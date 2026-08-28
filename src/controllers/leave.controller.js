import { prisma } from '../lib/prisma.js';

export async function createLeaveRequest(req, res, next) {
  try {
    const { type, startDate, endDate, reason } = req.body || {};
    if (!type || !startDate || !endDate) {
      return res.status(400).json({ error: 'Leave type, start date, and end date are required' });
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: req.user.id,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
        status: 'PENDING',
      },
    });

    res.status(201).json(leave);
  } catch (err) {
    next(err);
  }
}

export async function listLeaveRequests(req, res, next) {
  try {
    const { pendingOnly } = req.query || {};

    const where = {};

    if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'HR') {
      // HR/Super Admin can see all leave requests in the tenant
      where.employee = { tenantId: req.tenantId };
    } else if (req.user.role === 'MANAGER') {
      // Manager can see their own leaves AND leaves of their direct reports
      where.OR = [
        { employeeId: req.user.id },
        { employee: { managerId: req.user.id } },
      ];
    } else {
      // Regular employee can only see their own leaves
      where.employeeId = req.user.id;
    }

    if (pendingOnly === 'true') {
      where.status = 'PENDING';
    }

    const items = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: {
          select: { id: true, name: true, email: true, designation: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function approveLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body || {}; // APPROVED | REJECTED

    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
    }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!leave) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    // Verify manager approval logic
    if (leave.employee.managerId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') {
      return res.status(403).json({ error: 'Access forbidden: you are not authorized to approve this leave' });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status,
        approvedById: req.user.id,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
