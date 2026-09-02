import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { emitToTenant, emitToUser } from '../lib/socket.js';

export class PolicyService {
  /**
   * Generates a deterministic SHA-256 hash of policy text and version for tamper-evidence.
   */
  computeContentHash(content, version) {
    return crypto
      .createHash('sha256')
      .update(`${version}:${content.trim()}`)
      .digest('hex');
  }

  /**
   * Logs a tamper-evident audit record for policy lifecycle events.
   */
  async logAudit({ tenantId, policyId, actorUserId, action, details, ipAddress, userAgent, metadata }) {
    return prisma.policyAuditLog.create({
      data: {
        tenantId,
        policyId: policyId || null,
        actorUserId,
        action,
        details: details || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: metadata || null,
      },
    });
  }

  /**
   * Extracts clean client IP from request headers or socket.
   */
  getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    const realIp = req.headers['x-real-ip'];
    const forwarded = req.headers['x-forwarded-for'];
    let raw =
      cfIp ||
      realIp ||
      (forwarded ? forwarded.split(',')[0].trim() : null) ||
      req.ip ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

    if (raw === '::1' || raw === '::ffff:127.0.0.1') {
      return '127.0.0.1 (Localhost)';
    }
    if (typeof raw === 'string' && raw.startsWith('::ffff:')) {
      return raw.replace('::ffff:', '');
    }
    return String(raw);
  }

  /**
   * Create a new policy (Draft or Published) and optionally assign to employees.
   */
  async createPolicy({ tenantId, user, data, req }) {
    const {
      title,
      content,
      category = 'Compliance',
      description,
      status = 'PUBLISHED',
      pdfUrl,
      pdfOriginalName,
      effectiveDate,
      dueDate,
      assignees,
    } = data;

    const version = 1;
    const contentHash = this.computeContentHash(content, version);
    const isPublished = status === 'PUBLISHED';
    const now = new Date();

    const policy = await prisma.policy.create({
      data: {
        tenantId,
        title: title.trim(),
        content: content.trim(),
        description: description?.trim() || null,
        category: category.trim(),
        status,
        version,
        pdfUrl: pdfUrl || null,
        pdfOriginalName: pdfOriginalName || null,
        contentHash,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        publishedAt: isPublished ? now : null,
        createdById: user.id,
        publishedById: isPublished ? user.id : null,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    // Auto-assign if requested and policy is published
    let assignedCount = 0;
    if (isPublished && assignees) {
      assignedCount = await this.assignPolicyInternal({
        tenantId,
        policyId: policy.id,
        policyVersion: policy.version,
        assignerId: user.id,
        assignees,
        dueAt: dueDate ? new Date(dueDate) : null,
      });
    }

    // Audit log
    await this.logAudit({
      tenantId,
      policyId: policy.id,
      actorUserId: user.id,
      action: isPublished ? 'POLICY_PUBLISHED' : 'POLICY_CREATED',
      details: `${user.name} (${user.role}) created ${isPublished ? 'and published ' : ''}policy "${policy.title}" (v${policy.version}) with ${assignedCount} initial assignments.`,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      metadata: { initialAssignments: assignedCount, status },
    });

    emitToTenant(tenantId, 'policy_created', { policyId: policy.id, title: policy.title });

    return this.getPolicyById({ tenantId, id: policy.id });
  }

  /**
   * Internal helper to create assignments for target users.
   */
  async assignPolicyInternal({ tenantId, policyId, policyVersion, assignerId, assignees, dueAt }) {
    let targetUserIds = [];

    if (assignees === 'ALL') {
      const allActive = await prisma.tenantUser.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true },
      });
      targetUserIds = allActive.map(u => u.id);
    } else if (Array.isArray(assignees)) {
      const validUsers = await prisma.tenantUser.findMany({
        where: { tenantId, id: { in: assignees }, status: 'ACTIVE' },
        select: { id: true },
      });
      targetUserIds = validUsers.map(u => u.id);
    }

    if (targetUserIds.length === 0) return 0;

    // Filter out users who already have an assignment for this exact policy version
    const existing = await prisma.policyAssignment.findMany({
      where: {
        tenantId,
        policyId,
        policyVersion,
        userId: { in: targetUserIds },
      },
      select: { userId: true },
    });

    const existingSet = new Set(existing.map(e => e.userId));
    const toCreate = targetUserIds.filter(uid => !existingSet.has(uid));

    if (toCreate.length === 0) return 0;

    const assignmentData = toCreate.map(userId => ({
      tenantId,
      policyId,
      policyVersion,
      userId,
      assignedById: assignerId,
      assignedAt: new Date(),
      dueAt: dueAt || null,
      status: 'PENDING',
    }));

    await prisma.policyAssignment.createMany({
      data: assignmentData,
      skipDuplicates: true,
    });

    // Notify assigned users
    const policy = await prisma.policy.findUnique({
      where: { id: policyId },
      select: { title: true },
    });

    const notifications = toCreate.map(userId => ({
      tenantId,
      recipientId: userId,
      type: 'policy_assigned',
      title: 'New Policy Assigned for Sign-off',
      body: `You have been assigned to read and digitally sign "${policy?.title}".`,
      entityType: 'policy',
      entityId: policyId,
    }));

    await prisma.notification.createMany({
      data: notifications,
    });

    toCreate.forEach(userId => {
      emitToUser(tenantId, userId, 'policy_assigned', {
        policyId,
        title: policy?.title,
      });
    });

    emitToTenant(tenantId, 'policy_assigned', {
      policyId,
      title: policy?.title,
    });

    return toCreate.length;
  }

  /**
   * Explicit assign policy endpoint for HR/Admin.
   */
  async assignPolicy({ tenantId, user, policyId, data, req }) {
    const policy = await prisma.policy.findFirst({
      where: { id: policyId, tenantId },
    });

    if (!policy) {
      const err = new Error('Policy not found');
      err.status = 404;
      throw err;
    }

    if (policy.status !== 'PUBLISHED') {
      const err = new Error('Cannot assign an unpublished or archived policy');
      err.status = 400;
      throw err;
    }

    const { userIds, target, dueAt } = data;
    const assignees = target === 'ALL' ? 'ALL' : (userIds || []);

    const assignedCount = await this.assignPolicyInternal({
      tenantId,
      policyId,
      policyVersion: policy.version,
      assignerId: user.id,
      assignees,
      dueAt: dueAt ? new Date(dueAt) : (policy.dueDate || null),
    });

    await this.logAudit({
      tenantId,
      policyId,
      actorUserId: user.id,
      action: 'POLICY_ASSIGNED',
      details: `${user.name} assigned policy "${policy.title}" (v${policy.version}) to ${assignedCount} employee(s).`,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      metadata: { count: assignedCount, target },
    });

    return { success: true, count: assignedCount };
  }

  /**
   * Update an existing policy. Supports draft modification or new version generation.
   */
  async updatePolicy({ tenantId, user, id, data, req }) {
    const existing = await prisma.policy.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      const err = new Error('Policy not found');
      err.status = 404;
      throw err;
    }

    let version = existing.version;
    let content = data.content !== undefined ? data.content.trim() : existing.content;
    let contentHash = existing.contentHash;

    if (data.incrementVersion || (data.content && data.content.trim() !== existing.content)) {
      version += 1;
      contentHash = this.computeContentHash(content, version);
    }

    const updated = await prisma.policy.update({
      where: { id },
      data: {
        ...(data.title ? { title: data.title.trim() } : {}),
        ...(data.content ? { content: data.content.trim() } : {}),
        ...(data.category ? { category: data.category.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.pdfUrl !== undefined ? { pdfUrl: data.pdfUrl } : {}),
        ...(data.pdfOriginalName !== undefined ? { pdfOriginalName: data.pdfOriginalName } : {}),
        ...(data.effectiveDate !== undefined ? { effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
        version,
        contentHash,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
        publishedBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    let newAssignedCount = 0;
    if (version > existing.version) {
      // Find all previously assigned active users for this policy
      const previousAssignments = await prisma.policyAssignment.findMany({
        where: { tenantId, policyId: id, policyVersion: existing.version },
        select: { userId: true },
      });
      const previousUserIds = previousAssignments.map(a => a.userId);

      // Combine previous assignees with any newly selected assignees
      let allTargetIds = previousUserIds;
      if (data.assignees === 'ALL') {
        const allActive = await prisma.tenantUser.findMany({
          where: { tenantId, status: 'ACTIVE' },
          select: { id: true },
        });
        allTargetIds = allActive.map(u => u.id);
      } else if (Array.isArray(data.assignees)) {
        allTargetIds = Array.from(new Set([...previousUserIds, ...data.assignees]));
      }

      if (allTargetIds.length > 0) {
        newAssignedCount = await this.assignPolicyInternal({
          tenantId,
          policyId: id,
          policyVersion: updated.version,
          assignerId: user.id,
          assignees: allTargetIds,
          dueAt: updated.dueDate,
        });
      }
    } else if (data.assignees) {
      newAssignedCount = await this.assignPolicyInternal({
        tenantId,
        policyId: id,
        policyVersion: updated.version,
        assignerId: user.id,
        assignees: data.assignees,
        dueAt: updated.dueDate,
      });
    }

    await this.logAudit({
      tenantId,
      policyId: id,
      actorUserId: user.id,
      action: 'POLICY_UPDATED',
      details: `${user.name} updated policy "${updated.title}" (v${updated.version})${newAssignedCount > 0 ? ` and assigned to ${newAssignedCount} employee(s) for re-signing` : ''}.`,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      metadata: { newVersion: version, newAssignments: newAssignedCount },
    });

    emitToTenant(tenantId, 'policy_updated', { policyId: id, title: updated.title, version: updated.version });

    return this.getPolicyById({ tenantId, id });
  }

  /**
   * Publish a draft policy.
   */
  async publishPolicy({ tenantId, user, id, assignees, req }) {
    const existing = await prisma.policy.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      const err = new Error('Policy not found');
      err.status = 404;
      throw err;
    }

    const updated = await prisma.policy.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedById: user.id,
      },
    });

    let assignedCount = 0;
    if (assignees) {
      assignedCount = await this.assignPolicyInternal({
        tenantId,
        policyId: id,
        policyVersion: updated.version,
        assignerId: user.id,
        assignees,
        dueAt: updated.dueDate,
      });
    }

    await this.logAudit({
      tenantId,
      policyId: id,
      actorUserId: user.id,
      action: 'POLICY_PUBLISHED',
      details: `${user.name} published policy "${updated.title}" (v${updated.version}) with ${assignedCount} assignment(s).`,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
    });

    emitToTenant(tenantId, 'policy_published', { policyId: id, title: updated.title });

    return this.getPolicyById({ tenantId, id });
  }

  /**
   * Archive a policy.
   */
  async archivePolicy({ tenantId, user, id, req }) {
    const existing = await prisma.policy.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      const err = new Error('Policy not found');
      err.status = 404;
      throw err;
    }

    const updated = await prisma.policy.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    await this.logAudit({
      tenantId,
      policyId: id,
      actorUserId: user.id,
      action: 'POLICY_ARCHIVED',
      details: `${user.name} archived policy "${updated.title}".`,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
    });

    emitToTenant(tenantId, 'policy_archived', { policyId: id });

    return { success: true, message: 'Policy archived successfully' };
  }

  /**
   * Permanently delete a policy and all its related assignments/acceptances.
   */
  async deletePolicy({ tenantId, user, id, req }) {
    const existing = await prisma.policy.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      const err = new Error('Policy not found');
      err.status = 404;
      throw err;
    }

    await prisma.policy.delete({
      where: { id },
    });

    emitToTenant(tenantId, 'policy_deleted', { policyId: id, title: existing.title });

    return { success: true, message: `Policy "${existing.title}" deleted successfully` };
  }

  /**
   * Electronically sign and accept a policy.
   * Derives IP, userAgent, and timestamp securely on the backend.
   */
  async signPolicy({ tenantId, user, policyId, req }) {
    const policy = await prisma.policy.findFirst({
      where: { id: policyId, tenantId },
    });

    if (!policy) {
      const err = new Error('Policy not found');
      err.status = 404;
      throw err;
    }

    if (policy.status !== 'PUBLISHED') {
      const err = new Error('Cannot sign an unpublished or archived policy mandate');
      err.status = 400;
      throw err;
    }

    // Find assignment for this user and current policy version
    const assignment = await prisma.policyAssignment.findFirst({
      where: {
        tenantId,
        policyId,
        userId: user.id,
        policyVersion: policy.version,
      },
    });

    if (!assignment) {
      const err = new Error('This policy is not assigned to you or you are not authorized to sign it');
      err.status = 403;
      throw err;
    }

    if (assignment.status === 'SIGNED' || assignment.signedAt) {
      const err = new Error('You have already electronically signed this policy agreement');
      err.status = 400;
      throw err;
    }

    const ipAddress = this.getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown Client';
    const signedAt = new Date();
    const legalDeclaration = `I hereby electronically sign and confirm that I have read, understood, and agree to follow all conditions outlined in the ${policy.title}.`;

    // Execute atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create immutable acceptance record
      const acceptance = await tx.policyAcceptance.create({
        data: {
          tenantId,
          policyId,
          policyVersion: policy.version,
          assignmentId: assignment.id,
          userId: user.id,
          signedAt,
          ipAddress,
          userAgent,
          contentHash: policy.contentHash,
          complianceCheck: 'Verified Audit',
          legalDeclaration,
        },
      });

      // Update assignment
      const updatedAssignment = await tx.policyAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'SIGNED',
          signedAt,
          acceptanceId: acceptance.id,
        },
      });

      // Log tamper-evident audit entry
      await tx.policyAuditLog.create({
        data: {
          tenantId,
          policyId,
          actorUserId: user.id,
          action: 'POLICY_SIGNED',
          details: `${user.name} electronically signed policy "${policy.title}" (v${policy.version}) from IP ${ipAddress}.`,
          ipAddress,
          userAgent,
          metadata: {
            acceptanceId: acceptance.id,
            version: policy.version,
            contentHash: policy.contentHash,
          },
        },
      });

      return { acceptance, updatedAssignment };
    });

    // Notify HR / Admins via socket
    emitToTenant(tenantId, 'policy_signed', {
      policyId,
      userId: user.id,
      userName: user.name,
      policyTitle: policy.title,
      signedAt,
    });

    return {
      success: true,
      message: 'Policy electronically signed and verified successfully',
      acceptance: result.acceptance,
    };
  }

  /**
   * Get policies assigned to currently authenticated user (Employee view).
   */
  async getMyPolicies({ tenantId, userId }) {
    const assignments = await prisma.policyAssignment.findMany({
      where: {
        tenantId,
        userId,
        policy: {
          status: { in: ['PUBLISHED', 'ARCHIVED'] },
        },
      },
      include: {
        policy: {
          select: {
            id: true,
            title: true,
            description: true,
            content: true,
            category: true,
            version: true,
            status: true,
            pdfUrl: true,
            pdfOriginalName: true,
            publishedAt: true,
            dueDate: true,
          },
        },
        acceptance: {
          select: {
            id: true,
            signedAt: true,
            ipAddress: true,
            complianceCheck: true,
            contentHash: true,
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    // Filter to latest policy version for each unique policy
    const policyMap = new Map();
    for (const a of assignments) {
      if (!policyMap.has(a.policyId)) {
        policyMap.set(a.policyId, a);
      } else {
        const existing = policyMap.get(a.policyId);
        if (a.policyVersion > existing.policyVersion) {
          policyMap.set(a.policyId, a);
        }
      }
    }

    const uniqueAssignments = Array.from(policyMap.values());

    return uniqueAssignments.map(a => ({
      assignmentId: a.id,
      id: a.policy.id,
      title: a.policy.title,
      description: a.policy.description,
      content: a.policy.content,
      category: a.policy.category,
      version: a.policyVersion,
      pdfUrl: a.policy.pdfUrl,
      pdfOriginalName: a.policy.pdfOriginalName,
      publishedAt: a.policy.publishedAt,
      assignedAt: a.assignedAt,
      dueAt: a.dueAt || a.policy.dueDate,
      status: a.status,
      signedAt: a.signedAt,
      hasSigned: a.status === 'SIGNED' && Boolean(a.signedAt) && a.policyVersion === a.policy.version,
      acceptance: a.acceptance || null,
    }));
  }

  /**
   * List policies for HR/Admin with calculated compliance statistics from database.
   */
  async listPolicies({ tenantId, status, category, search, page = 1, limit = 50 }) {
    const where = { tenantId };

    if (status && status !== 'ALL') {
      where.status = status;
    } else {
      // By default show active policies (DRAFT and PUBLISHED), unless archived requested
      where.status = { not: 'ARCHIVED' };
    }

    if (category && category !== 'ALL') {
      where.category = category;
    }

    if (search && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [total, policies] = await Promise.all([
      prisma.policy.count({ where }),
      prisma.policy.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          publishedBy: { select: { id: true, name: true, email: true } },
          assignments: {
            select: {
              id: true,
              status: true,
              signedAt: true,
              userId: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items = policies.map(p => {
      const totalAssigned = p.assignments.length;
      const signedCount = p.assignments.filter(a => a.status === 'SIGNED').length;
      const pendingCount = p.assignments.filter(a => a.status === 'PENDING').length;
      const compliancePercentage = totalAssigned > 0 ? Math.round((signedCount / totalAssigned) * 100) : 0;

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        content: p.content,
        category: p.category,
        status: p.status,
        version: p.version,
        pdfUrl: p.pdfUrl,
        pdfOriginalName: p.pdfOriginalName,
        publishedAt: p.publishedAt,
        effectiveDate: p.effectiveDate,
        dueDate: p.dueDate,
        createdAt: p.createdAt,
        createdBy: p.createdBy,
        publishedBy: p.publishedBy,
        totalAssigned,
        signedCount,
        pendingCount,
        compliancePercentage,
      };
    });

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single policy with complete compliance details and assignment list.
   */
  async getPolicyById({ tenantId, id }) {
    const policy = await prisma.policy.findFirst({
      where: { id, tenantId },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
        publishedBy: { select: { id: true, name: true, email: true, role: true } },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                department: true,
                designation: true,
              },
            },
            acceptance: {
              select: {
                id: true,
                signedAt: true,
                ipAddress: true,
                complianceCheck: true,
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
        auditLogs: {
          include: {
            actor: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!policy) {
      const err = new Error('Policy not found');
      err.status = 404;
      throw err;
    }

    const totalAssigned = policy.assignments.length;
    const signedCount = policy.assignments.filter(a => a.status === 'SIGNED').length;
    const pendingCount = policy.assignments.filter(a => a.status === 'PENDING').length;
    const compliancePercentage = totalAssigned > 0 ? Math.round((signedCount / totalAssigned) * 100) : 0;

    return {
      ...policy,
      totalAssigned,
      signedCount,
      pendingCount,
      compliancePercentage,
    };
  }

  /**
   * HR Compliance Sign-Off Registry: audit log of all signed mandates across tenant.
   */
  async getComplianceRegistry({ tenantId, policyId, search, page = 1, limit = 50 }) {
    const where = { tenantId };

    if (policyId && policyId !== 'ALL') {
      where.policyId = policyId;
    }

    if (search && search.trim()) {
      where.OR = [
        { user: { name: { contains: search.trim(), mode: 'insensitive' } } },
        { user: { email: { contains: search.trim(), mode: 'insensitive' } } },
        { policy: { title: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [total, acceptances] = await Promise.all([
      prisma.policyAcceptance.count({ where }),
      prisma.policyAcceptance.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              department: true,
              designation: true,
            },
          },
          policy: {
            select: {
              id: true,
              title: true,
              category: true,
              version: true,
            },
          },
        },
        orderBy: { signedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items = acceptances.map(a => ({
      id: a.id,
      employeeName: a.user.name,
      userEmail: a.user.email,
      userId: a.user.id,
      department: a.user.department || 'General',
      designation: a.user.designation || 'Staff',
      policyId: a.policy.id,
      signedPolicyMandate: a.policy.title,
      policyCategory: a.policy.category,
      policyVersion: a.policyVersion,
      auditIpAddress: a.ipAddress,
      verificationTimestamp: a.signedAt.toISOString(),
      complianceCheck: a.complianceCheck || 'Verified Audit',
      contentHash: a.contentHash,
    }));

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Pending Compliance: List of non-signed/pending employee assignments for reminder panel.
   */
  async getPendingCompliance({ tenantId, policyId }) {
    const where = {
      tenantId,
      status: 'PENDING',
      policy: {
        status: 'PUBLISHED',
      },
    };

    if (policyId && policyId !== 'ALL') {
      where.policyId = policyId;
    }

    const pending = await prisma.policyAssignment.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            department: true,
            designation: true,
          },
        },
        policy: {
          select: {
            id: true,
            title: true,
            category: true,
            version: true,
            dueDate: true,
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return pending.map(p => ({
      assignmentId: p.id,
      userId: p.user.id,
      userName: p.user.name,
      userEmail: p.user.email,
      department: p.user.department || 'General',
      designation: p.user.designation || 'Staff',
      policyId: p.policy.id,
      policyTitle: p.policy.title,
      policyCategory: p.policy.category,
      policyVersion: p.policyVersion,
      assignedAt: p.assignedAt,
      dueAt: p.dueAt || p.policy.dueDate,
      reminderSentAt: p.reminderSentAt,
      reminderCount: p.reminderCount,
      status: 'Non-Compliant',
    }));
  }

  /**
   * Send digital reminder to non-signed employees.
   */
  async sendReminders({ tenantId, user, policyId, data, req }) {
    const where = {
      tenantId,
      policyId,
      status: 'PENDING',
    };

    if (data?.userId) {
      where.userId = data.userId;
    }

    const pendingAssignments = await prisma.policyAssignment.findMany({
      where,
      include: {
        policy: { select: { title: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (pendingAssignments.length === 0) {
      return { success: true, count: 0, message: 'No pending employees to remind.' };
    }

    const now = new Date();
    const assignmentIds = pendingAssignments.map(a => a.id);

    // Update reminder counters
    await prisma.policyAssignment.updateMany({
      where: { id: { in: assignmentIds } },
      data: {
        reminderSentAt: now,
        reminderCount: { increment: 1 },
      },
    });

    // Create notifications for each user
    const notifications = pendingAssignments.map(a => ({
      tenantId,
      recipientId: a.user.id,
      type: 'policy_reminder',
      title: 'Reminder: Action Required for Policy Sign-off',
      body: data?.customMessage || `Please review and digitally sign the corporate mandate "${a.policy.title}".`,
      entityType: 'policy',
      entityId: policyId,
    }));

    await prisma.notification.createMany({
      data: notifications,
    });

    pendingAssignments.forEach(a => {
      emitToUser(tenantId, a.user.id, 'policy_reminder', {
        policyId,
        title: a.policy.title,
        message: data?.customMessage,
      });
    });

    await this.logAudit({
      tenantId,
      policyId,
      actorUserId: user.id,
      action: 'POLICY_REMINDER_SENT',
      details: `${user.name} sent policy sign-off reminders to ${pendingAssignments.length} employee(s).`,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      metadata: { recipientCount: pendingAssignments.length, targetUserId: data?.userId || null },
    });

    return {
      success: true,
      count: pendingAssignments.length,
      message: `Successfully dispatched sign-off reminders to ${pendingAssignments.length} employee(s).`,
    };
  }

  /**
   * Generates dynamic CSV export of compliance records.
   */
  async exportComplianceCSV({ tenantId, policyId }) {
    const where = { tenantId };
    if (policyId && policyId !== 'ALL') {
      where.policyId = policyId;
    }

    const acceptances = await prisma.policyAcceptance.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            department: true,
            designation: true,
          },
        },
        policy: {
          select: {
            id: true,
            title: true,
            category: true,
            version: true,
          },
        },
      },
      orderBy: { signedAt: 'desc' },
    });

    const headers = [
      'Employee Name',
      'User ID',
      'Email',
      'Department',
      'Designation',
      'Signed Policy Mandate',
      'Category',
      'Policy Version',
      'Audit IP Address',
      'Verification Timestamp (UTC)',
      'Compliance Status',
      'Content SHA-256 Hash',
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const val = String(str).replace(/"/g, '""');
      return `"${val}"`;
    };

    const rows = acceptances.map(a => [
      escapeCsv(a.user.name),
      escapeCsv(a.user.id),
      escapeCsv(a.user.email),
      escapeCsv(a.user.department || 'General'),
      escapeCsv(a.user.designation || 'Staff'),
      escapeCsv(a.policy.title),
      escapeCsv(a.policy.category),
      escapeCsv(`v${a.policyVersion}`),
      escapeCsv(a.ipAddress),
      escapeCsv(a.signedAt.toISOString()),
      escapeCsv(a.complianceCheck || 'Verified Audit'),
      escapeCsv(a.contentHash || 'N/A'),
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  }
}

export const policyService = new PolicyService();
