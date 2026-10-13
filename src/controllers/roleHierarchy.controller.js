import {
  getSystemRolesHierarchy,
  getOrgHierarchyTree,
  getEmployeeHierarchyChain,
  assignEmployeeManager,
  getRolePermissionMatrix,
  updateRolePermissions,
  resetRolePermissions,
  getHierarchyVisibility,
  updateHierarchyVisibility,
  getRoleDashboardConfig,
  updateRoleDashboardConfig,
  resetRoleDashboardConfig,
  getPermissionAuditLogs,
} from '../services/roleHierarchy.service.js';
import {
  assignManagerSchema,
  hierarchyQuerySchema,
  employeeIdParamSchema,
  updatePermissionsSchema,
  resetPermissionsSchema,
  updateVisibilitySchema,
  updateDashboardConfigSchema,
  resetDashboardConfigSchema,
  auditLogsQuerySchema,
} from '../validations/roleHierarchy.schema.js';

/**
 * GET /api/hierarchy/system
 * Returns real database role definitions, tier levels, creation map, and active user counts.
 */
export async function getSystemRoles(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const data = await getSystemRolesHierarchy(tenantId, req.user);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
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
    const data = await getOrgHierarchyTree(tenantId, parsed.data, req.user);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
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
    const data = await getEmployeeHierarchyChain(tenantId, parsed.data.employeeId, req.user);
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
    const data = await getRolePermissionMatrix(tenantId, req.user);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * PATCH /api/hierarchy/permissions
 * Updates role-wise permission assignments in the tenant database.
 * Gated to SUPER_ADMIN and ADMIN.
 */
export async function updatePermissions(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = updatePermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const result = await updateRolePermissions(tenantId, req.user, parsed.data);
    return res.json({
      success: true,
      message: `Permissions updated successfully for role ${parsed.data.role}.`,
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/hierarchy/permissions/reset
 * Resets permission overrides to system enterprise defaults.
 * Gated to SUPER_ADMIN and ADMIN.
 */
export async function resetPermissions(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = resetPermissionsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const targetRole = parsed.data?.role || 'ALL';
    const result = await resetRolePermissions(tenantId, req.user, { role: targetRole });
    return res.json({
      success: true,
      message: `Permissions reset to enterprise defaults for ${targetRole === 'ALL' ? 'all roles' : `role ${targetRole}`}.`,
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * GET /api/hierarchy/visibility
 * Returns the dynamic role hierarchy visibility controls for this tenant.
 */
export async function getVisibility(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const data = await getHierarchyVisibility(tenantId, req.user);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * PATCH /api/hierarchy/visibility
 * Updates dynamic role hierarchy visibility configuration across roles.
 * Gated to SUPER_ADMIN and ADMIN.
 */
export async function updateVisibility(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = updateVisibilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const result = await updateHierarchyVisibility(tenantId, req.user, parsed.data);
    return res.json({
      success: true,
      message: 'Role hierarchy visibility settings updated successfully.',
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * GET /api/hierarchy/dashboard-config
 * Returns role-based dashboard widget configuration.
 */
export async function getDashboardConfig(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const data = await getRoleDashboardConfig(tenantId, req.user);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * PATCH /api/hierarchy/dashboard-config
 * Updates dashboard widgets enabled for a specific role.
 * Gated to SUPER_ADMIN and ADMIN.
 */
export async function updateDashboardConfig(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = updateDashboardConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const result = await updateRoleDashboardConfig(tenantId, req.user, parsed.data);
    return res.json({
      success: true,
      message: `Dashboard widget configuration updated for role ${parsed.data.role}.`,
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/hierarchy/dashboard-config/reset
 * Resets dashboard widgets to enterprise defaults.
 * Gated to SUPER_ADMIN and ADMIN.
 */
export async function resetDashboardConfig(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = resetDashboardConfigSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const targetRole = parsed.data?.role || 'ALL';
    const result = await resetRoleDashboardConfig(tenantId, req.user, { role: targetRole });
    return res.json({
      success: true,
      message: `Dashboard widget configuration reset to defaults for ${targetRole === 'ALL' ? 'all roles' : `role ${targetRole}`}.`,
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * GET /api/hierarchy/audit-logs
 * Retrieves paginated audit trail logs for role permission and visibility modifications.
 * Gated to SUPER_ADMIN and ADMIN.
 */
export async function getAuditLogs(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = auditLogsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const data = await getPermissionAuditLogs(tenantId, parsed.data);
    return res.json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}
