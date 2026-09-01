import { leaveService } from '../services/leave.service.js';
import { createLeaveRequestSchema, approvalActionSchema } from '../validations/leave.schema.js';

export async function createLeaveRequest(req, res, next) {
  try {
    const validated = createLeaveRequestSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid leave request data' });
    }

    const { requestType, leaveType, type, startDate, endDate, reason } = validated.data;
    const effectiveLeaveType = leaveType || type || (requestType === 'WFH' ? 'WFH' : 'Casual Leave');

    const created = await leaveService.submitRequest({
      tenantId: req.tenantId,
      employeeId: req.user.id,
      requestType,
      leaveType: effectiveLeaveType,
      startDate,
      endDate,
      reason,
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function getMyLeaveBalances(req, res, next) {
  try {
    const balances = await leaveService.getBalances({
      tenantId: req.tenantId,
      employeeId: req.user.id,
      year: parseInt(req.query.year, 10) || new Date().getFullYear(),
    });

    res.json(balances);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function listLeaveRequests(req, res, next) {
  try {
    const { scope = 'my', status, page, limit } = req.query;

    const result = await leaveService.listRequests({
      tenantId: req.tenantId,
      user: req.user,
      scope,
      statusFilter: status,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function managerApproveLeave(req, res, next) {
  try {
    const { id } = req.params;
    const { comment } = req.body || {};

    const updated = await leaveService.managerAction({
      tenantId: req.tenantId,
      requestId: id,
      managerUser: req.user,
      action: 'APPROVE',
      comment,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function managerRejectLeave(req, res, next) {
  try {
    const { id } = req.params;
    const validated = approvalActionSchema.safeParse({ action: 'REJECT', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Rejection reason is required' });
    }

    const updated = await leaveService.managerAction({
      tenantId: req.tenantId,
      requestId: id,
      managerUser: req.user,
      action: 'REJECT',
      comment: validated.data.comment,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function hrApproveLeave(req, res, next) {
  try {
    const { id } = req.params;
    const { comment } = req.body || {};

    const updated = await leaveService.hrAction({
      tenantId: req.tenantId,
      requestId: id,
      hrUser: req.user,
      action: 'APPROVE',
      comment,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function hrRejectLeave(req, res, next) {
  try {
    const { id } = req.params;
    const validated = approvalActionSchema.safeParse({ action: 'REJECT', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Rejection reason is required' });
    }

    const updated = await leaveService.hrAction({
      tenantId: req.tenantId,
      requestId: id,
      hrUser: req.user,
      action: 'REJECT',
      comment: validated.data.comment,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function cancelLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await leaveService.cancelRequest({
      tenantId: req.tenantId,
      requestId: id,
      employeeId: req.user.id,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// ─── Legacy Approval Handler (Backward Compatibility) ──────────────────────
export async function approveLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const { status, comment, role = 'manager' } = req.body || {};

    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
    }

    if (role === 'hr' || ['HR', 'SUPER_ADMIN', 'ADMIN'].includes(req.user.role)) {
      if (status === 'APPROVED') {
        const updated = await leaveService.hrAction({
          tenantId: req.tenantId,
          requestId: id,
          hrUser: req.user,
          action: 'APPROVE',
          comment,
        });
        return res.json(updated);
      } else {
        const updated = await leaveService.hrAction({
          tenantId: req.tenantId,
          requestId: id,
          hrUser: req.user,
          action: 'REJECT',
          comment: comment || 'Rejected by HR',
        });
        return res.json(updated);
      }
    } else {
      if (status === 'APPROVED') {
        const updated = await leaveService.managerAction({
          tenantId: req.tenantId,
          requestId: id,
          managerUser: req.user,
          action: 'APPROVE',
          comment,
        });
        return res.json(updated);
      } else {
        const updated = await leaveService.managerAction({
          tenantId: req.tenantId,
          requestId: id,
          managerUser: req.user,
          action: 'REJECT',
          comment: comment || 'Rejected by Manager',
        });
        return res.json(updated);
      }
    }
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}
