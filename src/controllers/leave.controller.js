import { leaveService } from '../services/leave.service.js';
import {
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  leaveTypeStatusSchema,
  createLeaveRequestSchema,
  approvalActionSchema,
  wfhPolicySchema,
  leaveBalanceAdjustmentSchema,
} from '../validations/leave.schema.js';

// ══════════════════════════════════════════════════════════════════════════════
// 1. LEAVE TYPE CRUD (Admin / HR)
// ══════════════════════════════════════════════════════════════════════════════

export async function createLeaveType(req, res, next) {
  try {
    const validated = createLeaveTypeSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid leave type data' });
    }

    const created = await leaveService.createLeaveType({
      tenantId: req.tenantId,
      user: req.user,
      data: validated.data,
      req,
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function listLeaveTypes(req, res, next) {
  try {
    const { search, status, page, limit } = req.query;
    const result = await leaveService.listLeaveTypes({
      tenantId: req.tenantId,
      search,
      status,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function getLeaveTypeById(req, res, next) {
  try {
    const { id } = req.params;
    const result = await leaveService.getLeaveTypeById({
      tenantId: req.tenantId,
      id,
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function updateLeaveType(req, res, next) {
  try {
    const { id } = req.params;
    const validated = updateLeaveTypeSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid leave type data' });
    }

    const updated = await leaveService.updateLeaveType({
      tenantId: req.tenantId,
      id,
      user: req.user,
      data: validated.data,
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function toggleLeaveTypeStatus(req, res, next) {
  try {
    const { id } = req.params;
    const validated = leaveTypeStatusSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid status data' });
    }

    const updated = await leaveService.toggleLeaveTypeStatus({
      tenantId: req.tenantId,
      id,
      user: req.user,
      isActive: validated.data.isActive,
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function deleteLeaveType(req, res, next) {
  try {
    const { id } = req.params;
    const result = await leaveService.deleteLeaveType({
      tenantId: req.tenantId,
      id,
      user: req.user,
      req,
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// Common active leave types for employee dropdown
export async function listActiveLeaveTypes(req, res, next) {
  try {
    const result = await leaveService.listLeaveTypes({
      tenantId: req.tenantId,
      activeOnly: true,
      limit: 100,
    });

    res.json(result.items);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. DYNAMIC BALANCES
// ══════════════════════════════════════════════════════════════════════════════

export async function getMyLeaveBalances(req, res, next) {
  try {
    const balances = await leaveService.getBalances({
      tenantId: req.tenantId,
      employeeId: req.user.id,
      year: parseInt(req.query.year, 10) || new Date().getFullYear(),
    });

    res.json(balances);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function listEmployeeBalances(req, res, next) {
  try {
    const { search, year, page, limit } = req.query;
    const result = await leaveService.listEmployeeBalances({
      tenantId: req.tenantId,
      search,
      year: parseInt(year, 10) || new Date().getFullYear(),
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function adjustEmployeeBalance(req, res, next) {
  try {
    const validated = leaveBalanceAdjustmentSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid adjustment data' });
    }

    const result = await leaveService.adjustEmployeeBalance({
      tenantId: req.tenantId,
      user: req.user,
      data: validated.data,
      req,
    });

    res.json({ message: 'Balance adjusted successfully', adjustment: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. LEAVE & WFH REQUESTS
// ══════════════════════════════════════════════════════════════════════════════

export async function createLeaveRequest(req, res, next) {
  try {
    const validated = createLeaveRequestSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid leave request data' });
    }

    const created = await leaveService.submitRequest({
      tenantId: req.tenantId,
      employeeId: req.user.id,
      data: validated.data,
      req,
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function listLeaveRequests(req, res, next) {
  try {
    const { scope = 'my', status, leaveTypeId, requestType, page, limit } = req.query;

    const result = await leaveService.listRequests({
      tenantId: req.tenantId,
      user: req.user,
      scope,
      statusFilter: status,
      leaveTypeId,
      requestType,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function cancelLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const cancelled = await leaveService.cancelRequest({
      tenantId: req.tenantId,
      requestId: id,
      employeeId: req.user.id,
      req,
    });

    res.json(cancelled);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. APPROVAL WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════

export async function managerApproveLeave(req, res, next) {
  try {
    const { id } = req.params;
    const validated = approvalActionSchema.safeParse({ action: 'APPROVE', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Validation failed' });
    }

    const updated = await leaveService.managerAction({
      tenantId: req.tenantId,
      requestId: id,
      managerUser: req.user,
      action: 'APPROVE',
      comment: validated.data.comment,
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function hrApproveLeave(req, res, next) {
  try {
    const { id } = req.params;
    const validated = approvalActionSchema.safeParse({ action: 'APPROVE', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Validation failed' });
    }

    const updated = await leaveService.hrAction({
      tenantId: req.tenantId,
      requestId: id,
      hrUser: req.user,
      action: 'APPROVE',
      comment: validated.data.comment,
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function adminApproveLeave(req, res, next) {
  try {
    const { id } = req.params;
    const validated = approvalActionSchema.safeParse({ action: 'APPROVE', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Validation failed' });
    }

    const updated = await leaveService.adminAction({
      tenantId: req.tenantId,
      requestId: id,
      adminUser: req.user,
      action: 'APPROVE',
      comment: validated.data.comment,
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function adminRejectLeave(req, res, next) {
  try {
    const { id } = req.params;
    const validated = approvalActionSchema.safeParse({ action: 'REJECT', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Rejection reason is required' });
    }

    const updated = await leaveService.adminAction({
      tenantId: req.tenantId,
      requestId: id,
      adminUser: req.user,
      action: 'REJECT',
      comment: validated.data.comment,
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function approveLeaveRequest(req, res, next) {
  try {
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'].includes(req.user.role);
    if (isAdmin) {
      return adminApproveLeave(req, res, next);
    }
    const isHR = req.user.role === 'HR';
    if (isHR) {
      return hrApproveLeave(req, res, next);
    }
    return managerApproveLeave(req, res, next);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function rejectLeaveRequest(req, res, next) {
  try {
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'].includes(req.user.role);
    if (isAdmin) {
      return adminRejectLeave(req, res, next);
    }
    const isHR = req.user.role === 'HR';
    if (isHR) {
      return hrRejectLeave(req, res, next);
    }
    return managerRejectLeave(req, res, next);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. WFH POLICY
// ══════════════════════════════════════════════════════════════════════════════

export async function getWfhPolicy(req, res, next) {
  try {
    const policy = await leaveService.getWfhPolicy({ tenantId: req.tenantId });
    res.json(policy);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function updateWfhPolicy(req, res, next) {
  try {
    const validated = wfhPolicySchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid WFH policy configuration' });
    }

    const policy = await leaveService.updateWfhPolicy({
      tenantId: req.tenantId,
      user: req.user,
      data: validated.data,
      req,
    });

    res.json(policy);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. OVERVIEW STATS, CALENDAR & AUDIT LOGS
// ══════════════════════════════════════════════════════════════════════════════

export async function getLeaveOverviewStats(req, res, next) {
  try {
    const stats = await leaveService.getOverviewStats({ tenantId: req.tenantId });
    res.json(stats);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function getLeaveCalendarView(req, res, next) {
  try {
    const { month, year, department, leaveTypeId } = req.query;
    const events = await leaveService.getCalendarView({
      tenantId: req.tenantId,
      month,
      year: parseInt(year, 10) || new Date().getFullYear(),
      department,
      leaveTypeId,
    });

    res.json(events);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function getLeaveAuditLogs(req, res, next) {
  try {
    const { action, page, limit } = req.query;
    const logs = await leaveService.getAuditLogs({
      tenantId: req.tenantId,
      action,
      page,
      limit,
    });

    res.json(logs);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
