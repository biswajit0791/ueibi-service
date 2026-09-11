import { policyService } from '../services/policy.service.js';
import {
  createPolicySchema,
  updatePolicySchema,
  signPolicySchema,
  assignPolicySchema,
  reminderSchema,
  publishPolicySchema,
} from '../validations/policy.schema.js';

export async function getMyPolicies(req, res, next) {
  try {
    const policies = await policyService.getMyPolicies({
      tenantId: req.tenantId,
      userId: req.user.id,
    });
    res.json({ items: policies });
  } catch (err) {
    next(err);
  }
}

export async function getMyPolicyById(req, res, next) {
  try {
    const { id } = req.params;
    const policies = await policyService.getMyPolicies({
      tenantId: req.tenantId,
      userId: req.user.id,
    });
    const policy = policies.find(p => p.id === id);
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found or not assigned to you' });
    }
    res.json(policy);
  } catch (err) {
    next(err);
  }
}

export async function signPolicy(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = signPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const result = await policyService.signPolicy({
      tenantId: req.tenantId,
      user: req.user,
      policyId: id,
      req,
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function listPolicies(req, res, next) {
  try {
    const { status, category, search, page, limit } = req.query;
    const result = await policyService.listPolicies({
      tenantId: req.tenantId,
      status,
      category,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPolicyById(req, res, next) {
  try {
    const { id } = req.params;
    const policy = await policyService.getPolicyById({
      tenantId: req.tenantId,
      id,
    });
    res.json(policy);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function createPolicy(req, res, next) {
  try {
    const parsed = createPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const policy = await policyService.createPolicy({
      tenantId: req.tenantId,
      user: req.user,
      data: parsed.data,
      req,
    });

    res.status(201).json(policy);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function updatePolicy(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = updatePolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const updated = await policyService.updatePolicy({
      tenantId: req.tenantId,
      user: req.user,
      id,
      data: parsed.data,
      req,
    });

    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function publishPolicy(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = publishPolicySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { assignees } = parsed.data;
    const published = await policyService.publishPolicy({
      tenantId: req.tenantId,
      user: req.user,
      id,
      assignees,
      req,
    });
    res.json(published);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function archivePolicy(req, res, next) {
  try {
    const { id } = req.params;
    const result = await policyService.archivePolicy({
      tenantId: req.tenantId,
      user: req.user,
      id,
      req,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function deletePolicy(req, res, next) {
  try {
    const { id } = req.params;
    const result = await policyService.deletePolicy({
      tenantId: req.tenantId,
      user: req.user,
      id,
      req,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function assignPolicy(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = assignPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const result = await policyService.assignPolicy({
      tenantId: req.tenantId,
      user: req.user,
      policyId: id,
      data: parsed.data,
      req,
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function getComplianceRegistry(req, res, next) {
  try {
    const { policyId, search, page, limit } = req.query;
    const result = await policyService.getComplianceRegistry({
      tenantId: req.tenantId,
      policyId,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPendingCompliance(req, res, next) {
  try {
    const { policyId } = req.query;
    const result = await policyService.getPendingCompliance({
      tenantId: req.tenantId,
      policyId,
    });
    res.json({ items: result });
  } catch (err) {
    next(err);
  }
}

export async function sendReminders(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = reminderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const result = await policyService.sendReminders({
      tenantId: req.tenantId,
      user: req.user,
      policyId: id,
      data: parsed.data,
      req,
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function exportComplianceCSV(req, res, next) {
  try {
    const { policyId } = req.query;
    const csvContent = await policyService.exportComplianceCSV({
      tenantId: req.tenantId,
      policyId,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_registry_${Date.now()}.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
}
