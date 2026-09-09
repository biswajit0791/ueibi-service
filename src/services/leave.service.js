import { prisma } from '../lib/prisma.js';
import { emitToUser, emitToTenant } from '../lib/socket.js';

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
   * Calculates working days between start and end date (inclusive), skipping Saturday and Sunday.
   */
  calculateWorkingDays(startDate, endDate) {
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
    // For single-day weekend leave requests or edge cases, ensure at least 1 day
    return Math.max(1, count);
  }

  /**
   * Checks whether the employee has an active overlapping request.
   */
  async checkOverlap({ employeeId, startDate, endDate, excludeId = null }) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const existing = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: { notIn: ['REJECTED', 'CANCELLED'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    for (const req of existing) {
      const reqStart = new Date(req.startDate);
      const reqEnd = new Date(req.endDate);
      // Check if [start, end] intersects with [reqStart, reqEnd]
      if (start <= reqEnd && end >= reqStart) {
        const formattedStart = reqStart.toISOString().split('T')[0];
        const formattedEnd = reqEnd.toISOString().split('T')[0];
        throw {
          status: 400,
          message: `You already have an active ${req.type} request from ${formattedStart} to ${formattedEnd} overlapping with this period.`,
        };
      }
    }
  }

  /**
   * Parses structured metadata from reason field or falls back cleanly.
   */
  parseMetadata(rawRequest) {
    let parsed = {};
    if (rawRequest.reason && typeof rawRequest.reason === 'string') {
      if (rawRequest.reason.startsWith('{') && rawRequest.reason.endsWith('}')) {
        try {
          parsed = JSON.parse(rawRequest.reason);
        } catch {
          parsed = { text: rawRequest.reason };
        }
      } else {
        parsed = { text: rawRequest.reason };
      }
    }

    const calculatedDays = this.calculateWorkingDays(rawRequest.startDate, rawRequest.endDate);
    const reqType = parsed.requestType || (rawRequest.type === 'WFH' ? 'WFH' : 'LEAVE');
    const lType = parsed.leaveType || rawRequest.type;

    return {
      id: rawRequest.id,
      employeeId: rawRequest.employeeId,
      employee: rawRequest.employee ? {
        id: rawRequest.employee.id,
        name: rawRequest.employee.name,
        email: rawRequest.employee.email,
        department: rawRequest.employee.department || 'General',
        designation: rawRequest.employee.designation || 'Staff',
        managerId: rawRequest.employee.managerId,
      } : null,
      type: lType || rawRequest.type,
      requestType: reqType,
      leaveType: lType || rawRequest.type,
      startDate: rawRequest.startDate.toISOString().split('T')[0],
      endDate: rawRequest.endDate.toISOString().split('T')[0],
      totalDays: parsed.totalDays || calculatedDays,
      reason: parsed.text || rawRequest.reason || 'No reason provided',
      status: rawRequest.status,
      managerStatus: (parsed.managerComment && parsed.managerComment.includes('Auto-approved') && rawRequest.status === 'PENDING')
        ? 'Pending'
        : (parsed.managerStatus || (rawRequest.status === 'APPROVED' ? 'Approved' : rawRequest.status === 'REJECTED' ? 'Rejected' : 'Pending')),
      managerId: parsed.managerId || null,
      managerComment: (parsed.managerComment && parsed.managerComment.includes('Auto-approved') && rawRequest.status === 'PENDING')
        ? null
        : (parsed.managerComment || null),
      managerActedAt: (parsed.managerComment && parsed.managerComment.includes('Auto-approved') && rawRequest.status === 'PENDING')
        ? null
        : (parsed.managerActedAt || null),
      hrStatus: parsed.hrStatus || (rawRequest.status === 'APPROVED' ? 'Approved' : rawRequest.status === 'REJECTED' ? 'Rejected' : 'Pending'),
      hrId: parsed.hrId || null,
      hrComment: parsed.hrComment || null,
      hrActedAt: parsed.hrActedAt || null,
      createdAt: rawRequest.createdAt,
      updatedAt: rawRequest.updatedAt,
    };
  }

  /**
   * Encodes structured metadata into reason field string.
   */
  encodeMetadata(text, meta) {
    return JSON.stringify({
      text: (text || '').trim(),
      ...meta,
    });
  }

  /**
   * Computes dynamic leave and WFH balances for an employee.
   */
  async getBalances({ tenantId, employeeId, year = new Date().getFullYear() }) {
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    // Standard Tenant Allowances
    const policy = {
      annual: 18,
      sick: 10,
      casual: 8,
      wfh: 15,
    };

    const requests = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        startDate: { gte: startOfYear },
        endDate: { lte: endOfYear },
      },
    });

    let annualUsed = 0, annualPending = 0;
    let sickUsed = 0, sickPending = 0;
    let casualUsed = 0, casualPending = 0;
    let wfhUsed = 0, wfhPending = 0;

    for (const raw of requests) {
      const formatted = this.parseMetadata(raw);
      const days = formatted.totalDays || 1;
      const typeLower = (formatted.leaveType || formatted.type || '').toLowerCase();

      if (formatted.requestType === 'WFH' || typeLower.includes('wfh') || typeLower.includes('work from home')) {
        if (raw.status === 'APPROVED') wfhUsed += days;
        else if (raw.status === 'PENDING') wfhPending += days;
      } else if (typeLower.includes('sick')) {
        if (raw.status === 'APPROVED') sickUsed += days;
        else if (raw.status === 'PENDING') sickPending += days;
      } else if (typeLower.includes('casual')) {
        if (raw.status === 'APPROVED') casualUsed += days;
        else if (raw.status === 'PENDING') casualPending += days;
      } else {
        // Default to Annual Leave
        if (raw.status === 'APPROVED') annualUsed += days;
        else if (raw.status === 'PENDING') annualPending += days;
      }
    }

    return {
      annual: { total: policy.annual, used: annualUsed, pending: annualPending, remaining: Math.max(0, policy.annual - annualUsed) },
      sick: { total: policy.sick, used: sickUsed, pending: sickPending, remaining: Math.max(0, policy.sick - sickUsed) },
      casual: { total: policy.casual, used: casualUsed, pending: casualPending, remaining: Math.max(0, policy.casual - casualUsed) },
      wfh: { total: policy.wfh, used: wfhUsed, pending: wfhPending, remaining: Math.max(0, policy.wfh - wfhUsed) },
    };
  }

  /**
   * Submits a new leave or WFH request.
   */
  async submitRequest({ tenantId, employeeId, requestType = 'LEAVE', leaveType, startDate, endDate, reason }) {
    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw { status: 404, message: 'Employee not found' };

    const totalDays = this.calculateWorkingDays(startDate, endDate);
    if (totalDays <= 0) {
      throw { status: 400, message: 'Invalid date range: working days must be at least 1 day' };
    }

    // 1. Check for overlapping requests
    await this.checkOverlap({ employeeId, startDate, endDate });

    // 2. Check balance
    const effectiveType = requestType === 'WFH' ? 'WFH' : (leaveType || 'Casual Leave');
    const balances = await this.getBalances({ tenantId, employeeId });
    const typeLower = effectiveType.toLowerCase();

    let available = 0;
    if (requestType === 'WFH' || typeLower.includes('wfh')) available = balances.wfh.remaining;
    else if (typeLower.includes('sick')) available = balances.sick.remaining;
    else if (typeLower.includes('casual')) available = balances.casual.remaining;
    else available = balances.annual.remaining;

    if (totalDays > available) {
      throw {
        status: 400,
        message: `Insufficient ${effectiveType} balance. Requested: ${totalDays} Days, Available: ${available} Days.`,
      };
    }

    // 3. Resolve Manager & Approval Flow
    // Leave requests must ALWAYS start with Manager Status as 'Pending' (never auto-approved).
    const initialManagerStatus = 'Pending';
    const initialHrStatus = 'Pending';

    const meta = {
      requestType,
      leaveType: effectiveType,
      totalDays,
      managerStatus: initialManagerStatus,
      managerId: employee.managerId || null,
      managerComment: null,
      managerActedAt: null,
      hrStatus: initialHrStatus,
      hrId: null,
      hrComment: null,
      hrActedAt: null,
    };

    const encodedReason = this.encodeMetadata(reason, meta);

    const created = await prisma.leaveRequest.create({
      data: {
        employeeId,
        type: effectiveType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason: encodedReason,
        status: 'PENDING',
      },
      include: {
        employee: true,
      },
    });

    // 4. Send Notifications
    if (hasManager) {
      await this.notify({
        tenantId,
        recipientId: employee.managerId,
        type: 'leave',
        title: `New ${effectiveType} Request from ${employee.name}`,
        body: `${employee.name} applied for ${totalDays} day(s) from ${startDate} to ${endDate}. Reason: "${reason.slice(0, 80)}"`,
        entityType: 'leave_request',
        entityId: created.id,
      });
    } else {
      // Direct notification to HR if no manager
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN'] } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'leave',
          title: `New ${effectiveType} Request awaiting HR Approval`,
          body: `${employee.name} applied for ${totalDays} day(s) from ${startDate} to ${endDate}.`,
          entityType: 'leave_request',
          entityId: created.id,
        });
      }
    }

    const formatted = this.parseMetadata(created);
    emitToTenant(tenantId, 'leave_updated', { action: 'create', leave: formatted, leaveId: created.id });
    return formatted;
  }

  /**
   * Manager approves or rejects leave request.
   */
  async managerAction({ tenantId, requestId, managerUser, action, comment }) {
    const raw = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
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

    const currentMeta = this.parseMetadata(raw);
    if (raw.status !== 'PENDING' || currentMeta.managerStatus === 'Approved') {
      throw { status: 400, message: `Manager approval cannot be updated: request is already ${raw.status}` };
    }

    const isApprove = action === 'APPROVE';
    const newManagerStatus = isApprove ? 'Approved' : 'Rejected';
    const newOverallStatus = isApprove ? 'PENDING' : 'REJECTED';
    const newHrStatus = isApprove ? 'Pending' : 'Not Required';

    const updatedMeta = {
      requestType: currentMeta.requestType,
      leaveType: currentMeta.leaveType,
      totalDays: currentMeta.totalDays,
      managerStatus: newManagerStatus,
      managerId: managerUser.id,
      managerComment: comment || (isApprove ? 'Approved by Manager' : 'Rejected by Manager'),
      managerActedAt: new Date().toISOString(),
      hrStatus: newHrStatus,
      hrId: currentMeta.hrId,
      hrComment: currentMeta.hrComment,
      hrActedAt: currentMeta.hrActedAt,
    };

    const encodedReason = this.encodeMetadata(currentMeta.reason, updatedMeta);

    const updated = await prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: newOverallStatus,
        reason: encodedReason,
        approvedById: isApprove ? managerUser.id : null,
      },
      include: { employee: true },
    });

    // Notify Employee of Manager Action
    await this.notify({
      tenantId,
      recipientId: raw.employeeId,
      type: 'leave',
      title: `Manager ${newManagerStatus} your ${currentMeta.type} request`,
      body: isApprove
        ? `Your manager ${managerUser.name} approved your request. It has now been forwarded for final HR approval.`
        : `Your manager ${managerUser.name} rejected your request. Reason: "${comment || 'No comment provided'}"`,
      entityType: 'leave_request',
      entityId: requestId,
    });

    // If Manager Approved, Notify HR
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
          body: `Manager ${managerUser.name} approved ${raw.employee.name}'s ${currentMeta.type} request (${currentMeta.totalDays} days). Please review.`,
          entityType: 'leave_request',
          entityId: requestId,
        });
      }
    }

    const formatted = this.parseMetadata(updated);
    emitToTenant(tenantId, 'leave_updated', { action: 'update', leave: formatted, leaveId: requestId });
    return formatted;
  }

  /**
   * HR approves or rejects leave request (Final Step).
   */
  async hrAction({ tenantId, requestId, hrUser, action, comment }) {
    const raw = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });

    if (!raw || raw.employee.tenantId !== tenantId) {
      throw { status: 404, message: 'Leave request not found' };
    }

    const isHRElevated = ['HR', 'SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER'].includes(hrUser.role);
    if (!isHRElevated) {
      throw { status: 403, message: 'Access forbidden: only HR or Administrators can perform final approval' };
    }

    const currentMeta = this.parseMetadata(raw);

    // Enforce Two-Level Ordering: Manager must have approved
    if (currentMeta.managerStatus !== 'Approved') {
      throw {
        status: 400,
        message: `Cannot perform HR decision: Manager approval is currently "${currentMeta.managerStatus}". Manager must approve before HR.`,
      };
    }

    if (raw.status !== 'PENDING' || currentMeta.hrStatus !== 'Pending') {
      throw { status: 400, message: `HR decision cannot be updated: request is already ${raw.status}` };
    }

    const isApprove = action === 'APPROVE';
    const newHrStatus = isApprove ? 'Approved' : 'Rejected';
    const newOverallStatus = isApprove ? 'APPROVED' : 'REJECTED';

    const updatedMeta = {
      requestType: currentMeta.requestType,
      leaveType: currentMeta.leaveType,
      totalDays: currentMeta.totalDays,
      managerStatus: currentMeta.managerStatus,
      managerId: currentMeta.managerId,
      managerComment: currentMeta.managerComment,
      managerActedAt: currentMeta.managerActedAt,
      hrStatus: newHrStatus,
      hrId: hrUser.id,
      hrComment: comment || (isApprove ? 'Approved by HR' : 'Rejected by HR'),
      hrActedAt: new Date().toISOString(),
    };

    const encodedReason = this.encodeMetadata(currentMeta.reason, updatedMeta);

    const updated = await prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: newOverallStatus,
        reason: encodedReason,
        approvedById: isApprove ? hrUser.id : null,
      },
      include: { employee: true },
    });

    // Notify Employee of Final HR Decision
    await this.notify({
      tenantId,
      recipientId: raw.employeeId,
      type: 'leave',
      title: `Final HR Decision: Your ${currentMeta.type} is ${newOverallStatus}`,
      body: isApprove
        ? `HR Partner ${hrUser.name} has approved your ${currentMeta.type} request. Your balance has been updated.`
        : `HR Partner ${hrUser.name} rejected your request. Remarks: "${comment || 'No comment provided'}"`,
      entityType: 'leave_request',
      entityId: requestId,
    });

    const formatted = this.parseMetadata(updated);
    emitToTenant(tenantId, 'leave_updated', { action: 'update', leave: formatted, leaveId: requestId });
    return formatted;
  }

  /**
   * Employee cancels their own pending leave request.
   */
  async cancelRequest({ tenantId, requestId, employeeId }) {
    const raw = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });

    if (!raw || raw.employee.tenantId !== tenantId) {
      throw { status: 404, message: 'Leave request not found' };
    }

    if (raw.employeeId !== employeeId) {
      throw { status: 403, message: 'Access forbidden: you can only cancel your own requests' };
    }

    if (raw.status !== 'PENDING') {
      throw { status: 400, message: `Cannot cancel request with status ${raw.status}` };
    }

    const currentMeta = this.parseMetadata(raw);
    const updatedMeta = {
      ...currentMeta,
      managerStatus: 'Cancelled',
      hrStatus: 'Cancelled',
    };

    const encodedReason = this.encodeMetadata(currentMeta.reason, updatedMeta);

    const updated = await prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        reason: encodedReason,
      },
      include: { employee: true },
    });

    const formatted = this.parseMetadata(updated);
    emitToTenant(tenantId, 'leave_updated', { action: 'update', leave: formatted, leaveId: requestId });
    return formatted;
  }

  /**
   * Lists requests for employee, manager team queue, or full company.
   */
  async listRequests({ tenantId, user, scope = 'my', statusFilter = null, page = 1, limit = 50 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      employee: { tenantId },
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
      // HR or Super Admin
      const isHR = ['HR', 'SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER'].includes(user.role);
      if (!isHR) {
        throw { status: 403, message: 'Access forbidden: only HR and Admins can view company-wide leaves' };
      }
    }

    if (statusFilter && statusFilter !== 'ALL') {
      where.status = statusFilter;
    }

    const [items, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          employee: {
            select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    const formatted = items.map((i) => this.parseMetadata(i));

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
}

export const leaveService = new LeaveService();
