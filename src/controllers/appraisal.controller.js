import { prisma } from '../lib/prisma.js';

export async function submitSelfRating(req, res, next) {
  try {
    const { cycleId, selfRating, selfRemarks } = req.body || {};
    if (!cycleId || selfRating === undefined) {
      return res.status(400).json({ error: 'Appraisal cycle ID and self rating are required' });
    }

    // Upsert performance review for current user and cycle
    const review = await prisma.performanceReview.findFirst({
      where: { cycleId, employeeId: req.user.id },
    });

    let result;
    if (review) {
      result = await prisma.performanceReview.update({
        where: { id: review.id },
        data: {
          selfRating: parseFloat(selfRating),
          selfRemarks,
          status: 'SUBMITTED',
        },
      });
    } else {
      result = await prisma.performanceReview.create({
        data: {
          cycleId,
          employeeId: req.user.id,
          selfRating: parseFloat(selfRating),
          selfRemarks,
          status: 'SUBMITTED',
        },
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function submitManagerRating(req, res, next) {
  try {
    const { id } = req.params;
    const { managerRating, managerRemarks } = req.body || {};
    if (managerRating === undefined) {
      return res.status(400).json({ error: 'Manager rating is required' });
    }

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }


    // Verify requesting user is employee's manager
    if (review.employee.managerId !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access forbidden: you are not the manager of this employee' });
    }

    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        managerRating: parseFloat(managerRating),
        managerRemarks,
        status: 'COMPLETED',
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function listReviews(req, res, next) {
  try {
    const employeeId = req.query.employeeId || req.user.id;

    if (employeeId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') {
      const subordinate = await prisma.tenantUser.findFirst({
        where: { id: employeeId, managerId: req.user.id },
      });
      if (!subordinate) {
        return res.status(403).json({ error: 'Access forbidden' });
      }
    }

    const items = await prisma.performanceReview.findMany({
      where: { employeeId },
      include: { cycle: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}
