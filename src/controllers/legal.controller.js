/**
 * legal.controller.js — the User Agreement and Privacy Policy.
 *
 * These were hardcoded spans on the signup page that looked like links but went
 * nowhere, so customers were ticking "I have read and agree" to documents they
 * could not open. They are now authored by the platform owner and served here.
 *
 * Three rules hold throughout:
 *
 *   1. **Published versions are immutable.** Editing terms creates a NEW
 *      version. A legal agreement is only meaningful if you can show what
 *      somebody agreed to on the day, and rewriting a published version
 *      destroys exactly that.
 *   2. **HTML is sanitised on write**, not on read, so what is stored is
 *      already safe for a public page.
 *   3. **The public read is unauthenticated.** Somebody deciding whether to
 *      sign up has no account yet, and terms they cannot read before agreeing
 *      are not terms.
 */
import { prisma } from '../lib/prisma.js';
import { sanitizeLegalHtml, htmlToText } from '../lib/sanitizeHtml.js';
import {
  legalSlugParamSchema,
  legalVersionParamSchema,
  legalDocumentCreateSchema,
  legalDocumentUpdateSchema,
  legalVersionWriteSchema,
  legalAcceptanceQuerySchema,
} from '../validations/legal.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

const PUBLISHED = { publishedAt: { not: null } };

/**
 * The live version of a document: the highest-numbered published one.
 * Exported because signup needs it to record what was accepted.
 */
export async function publishedVersionOf(slug, client = prisma) {
  return client.legalDocumentVersion.findFirst({
    where: { documentSlug: slug, ...PUBLISHED },
    orderBy: { version: 'desc' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

/** GET /legal — which documents exist, for a footer or a signup link. */
export async function listPublicLegalDocuments(req, res, next) {
  try {
    const docs = await prisma.legalDocument.findMany({
      orderBy: { title: 'asc' },
      select: {
        slug: true,
        title: true,
        description: true,
        versions: {
          where: PUBLISHED,
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, publishedAt: true },
        },
      },
    });

    res.json({
      // A document with no published version does not exist as far as the
      // public is concerned — a draft must never be linked to.
      items: docs
        .filter((d) => d.versions.length > 0)
        .map((d) => ({
          slug: d.slug,
          title: d.title,
          description: d.description,
          version: d.versions[0].version,
          publishedAt: d.versions[0].publishedAt,
        })),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /legal/:slug — the published document, for anyone. */
export async function getPublicLegalDocument(req, res, next) {
  try {
    const parsed = legalSlugParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const doc = await prisma.legalDocument.findUnique({
      where: { slug: parsed.data.slug },
      select: { slug: true, title: true, description: true },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const version = await publishedVersionOf(doc.slug);
    if (!version) {
      // Drafted but never published. Saying so is more useful than a 404 that
      // suggests the URL is wrong.
      return res.status(404).json({
        error: `${doc.title} has not been published yet.`,
        code: 'NOT_PUBLISHED',
      });
    }

    res.json({
      slug: doc.slug,
      title: version.title,
      description: doc.description,
      version: version.version,
      publishedAt: version.publishedAt,
      // Already sanitised when it was stored.
      bodyHtml: version.bodyHtml,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM OWNER
// ─────────────────────────────────────────────────────────────────────────────

/** GET /platform/legal */
export async function listLegalDocuments(req, res, next) {
  try {
    const docs = await prisma.legalDocument.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true, version: true, title: true, publishedAt: true,
            changeNote: true, authorId: true, createdAt: true, updatedAt: true,
          },
        },
      },
    });

    const acceptanceRows = await prisma.legalAcceptance.groupBy({
      by: ['versionId'],
      _count: { _all: true },
    });
    const acceptedBy = Object.fromEntries(acceptanceRows.map((r) => [r.versionId, r._count._all]));

    res.json({
      items: docs.map((d) => {
        const live = d.versions.find((v) => v.publishedAt);
        const draft = d.versions.find((v) => !v.publishedAt);
        return {
          slug: d.slug,
          title: d.title,
          description: d.description,
          createdAt: d.createdAt,
          published: live ? { ...live, acceptances: acceptedBy[live.id] || 0 } : null,
          // At most one draft is possible: a new draft is refused while one is
          // open, so the operator is never editing two futures at once.
          draft: draft || null,
          versionCount: d.versions.length,
          totalAcceptances: d.versions.reduce((a, v) => a + (acceptedBy[v.id] || 0), 0),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/legal/:slug — the document and every version of it. */
export async function getLegalDocument(req, res, next) {
  try {
    const parsed = legalSlugParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const doc = await prisma.legalDocument.findUnique({
      where: { slug: parsed.data.slug },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const [acceptanceRows, authors] = await Promise.all([
      prisma.legalAcceptance.groupBy({
        by: ['versionId'],
        where: { versionId: { in: doc.versions.map((v) => v.id) } },
        _count: { _all: true },
      }),
      prisma.tenantUser.findMany({
        where: { id: { in: [...new Set(doc.versions.map((v) => v.authorId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const acceptedBy = Object.fromEntries(acceptanceRows.map((r) => [r.versionId, r._count._all]));
    const nameOf = Object.fromEntries(authors.map((a) => [a.id, a.name]));

    res.json({
      document: {
        slug: doc.slug, title: doc.title, description: doc.description, createdAt: doc.createdAt,
      },
      versions: doc.versions.map((v) => ({
        ...v,
        author: nameOf[v.authorId] || 'Deleted account',
        acceptances: acceptedBy[v.id] || 0,
        // A published version can never be changed or removed; the UI reads
        // this rather than re-deriving the rule.
        immutable: Boolean(v.publishedAt),
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/legal */
export async function createLegalDocument(req, res, next) {
  try {
    const parsed = legalDocumentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { slug, title, description } = parsed.data;

    const existing = await prisma.legalDocument.findUnique({
      where: { slug }, select: { slug: true },
    });
    if (existing) {
      return res.status(409).json({ error: `A document already exists at /${slug}`, code: 'SLUG_TAKEN' });
    }

    const doc = await prisma.legalDocument.create({
      data: { slug, title, description: description ?? null },
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.LEGAL_DOCUMENT_CREATED,
      targetType: 'LEGAL_DOCUMENT',
      targetId: slug,
      afterValue: { slug, title },
    }).catch((err) => console.warn('[Legal] audit write failed:', err.message));

    res.status(201).json({ document: doc });
  } catch (err) {
    next(err);
  }
}

/** PATCH /platform/legal/:slug — title and description only; the body lives on versions. */
export async function updateLegalDocument(req, res, next) {
  try {
    const parsedParams = legalSlugParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = legalDocumentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const before = await prisma.legalDocument.findUnique({ where: { slug: parsedParams.data.slug } });
    if (!before) return res.status(404).json({ error: 'Document not found' });

    const doc = await prisma.legalDocument.update({
      where: { slug: before.slug },
      data: parsed.data,
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.LEGAL_DOCUMENT_UPDATED,
      targetType: 'LEGAL_DOCUMENT',
      targetId: doc.slug,
      beforeValue: { title: before.title },
      afterValue: { title: doc.title },
    }).catch((err) => console.warn('[Legal] audit write failed:', err.message));

    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /platform/legal/:slug — remove a document entirely.
 *
 * Refused the moment anybody has accepted any version of it. An acceptance is
 * the evidence of what a company agreed to, and deleting the document takes
 * that evidence with it — which is the one thing the versioning exists to
 * prevent. A document nobody has accepted is just a mistake, and removing a
 * mistake is fine.
 */
export async function deleteLegalDocument(req, res, next) {
  try {
    const parsed = legalSlugParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const doc = await prisma.legalDocument.findUnique({
      where: { slug: parsed.data.slug },
      include: { versions: { select: { id: true, version: true, publishedAt: true } } },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const accepted = await prisma.legalAcceptance.count({
      where: { versionId: { in: doc.versions.map((v) => v.id) } },
    });
    if (accepted > 0) {
      return res.status(409).json({
        error: `${doc.title} has been accepted by ${accepted} ${accepted === 1 ? 'company' : 'companies'}. Deleting it would destroy the record of what they agreed to. It cannot be removed.`,
        code: 'DOCUMENT_ACCEPTED',
        acceptances: accepted,
      });
    }

    const wasLive = doc.versions.some((v) => v.publishedAt);

    // Versions cascade with the document; the acceptance check above is what
    // makes that safe, since legal_acceptances holds a RESTRICT on the version.
    await prisma.legalDocument.delete({ where: { slug: doc.slug } });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.LEGAL_DOCUMENT_DELETED,
      targetType: 'LEGAL_DOCUMENT',
      targetId: doc.slug,
      beforeValue: { title: doc.title, versions: doc.versions.length, wasPublished: wasLive },
    }).catch((err) => console.warn('[Legal] audit write failed:', err.message));

    res.json({
      deleted: true,
      title: doc.title,
      versionsRemoved: doc.versions.length,
      note: wasLive
        ? `${doc.title} was live, so the signup page no longer links to it.`
        : null,
    });
  } catch (err) {
    if (err?.code === 'P2003') {
      // The database refused it, which means an acceptance appeared between
      // the check above and the delete. Report it as the same refusal.
      return res.status(409).json({
        error: 'This document has been accepted and cannot be deleted.',
        code: 'DOCUMENT_ACCEPTED',
      });
    }
    next(err);
  }
}

/**
 * POST /platform/legal/:slug/versions — start a new draft.
 *
 * Only one draft may be open at a time, so the operator is never editing two
 * competing futures of the same document.
 */
export async function createLegalVersion(req, res, next) {
  try {
    const parsedParams = legalSlugParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = legalVersionWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const doc = await prisma.legalDocument.findUnique({
      where: { slug: parsedParams.data.slug },
      select: { slug: true, title: true },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const openDraft = await prisma.legalDocumentVersion.findFirst({
      where: { documentSlug: doc.slug, publishedAt: null },
      select: { id: true, version: true },
    });
    if (openDraft) {
      return res.status(409).json({
        error: 'A draft is already open for this document. Publish or discard it before starting another.',
        code: 'DRAFT_EXISTS',
        versionId: openDraft.id,
      });
    }

    const highest = await prisma.legalDocumentVersion.findFirst({
      where: { documentSlug: doc.slug },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const version = await prisma.legalDocumentVersion.create({
      data: {
        documentSlug: doc.slug,
        version: (highest?.version || 0) + 1,
        title: parsed.data.title,
        // The editor's output is never trusted.
        bodyHtml: sanitizeLegalHtml(parsed.data.bodyHtml),
        changeNote: parsed.data.changeNote ?? null,
        authorId: req.user.id,
      },
    });

    res.status(201).json({ version });
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'That version number was just taken. Try again.' });
    }
    next(err);
  }
}

/**
 * PATCH /platform/legal/:slug/versions/:versionId — edit a DRAFT.
 *
 * Refused once published. That refusal is the whole point of versioning: if a
 * published version could be edited, the record of what a customer agreed to
 * would change underneath them.
 */
export async function updateLegalVersion(req, res, next) {
  try {
    const parsedParams = legalVersionParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = legalVersionWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const version = await prisma.legalDocumentVersion.findUnique({
      where: { id: parsedParams.data.versionId },
      select: { id: true, documentSlug: true, version: true, publishedAt: true },
    });
    if (!version || version.documentSlug !== parsedParams.data.slug) {
      return res.status(404).json({ error: 'Version not found' });
    }
    if (version.publishedAt) {
      return res.status(409).json({
        error: `Version ${version.version} is published and cannot be changed. Start a new version instead — that is what keeps the record of what customers agreed to.`,
        code: 'VERSION_PUBLISHED',
      });
    }

    const updated = await prisma.legalDocumentVersion.update({
      where: { id: version.id },
      data: {
        title: parsed.data.title,
        bodyHtml: sanitizeLegalHtml(parsed.data.bodyHtml),
        changeNote: parsed.data.changeNote ?? null,
      },
    });

    res.json({ version: updated });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/legal/:slug/versions/:versionId/publish — make it the live one. */
export async function publishLegalVersion(req, res, next) {
  try {
    const parsed = legalVersionParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const version = await prisma.legalDocumentVersion.findUnique({
      where: { id: parsed.data.versionId },
    });
    if (!version || version.documentSlug !== parsed.data.slug) {
      return res.status(404).json({ error: 'Version not found' });
    }
    if (version.publishedAt) {
      return res.status(409).json({ error: `Version ${version.version} is already published` });
    }
    if (htmlToText(version.bodyHtml).length < 50) {
      return res.status(400).json({
        error: 'This version is nearly empty. Publishing it would replace your live terms with a blank page.',
        code: 'BODY_TOO_SHORT',
      });
    }

    const previous = await publishedVersionOf(version.documentSlug);

    const published = await prisma.legalDocumentVersion.update({
      where: { id: version.id },
      data: { publishedAt: new Date() },
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.LEGAL_VERSION_PUBLISHED,
      targetType: 'LEGAL_DOCUMENT',
      targetId: version.documentSlug,
      beforeValue: previous ? { version: previous.version } : null,
      afterValue: { version: published.version, title: published.title },
      reason: version.changeNote || null,
    }).catch((err) => console.warn('[Legal] audit write failed:', err.message));

    res.json({
      version: published,
      // Earlier versions stay exactly as they were; only new acceptances use
      // the new one. Said out loud because it is the question an operator has.
      note: previous
        ? `Version ${published.version} is now live. Version ${previous.version} is kept unchanged for everyone who already accepted it.`
        : `Version ${published.version} is now live.`,
    });
  } catch (err) {
    next(err);
  }
}

/** DELETE /platform/legal/:slug/versions/:versionId — discard a draft. */
export async function deleteLegalVersion(req, res, next) {
  try {
    const parsed = legalVersionParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const version = await prisma.legalDocumentVersion.findUnique({
      where: { id: parsed.data.versionId },
      select: { id: true, documentSlug: true, version: true, publishedAt: true },
    });
    if (!version || version.documentSlug !== parsed.data.slug) {
      return res.status(404).json({ error: 'Version not found' });
    }
    // A published version is evidence. It is never deletable, whether or not
    // anybody has accepted it yet.
    if (version.publishedAt) {
      return res.status(409).json({
        error: `Version ${version.version} is published and cannot be deleted. Publish a newer version to supersede it.`,
        code: 'VERSION_PUBLISHED',
      });
    }

    await prisma.legalDocumentVersion.delete({ where: { id: version.id } });
    res.json({ deleted: true, version: version.version });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/legal/:slug/acceptances — who agreed, to which version, when. */
export async function listLegalAcceptances(req, res, next) {
  try {
    const parsedParams = legalSlugParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = legalAcceptanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { page, limit } = parsed.data;

    const where = { version: { documentSlug: parsedParams.data.slug } };
    const [total, rows] = await Promise.all([
      prisma.legalAcceptance.count({ where }),
      prisma.legalAcceptance.findMany({
        where,
        orderBy: { acceptedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { version: { select: { version: true, title: true } } },
      }),
    ]);

    // The company that accepted, resolved by id so the row survives the
    // registration being removed.
    const regIds = [...new Set(rows.map((r) => r.registrationId).filter(Boolean))];
    const regs = regIds.length
      ? await prisma.companyRegistration.findMany({
          where: { id: { in: regIds } },
          select: { id: true, companyName: true, email: true },
        })
      : [];
    const regBy = Object.fromEntries(regs.map((r) => [r.id, r]));

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        version: r.version.version,
        acceptedAt: r.acceptedAt,
        ipAddress: r.ipAddress,
        company: regBy[r.registrationId]?.companyName || null,
        email: regBy[r.registrationId]?.email || null,
        registrationId: r.registrationId,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}
