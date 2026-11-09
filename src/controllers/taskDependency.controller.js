import {
  createDependency,
  approveDependency,
  rejectDependency,
  submitDeliverable,
  verifyDependency,
  requestRework,
  getPendingApprovals,
  getTaskDependencies,
  getManagerDownlines,
} from '../services/taskDependency.service.js';

export async function createDependencyHandler(req, res, next) {
  try {
    const { taskId } = req.params;
    const { dependencyType, targetManagerId, title, description, dueDate, weight } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Dependency title is required.' });
    }
    if (!targetManagerId) {
      return res.status(400).json({ success: false, error: 'Target manager is required.' });
    }

    const dep = await createDependency({
      tenantId: req.tenantId,
      requester: req.user,
      sourceTaskId: taskId,
      dependencyType: dependencyType || 'pre',
      targetManagerId,
      title: title.trim(),
      description,
      dueDate,
      weight: Number(weight) || 10,
    });

    res.status(201).json({ success: true, dependency: dep });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function approveDependencyHandler(req, res, next) {
  try {
    const { id: dependencyId } = req.params;
    const { downlineEmployeeIds, notes } = req.body;

    const updated = await approveDependency({
      tenantId: req.tenantId,
      user: req.user,
      dependencyId,
      downlineEmployeeIds,
      notes,
    });

    res.json({ success: true, dependency: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function rejectDependencyHandler(req, res, next) {
  try {
    const { id: dependencyId } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: 'A rejection reason is required.' });
    }

    const updated = await rejectDependency({
      tenantId: req.tenantId,
      user: req.user,
      dependencyId,
      reason: reason.trim(),
    });

    res.json({ success: true, dependency: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function submitDeliverableHandler(req, res, next) {
  try {
    const { id: dependencyId } = req.params;
    const { deliverableNotes } = req.body;

    const updated = await submitDeliverable({
      tenantId: req.tenantId,
      user: req.user,
      dependencyId,
      deliverableNotes,
    });

    res.json({ success: true, dependency: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function verifyDependencyHandler(req, res, next) {
  try {
    const { id: dependencyId } = req.params;
    const { verificationNotes } = req.body;

    const result = await verifyDependency({
      tenantId: req.tenantId,
      user: req.user,
      dependencyId,
      verificationNotes,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function requestReworkHandler(req, res, next) {
  try {
    const { id: dependencyId } = req.params;
    const { reworkReason } = req.body;

    if (!reworkReason || !reworkReason.trim()) {
      return res.status(400).json({ success: false, error: 'A rework reason is required.' });
    }

    const updated = await requestRework({
      tenantId: req.tenantId,
      user: req.user,
      dependencyId,
      reworkReason: reworkReason.trim(),
    });

    res.json({ success: true, dependency: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function getPendingApprovalsHandler(req, res, next) {
  try {
    const approvals = await getPendingApprovals(req.tenantId, req.user.id);
    res.json({ success: true, approvals });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function getTaskDependenciesHandler(req, res, next) {
  try {
    const { taskId } = req.params;
    const dependencies = await getTaskDependencies(taskId, req.tenantId);
    res.json({ success: true, dependencies });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function getManagerDownlinesHandler(req, res, next) {
  try {
    const managerId = req.params.managerId || req.user.id;
    const downlines = await getManagerDownlines(managerId, req.tenantId);
    res.json({ success: true, downlines });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}
