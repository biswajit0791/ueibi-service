/**
 * Leave & Work-From-Home (WFH) Management Service
 * Provides comprehensive dynamic leave types, dynamic employee balance tracking,
 * multi-level approval workflows (Manager, HR, Supreme Administrator), and audit logging.
 */
import { prisma } from '../lib/prisma.js';
import { emitToUser, emitToTenant } from '../lib/socket.js';
import { sendMail } from '../lib/mailer.js';

export class LeaveService {
  /**
   * Helper: Push notification and real-time Socket.IO event.
   */
  async notify({ tenantId, recipientId, type, title, body, entityType, entityId }) {
    if (!recipientId || recipientId === 'system' || !tenantId) return null;
    try {
      const notif = await prisma.notification.create({
        data: {
          tenantId,
          recipientId,
          type: type || 'leave',
          title,
          body: body || null,
          entityType: entityType || 'leave_request',
          entityId: entityId || null,
        },
      });
      emitToUser(tenantId, recipientId, 'notification', notif);
      return notif;
    } catch (err) {
      console.warn('[LeaveService] Failed to push notification:', err.message);
      return null;
    }
  }

  /**
   * Helper: Log audit record for Leave and WFH lifecycle events.
   */
  async logAudit({ tenantId, leaveTypeId, leaveRequestId, actorUserId, action, details, req, metadata }) {
    if (!tenantId || !actorUserId || !action) return null;
    try {
      const ipAddress = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '127.0.0.1';
      const userAgent = req?.headers?.['user-agent'] || 'System';

      return await prisma.leaveAuditLog.create({
        data: {
          tenantId,
          leaveTypeId: leaveTypeId || null,
          leaveRequestId: leaveRequestId || null,
          actorUserId,
          action,
          details: details || null,
          ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : '127.0.0.1',
          userAgent,
          metadata: metadata || null,
        },
      });
    } catch (err) {
      console.warn('[LeaveService] Failed to log audit:', err.message);
      return null;
    }
  }

  /**
   * Calculates working days between start and end date (inclusive), skipping Saturday and Sunday.
   * Supports half-day leaves (returns 0.5).
   */
  calculateWorkingDays(startDate, endDate, dayType = 'FULL') {
    if (dayType === 'FIRST_HALF' || dayType === 'SECOND_HALF') {
      return 0.5;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;

    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const dayOfWeek = cur.getDay(); // 0 = Sunday, 6 = Saturday
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, count);
  }

  /**
   * Checks whether the employee has an active overlapping request.
   */
  async checkOverlap({ tenantId, employeeId, startDate, endDate, excludeId = null }) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const existing = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: { notIn: ['REJECTED', 'CANCELLED'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      include: {
        leaveType: { select: { name: true } },
      },
    });

    for (const req of existing) {
      const reqStart = new Date(req.startDate);
      const reqEnd = new Date(req.endDate);
      if (start <= reqEnd && end >= reqStart) {
        const formattedStart = reqStart.toISOString().split('T')[0];
        const formattedEnd = reqEnd.toISOString().split('T')[0];
        const typeName = req.requestType === 'WFH' ? 'Work From Home' : (req.leaveType?.name || req.type || 'Leave');
        throw {
          status: 400,
          message: `You already have an active ${typeName} request from ${formattedStart} to ${formattedEnd} overlapping with this period.`,
        };
      }
    }
  }

  /**
   * Formats raw LeaveRequest into a clean, consistent response payload.
   */
  formatRequest(raw) {
    if (!raw) return null;
    const leaveTypeName = raw.requestType === 'WFH' ? 'Work From Home' : (raw.leaveType?.name || raw.type || 'Leave');
    const leaveTypeCode = raw.requestType === 'WFH' ? 'WFH' : (raw.leaveType?.code || 'LEAVE');

    let cleanReason = raw.reason || 'No reason provided';
    let extraMgrComment = null;
    let extraHrComment = null;

    if (typeof cleanReason === 'string' && cleanReason.trim().startsWith('{') && cleanReason.trim().endsWith('}')) {
      try {
        const parsed = JSON.parse(cleanReason);
        cleanReason = parsed.text || parsed.reason || parsed.description || cleanReason;
        if (!raw.managerComment && parsed.managerComment) extraMgrComment = parsed.managerComment;
        if (!raw.hrComment && parsed.hrComment) extraHrComment = parsed.hrComment;
      } catch {}
    }

    return {
      id: raw.id,
      tenantId: raw.tenantId,
      employeeId: raw.employeeId,
      employee: raw.employee ? {
        id: raw.employee.id,
        name: raw.employee.name,
        email: raw.employee.email,
        department: raw.employee.department || 'General',
        designation: raw.employee.designation || 'Staff',
        managerId: raw.employee.managerId,
      } : null,
      requestType: raw.requestType || 'LEAVE',
      leaveTypeId: raw.leaveTypeId,
      leaveType: leaveTypeName,
      leaveTypeCode,
      type: leaveTypeName,
      startDate: raw.startDate ? raw.startDate.toISOString().split('T')[0] : null,
      endDate: raw.endDate ? raw.endDate.toISOString().split('T')[0] : null,
      totalDays: raw.totalDays || 1,
      dayType: raw.dayType || 'FULL',
      reason: cleanReason,
      attachmentUrl: raw.attachmentUrl || null,
      attachmentOriginalName: raw.attachmentOriginalName || null,
      status: raw.status,
      managerStatus: raw.managerStatus || 'Pending',
      managerId: raw.managerId || null,
      managerComment: raw.managerComment || extraMgrComment,
      managerActedAt: raw.managerActedAt || null,
      hrStatus: raw.hrStatus || 'Pending',
      hrId: raw.hrId || null,
      hrComment: raw.hrComment || extraHrComment,
      hrActedAt: raw.hrActedAt || null,
      rejectionReason: raw.rejectionReason || null,
      rejectedById: raw.rejectedById || null,
      rejectedAt: raw.rejectedAt || null,
      cancelledById: raw.cancelledById || null,
      cancelledAt: raw.cancelledAt || null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. ADMIN LEAVE TYPE CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  async createLeaveType({ tenantId, user, data, req }) {
    const existing = await prisma.leaveType.findFirst({
      where: {
        tenantId,
        code: data.code,
      },
    });

    if (existing) {
      throw { status: 409, message: `Leave type with code "${data.code}" already exists in this tenant.` };
    }

    const currentYear = data.year || new Date().getFullYear();

    const created = await prisma.leaveType.create({
      data: {
        tenantId,
        name: data.name.trim(),
        code: data.code.trim().toUpperCase(),
        description: data.description ? data.description.trim() : null,
        defaultDays: Number(data.defaultDays || 0),
        allocationType: data.allocationType || 'ANNUAL',
        year: currentYear,
        isPaid: data.isPaid !== undefined ? data.isPaid : true,
        requiresApproval: data.requiresApproval !== undefined ? data.requiresApproval : true,
        allowHalfDay: data.allowHalfDay !== undefined ? data.allowHalfDay : true,
        allowNegativeBalance: Boolean(data.allowNegativeBalance),
        maxConsecutiveDays: data.maxConsecutiveDays ? Number(data.maxConsecutiveDays) : null,
        minNoticeDays: Number(data.minNoticeDays || 0),
        carryForwardAllowed: Boolean(data.carryForwardAllowed),
        maxCarryForwardDays: Number(data.maxCarryForwardDays || 0),
        encashmentAllowed: Boolean(data.encashmentAllowed),
        requiresDocument: Boolean(data.requiresDocument),
        documentRequiredAfterDays: Number(data.documentRequiredAfterDays || 2),
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdById: user.id,
      },
    });

    // Automatically initialize balances for existing active employees
    const employees = await prisma.tenantUser.findMany({
      where: { tenantId, isDeleted: false },
      select: { id: true },
    });

    for (const emp of employees) {
      await prisma.leaveBalance.upsert({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId,
            employeeId: emp.id,
            leaveTypeId: created.id,
            year: currentYear,
          },
        },
        update: {},
        create: {
          tenantId,
          employeeId: emp.id,
          leaveTypeId: created.id,
          year: currentYear,
          allocated: created.defaultDays,
          carriedForward: 0,
          adjusted: 0,
          used: 0,
          pending: 0,
        },
      }).catch(() => {});
    }

    await this.logAudit({
      tenantId,
      leaveTypeId: created.id,
      actorUserId: user.id,
      action: 'LEAVE_TYPE_CREATED',
      details: `${user.name} created leave type "${created.name}" (${created.code}) with ${created.defaultDays} default days.`,
      req,
      metadata: { code: created.code, defaultDays: created.defaultDays },
    });

    emitToTenant(tenantId, 'leave_type_updated', { action: 'create', leaveType: created });
    return created;
  }

  async listLeaveTypes({ tenantId, search = '', status = 'ALL', activeOnly = false, page = 1, limit = 50 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      tenantId,
    };

    if (activeOnly || status === 'ACTIVE') {
      where.isActive = true;
    } else if (status === 'INACTIVE') {
      where.isActive = false;
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.leaveType.findMany({
        where,
        include: {
          _count: {
            select: { leaveRequests: true, balances: true },
          },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip,
        take: limitNum,
      }),
      prisma.leaveType.count({ where }),
    ]);

    const formatted = items.map(lt => ({
      ...lt,
      usageCount: lt._count?.leaveRequests || 0,
      activeBalancesCount: lt._count?.balances || 0,
    }));

    return {
      items: formatted,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  async getLeaveTypeById({ tenantId, id }) {
    const item = await prisma.leaveType.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: { leaveRequests: true, balances: true },
        },
      },
    });

    if (!item) {
      throw { status: 404, message: 'Leave type not found' };
    }

    return {
      ...item,
      usageCount: item._count?.leaveRequests || 0,
    };
  }

  async updateLeaveType({ tenantId, id, user, data, req }) {
    const existing = await prisma.leaveType.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw { status: 404, message: 'Leave type not found' };
    }

    if (data.code && data.code.toUpperCase() !== existing.code) {
      const duplicate = await prisma.leaveType.findFirst({
        where: { tenantId, code: data.code.toUpperCase(), id: { not: id } },
      });
      if (duplicate) {
        throw { status: 409, message: `Leave type code "${data.code}" is already in use.` };
      }
    }

    const updated = await prisma.leaveType.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name.trim() : existing.name,
        code: data.code !== undefined ? data.code.trim().toUpperCase() : existing.code,
        description: data.description !== undefined ? data.description : existing.description,
        defaultDays: data.defaultDays !== undefined ? Number(data.defaultDays) : existing.defaultDays,
        allocationType: data.allocationType || existing.allocationType,
        year: data.year !== undefined ? data.year : existing.year,
        isPaid: data.isPaid !== undefined ? data.isPaid : existing.isPaid,
        requiresApproval: data.requiresApproval !== undefined ? data.requiresApproval : existing.requiresApproval,
        allowHalfDay: data.allowHalfDay !== undefined ? data.allowHalfDay : existing.allowHalfDay,
        allowNegativeBalance: data.allowNegativeBalance !== undefined ? data.allowNegativeBalance : existing.allowNegativeBalance,
        maxConsecutiveDays: data.maxConsecutiveDays !== undefined ? (data.maxConsecutiveDays ? Number(data.maxConsecutiveDays) : null) : existing.maxConsecutiveDays,
        minNoticeDays: data.minNoticeDays !== undefined ? Number(data.minNoticeDays) : existing.minNoticeDays,
        carryForwardAllowed: data.carryForwardAllowed !== undefined ? data.carryForwardAllowed : existing.carryForwardAllowed,
        maxCarryForwardDays: data.maxCarryForwardDays !== undefined ? Number(data.maxCarryForwardDays) : existing.maxCarryForwardDays,
        encashmentAllowed: data.encashmentAllowed !== undefined ? data.encashmentAllowed : existing.encashmentAllowed,
        requiresDocument: data.requiresDocument !== undefined ? data.requiresDocument : existing.requiresDocument,
        documentRequiredAfterDays: data.documentRequiredAfterDays !== undefined ? Number(data.documentRequiredAfterDays) : existing.documentRequiredAfterDays,
        isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
        updatedById: user.id,
      },
    });

    await this.logAudit({
      tenantId,
      leaveTypeId: id,
      actorUserId: user.id,
      action: 'LEAVE_TYPE_UPDATED',
      details: `${user.name} updated configuration for leave type "${updated.name}" (${updated.code}).`,
      req,
    });

    emitToTenant(tenantId, 'leave_type_updated', { action: 'update', leaveType: updated });
    return updated;
  }

  async toggleLeaveTypeStatus({ tenantId, id, user, isActive, req }) {
    const existing = await prisma.leaveType.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw { status: 404, message: 'Leave type not found' };
    }

    const updated = await prisma.leaveType.update({
      where: { id },
      data: { isActive, updatedById: user.id },
    });

    const action = isActive ? 'LEAVE_TYPE_ACTIVATED' : 'LEAVE_TYPE_DEACTIVATED';
    await this.logAudit({
      tenantId,
      leaveTypeId: id,
      actorUserId: user.id,
      action,
      details: `${user.name} ${isActive ? 'activated' : 'deactivated'} leave type "${updated.name}".`,
      req,
    });

    emitToTenant(tenantId, 'leave_type_updated', { action: 'status', leaveType: updated });
    return updated;
  }

  async deleteLeaveType({ tenantId, id, user, req }) {
    const existing = await prisma.leaveType.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { leaveRequests: true } },
      },
    });

    if (!existing) {
      throw { status: 404, message: 'Leave type not found' };
    }

    // Safety rule: Cannot delete if requests exist
    if (existing._count.leaveRequests > 0) {
      throw {
        status: 409,
        message: `Cannot delete "${existing.name}" because ${existing._count.leaveRequests} historical request(s) depend on it. Deactivate this leave type instead to preserve records.`,
      };
    }

    // Safe delete dependent balance rows and the leave type
    await prisma.$transaction([
      prisma.leaveBalance.deleteMany({ where: { leaveTypeId: id } }),
      prisma.leaveBalanceAdjustment.deleteMany({ where: { leaveTypeId: id } }),
      prisma.leaveType.delete({ where: { id } }),
    ]);

    await this.logAudit({
      tenantId,
      leaveTypeId: id,
      actorUserId: user.id,
      action: 'LEAVE_TYPE_DELETED',
      details: `${user.name} safely deleted unused leave type "${existing.name}" (${existing.code}).`,
      req,
    });

    emitToTenant(tenantId, 'leave_type_updated', { action: 'delete', id });
    return { success: true, message: `Leave type "${existing.name}" was safely deleted.` };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. DYNAMIC EMPLOYEE BALANCES
  // ══════════════════════════════════════════════════════════════════════════════

  async getBalances({ tenantId, employeeId, year = new Date().getFullYear() }) {
    // 1. Fetch active leave types for tenant
    const leaveTypes = await prisma.leaveType.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Fetch tenant WFH policy
    let wfhPolicy = await prisma.wfhPolicy.findUnique({
      where: { tenantId },
    });

    if (!wfhPolicy) {
      wfhPolicy = await prisma.wfhPolicy.create({
        data: {
          tenantId,
          isEnabled: true,
          annualDays: 15,
          requiresApproval: true,
        },
      });
    }

    // 3. Compute dynamic balances from LeaveRequest records for the given year
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    const yearRequests = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        startDate: { gte: startOfYear },
        endDate: { lte: endOfYear },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      select: {
        id: true,
        requestType: true,
        leaveTypeId: true,
        type: true,
        totalDays: true,
        status: true,
      },
    });

    // 4. Fetch or initialize LeaveBalance records
    const balances = [];
    for (const lt of leaveTypes) {
      let balanceRow = await prisma.leaveBalance.findUnique({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId,
            employeeId,
            leaveTypeId: lt.id,
            year,
          },
        },
      });

      if (!balanceRow) {
        balanceRow = await prisma.leaveBalance.create({
          data: {
            tenantId,
            employeeId,
            leaveTypeId: lt.id,
            year,
            allocated: lt.defaultDays,
            carriedForward: 0,
            adjusted: 0,
            used: 0,
            pending: 0,
          },
        }).catch(() => null);
      }

      // Compute actual used & pending days from requests matching this leave type
      const matching = yearRequests.filter(
        r => r.requestType !== 'WFH' && (r.leaveTypeId === lt.id || (r.type && r.type.toLowerCase().includes(lt.name.toLowerCase())))
      );

      const computedUsed = matching.filter(r => r.status === 'APPROVED').reduce((sum, r) => sum + (r.totalDays || 1), 0);
      const computedPending = matching.filter(r => r.status === 'PENDING').reduce((sum, r) => sum + (r.totalDays || 1), 0);

      const allocated = balanceRow ? balanceRow.allocated : lt.defaultDays;
      const carriedForward = balanceRow ? balanceRow.carriedForward : 0;
      const adjusted = balanceRow ? balanceRow.adjusted : 0;
      const totalAvailable = allocated + carriedForward + adjusted;
      const remaining = lt.allowNegativeBalance ? (totalAvailable - computedUsed - computedPending) : Math.max(0, totalAvailable - computedUsed - computedPending);

      balances.push({
        id: lt.id,
        leaveTypeId: lt.id,
        name: lt.name,
        code: lt.code,
        description: lt.description,
        allocated,
        carriedForward,
        adjusted,
        used: computedUsed,
        pending: computedPending,
        remaining,
        year,
        isPaid: lt.isPaid,
        requiresApproval: lt.requiresApproval,
        allowHalfDay: lt.allowHalfDay,
        allowNegativeBalance: lt.allowNegativeBalance,
        maxConsecutiveDays: lt.maxConsecutiveDays,
        minNoticeDays: lt.minNoticeDays,
        requiresDocument: lt.requiresDocument,
        documentRequiredAfterDays: lt.documentRequiredAfterDays,
      });
    }

    // 5. WFH Balance Calculation
    let wfhRow = await prisma.wfhBalance.findUnique({
      where: {
        tenantId_employeeId_year: {
          tenantId,
          employeeId,
          year,
        },
      },
    });

    if (!wfhRow) {
      wfhRow = await prisma.wfhBalance.create({
        data: {
          tenantId,
          employeeId,
          year,
          allocated: wfhPolicy.annualDays,
          adjusted: 0,
          used: 0,
          pending: 0,
        },
      }).catch(() => null);
    }

    const wfhMatching = yearRequests.filter(r => r.requestType === 'WFH' || (r.type && r.type.toLowerCase().includes('wfh')));
    const wfhUsed = wfhMatching.filter(r => r.status === 'APPROVED').reduce((sum, r) => sum + (r.totalDays || 1), 0);
    const wfhPending = wfhMatching.filter(r => r.status === 'PENDING').reduce((sum, r) => sum + (r.totalDays || 1), 0);
    const wfhAllocated = wfhRow ? wfhRow.allocated : wfhPolicy.annualDays;
    const wfhAdjusted = wfhRow ? wfhRow.adjusted : 0;
    const wfhRemaining = Math.max(0, wfhAllocated + wfhAdjusted - wfhUsed - wfhPending);

    const wfhPayload = {
      isEnabled: wfhPolicy.isEnabled,
      allocated: wfhAllocated,
      adjusted: wfhAdjusted,
      used: wfhUsed,
      pending: wfhPending,
      remaining: wfhRemaining,
      year,
      requiresApproval: wfhPolicy.requiresApproval,
      maxConsecutiveDays: wfhPolicy.maxConsecutiveDays,
      minNoticeDays: wfhPolicy.minNoticeDays,
      monthlyLimit: wfhPolicy.monthlyLimit,
    };

    return {
      leaveTypes: balances,
      wfh: wfhPayload,
      summary: {
        totalLeaveRemaining: balances.reduce((sum, b) => sum + b.remaining, 0),
        totalWfhRemaining: wfhRemaining,
        year,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. LEAVE & WFH REQUEST SUBMISSION
  // ══════════════════════════════════════════════════════════════════════════════

  async submitRequest({ tenantId, employeeId, data, req }) {
    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId },
      include: { manager: { select: { id: true, name: true, email: true } } },
    });
    if (!employee) throw { status: 404, message: 'Employee not found' };

    const {
      requestType = 'LEAVE',
      leaveTypeId,
      type: legacyType,
      leaveType: legacyLeaveType,
      startDate,
      endDate,
      dayType = 'FULL',
      reason,
      attachmentUrl,
      attachmentOriginalName,
    } = data;

    const totalDays = this.calculateWorkingDays(startDate, endDate, dayType);
    if (totalDays <= 0) {
      throw { status: 400, message: 'Invalid date range: requested working duration must be at least 0.5 days.' };
    }

    // 1. Overlapping check
    await this.checkOverlap({ tenantId, employeeId, startDate, endDate });

    const currentYear = new Date(startDate).getFullYear();
    const balances = await this.getBalances({ tenantId, employeeId, year: currentYear });

    let targetLeaveType = null;
    let effectiveTitle = 'Leave';

    if (requestType === 'LEAVE') {
      // Find matching leave type
      if (leaveTypeId) {
        targetLeaveType = await prisma.leaveType.findFirst({
          where: { id: leaveTypeId, tenantId },
        });
      } else {
        const typeSearch = legacyLeaveType || legacyType || 'Casual Leave';
        targetLeaveType = await prisma.leaveType.findFirst({
          where: {
            tenantId,
            OR: [
              { name: { equals: typeSearch, mode: 'insensitive' } },
              { code: { equals: typeSearch, mode: 'insensitive' } },
            ],
          },
        });
      }

      if (!targetLeaveType) {
        throw { status: 400, message: 'Selected leave category does not exist. Please choose an active leave category.' };
      }

      if (!targetLeaveType.isActive) {
        throw { status: 400, message: `"${targetLeaveType.name}" is currently inactive and not accepting new leave applications.` };
      }

      effectiveTitle = targetLeaveType.name;

      // Half-day policy rule
      if (dayType !== 'FULL' && !targetLeaveType.allowHalfDay) {
        throw { status: 400, message: `Half-day leaves are not permitted for "${targetLeaveType.name}".` };
      }

      // Max consecutive days rule
      if (targetLeaveType.maxConsecutiveDays && totalDays > targetLeaveType.maxConsecutiveDays) {
        throw {
          status: 400,
          message: `Maximum consecutive days allowed for "${targetLeaveType.name}" is ${targetLeaveType.maxConsecutiveDays} days.`,
        };
      }

      // Minimum notice period rule
      if (targetLeaveType.minNoticeDays > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const reqStart = new Date(startDate);
        const diffDays = Math.ceil((reqStart - today) / (1000 * 60 * 60 * 24));
        if (diffDays < targetLeaveType.minNoticeDays) {
          throw {
            status: 400,
            message: `"${targetLeaveType.name}" requires at least ${targetLeaveType.minNoticeDays} days advance notice.`,
          };
        }
      }

      // Supporting document requirement rule
      if (targetLeaveType.requiresDocument && totalDays >= targetLeaveType.documentRequiredAfterDays && !attachmentUrl) {
        throw {
          status: 400,
          message: `A supporting document/medical certificate is required for "${targetLeaveType.name}" requests of ${targetLeaveType.documentRequiredAfterDays} or more days.`,
        };
      }

      // Balance check
      const typeBalance = balances.leaveTypes.find(b => b.leaveTypeId === targetLeaveType.id);
      const available = typeBalance ? typeBalance.remaining : 0;

      if (totalDays > available && !targetLeaveType.allowNegativeBalance) {
        throw {
          status: 400,
          message: `Insufficient ${targetLeaveType.name} balance. Requested: ${totalDays} Day(s), Available: ${available} Day(s).`,
        };
      }
    } else {
      // WFH Request
      if (!balances.wfh.isEnabled) {
        throw { status: 400, message: 'Work From Home is currently disabled by enterprise policy.' };
      }

      effectiveTitle = 'Work From Home';
      const availableWfh = balances.wfh.remaining;

      if (totalDays > availableWfh) {
        throw {
          status: 400,
          message: `Insufficient WFH balance. Requested: ${totalDays} Day(s), Available: ${availableWfh} Day(s).`,
        };
      }

      if (balances.wfh.maxConsecutiveDays && totalDays > balances.wfh.maxConsecutiveDays) {
        throw {
          status: 400,
          message: `Maximum consecutive WFH days allowed is ${balances.wfh.maxConsecutiveDays} days.`,
        };
      }
    }

    // Two-level approval setup
    const initialManagerStatus = 'Pending';
    const initialHrStatus = 'Pending';

    // Transactional creation & balance pending increment
    const created = await prisma.$transaction(async (tx) => {
      // 1. Create request
      const reqRecord = await tx.leaveRequest.create({
        data: {
          tenantId,
          employeeId,
          leaveTypeId: targetLeaveType?.id || null,
          type: effectiveTitle,
          requestType,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          totalDays,
          dayType,
          reason: reason.trim(),
          attachmentUrl: attachmentUrl || null,
          attachmentOriginalName: attachmentOriginalName || null,
          status: 'PENDING',
          managerStatus: initialManagerStatus,
          managerId: employee.managerId || null,
          hrStatus: initialHrStatus,
        },
        include: {
          employee: true,
          leaveType: true,
        },
      });

      // 2. Reserve balance by incrementing pending
      if (requestType === 'LEAVE' && targetLeaveType) {
        await tx.leaveBalance.upsert({
          where: {
            tenantId_employeeId_leaveTypeId_year: {
              tenantId,
              employeeId,
              leaveTypeId: targetLeaveType.id,
              year: currentYear,
            },
          },
          update: {
            pending: { increment: totalDays },
          },
          create: {
            tenantId,
            employeeId,
            leaveTypeId: targetLeaveType.id,
            year: currentYear,
            allocated: targetLeaveType.defaultDays,
            pending: totalDays,
          },
        });
      } else if (requestType === 'WFH') {
        await tx.wfhBalance.upsert({
          where: {
            tenantId_employeeId_year: {
              tenantId,
              employeeId,
              year: currentYear,
            },
          },
          update: {
            pending: { increment: totalDays },
          },
          create: {
            tenantId,
            employeeId,
            year: currentYear,
            allocated: balances.wfh.allocated || 15,
            pending: totalDays,
          },
        });
      }

      return reqRecord;
    });

    // Audit Logging
    await this.logAudit({
      tenantId,
      leaveTypeId: targetLeaveType?.id || null,
      leaveRequestId: created.id,
      actorUserId: employeeId,
      action: requestType === 'WFH' ? 'WFH_REQUEST_CREATED' : 'LEAVE_REQUEST_CREATED',
      details: `${employee.name} submitted ${requestType} request for ${totalDays} day(s) (${startDate} to ${endDate}).`,
      req,
      metadata: { totalDays, dayType, leaveType: effectiveTitle },
    });

    // Notifications
    const hasManager = Boolean(employee.managerId);
    if (hasManager) {
      await this.notify({
        tenantId,
        recipientId: employee.managerId,
        type: 'leave',
        title: `New ${effectiveTitle} Request from ${employee.name}`,
        body: `${employee.name} applied for ${totalDays} day(s) from ${startDate} to ${endDate}. Reason: "${reason.slice(0, 80)}"`,
        entityType: 'leave_request',
        entityId: created.id,
      });
    } else {
      // Forward directly to HR
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN'] } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'leave',
          title: `New ${effectiveTitle} Request awaiting HR Approval`,
          body: `${employee.name} applied for ${totalDays} day(s) from ${startDate} to ${endDate}.`,
          entityType: 'leave_request',
          entityId: created.id,
        });
      }
    }

    const formatted = this.formatRequest(created);
    emitToTenant(tenantId, 'leave_updated', { action: 'create', leave: formatted, leaveId: created.id });
    return formatted;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. TWO-LEVEL APPROVAL WORKFLOW
  // ══════════════════════════════════════════════════════════════════════════════

  async managerAction({ tenantId, requestId, managerUser, action, comment, req }) {
    const raw = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true, leaveType: true },
    });

    if (!raw || raw.employee.tenantId !== tenantId) {
      throw { status: 404, message: 'Leave request not found' };
    }

    const isDirectManager = raw.employee.managerId === managerUser.id;
    const isElevated = ['SUPER_ADMIN', 'HR', 'ADMIN', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'].includes(managerUser.role);
    const isFallbackManager = !raw.employee.managerId && managerUser.role === 'MANAGER';

    if (!isDirectManager && !isElevated && !isFallbackManager) {
      throw { status: 403, message: 'Access forbidden: you are not the assigned manager for this employee' };
    }

    if (raw.status !== 'PENDING' || raw.managerStatus === 'Approved') {
      throw { status: 400, message: `Manager approval cannot be updated: request is already ${raw.status}` };
    }

    const isApprove = action === 'APPROVE';
    const newManagerStatus = isApprove ? 'Approved' : 'Rejected';
    const newOverallStatus = isApprove ? 'PENDING' : 'REJECTED';
    const newHrStatus = isApprove ? 'Pending' : 'Not Required';
    const currentYear = new Date(raw.startDate).getFullYear();

    const updated = await prisma.$transaction(async (tx) => {
      // If rejecting, restore the reserved pending days
      if (!isApprove) {
        if (raw.requestType === 'LEAVE' && raw.leaveTypeId) {
          await tx.leaveBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              leaveTypeId: raw.leaveTypeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
            },
          });
        } else if (raw.requestType === 'WFH') {
          await tx.wfhBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
            },
          });
        }
      }

      return tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: newOverallStatus,
          managerStatus: newManagerStatus,
          managerId: managerUser.id,
          managerComment: comment || (isApprove ? 'Approved by Manager' : 'Rejected by Manager'),
          managerActedAt: new Date(),
          hrStatus: newHrStatus,
          rejectedById: isApprove ? null : managerUser.id,
          rejectedAt: isApprove ? null : new Date(),
          rejectionReason: isApprove ? null : comment,
        },
        include: { employee: true, leaveType: true },
      });
    });

    await this.logAudit({
      tenantId,
      leaveTypeId: raw.leaveTypeId,
      leaveRequestId: requestId,
      actorUserId: managerUser.id,
      action: isApprove
        ? (raw.requestType === 'WFH' ? 'WFH_REQUEST_APPROVED' : 'LEAVE_REQUEST_APPROVED')
        : (raw.requestType === 'WFH' ? 'WFH_REQUEST_REJECTED' : 'LEAVE_REQUEST_REJECTED'),
      details: `Manager ${managerUser.name} ${newManagerStatus.toLowerCase()} ${raw.requestType} request of ${raw.employee.name}. Remarks: "${comment || 'None'}"`,
      req,
    });

    // Notify Employee
    await this.notify({
      tenantId,
      recipientId: raw.employeeId,
      type: 'leave',
      title: `Manager ${newManagerStatus} your ${raw.leaveType?.name || raw.type} request`,
      body: isApprove
        ? `Your manager ${managerUser.name} approved your request. It has now been forwarded for final HR sign-off.`
        : `Your manager ${managerUser.name} rejected your request. Reason: "${comment || 'No comment provided'}"`,
      entityType: 'leave_request',
      entityId: requestId,
    });

    // Notify HR if approved
    if (isApprove) {
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN'] } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'leave',
          title: `Action Required: HR Approval for ${raw.employee.name}`,
          body: `Manager ${managerUser.name} approved ${raw.employee.name}'s ${raw.leaveType?.name || raw.type} request (${raw.totalDays} days). Please review.`,
          entityType: 'leave_request',
          entityId: requestId,
        });
      }
    }

    const formatted = this.formatRequest(updated);
    emitToTenant(tenantId, 'leave_updated', { action: 'update', leave: formatted, leaveId: requestId });
    return formatted;
  }

  async hrAction({ tenantId, requestId, hrUser, action, comment, req }) {
    const raw = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true, leaveType: true },
    });

    if (!raw || raw.employee.tenantId !== tenantId) {
      throw { status: 404, message: 'Leave request not found' };
    }

    const isHRElevated = ['HR', 'SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'].includes(hrUser.role);
    if (!isHRElevated) {
      throw { status: 403, message: 'Access forbidden: only HR or Administrators can perform final approval' };
    }

    if (raw.status !== 'PENDING' || raw.hrStatus !== 'Pending') {
      throw { status: 400, message: `HR decision cannot be updated: request is already ${raw.status}` };
    }

    const isApprove = action === 'APPROVE';
    const newHrStatus = isApprove ? 'Approved' : 'Rejected';
    const newOverallStatus = isApprove ? 'APPROVED' : 'REJECTED';
    const currentYear = new Date(raw.startDate).getFullYear();

    const updated = await prisma.$transaction(async (tx) => {
      if (isApprove) {
        // Move from pending to used
        if (raw.requestType === 'LEAVE' && raw.leaveTypeId) {
          await tx.leaveBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              leaveTypeId: raw.leaveTypeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
              used: { increment: raw.totalDays },
            },
          });
        } else if (raw.requestType === 'WFH') {
          await tx.wfhBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
              used: { increment: raw.totalDays },
            },
          });
        }
      } else {
        // Rejecting: restore pending
        if (raw.requestType === 'LEAVE' && raw.leaveTypeId) {
          await tx.leaveBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              leaveTypeId: raw.leaveTypeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
            },
          });
        } else if (raw.requestType === 'WFH') {
          await tx.wfhBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
            },
          });
        }
      }

      return tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: newOverallStatus,
          managerStatus: isApprove ? 'Approved' : (raw.managerStatus === 'Approved' ? 'Approved' : 'Rejected'),
          managerComment: isApprove && raw.managerStatus !== 'Approved' ? (comment || `Approved by ${hrUser.name} (${hrUser.role})`) : raw.managerComment,
          managerActedAt: isApprove && raw.managerStatus !== 'Approved' ? new Date() : raw.managerActedAt,
          hrStatus: newHrStatus,
          hrId: hrUser.id,
          hrComment: comment || (isApprove ? `Approved by ${hrUser.name} (${hrUser.role})` : `Rejected by ${hrUser.name} (${hrUser.role})`),
          hrActedAt: new Date(),
          approvedById: isApprove ? hrUser.id : null,
          rejectedById: isApprove ? null : hrUser.id,
          rejectedAt: isApprove ? null : new Date(),
          rejectionReason: isApprove ? null : comment,
        },
        include: { employee: true, leaveType: true },
      });
    });

    await this.logAudit({
      tenantId,
      leaveTypeId: raw.leaveTypeId,
      leaveRequestId: requestId,
      actorUserId: hrUser.id,
      action: isApprove
        ? (raw.requestType === 'WFH' ? 'WFH_REQUEST_APPROVED' : 'LEAVE_REQUEST_APPROVED')
        : (raw.requestType === 'WFH' ? 'WFH_REQUEST_REJECTED' : 'LEAVE_REQUEST_REJECTED'),
      details: `${hrUser.name} (${hrUser.role}) signed off ${newHrStatus.toLowerCase()} for ${raw.employee.name}'s ${raw.requestType} request. Remarks: "${comment || 'None'}"`,
      req,
    });

    // Notify Employee of Final Decision
    await this.notify({
      tenantId,
      recipientId: raw.employeeId,
      type: 'leave',
      title: `Final Decision: Your ${raw.leaveType?.name || raw.type} is ${newOverallStatus}`,
      body: isApprove
        ? `${hrUser.name} approved your ${raw.leaveType?.name || raw.type} request. Your balance has been updated.`
        : `${hrUser.name} rejected your request. Remarks: "${comment || 'No comment provided'}"`,
      entityType: 'leave_request',
      entityId: requestId,
    });

    const formatted = this.formatRequest(updated);
    emitToTenant(tenantId, 'leave_updated', { action: 'update', leave: formatted, leaveId: requestId });
    return formatted;
  }

  async adminAction({ tenantId, requestId, adminUser, action, comment, req }) {
    const raw = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true, leaveType: true },
    });

    if (!raw || raw.employee.tenantId !== tenantId) {
      throw { status: 404, message: 'Leave request not found' };
    }

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR', 'HR'].includes(adminUser.role);
    if (!isAdmin) {
      throw { status: 403, message: 'Access forbidden: only Administrators or HR can perform supreme approval' };
    }

    if (raw.status !== 'PENDING') {
      throw { status: 400, message: `Request cannot be updated: status is already ${raw.status}` };
    }

    const isApprove = action === 'APPROVE';
    const newStatus = isApprove ? 'APPROVED' : 'REJECTED';
    const newStageStatus = isApprove ? 'Approved' : 'Rejected';
    const currentYear = new Date(raw.startDate).getFullYear();

    const updated = await prisma.$transaction(async (tx) => {
      if (isApprove) {
        // Move from pending to used
        if (raw.requestType === 'LEAVE' && raw.leaveTypeId) {
          await tx.leaveBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              leaveTypeId: raw.leaveTypeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
              used: { increment: raw.totalDays },
            },
          });
        } else if (raw.requestType === 'WFH') {
          await tx.wfhBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
              used: { increment: raw.totalDays },
            },
          });
        }
      } else {
        // Rejecting: restore pending
        if (raw.requestType === 'LEAVE' && raw.leaveTypeId) {
          await tx.leaveBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              leaveTypeId: raw.leaveTypeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
            },
          });
        } else if (raw.requestType === 'WFH') {
          await tx.wfhBalance.updateMany({
            where: {
              tenantId,
              employeeId: raw.employeeId,
              year: currentYear,
            },
            data: {
              pending: { decrement: raw.totalDays },
            },
          });
        }
      }

      return tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          managerStatus: newStageStatus,
          managerId: adminUser.id,
          managerComment: comment || (isApprove ? `Approved by Administrator (${adminUser.name})` : `Rejected by Administrator (${adminUser.name})`),
          managerActedAt: new Date(),
          hrStatus: newStageStatus,
          hrId: adminUser.id,
          hrComment: comment || (isApprove ? `Approved by Administrator (${adminUser.name})` : `Rejected by Administrator (${adminUser.name})`),
          hrActedAt: new Date(),
          approvedById: isApprove ? adminUser.id : null,
          rejectedById: isApprove ? null : adminUser.id,
          rejectedAt: isApprove ? null : new Date(),
          rejectionReason: isApprove ? null : (comment || 'Rejected by Administrator'),
        },
        include: { employee: true, leaveType: true },
      });
    });

    await this.logAudit({
      tenantId,
      leaveTypeId: raw.leaveTypeId,
      leaveRequestId: requestId,
      actorUserId: adminUser.id,
      action: isApprove
        ? (raw.requestType === 'WFH' ? 'WFH_REQUEST_APPROVED' : 'LEAVE_REQUEST_APPROVED')
        : (raw.requestType === 'WFH' ? 'WFH_REQUEST_REJECTED' : 'LEAVE_REQUEST_REJECTED'),
      details: `Administrator ${adminUser.name} (${adminUser.role}) ${newStatus.toLowerCase()} ${raw.requestType} request for ${raw.employee.name}. Remarks: "${comment || 'None'}"`,
      req,
    });

    await this.notify({
      tenantId,
      recipientId: raw.employeeId,
      type: 'leave',
      title: `Administrator Decision: Your ${raw.leaveType?.name || raw.type} is ${newStatus}`,
      body: isApprove
        ? `Administrator ${adminUser.name} approved your ${raw.leaveType?.name || raw.type} request. Your balance has been updated.`
        : `Administrator ${adminUser.name} rejected your request. Remarks: "${comment || 'No comment provided'}"`,
      entityType: 'leave_request',
      entityId: requestId,
    });

    const formatted = this.formatRequest(updated);
    emitToTenant(tenantId, 'leave_updated', { action: 'update', leave: formatted, leaveId: requestId });
    return formatted;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. EMPLOYEE CANCELLATION
  // ══════════════════════════════════════════════════════════════════════════════

  async cancelRequest({ tenantId, requestId, employeeId, req }) {
    const raw = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true, leaveType: true },
    });

    if (!raw || raw.employee.tenantId !== tenantId) {
      throw { status: 404, message: 'Leave request not found' };
    }

    if (raw.employeeId !== employeeId) {
      throw { status: 403, message: 'Access forbidden: you can only cancel your own leave requests' };
    }

    if (raw.status !== 'PENDING') {
      throw { status: 400, message: `Cannot cancel request with status ${raw.status}. Only pending requests can be cancelled.` };
    }

    const currentYear = new Date(raw.startDate).getFullYear();

    const updated = await prisma.$transaction(async (tx) => {
      // Restore pending days
      if (raw.requestType === 'LEAVE' && raw.leaveTypeId) {
        await tx.leaveBalance.updateMany({
          where: {
            tenantId,
            employeeId,
            leaveTypeId: raw.leaveTypeId,
            year: currentYear,
          },
          data: {
            pending: { decrement: raw.totalDays },
          },
        });
      } else if (raw.requestType === 'WFH') {
        await tx.wfhBalance.updateMany({
          where: {
            tenantId,
            employeeId,
            year: currentYear,
          },
          data: {
            pending: { decrement: raw.totalDays },
          },
        });
      }

      return tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: 'CANCELLED',
          managerStatus: 'Cancelled',
          hrStatus: 'Cancelled',
          cancelledById: employeeId,
          cancelledAt: new Date(),
        },
        include: { employee: true, leaveType: true },
      });
    });

    await this.logAudit({
      tenantId,
      leaveTypeId: raw.leaveTypeId,
      leaveRequestId: requestId,
      actorUserId: employeeId,
      action: raw.requestType === 'WFH' ? 'WFH_REQUEST_CANCELLED' : 'LEAVE_REQUEST_CANCELLED',
      details: `${raw.employee.name} cancelled their pending ${raw.requestType} request.`,
      req,
    });

    const formatted = this.formatRequest(updated);
    emitToTenant(tenantId, 'leave_updated', { action: 'update', leave: formatted, leaveId: requestId });
    return formatted;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. LIST LEAVE REQUESTS (Scoped by role & query)
  // ══════════════════════════════════════════════════════════════════════════════

  async listRequests({ tenantId, user, scope = 'my', statusFilter = null, leaveTypeId = null, requestType = null, page = 1, limit = 50 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      tenantId,
    };

    if (scope === 'my') {
      where.employeeId = user.id;
    } else if (scope === 'team') {
      // Direct reports for Manager or employees without an assigned manager
      where.OR = [
        { employee: { tenantId, managerId: user.id } },
        { employee: { tenantId, managerId: null, role: 'EMPLOYEE' } },
      ];
    } else if (scope === 'company') {
      const isHR = ['HR', 'SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER'].includes(user.role);
      if (!isHR) {
        throw { status: 403, message: 'Access forbidden: only HR and Admins can view company-wide leaves' };
      }
    }

    if (statusFilter && statusFilter !== 'ALL') {
      where.status = statusFilter;
    }

    if (leaveTypeId && leaveTypeId !== 'ALL') {
      where.leaveTypeId = leaveTypeId;
    }

    if (requestType && requestType !== 'ALL') {
      where.requestType = requestType;
    }

    const [items, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          employee: {
            select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
          },
          leaveType: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    const formatted = items.map(i => this.formatRequest(i));

    return {
      items: formatted,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. WFH POLICY MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════════

  async getWfhPolicy({ tenantId }) {
    let policy = await prisma.wfhPolicy.findUnique({
      where: { tenantId },
    });

    if (!policy) {
      policy = await prisma.wfhPolicy.create({
        data: {
          tenantId,
          isEnabled: true,
          annualDays: 15,
          requiresApproval: true,
          maxConsecutiveDays: 5,
          minNoticeDays: 0,
          isActive: true,
        },
      });
    }

    return policy;
  }

  async updateWfhPolicy({ tenantId, user, data, req }) {
    const policy = await prisma.wfhPolicy.upsert({
      where: { tenantId },
      update: {
        isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
        annualDays: Number(data.annualDays || 15),
        requiresApproval: data.requiresApproval !== undefined ? data.requiresApproval : true,
        maxConsecutiveDays: data.maxConsecutiveDays !== undefined ? (data.maxConsecutiveDays ? Number(data.maxConsecutiveDays) : null) : 5,
        minNoticeDays: Number(data.minNoticeDays || 0),
        monthlyLimit: data.monthlyLimit !== undefined ? (data.monthlyLimit ? Number(data.monthlyLimit) : null) : null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
      create: {
        tenantId,
        isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
        annualDays: Number(data.annualDays || 15),
        requiresApproval: data.requiresApproval !== undefined ? data.requiresApproval : true,
        maxConsecutiveDays: data.maxConsecutiveDays !== undefined ? (data.maxConsecutiveDays ? Number(data.maxConsecutiveDays) : null) : 5,
        minNoticeDays: Number(data.minNoticeDays || 0),
        monthlyLimit: data.monthlyLimit !== undefined ? (data.monthlyLimit ? Number(data.monthlyLimit) : null) : null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
    });

    await this.logAudit({
      tenantId,
      actorUserId: user.id,
      action: 'POLICY_UPDATED',
      details: `${user.name} updated the corporate Work From Home policy (${policy.annualDays} annual days, enabled: ${policy.isEnabled}).`,
      req,
    });

    emitToTenant(tenantId, 'wfh_policy_updated', policy);
    return policy;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. ADMIN BALANCE ADJUSTMENTS & REPORTING
  // ══════════════════════════════════════════════════════════════════════════════

  async listEmployeeBalances({ tenantId, search = '', year = new Date().getFullYear(), page = 1, limit = 50 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      tenantId,
      isDeleted: false,
    };

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [employees, total] = await Promise.all([
      prisma.tenantUser.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          department: true,
          designation: true,
          role: true,
        },
        orderBy: { name: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.tenantUser.count({ where }),
    ]);

    const activeTypes = await prisma.leaveType.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, code: true, defaultDays: true },
    });

    const wfhPolicy = await this.getWfhPolicy({ tenantId });

    const results = await Promise.all(
      employees.map(async (emp) => {
        const balances = await this.getBalances({ tenantId, employeeId: emp.id, year });
        return {
          employee: emp,
          balances: balances.leaveTypes,
          wfh: balances.wfh,
        };
      })
    );

    return {
      items: results,
      activeLeaveTypes: activeTypes,
      wfhPolicy,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  async adjustEmployeeBalance({ tenantId, user, data, req }) {
    const { employeeId, leaveTypeId, isWfh = false, year = new Date().getFullYear(), adjustmentAmount, reason } = data;

    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw { status: 404, message: 'Employee not found' };

    let targetName = 'Work From Home';
    let prevBal = 0;
    let newBal = 0;

    const adjRecord = await prisma.$transaction(async (tx) => {
      if (isWfh) {
        let wfh = await tx.wfhBalance.findUnique({
          where: { tenantId_employeeId_year: { tenantId, employeeId, year } },
        });

        if (!wfh) {
          const pol = await tx.wfhPolicy.findUnique({ where: { tenantId } });
          wfh = await tx.wfhBalance.create({
            data: {
              tenantId,
              employeeId,
              year,
              allocated: pol?.annualDays || 15,
              adjusted: 0,
            },
          });
        }

        prevBal = wfh.allocated + wfh.adjusted - wfh.used;
        newBal = prevBal + Number(adjustmentAmount);

        await tx.wfhBalance.update({
          where: { id: wfh.id },
          data: {
            adjusted: { increment: Number(adjustmentAmount) },
          },
        });
      } else {
        const lt = await tx.leaveType.findFirst({
          where: { id: leaveTypeId, tenantId },
        });
        if (!lt) throw { status: 404, message: 'Leave type not found' };
        targetName = lt.name;

        let lb = await tx.leaveBalance.findUnique({
          where: {
            tenantId_employeeId_leaveTypeId_year: {
              tenantId,
              employeeId,
              leaveTypeId,
              year,
            },
          },
        });

        if (!lb) {
          lb = await tx.leaveBalance.create({
            data: {
              tenantId,
              employeeId,
              leaveTypeId,
              year,
              allocated: lt.defaultDays,
              adjusted: 0,
            },
          });
        }

        prevBal = lb.allocated + lb.carriedForward + lb.adjusted - lb.used;
        newBal = prevBal + Number(adjustmentAmount);

        await tx.leaveBalance.update({
          where: { id: lb.id },
          data: {
            adjusted: { increment: Number(adjustmentAmount) },
          },
        });
      }

      return tx.leaveBalanceAdjustment.create({
        data: {
          tenantId,
          employeeId,
          leaveTypeId: isWfh ? null : leaveTypeId,
          isWfh,
          year,
          previousBalance: prevBal,
          newBalance: newBal,
          adjustmentAmount: Number(adjustmentAmount),
          reason: reason.trim(),
          adjustedById: user.id,
        },
      });
    });

    await this.logAudit({
      tenantId,
      leaveTypeId: isWfh ? null : leaveTypeId,
      actorUserId: user.id,
      action: 'BALANCE_ADJUSTED',
      details: `${user.name} adjusted ${employee.name}'s ${targetName} balance by ${adjustmentAmount > 0 ? '+' : ''}${adjustmentAmount} days. Reason: "${reason}"`,
      req,
      metadata: { previousBalance: prevBal, newBalance: newBal, adjustmentAmount },
    });

    await this.notify({
      tenantId,
      recipientId: employeeId,
      type: 'leave',
      title: `${targetName} Balance Adjusted`,
      body: `Admin adjusted your ${targetName} balance by ${adjustmentAmount > 0 ? '+' : ''}${adjustmentAmount} day(s). New balance: ${newBal} days.`,
      entityType: 'leave_balance',
      entityId: adjRecord.id,
    });

    return adjRecord;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 9. OVERVIEW STATS, CALENDAR & AUDIT LOGS
  // ══════════════════════════════════════════════════════════════════════════════

  async getOverviewStats({ tenantId }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalLeaveTypes,
      activeLeaveTypes,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      onLeaveToday,
      wfhToday,
    ] = await Promise.all([
      prisma.leaveType.count({ where: { tenantId } }),
      prisma.leaveType.count({ where: { tenantId, isActive: true } }),
      prisma.leaveRequest.count({ where: { tenantId, status: 'PENDING' } }),
      prisma.leaveRequest.count({ where: { tenantId, status: 'APPROVED' } }),
      prisma.leaveRequest.count({ where: { tenantId, status: 'REJECTED' } }),
      prisma.leaveRequest.count({
        where: {
          tenantId,
          requestType: 'LEAVE',
          status: 'APPROVED',
          startDate: { lte: tomorrow },
          endDate: { gte: today },
        },
      }),
      prisma.leaveRequest.count({
        where: {
          tenantId,
          requestType: 'WFH',
          status: 'APPROVED',
          startDate: { lte: tomorrow },
          endDate: { gte: today },
        },
      }),
    ]);

    return {
      totalLeaveTypes,
      activeLeaveTypes,
      inactiveLeaveTypes: totalLeaveTypes - activeLeaveTypes,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      employeesOnLeaveToday: onLeaveToday,
      employeesWfhToday: wfhToday,
    };
  }

  async getCalendarView({ tenantId, month, year = new Date().getFullYear(), department, leaveTypeId }) {
    const startMonth = month ? parseInt(month, 10) - 1 : 0;
    const endMonth = month ? parseInt(month, 10) : 12;

    const startDate = new Date(year, startMonth, 1);
    const endDate = new Date(year, endMonth, 0, 23, 59, 59);

    const where = {
      tenantId,
      status: { in: ['APPROVED', 'PENDING'] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    };

    if (leaveTypeId && leaveTypeId !== 'ALL') {
      where.leaveTypeId = leaveTypeId;
    }

    if (department && department !== 'ALL') {
      where.employee = { department };
    }

    const items = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true, department: true } },
        leaveType: { select: { id: true, name: true, code: true } },
      },
      orderBy: { startDate: 'asc' },
    });

    return items.map(r => ({
      id: r.id,
      title: `${r.employee?.name}: ${r.requestType === 'WFH' ? 'WFH' : (r.leaveType?.name || r.type)}`,
      employeeName: r.employee?.name,
      employeeEmail: r.employee?.email,
      department: r.employee?.department || 'General',
      type: r.requestType === 'WFH' ? 'WFH' : (r.leaveType?.name || r.type),
      requestType: r.requestType,
      startDate: r.startDate.toISOString().split('T')[0],
      endDate: r.endDate.toISOString().split('T')[0],
      totalDays: r.totalDays,
      status: r.status,
    }));
  }

  async getAuditLogs({ tenantId, action, page = 1, limit = 50 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = { tenantId };
    if (action && action !== 'ALL') {
      where.action = action;
    }

    const [items, total] = await Promise.all([
      prisma.leaveAuditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
          leaveType: { select: { id: true, name: true, code: true } },
          leaveRequest: { select: { id: true, type: true, requestType: true, totalDays: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.leaveAuditLog.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  }
}

export const leaveService = new LeaveService();
