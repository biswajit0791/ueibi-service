import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { 
  updateHubProfileSchema, 
  createHubEventSchema, 
  updateHubEventSchema,
  getHubEventsQuerySchema,
  eventIdParamSchema,
  getTeamQuerySchema
} from "../validations/hub.schema.js";

let tableEnsured = false;
async function ensureHubEventsTable() {
  if (tableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "hub_events" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "date" TEXT NOT NULL,
        "time" TEXT,
        "location" TEXT,
        "description" TEXT NOT NULL,
        "isFeatured" BOOLEAN NOT NULL DEFAULT true,
        "createdById" TEXT NOT NULL,
        "postedBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hub_events_tenantId_idx" ON "hub_events"("tenantId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hub_events_createdById_idx" ON "hub_events"("createdById");`);
    tableEnsured = true;
  } catch (e) {
    console.error("Failed to ensure hub_events table:", e.message);
  }
}

export async function getTeam(req, res, next) {
  try {
    const tenantId = req.tenantId;

    const parsed = getTeamQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      const issues = parsed.error?.issues || parsed.error?.errors || [];
      return res.status(400).json({
        error: "Validation failed",
        details: issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const { search, department } = parsed.data;
    const where = { tenantId, isDeleted: false, status: { not: "EXITED" } };

    if (department) {
      where.department = { contains: department, mode: "insensitive" };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { designation: { contains: search, mode: "insensitive" } },
        { department: { contains: search, mode: "insensitive" } },
      ];
    }

    const users = await prisma.tenantUser.findMany({
      where,
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, role: true, designation: true,
        department: true, status: true, joinDate: true,
        hubBio: true, hubBirthday: true, profileSnaps: true,
      },
    });
    const items = users.map((u) => ({
      id: u.id, name: u.name, role: u.role,
      designation: u.designation || "", department: u.department || "",
      status: u.status, joinDate: u.joinDate,
      hubBio: u.hubBio || "", hubBirthday: u.hubBirthday || "",
      profileSnaps: Array.isArray(u.profileSnaps) ? u.profileSnaps : [],
      initials: u.name.trim().split(/\s+/).map((w) => w[0]).join("").substring(0, 2).toUpperCase(),
    }));
    res.json({ items });
  } catch (err) { next(err); }
}

export async function updateMyHubProfile(req, res, next) {
  try {
    const userId = req.user.id;

    const parsed = updateHubProfileSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issues = parsed.error?.issues || parsed.error?.errors || [];
      return res.status(400).json({
        error: "Validation failed",
        details: issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const { name, hubBio, hubBirthday, profileSnaps } = parsed.data;
    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (hubBio !== undefined) data.hubBio = hubBio;
    if (hubBirthday !== undefined) data.hubBirthday = hubBirthday ? hubBirthday.trim() : null;
    if (profileSnaps !== undefined) data.profileSnaps = profileSnaps;

    const updated = await prisma.tenantUser.update({
      where: { id: userId }, data,
      select: { id: true, name: true, hubBio: true, hubBirthday: true, profileSnaps: true },
    });
    res.json({
      message: "Hub profile updated successfully",
      profile: { ...updated, profileSnaps: Array.isArray(updated.profileSnaps) ? updated.profileSnaps : [] },
    });
  } catch (err) { next(err); }
}

export async function getHubEvents(req, res, next) {
  try {
    await ensureHubEventsTable();
    const tenantId = req.tenantId;
    const user = req.user;

    const parsed = getHubEventsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      const issues = parsed.error?.issues || parsed.error?.errors || [];
      return res.status(400).json({
        error: "Validation failed",
        details: issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const { search, filter, sortBy, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    if (prisma.hubEvent) {
      const where = { tenantId };
      if (filter === "featured") {
        where.isFeatured = true;
      } else if (filter === "mine") {
        where.createdById = user.id;
      }

      if (search) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { location: { contains: search, mode: "insensitive" } },
          { postedBy: { contains: search, mode: "insensitive" } },
        ];
      }

      let orderBy = { createdAt: "desc" };
      if (sortBy === "oldest") orderBy = { createdAt: "asc" };
      else if (sortBy === "title_asc") orderBy = { title: "asc" };
      else if (sortBy === "title_desc") orderBy = { title: "desc" };

      const [total, items] = await Promise.all([
        prisma.hubEvent.count({ where }),
        prisma.hubEvent.findMany({
          where,
          orderBy,
          skip,
          take: limit,
        }),
      ]);

      const totalPages = Math.ceil(total / limit) || 1;
      return res.json({
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    }

    // Raw PostgreSQL fallback
    const whereClauses = [`"tenantId" = $1`];
    const params = [tenantId];
    let paramIdx = 2;

    if (filter === "featured") {
      whereClauses.push(`"isFeatured" = true`);
    } else if (filter === "mine") {
      whereClauses.push(`"createdById" = $${paramIdx++}`);
      params.push(user.id);
    }

    if (search) {
      const sTerm = `%${search}%`;
      whereClauses.push(`(
        "title" ILIKE $${paramIdx} OR
        "description" ILIKE $${paramIdx} OR
        "location" ILIKE $${paramIdx} OR
        "postedBy" ILIKE $${paramIdx}
      )`);
      params.push(sTerm);
      paramIdx++;
    }

    const whereSql = whereClauses.join(" AND ");

    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "hub_events" WHERE ${whereSql}`,
      ...params
    );
    const total = Number(countRows[0]?.count || 0);

    let orderSql = `"createdAt" DESC`;
    if (sortBy === "oldest") orderSql = `"createdAt" ASC`;
    else if (sortBy === "title_asc") orderSql = `"title" ASC`;
    else if (sortBy === "title_desc") orderSql = `"title" DESC`;

    const limitParamIdx = paramIdx++;
    const offsetParamIdx = paramIdx++;
    const itemsQuery = `
      SELECT * FROM "hub_events" 
      WHERE ${whereSql} 
      ORDER BY ${orderSql} 
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `;
    const itemsParams = [...params, limit, skip];
    const items = await prisma.$queryRawUnsafe(itemsQuery, ...itemsParams);

    const totalPages = Math.ceil(total / limit) || 1;
    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function createHubEvent(req, res, next) {
  try {
    await ensureHubEventsTable();
    const tenantId = req.tenantId;
    const user = req.user;

    // Verify authorized role for publishing corporate announcements
    const allowedRoles = ["HR", "MANAGER", "CMD", "OWNER", "ADMIN", "SUPER_ADMIN", "LEADERSHIP"];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: "Forbidden: Only HR, Managers, or Leadership can post corporate events",
      });
    }

    const parsed = createHubEventSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issues = parsed.error?.issues || parsed.error?.errors || [];
      return res.status(400).json({
        error: "Validation failed",
        details: issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const { title, date, time, location, description, isFeatured, postedBy: reqPostedBy } = parsed.data;
    const eventTime = time ? time.trim() : null;
    const eventLocation = location ? location.trim() : null;
    const featured = isFeatured !== undefined ? isFeatured : true;
    const postedBy = reqPostedBy?.trim() || user.name || (user.email ? user.email.split('@')[0] : "Corporate HR");

    if (prisma.hubEvent) {
      const event = await prisma.hubEvent.create({
        data: {
          tenantId,
          createdById: user.id,
          postedBy,
          title,
          date,
          time: eventTime,
          location: eventLocation,
          description,
          isFeatured: featured,
        },
      });
      return res.status(201).json({ message: "Event published successfully", event });
    }

    const id = `ev_${randomUUID()}`;
    const now = new Date();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "hub_events" ("id", "tenantId", "createdById", "postedBy", "title", "date", "time", "location", "description", "isFeatured", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      id, tenantId, user.id, postedBy, title, date, eventTime, eventLocation, description, featured, now, now
    );

    const event = {
      id,
      tenantId,
      createdById: user.id,
      postedBy,
      title,
      date,
      time: eventTime,
      location: eventLocation,
      description,
      isFeatured: featured,
      createdAt: now,
      updatedAt: now,
    };

    res.status(201).json({ message: "Event published successfully", event });
  } catch (err) {
    next(err);
  }
}

export async function deleteHubEvent(req, res, next) {
  try {
    await ensureHubEventsTable();
    const tenantId = req.tenantId;
    const user = req.user;

    const paramParsed = eventIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      const issues = paramParsed.error?.issues || paramParsed.error?.errors || [];
      return res.status(400).json({
        error: "Validation failed",
        details: issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    const { id } = paramParsed.data;

    let event = null;
    if (prisma.hubEvent) {
      event = await prisma.hubEvent.findFirst({
        where: { id, tenantId },
      });
    } else {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "hub_events" WHERE "id" = $1 AND "tenantId" = $2 LIMIT 1`,
        id, tenantId
      );
      event = rows[0] || null;
    }

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Only author or HR/Management can delete
    const privilegedRoles = ["HR", "CMD", "OWNER", "ADMIN", "SUPER_ADMIN", "LEADERSHIP"];
    const isAuthor = event.createdById === user.id;
    if (!isAuthor && !privilegedRoles.includes(user.role)) {
      return res.status(403).json({ error: "Forbidden: You are not authorized to delete this event" });
    }

    if (prisma.hubEvent) {
      await prisma.hubEvent.delete({ where: { id } });
    } else {
      await prisma.$executeRawUnsafe(`DELETE FROM "hub_events" WHERE "id" = $1`, id);
    }

    res.json({ message: "Event deleted successfully", id });
  } catch (err) {
    next(err);
  }
}

export async function updateHubEvent(req, res, next) {
  try {
    await ensureHubEventsTable();
    const tenantId = req.tenantId;
    const user = req.user;

    const paramParsed = eventIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      const issues = paramParsed.error?.issues || paramParsed.error?.errors || [];
      return res.status(400).json({
        error: "Validation failed",
        details: issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    const { id } = paramParsed.data;

    let event = null;
    if (prisma.hubEvent) {
      event = await prisma.hubEvent.findFirst({
        where: { id, tenantId },
      });
    } else {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "hub_events" WHERE "id" = $1 AND "tenantId" = $2 LIMIT 1`,
        id, tenantId
      );
      event = rows[0] || null;
    }

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Only author or HR/Management can update
    const privilegedRoles = ["HR", "CMD", "OWNER", "ADMIN", "SUPER_ADMIN", "LEADERSHIP"];
    const isAuthor = event.createdById === user.id;
    if (!isAuthor && !privilegedRoles.includes(user.role)) {
      return res.status(403).json({ error: "Forbidden: You are not authorized to update this event" });
    }

    const parsed = updateHubEventSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issues = parsed.error?.issues || parsed.error?.errors || [];
      return res.status(400).json({
        error: "Validation failed",
        details: issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const { title, date, time, location, description, isFeatured, postedBy } = parsed.data;

    if (prisma.hubEvent) {
      const updated = await prisma.hubEvent.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(date !== undefined ? { date } : {}),
          ...(time !== undefined ? { time } : {}),
          ...(location !== undefined ? { location } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(isFeatured !== undefined ? { isFeatured } : {}),
          ...(postedBy !== undefined ? { postedBy: postedBy.trim() } : {}),
        },
      });
      return res.json({ message: "Event updated successfully", event: updated });
    }

    // Raw SQL update fallback
    const newTitle = title !== undefined ? title : event.title;
    const newDate = date !== undefined ? date : event.date;
    const newTime = time !== undefined ? time : event.time;
    const newLocation = location !== undefined ? location : event.location;
    const newDescription = description !== undefined ? description : event.description;
    const newFeatured = isFeatured !== undefined ? isFeatured : event.isFeatured;
    const newPostedBy = postedBy !== undefined ? postedBy.trim() : event.postedBy;
    const now = new Date();

    await prisma.$executeRawUnsafe(
      `UPDATE "hub_events" 
       SET "title" = $1, "date" = $2, "time" = $3, "location" = $4, "description" = $5, "isFeatured" = $6, "postedBy" = $7, "updatedAt" = $8
       WHERE "id" = $9 AND "tenantId" = $10`,
      newTitle, newDate, newTime, newLocation, newDescription, newFeatured, newPostedBy, now, id, tenantId
    );

    const updated = {
      ...event,
      title: newTitle,
      date: newDate,
      time: newTime,
      location: newLocation,
      description: newDescription,
      isFeatured: newFeatured,
      updatedAt: now,
    };

    res.json({ message: "Event updated successfully", event: updated });
  } catch (err) {
    next(err);
  }
}


