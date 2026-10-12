import {
  getSystemRolesHierarchy,
  getOrgHierarchyTree,
  getEmployeeHierarchyChain,
  assignEmployeeManager,
  getRolePermissionMatrix,
} from '../services/roleHierarchy.service.js';
import {
  assignManagerSchema,
  hierarchyQuerySchema,
  employeeIdParamSchema,
} from '../validations/roleHierarchy.schema.js';

/**
 * GET /api/hierarchy/system
 * Returns real database role definitions, tier levels, creation map, and active user counts.
 */
export async function getSystemRoles(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const data = await getSystemRolesHierarchy(tenantId);
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/hierarchy/tree
 * Returns the company's real-time organizational reporting tree.
 */
export async function getOrgTree(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = hierarchyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = await getOrgHierarchyTree(tenantId, parsed.data);
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/hierarchy/chain/:employeeId
 * Returns the management chain of command from top leader to this employee + direct reports.
 */
export async function getHierarchyChain(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = employeeIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = await getEmployeeHierarchyChain(tenantId, parsed.data.employeeId);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * PATCH /api/hierarchy/assign-manager
 * Safely updates an employee's direct reporting manager with anti-cycle checks.
 * Gated to SUPER_ADMIN, ADMIN, HR.
 */
export async function updateManagerAssignment(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = assignManagerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { employeeId, managerId } = parsed.data;
    const result = await assignEmployeeManager(tenantId, employeeId, managerId);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * GET /api/hierarchy/matrix
 * Returns the feature permissions matrix across all roles present in this tenant.
 */
export async function getPermissionMatrix(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const data = await getRolePermissionMatrix(tenantId);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

