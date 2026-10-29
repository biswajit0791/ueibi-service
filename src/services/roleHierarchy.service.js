import { prisma } from '../lib/prisma.js';
import {
  ROLE_CREATION_MAP,
  getAllowedRoles,
} from '../lib/roleHierarchy.js';
import {
  ELEVATED_ROLES,
  HR_ROLES,
  SUPER_ELEVATED_ROLES,
  MANAGER_OR_ELEVATED_ROLES,
  PLATFORM_ROLES,
  hasRole,
} from '../lib/roles.js';
import {
  DASHBOARD_VISIBILITY,
  getVisibleDashboards,
} from '../lib/dashboardPermissions.js';
import { CAPABILITIES } from '../lib/capabilities.js';

/**
 * Metadata definition for corporate system roles.
 * Non-existent / educational roles (STUDENT, MENTOR) are removed.
 * Only roles with actual users in the tenant database will be returned.
 */
export const SYSTEM_ROLE_DEFINITIONS = [
  {
    role: 'SUPER_ADMIN',
    title: 'Super Administrator',
    subtitle: 'Chief Tenant Authority & Owner',
    tierName: 'Executive Governance',
    tierLevel: 1,
    tierRank: 100,
    badgeColor: '#6366f1',
    badgeBg: '#eef2ff',
    description: 'Supreme root authority within the enterprise. Owns complete tenant settings, user provisioning, license management, billing, and system-wide visibility.',
    responsibilities: [
      'Full administrative control over all tenant data and configurations',
      'Can invite, edit, or exit any user role without restriction',
      'Full dashboard visibility across all company roles',
      'Approve license purchases, payments, and billing invoices',
      'Assign goals to all corporate users including super-elevated leaders',
      'Manage tenant document templates and department masters',
    ],
  },
  {
    role: 'CMD',
    title: 'Chairman & Managing Director',
    subtitle: 'Board & Executive Leadership',
    tierName: 'Executive Governance',
    tierLevel: 1,
    tierRank: 95,
    badgeColor: '#8b5cf6',
    badgeBg: '#f3e8ff',
    description: 'Top-tier executive leadership overlooking strategic business initiatives, high-level corporate goals, and confidential executive communication.',
    responsibilities: [
      'Executive dashboard and performance analytics oversight',
      'Targets and signs off on top-level corporate OKRs and strategic milestones',
      'Receives and responds to confidential CXO Connect tickets from staff',
      'Full company-wide reporting and task visibility access',
      'Immune from standard HR goal assignment (Super-Elevated status)',
    ],
  },
  {
    role: 'ADMIN',
    title: 'Company Administrator',
    subtitle: 'Operations & Workspace Controller',
    tierName: 'Tenant Administration',
    tierLevel: 2,
    tierRank: 90,
    badgeColor: '#3b82f6',
    badgeBg: '#eff6ff',
    description: 'Operational administrator tasked with day-to-day corporate governance, master data maintenance, user onboarding, and access control.',
    responsibilities: [
      'Manage corporate master data, departments, and blood group listings',
      'Invite and provision HR, Manager, and Employee user accounts',
      'View company-wide reports, analytics, and employee registries',
      'Configure company settings, email domains, and milestone approvals',
      'Grant or revoke leadership and registry capabilities',
    ],
  },
  {
    role: 'HR',
    title: 'Human Resources Head',
    subtitle: 'People Operations & Talent Management',
    tierName: 'People & Operations Leadership',
    tierLevel: 3,
    tierRank: 80,
    badgeColor: '#10b981',
    badgeBg: '#ecfdf5',
    description: 'Head of human capital managing the employee lifecycle, leave policies, onboarding verification, 360 appraisals, and exit clearances.',
    responsibilities: [
      'Orchestrate employee onboarding, profile verification, and records',
      'Invite and manage team Managers and regular Employees',
      'Level 2 / Final sign-off on employee leave and WFH requests',
      'Manage performance appraisal cycles, parameters, and 360 reviews',
      'Oversee employee exit workflows, clearance sign-offs, and service certificates',
      'Access registry search, verification, and talent credentials',
    ],
  },
  {
    role: 'FINANCE',
    title: 'Finance Controller',
    subtitle: 'Billing, Licenses & Financial Clearance',
    tierName: 'People & Operations Leadership',
    tierLevel: 3,
    tierRank: 75,
    badgeColor: '#0ea5e9',
    badgeBg: '#f0f9ff',
    description: 'Oversees financial clearances, subscription seat licensing, payment reconciliations, and financial exit approvals.',
    responsibilities: [
      'Review and authorize employee license quota requests and seat payments',
      'View finance dashboard, manager and employee performance overviews',
      'Sign off on financial dues and equipment clearance during employee exit',
      'Access talent registry and compensation-related employee documentation',
    ],
  },
  {
    role: 'MANAGER',
    title: 'Line Manager / Team Lead',
    subtitle: 'Team Leadership & Direct Report Supervision',
    tierName: 'Line Management',
    tierLevel: 4,
    tierRank: 60,
    badgeColor: '#f59e0b',
    badgeBg: '#fffbeb',
    description: 'Team supervisor directly responsible for subordinate task execution, goal allocation, Level 1 leave approvals, and employee performance appraisals.',
    responsibilities: [
      'Supervise direct reports and entire hierarchical downline team',
      'Assign goals, monitor milestone completions, and track task weights',
      'First-line (Level 1) approval authority for subordinate leave and WFH requests',
      'Conduct annual appraisal ratings, conduct reviews, and feedback submissions',
      'Invite team employees into their respective department downline',
      'Sign off on operational exit clearance for departing direct reports',
    ],
  },
  {
    role: 'EMPLOYEE',
    title: 'Employee',
    subtitle: 'Core Contributor & Individual Contributor',
    tierName: 'Core Workforce',
    tierLevel: 5,
    tierRank: 40,
    badgeColor: '#64748b',
    badgeBg: '#f8fafc',
    description: 'Individual contributor focused on executing assigned tasks, milestones, self-appraisals, and departmental collaboration.',
    responsibilities: [
      'View and update personal task board and assigned OKRs',
      'Submit leave requests, WFH applications, and track remaining balances',
      'Participate in self-appraisals and 360 peer feedback nominations',
      'Submit direct messages through CXO Connect with optional anonymity',
      'Acknowledge and comply with tenant company policies and NDAs',
    ],
  },
];

/**
 * Returns roles dynamically derived STRICTLY from the real database records of the tenant.
 * Only roles with active users in the DB are returned — no static/hardcoded roles with 0 users.
 */
export async function getSystemRolesHierarchy(tenantId, caller = null) {
  const callerRole = String(caller?.role || 'EMPLOYEE').toUpperCase();
  const isSuperAdminOrAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(callerRole);

  if (caller) {
    const callerVis = await getCallerHierarchyVisibility(tenantId, caller);
    if (!callerVis.canViewLadder && !isSuperAdminOrAdmin) {
      const err = new Error('You do not have permission to view the System Role Hierarchy Ladder.');
      err.status = 403;
      throw err;
    }
  }

  // Query actual user counts grouped by role from the database
  const userCounts = await prisma.tenantUser.groupBy({
    by: ['role'],
    where: {
      tenantId,
      isDeleted: false,
      status: { not: 'EXITED' },
    },
    _count: {
      id: true,
    },
  });

  // Only include roles that ACTUALLY exist in the database with real users
  const activeRolesMap = new Map();
  userCounts.forEach((c) => {
    if (c._count.id > 0) {
      activeRolesMap.set(c.role, c._count.id);
    }
  });

  const activeRoleKeys = Array.from(activeRolesMap.keys());

  // Enrich only active roles from DB
  const enrichedRoles = activeRoleKeys.map((roleKey) => {
    const count = activeRolesMap.get(roleKey) || 0;
    const def = SYSTEM_ROLE_DEFINITIONS.find((d) => d.role === roleKey) || {
      role: roleKey,
      title: roleKey.replace(/_/g, ' '),
      subtitle: 'Company Role',
      tierName: 'Corporate Operations',
      tierLevel: 5,
      tierRank: 50,
      badgeColor: '#64748b',
      badgeBg: '#f8fafc',
      description: `Active role holding responsibility across company operations.`,
      responsibilities: [
        'Direct participant in company operational workflows and project milestones.',
      ],
    };

    // Filter creatable roles and visible dashboards to only roles that exist in this DB
    const creatableRoles = (ROLE_CREATION_MAP[roleKey] || []).filter((r) => activeRolesMap.has(r));
    const visibleDashboards = (DASHBOARD_VISIBILITY[roleKey] || ['EMPLOYEE']).filter((r) => activeRolesMap.has(r));

    return {
      ...def,
      userCount: count,
      isElevated: ELEVATED_ROLES.includes(roleKey),
      creatableRoles,
      visibleDashboards,
      capabilitiesSupported: roleKey === 'SUPER_ADMIN' || roleKey === 'ADMIN'
        ? Object.values(CAPABILITIES)
        : roleKey === 'HR'
          ? [CAPABILITIES.REGISTRY_SEARCH, CAPABILITIES.REGISTRY_WRITE, CAPABILITIES.REGISTRY_ANALYTICS, CAPABILITIES.REGISTRY_EXPORT]
          : roleKey === 'MANAGER'
            ? [CAPABILITIES.LEADERSHIP, CAPABILITIES.REGISTRY_SEARCH, CAPABILITIES.REGISTRY_WRITE]
            : [CAPABILITIES.REGISTRY_SEARCH],
    };
  });

  // Sort by seniority rank
  enrichedRoles.sort((a, b) => b.tierRank - a.tierRank);

  return {
    roles: enrichedRoles,
    activeRolesCount: enrichedRoles.length,
    activeRoleKeys: enrichedRoles.map((r) => r.role),
    creationMap: ROLE_CREATION_MAP,
    dashboardMatrix: DASHBOARD_VISIBILITY,
    elevatedRoles: ELEVATED_ROLES,
    superElevatedRoles: SUPER_ELEVATED_ROLES,
    hrRoles: HR_ROLES,
    managerRoles: MANAGER_OR_ELEVATED_ROLES,
  };
}

/**
 * Builds the complete organizational reporting hierarchy tree for a tenant.
 */
export async function getOrgHierarchyTree(tenantId, { department, search } = {}, caller = null) {
  const callerRole = String(caller?.role || 'EMPLOYEE').toUpperCase();
  const isSuperAdminOrAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(callerRole);
  let callerVis = null;

  if (caller) {
    callerVis = await getCallerHierarchyVisibility(tenantId, caller);
    if (!callerVis.canViewTree && !isSuperAdminOrAdmin) {
      const err = new Error('You do not have permission to view the Organizational Reporting Tree.');
      err.status = 403;
      throw err;
    }
  }

  const users = await prisma.tenantUser.findMany({
    where: {
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
      role: { notIn: ['PLATFORM_OWNER', 'PLATFORM_SALES'] },
    },
    select: {
      id: true,
      employeeId: true,
      name: true,
      email: true,
      role: true,
      designation: true,
      department: true,
      band: true,
      status: true,
      managerId: true,
      profilePhoto: true,
      joinDate: true,
      capabilities: {
        select: { capability: true },
      },
    },
    orderBy: [{ name: 'asc' }],
  });

  const userMap = new Map();
  const childrenMap = new Map();
  const departmentsSet = new Set();
  const roleCounts = {};

  users.forEach((u) => {
    if (u.department) departmentsSet.add(u.department);
    roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;

    const flattened = {
      ...u,
      capabilities: (u.capabilities || []).map((c) => c.capability),
      subordinates: [],
      directReportCount: 0,
      totalDownlineCount: 0,
      departmentsInDownline: new Set(u.department ? [u.department] : []),
      depth: 0,
    };
    userMap.set(u.id, flattened);
    childrenMap.set(u.id, []);
  });

  // Attach subordinates to managers
  const rootUsers = [];
  users.forEach((u) => {
    const node = userMap.get(u.id);
    if (u.managerId && userMap.has(u.managerId) && u.managerId !== u.id) {
      childrenMap.get(u.managerId).push(node);
    } else {
      rootUsers.push(node);
    }
  });

  // Recursively populate downline counts and tree branches
  function assembleNode(node, currentDepth = 0, visited = new Set()) {
    if (visited.has(node.id)) {
      return { totalCount: 0, depts: new Set() };
    }
    visited.add(node.id);
    node.depth = currentDepth;

    const rawChildren = childrenMap.get(node.id) || [];
    node.subordinates = rawChildren;
    node.directReportCount = rawChildren.length;

    let totalDownline = rawChildren.length;
    const combinedDepts = new Set(node.department ? [node.department] : []);

    for (const child of rawChildren) {
      const childRes = assembleNode(child, currentDepth + 1, new Set(visited));
      totalDownline += childRes.totalCount;
      childRes.depts.forEach((d) => combinedDepts.add(d));
    }

    node.totalDownlineCount = totalDownline;
    node.departmentsInDownline = Array.from(combinedDepts);
    return { totalCount: totalDownline, depts: combinedDepts };
  }

  // Sort root users by seniority rank
  const rankByRole = {
    SUPER_ADMIN: 100,
    CMD: 95,
    ADMIN: 90,
    HR: 80,
    FINANCE: 75,
    MANAGER: 60,
    EMPLOYEE: 40,
  };

  rootUsers.sort((a, b) => {
    const rankA = rankByRole[a.role] || 0;
    const rankB = rankByRole[b.role] || 0;
    if (rankB !== rankA) return rankB - rankA;
    return (a.name || '').localeCompare(b.name || '');
  });

  rootUsers.forEach((root) => {
    assembleNode(root, 0, new Set());
  });

  // Filter or highlight if search/department query provided
  let filteredTree = rootUsers;
  const sTerm = (search || '').trim().toLowerCase();
  const dTerm = (department || '').trim().toLowerCase();

  if (sTerm || (dTerm && dTerm !== 'all')) {
    function filterNode(node) {
      const matchesSearch = !sTerm ||
        (node.name && node.name.toLowerCase().includes(sTerm)) ||
        (node.email && node.email.toLowerCase().includes(sTerm)) ||
        (node.designation && node.designation.toLowerCase().includes(sTerm)) ||
        (node.role && node.role.toLowerCase().includes(sTerm));

      const matchesDept = !dTerm || dTerm === 'all' ||
        (node.department && node.department.toLowerCase() === dTerm);

      const matchingChildren = [];
      for (const child of node.subordinates) {
        const keptChild = filterNode(child);
        if (keptChild) matchingChildren.push(keptChild);
      }

      if ((matchesSearch && matchesDept) || matchingChildren.length > 0) {
        return {
          ...node,
          subordinates: matchingChildren,
          isSearchMatch: matchesSearch && matchesDept,
        };
      }
      return null;
    }

    filteredTree = rootUsers
      .map((r) => filterNode(r))
      .filter(Boolean);
  }

  // Enforce visibility controls on tree output
  const hideStats = Boolean(callerVis && !callerVis.canViewStats && !isSuperAdminOrAdmin);
  const hideDirectory = Boolean(callerVis && !callerVis.canViewDirectory && !isSuperAdminOrAdmin);

  if (hideDirectory) {
    function sanitizeNodes(nodes) {
      return nodes.map((n) => ({
        ...n,
        email: 'Protected',
        employeeId: 'Protected',
        subordinates: sanitizeNodes(n.subordinates || []),
      }));
    }
    filteredTree = sanitizeNodes(filteredTree);
  }

  // Summary statistics strictly from real DB
  const totalHeadcount = users.length;
  const managersCount = users.filter((u) => (childrenMap.get(u.id) || []).length > 0).length;
  const unassignedCount = rootUsers.filter((u) => !['SUPER_ADMIN', 'CMD'].includes(u.role)).length;
  const activeRolesCount = Object.keys(roleCounts).length;

  return {
    tree: filteredTree,
    stats: hideStats
      ? null
      : {
          totalHeadcount,
          managersCount,
          departmentsCount: departmentsSet.size,
          rootLeadersCount: rootUsers.length,
          unassignedReportsCount: unassignedCount,
          activeRolesCount,
          roleCounts,
          departments: Array.from(departmentsSet).sort(),
        },
  };
}

/**
 * Returns an employee's full management reporting chain (all managers up to root)
 * and direct reports downline.
 */
export async function getEmployeeHierarchyChain(tenantId, employeeId, caller = null) {
  const employee = await prisma.tenantUser.findFirst({
    where: { id: employeeId, tenantId, isDeleted: false },
    select: {
      id: true,
      employeeId: true,
      name: true,
      email: true,
      role: true,
      designation: true,
      department: true,
      band: true,
      status: true,
      managerId: true,
      profilePhoto: true,
      joinDate: true,
    },
  });

  if (!employee) {
    const err = new Error('Employee not found');
    err.status = 404;
    throw err;
  }

  // Enforce reporting team scope
  if (caller) {
    const callerRole = String(caller.role || '').toUpperCase();
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(callerRole);
    if (!isElevated) {
      if (callerRole === 'MANAGER') {
        if (caller.id !== employee.id) {
          // Verify if employee is in manager's downline or shares department
          let inManagerTeam = false;
          let testMgrId = employee.managerId;
          const seen = new Set();
          while (testMgrId && !seen.has(testMgrId)) {
            if (testMgrId === caller.id) {
              inManagerTeam = true;
              break;
            }
            seen.add(testMgrId);
            const parent = await prisma.tenantUser.findUnique({
              where: { id: testMgrId },
              select: { managerId: true },
            });
            testMgrId = parent?.managerId;
          }
          if (!inManagerTeam && employee.department !== caller.department) {
            const err = new Error('Managers are restricted to viewing members of their own reporting team.');
            err.status = 403;
            throw err;
          }
        }
      } else if (callerRole === 'EMPLOYEE') {
        if (caller.id !== employee.id) {
          const callerVis = await getCallerHierarchyVisibility(tenantId, caller);
          if (!callerVis.canViewDirectory && !callerVis.canUseActions) {
            const err = new Error('Access restricted: You may only view your own management reporting chain.');
            err.status = 403;
            throw err;
          }
        }
      }
    }
  }

  // Trace manager chain upward
  const chain = [];
  const visited = new Set([employee.id]);
  let currentManagerId = employee.managerId;

  while (currentManagerId && !visited.has(currentManagerId)) {
    visited.add(currentManagerId);
    const mgr = await prisma.tenantUser.findFirst({
      where: { id: currentManagerId, tenantId, isDeleted: false },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        role: true,
        designation: true,
        department: true,
        band: true,
        managerId: true,
        profilePhoto: true,
      },
    });

    if (!mgr) break;
    chain.unshift(mgr);
    currentManagerId = mgr.managerId;
  }

  // Fetch direct reports
  const directReports = await prisma.tenantUser.findMany({
    where: {
      managerId: employee.id,
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
    },
    select: {
      id: true,
      employeeId: true,
      name: true,
      email: true,
      role: true,
      designation: true,
      department: true,
      band: true,
      profilePhoto: true,
      status: true,
    },
    orderBy: [{ name: 'asc' }],
  });

  return {
    employee,
    managementChain: chain,
    directReports,
  };
}

/**
 * Assigns or updates an employee's reporting manager.
 * Strict cycle detection prevents an employee from reporting to themselves
 * or to any of their own subordinates.
 */
export async function assignEmployeeManager(tenantId, employeeId, managerId) {
  if (managerId && employeeId === managerId) {
    const err = new Error('An employee cannot be their own reporting manager.');
    err.status = 400;
    throw err;
  }

  const employee = await prisma.tenantUser.findFirst({
    where: { id: employeeId, tenantId, isDeleted: false },
    select: { id: true, name: true, managerId: true, role: true, department: true },
  });

  if (!employee) {
    const err = new Error('Employee not found.');
    err.status = 404;
    throw err;
  }

  // If removing manager
  if (!managerId) {
    const updated = await prisma.tenantUser.update({
      where: { id: employeeId },
      data: { managerId: null },
      select: { id: true, name: true, managerId: true, role: true },
    });
    return {
      success: true,
      message: `${employee.name} is now set as a top-level reporting node (no manager assigned).`,
      employee: updated,
    };
  }

  // Validate proposed manager
  const targetManager = await prisma.tenantUser.findFirst({
    where: {
      id: managerId,
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
    },
    select: { id: true, name: true, role: true, managerId: true },
  });

  if (!targetManager) {
    const err = new Error('Specified reporting manager does not exist or is inactive.');
    err.status = 404;
    throw err;
  }

  // Cycle detection: ensure employeeId is NOT an ancestor of managerId
  let currentCheck = targetManager.managerId;
  const visited = new Set([targetManager.id]);

  while (currentCheck) {
    if (currentCheck === employeeId) {
      const err = new Error(
        `Circular hierarchy detected: ${targetManager.name} is already a subordinate in ${employee.name}'s downline. Assigning them as manager would create an infinite loop.`
      );
      err.status = 400;
      throw err;
    }
    if (visited.has(currentCheck)) break;
    visited.add(currentCheck);

    const ancestor = await prisma.tenantUser.findFirst({
      where: { id: currentCheck, tenantId, isDeleted: false },
      select: { id: true, managerId: true },
    });
    currentCheck = ancestor?.managerId || null;
  }

  const updated = await prisma.tenantUser.update({
    where: { id: employeeId },
    data: { managerId },
    select: {
      id: true,
      name: true,
      role: true,
      managerId: true,
      manager: {
        select: { id: true, name: true, designation: true, role: true },
      },
    },
  });

  return {
    success: true,
    message: `${employee.name} now reports to ${targetManager.name}.`,
    employee: updated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLE HIERARCHY VISIBILITY, PERMISSIONS & DASHBOARD CONFIGURATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_HIERARCHY_VISIBILITY = {
  SUPER_ADMIN: {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: true,
    canViewStats: true,
    canViewDirectory: true,
    canViewDeptFilters: true,
    canUseActions: true,
  },
  CMD: {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: true,
    canViewStats: true,
    canViewDirectory: true,
    canViewDeptFilters: true,
    canUseActions: true,
  },
  ADMIN: {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: true,
    canViewStats: true,
    canViewDirectory: true,
    canViewDeptFilters: true,
    canUseActions: true,
  },
  HR: {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: true,
    canViewStats: true,
    canViewDirectory: true,
    canViewDeptFilters: true,
    canUseActions: true,
  },
  FINANCE: {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: false,
    canViewStats: true,
    canViewDirectory: false,
    canViewDeptFilters: true,
    canUseActions: false,
  },
  MANAGER: {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: false,
    canViewStats: true,
    canViewDirectory: true,
    canViewDeptFilters: true,
    canUseActions: true,
  },
  EMPLOYEE: {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: false,
    canViewStats: false,
    canViewDirectory: false,
    canViewDeptFilters: false,
    canUseActions: false,
  },
};

export const SUPPORTED_DASHBOARD_WIDGETS = [
  {
    id: 'metrics_overview',
    name: 'Metrics Overview',
    description: 'Primary KPI statistic cards (Goals, Tasks, Leave Balances, Performance)',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE'],
  },
  {
    id: 'hub_highlights',
    name: 'Hub Highlights & Events',
    description: 'Upcoming corporate events, team birthdays, and work anniversaries',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  },
  {
    id: 'pending_approvals',
    name: 'Pending Approvals & Signoffs',
    description: 'Subordinate leave requests, WFH submissions, and milestone reviews',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER'],
  },
  {
    id: 'department_performance',
    name: 'Department Performance',
    description: 'Goal execution and completion progress by department',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'MANAGER'],
  },
  {
    id: 'quick_actions',
    name: 'Quick Action Shortcuts',
    description: 'Action triggers (Apply Leave, Create Task/Goal, Submit Feedback)',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE'],
  },
  {
    id: 'team_attendance',
    name: 'Team Attendance & Availability',
    description: 'Live availability radar and on-leave team member list',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'MANAGER'],
  },
  {
    id: 'recent_activity',
    name: 'Recent Activity Timeline',
    description: 'Task updates, milestone changes, and audit ledger entries',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR'],
  },
  {
    id: 'license_overview',
    name: 'Licensing & Quota Monitor',
    description: 'Subscription seats, employee quota utilization, and license requests',
    allowedRoles: ['SUPER_ADMIN', 'CMD', 'ADMIN', 'FINANCE'],
  },
];

export const DEFAULT_DASHBOARD_CONFIG = {
  SUPER_ADMIN: {
    widgets: ['metrics_overview', 'hub_highlights', 'pending_approvals', 'department_performance', 'quick_actions', 'team_attendance', 'recent_activity', 'license_overview'],
  },
  CMD: {
    widgets: ['metrics_overview', 'hub_highlights', 'pending_approvals', 'department_performance', 'quick_actions', 'team_attendance', 'recent_activity', 'license_overview'],
  },
  ADMIN: {
    widgets: ['metrics_overview', 'hub_highlights', 'pending_approvals', 'department_performance', 'quick_actions', 'team_attendance', 'recent_activity', 'license_overview'],
  },
  HR: {
    widgets: ['metrics_overview', 'hub_highlights', 'pending_approvals', 'department_performance', 'quick_actions', 'team_attendance', 'recent_activity'],
  },
  FINANCE: {
    widgets: ['metrics_overview', 'pending_approvals', 'license_overview', 'quick_actions'],
  },
  MANAGER: {
    widgets: ['metrics_overview', 'hub_highlights', 'pending_approvals', 'department_performance', 'quick_actions', 'team_attendance'],
  },
  EMPLOYEE: {
    widgets: ['metrics_overview', 'hub_highlights', 'quick_actions'],
  },
};

export const BASE_PERMISSION_MATRIX = [
  {
    category: 'Governance & Administration',
    features: [
      {
        feature: 'Manage Company Settings & Branding',
        roles: {
          SUPER_ADMIN: { state: 'PROTECTED', label: 'Full Control', isProtected: true },
          CMD: { state: 'INHERITED', label: 'View Only', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Full Control', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Full Control', isProtected: false },
          FINANCE: { state: 'DENIED', label: 'No Access', isProtected: false },
          MANAGER: { state: 'DENIED', label: 'No Access', isProtected: false },
          EMPLOYEE: { state: 'PROTECTED', label: 'No Access', isProtected: true },
        },
      },
      {
        feature: 'Manage Departments & Master Data',
        roles: {
          SUPER_ADMIN: { state: 'PROTECTED', label: 'Create, Edit, Archive', isProtected: true },
          CMD: { state: 'INHERITED', label: 'View Only', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Create, Edit, Archive', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Create & Edit', isProtected: false },
          FINANCE: { state: 'INHERITED', label: 'View Only', isProtected: false },
          MANAGER: { state: 'INHERITED', label: 'View Only', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'View Only', isProtected: false },
        },
      },
      {
        feature: 'Document Templates Builder',
        roles: {
          SUPER_ADMIN: { state: 'PROTECTED', label: 'Full Authoring', isProtected: true },
          CMD: { state: 'INHERITED', label: 'View Only', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Full Authoring', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Full Authoring', isProtected: false },
          FINANCE: { state: 'DENIED', label: 'No Access', isProtected: false },
          MANAGER: { state: 'DENIED', label: 'No Access', isProtected: false },
          EMPLOYEE: { state: 'DENIED', label: 'No Access', isProtected: false },
        },
      },
      {
        feature: 'Sub-Logins & Capability Delegation',
        roles: {
          SUPER_ADMIN: { state: 'PROTECTED', label: 'All Grants', isProtected: true },
          CMD: { state: 'INHERITED', label: 'View Only', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'All Grants', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Registry Credentials', isProtected: false },
          FINANCE: { state: 'DENIED', label: 'No Access', isProtected: false },
          MANAGER: { state: 'DENIED', label: 'No Access', isProtected: false },
          EMPLOYEE: { state: 'DENIED', label: 'No Access', isProtected: false },
        },
      },
    ],
  },
  {
    category: 'User & Employee Lifecycle',
    features: [
      {
        feature: 'User Provisioning Rights',
        roles: {
          SUPER_ADMIN: { state: 'PROTECTED', label: 'All Configured Roles', isProtected: true },
          CMD: { state: 'DENIED', label: 'None', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'HR, Manager, Employee', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Manager, Employee', isProtected: false },
          FINANCE: { state: 'DENIED', label: 'None', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'Employee', isProtected: false },
          EMPLOYEE: { state: 'PROTECTED', label: 'None', isProtected: true },
        },
      },
      {
        feature: 'Employee Profile Verification',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Approve & Edit', isProtected: false },
          CMD: { state: 'INHERITED', label: 'View', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Approve & Edit', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Approve & Edit', isProtected: false },
          FINANCE: { state: 'INHERITED', label: 'View', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'View Direct Reports', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'Self Profile', isProtected: false },
        },
      },
      {
        feature: 'Exit Process Initiation & Clearance',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Full Sign-off', isProtected: false },
          CMD: { state: 'INHERITED', label: 'View Only', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Full Sign-off', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Full Sign-off & Docs', isProtected: false },
          FINANCE: { state: 'ALLOWED', label: 'Finance Sign-off', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'Operational Sign-off', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'Handover & Self', isProtected: false },
        },
      },
      {
        feature: 'Employee Reporting Line Assignment',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Any Employee', isProtected: false },
          CMD: { state: 'INHERITED', label: 'View Only', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Any Employee', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Any Employee', isProtected: false },
          FINANCE: { state: 'DENIED', label: 'No Access', isProtected: false },
          MANAGER: { state: 'DENIED', label: 'No Access', isProtected: false },
          EMPLOYEE: { state: 'PROTECTED', label: 'No Access', isProtected: true },
        },
      },
    ],
  },
  {
    category: 'Performance, Goals & Tasks',
    features: [
      {
        feature: 'Goal Creation & Allocation',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Company-Wide', isProtected: false },
          CMD: { state: 'ALLOWED', label: 'Company-Wide', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Company-Wide', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Company-Wide (Non-Super)', isProtected: false },
          FINANCE: { state: 'INHERITED', label: 'Self Only', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'Team Downline', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'Self Only', isProtected: false },
        },
      },
      {
        feature: 'Super-Elevated Goal Allocation',
        roles: {
          SUPER_ADMIN: { state: 'PROTECTED', label: 'Permitted', isProtected: true },
          CMD: { state: 'PROTECTED', label: 'Permitted', isProtected: true },
          ADMIN: { state: 'PROTECTED', label: 'Permitted', isProtected: true },
          HR: { state: 'PROTECTED', label: 'Forbidden (Protected)', isProtected: true },
          FINANCE: { state: 'PROTECTED', label: 'Forbidden', isProtected: true },
          MANAGER: { state: 'PROTECTED', label: 'Forbidden', isProtected: true },
          EMPLOYEE: { state: 'PROTECTED', label: 'Forbidden', isProtected: true },
        },
      },
      {
        feature: 'Task Board Visibility Scope',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'All Tasks (Org)', isProtected: false },
          CMD: { state: 'ALLOWED', label: 'All Tasks (Org)', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'All Tasks (Org)', isProtected: false },
          HR: { state: 'ALLOWED', label: 'All Tasks (Org)', isProtected: false },
          FINANCE: { state: 'INHERITED', label: 'Self Only', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'Downline Tree + Dept', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'Self Only', isProtected: false },
        },
      },
      {
        feature: 'Annual Appraisal & 360 Reviews',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Final Sign-off', isProtected: false },
          CMD: { state: 'ALLOWED', label: 'Executive Review', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Admin Sign-off', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Cycle Management', isProtected: false },
          FINANCE: { state: 'INHERITED', label: 'Self & Peers', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'Direct Reports Review', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'Self & Peer Nomination', isProtected: false },
        },
      },
    ],
  },
  {
    category: 'Time & Leave Management',
    features: [
      {
        feature: 'Leave Application & WFH Request',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Apply & Auto-Approve', isProtected: false },
          CMD: { state: 'ALLOWED', label: 'Apply', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Apply', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Apply', isProtected: false },
          FINANCE: { state: 'ALLOWED', label: 'Apply', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'Apply', isProtected: false },
          EMPLOYEE: { state: 'ALLOWED', label: 'Apply', isProtected: false },
        },
      },
      {
        feature: 'Leave Approval Workflow',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'L1 & L2 Override', isProtected: false },
          CMD: { state: 'ALLOWED', label: 'Direct Reports', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'L1 & L2 Override', isProtected: false },
          HR: { state: 'ALLOWED', label: 'L2 Final Sign-off', isProtected: false },
          FINANCE: { state: 'DENIED', label: 'No Approval Access', isProtected: false },
          MANAGER: { state: 'ALLOWED', label: 'L1 Line Manager Approval', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'Applicant Only', isProtected: false },
        },
      },
      {
        feature: 'Leave Policy & Balance Adjustment',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Full Control', isProtected: false },
          CMD: { state: 'INHERITED', label: 'View', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Full Control', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Full Control', isProtected: false },
          FINANCE: { state: 'INHERITED', label: 'View', isProtected: false },
          MANAGER: { state: 'INHERITED', label: 'View Team Balances', isProtected: false },
          EMPLOYEE: { state: 'INHERITED', label: 'View Self Balances', isProtected: false },
        },
      },
    ],
  },
  {
    category: 'Commercial & Financial Operations',
    features: [
      {
        feature: 'License Quota Purchase & Payment',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Request & Pay', isProtected: false },
          CMD: { state: 'ALLOWED', label: 'Request & Pay', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Request & Pay', isProtected: false },
          HR: { state: 'ALLOWED', label: 'Request Only', isProtected: false },
          FINANCE: { state: 'ALLOWED', label: 'Approve & Pay', isProtected: false },
          MANAGER: { state: 'DENIED', label: 'No Access', isProtected: false },
          EMPLOYEE: { state: 'PROTECTED', label: 'No Access', isProtected: true },
        },
      },
      {
        feature: 'Invoices, Receipts & Subscriptions',
        roles: {
          SUPER_ADMIN: { state: 'ALLOWED', label: 'Full Access', isProtected: false },
          CMD: { state: 'ALLOWED', label: 'Full Access', isProtected: false },
          ADMIN: { state: 'ALLOWED', label: 'Full Access', isProtected: false },
          HR: { state: 'INHERITED', label: 'View Invoices', isProtected: false },
          FINANCE: { state: 'ALLOWED', label: 'Manage & Reconcile', isProtected: false },
          MANAGER: { state: 'DENIED', label: 'No Access', isProtected: false },
          EMPLOYEE: { state: 'PROTECTED', label: 'No Access', isProtected: true },
        },
      },
    ],
  },
];

/**
 * Lazy helper: ensures a TenantSettings record exists for the tenant.
 */
export async function getTenantSettingsLazy(tenantId) {
  let settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
  });
  if (!settings) {
    settings = await prisma.tenantSettings.create({
      data: { tenantId },
    });
  }
  return settings;
}

/**
 * Helper: resolves effective hierarchy visibility for the caller's role.
 */
export async function getCallerHierarchyVisibility(tenantId, user) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { hierarchyVisibility: true },
  });
  const role = String(user?.role || 'EMPLOYEE').toUpperCase();
  const visibilityConfig = settings?.hierarchyVisibility || DEFAULT_HIERARCHY_VISIBILITY;
  return visibilityConfig[role] || DEFAULT_HIERARCHY_VISIBILITY[role] || DEFAULT_HIERARCHY_VISIBILITY.EMPLOYEE;
}

/**
 * Returns feature permission matrix dynamically tailored to active DB roles,
 * augmented with real database-backed custom overrides and authority flags.
 */
export async function getRolePermissionMatrix(tenantId, caller = null) {
  // Query active roles strictly from the database
  const userCounts = await prisma.tenantUser.groupBy({
    by: ['role'],
    where: {
      tenantId,
      isDeleted: false,
      status: { not: 'EXITED' },
    },
    _count: {
      id: true,
    },
  });

  const activeRolesMap = new Set(userCounts.filter((c) => c._count.id > 0).map((c) => c.role));
  const rankOrder = { SUPER_ADMIN: 100, CMD: 95, ADMIN: 90, HR: 80, FINANCE: 75, MANAGER: 60, EMPLOYEE: 40 };
  const activeRoles = Array.from(activeRolesMap).sort((a, b) => (rankOrder[b] || 0) - (rankOrder[a] || 0));

  // Caller visibility enforcement
  const callerRole = String(caller?.role || 'EMPLOYEE').toUpperCase();
  const isSuperAdminOrAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(callerRole);

  if (caller) {
    const callerVis = await getCallerHierarchyVisibility(tenantId, caller);
    if (!callerVis.canViewMatrix && !isSuperAdminOrAdmin) {
      const err = new Error('You do not have permission to view the Permission & Authority Matrix.');
      err.status = 403;
      throw err;
    }
  }

  // Load tenant-specific custom permission overrides from database
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { rolePermissions: true },
  });
  const customOverrides = (settings?.rolePermissions || {});

  let totalOverrides = 0;

  // Build matrix with backward-compatible string fields AND rich meta objects
  const matrix = BASE_PERMISSION_MATRIX.map((section) => ({
    category: section.category,
    features: section.features.map((feat) => {
      const row = { feature: feat.feature };
      activeRoles.forEach((r) => {
        const baseDef = (feat.roles && feat.roles[r]) || {
          state: 'INHERITED',
          label: 'Standard Access',
          isProtected: false,
        };

        const override = customOverrides[r]?.[feat.feature];
        let state = override?.state || baseDef.state;
        let label = override?.label || baseDef.label;
        const isProtected = Boolean(baseDef.isProtected);

        // A protected core boundary cannot be overridden into an unsafe state
        if (isProtected) {
          state = baseDef.state;
          label = baseDef.label;
        } else if (override) {
          totalOverrides++;
        }

        row[r] = label;
        row[`${r}_meta`] = {
          state,
          label,
          isProtected,
          isOverridden: !isProtected && !!override,
        };
      });
      return row;
    }),
  }));

  return {
    matrix,
    activeRoles,
    canEdit: isSuperAdminOrAdmin,
    effectiveOverridesCount: totalOverrides,
  };
}

/**
 * Updates role-wise permission matrix configurations in the database.
 * Strictly validated against security boundaries and logged to audit trail.
 */
export async function updateRolePermissions(tenantId, actor, { role, permissions }) {
  const actorRole = String(actor?.role || '').toUpperCase();
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
    const err = new Error('Only a Super Administrator or Company Administrator can modify role permissions.');
    err.status = 403;
    throw err;
  }

  // An ADMIN cannot alter SUPER_ADMIN permissions
  if (actorRole === 'ADMIN' && role === 'SUPER_ADMIN') {
    const err = new Error('Company Administrators are not permitted to modify Super Administrator privileges.');
    err.status = 403;
    throw err;
  }

  // Load current settings
  const settings = await getTenantSettingsLazy(tenantId);
  const existingOverrides = { ...(settings.rolePermissions || {}) };
  const roleOverrides = { ...(existingOverrides[role] || {}) };
  const beforeSnapshot = JSON.stringify(roleOverrides);

  // Validate every requested permission assignment
  const validationErrors = [];
  permissions.forEach((p) => {
    // Find base definition for this feature
    let foundFeature = null;
    for (const sec of BASE_PERMISSION_MATRIX) {
      const match = sec.features.find((f) => f.feature === p.feature);
      if (match) {
        foundFeature = match;
        break;
      }
    }

    if (!foundFeature) {
      validationErrors.push(`Unknown feature: "${p.feature}"`);
      return;
    }

    const baseDef = foundFeature.roles?.[role];
    if (baseDef?.isProtected && p.state !== baseDef.state) {
      validationErrors.push(
        `Feature "${p.feature}" is protected by enterprise core policy for role ${role} and cannot be modified.`
      );
      return;
    }

    // Security guard: EMPLOYEE or MANAGER cannot be granted executive tenant control
    if (
      ['EMPLOYEE', 'MANAGER'].includes(role) &&
      foundFeature.feature === 'Manage Company Settings & Branding' &&
      p.state === 'ALLOWED'
    ) {
      validationErrors.push(`Privilege escalation blocked: Cannot grant "${p.feature}" to ${role}.`);
      return;
    }

    // Set or update override
    if (p.state === 'INHERITED') {
      delete roleOverrides[p.feature];
    } else {
      roleOverrides[p.feature] = {
        state: p.state,
        label: p.label || (p.state === 'ALLOWED' ? 'Custom Allowed' : 'No Access'),
      };
    }
  });

  if (validationErrors.length > 0) {
    const err = new Error(validationErrors.join('; '));
    err.status = 400;
    throw err;
  }

  existingOverrides[role] = roleOverrides;

  // Persist to tenant_settings
  await prisma.tenantSettings.update({
    where: { tenantId },
    data: { rolePermissions: existingOverrides },
  });

  // Record immutable audit log
  await prisma.permissionAuditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorRole,
      action: 'PERMISSION_UPDATE',
      targetRole: role,
      details: `Updated ${permissions.length} permission(s) for role ${role}.`,
      changes: {
        before: JSON.parse(beforeSnapshot),
        after: roleOverrides,
      },
    },
  });

  return getRolePermissionMatrix(tenantId, actor);
}

/**
 * Resets permission overrides to standard defaults.
 */
export async function resetRolePermissions(tenantId, actor, { role = 'ALL' }) {
  const actorRole = String(actor?.role || '').toUpperCase();
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
    const err = new Error('Only administrators can reset role permissions.');
    err.status = 403;
    throw err;
  }

  const settings = await getTenantSettingsLazy(tenantId);
  const existing = { ...(settings.rolePermissions || {}) };

  if (role === 'ALL') {
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { rolePermissions: null },
    });
  } else {
    delete existing[role];
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { rolePermissions: Object.keys(existing).length > 0 ? existing : null },
    });
  }

  await prisma.permissionAuditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorRole,
      action: 'RESET_DEFAULTS',
      targetRole: role,
      details: `Reset permissions to enterprise defaults for ${role === 'ALL' ? 'all roles' : `role ${role}`}.`,
    },
  });

  return getRolePermissionMatrix(tenantId, actor);
}

/**
 * Returns dynamic role hierarchy visibility controls for the tenant.
 */
export async function getHierarchyVisibility(tenantId, caller = null) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { hierarchyVisibility: true },
  });

  const effectiveConfig = settings?.hierarchyVisibility || DEFAULT_HIERARCHY_VISIBILITY;
  const callerRole = String(caller?.role || 'EMPLOYEE').toUpperCase();
  const isSuperAdminOrAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(callerRole);

  return {
    visibility: effectiveConfig,
    myVisibility: effectiveConfig[callerRole] || DEFAULT_HIERARCHY_VISIBILITY[callerRole] || DEFAULT_HIERARCHY_VISIBILITY.EMPLOYEE,
    canConfigure: isSuperAdminOrAdmin,
  };
}

/**
 * Updates dynamic role hierarchy visibility controls for the tenant.
 */
export async function updateHierarchyVisibility(tenantId, actor, { visibility }) {
  const actorRole = String(actor?.role || '').toUpperCase();
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
    const err = new Error('Only administrators can configure role hierarchy visibility.');
    err.status = 403;
    throw err;
  }

  // Ensure SUPER_ADMIN cannot be locked out of essential views
  const sanitized = { ...visibility };
  sanitized.SUPER_ADMIN = {
    canViewTree: true,
    canViewLadder: true,
    canViewMatrix: true,
    canViewStats: true,
    canViewDirectory: true,
    canViewDeptFilters: true,
    canUseActions: true,
  };

  const settings = await getTenantSettingsLazy(tenantId);
  const beforeSnapshot = JSON.stringify(settings.hierarchyVisibility || DEFAULT_HIERARCHY_VISIBILITY);

  await prisma.tenantSettings.update({
    where: { tenantId },
    data: { hierarchyVisibility: sanitized },
  });

  await prisma.permissionAuditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorRole,
      action: 'VISIBILITY_UPDATE',
      targetRole: 'ALL',
      details: `Updated role hierarchy visibility settings across roles.`,
      changes: {
        before: JSON.parse(beforeSnapshot),
        after: sanitized,
      },
    },
  });

  return getHierarchyVisibility(tenantId, actor);
}

/**
 * Returns role-based dashboard widget configuration.
 */
export async function getRoleDashboardConfig(tenantId, caller = null) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { dashboardConfig: true },
  });

  const effectiveConfig = settings?.dashboardConfig || DEFAULT_DASHBOARD_CONFIG;
  const callerRole = String(caller?.role || 'EMPLOYEE').toUpperCase();
  const isSuperAdminOrAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(callerRole);

  return {
    supportedWidgets: SUPPORTED_DASHBOARD_WIDGETS,
    config: effectiveConfig,
    myWidgets: (effectiveConfig[callerRole] || DEFAULT_DASHBOARD_CONFIG[callerRole] || DEFAULT_DASHBOARD_CONFIG.EMPLOYEE).widgets,
    canConfigure: isSuperAdminOrAdmin,
  };
}

/**
 * Updates role-based dashboard widget configuration.
 */
export async function updateRoleDashboardConfig(tenantId, actor, { role, widgets, allowedNavModules }) {
  const actorRole = String(actor?.role || '').toUpperCase();
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
    const err = new Error('Only administrators can configure dashboard widgets.');
    err.status = 403;
    throw err;
  }

  const settings = await getTenantSettingsLazy(tenantId);
  const currentConfig = { ...(settings.dashboardConfig || DEFAULT_DASHBOARD_CONFIG) };
  const beforeSnapshot = JSON.stringify(currentConfig[role] || {});

  // Validate widgets against supported set
  const supportedIds = new Set(SUPPORTED_DASHBOARD_WIDGETS.map((w) => w.id));
  const validWidgets = widgets.filter((w) => supportedIds.has(w));

  currentConfig[role] = {
    widgets: validWidgets,
    ...(allowedNavModules ? { allowedNavModules } : {}),
  };

  await prisma.tenantSettings.update({
    where: { tenantId },
    data: { dashboardConfig: currentConfig },
  });

  await prisma.permissionAuditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorRole,
      action: 'DASHBOARD_CONFIG_UPDATE',
      targetRole: role,
      details: `Configured ${validWidgets.length} dashboard widget(s) for role ${role}.`,
      changes: {
        before: JSON.parse(beforeSnapshot),
        after: currentConfig[role],
      },
    },
  });

  return getRoleDashboardConfig(tenantId, actor);
}

/**
 * Resets dashboard configurations to standard enterprise defaults.
 */
export async function resetRoleDashboardConfig(tenantId, actor, { role = 'ALL' }) {
  const actorRole = String(actor?.role || '').toUpperCase();
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
    const err = new Error('Only administrators can reset dashboard configurations.');
    err.status = 403;
    throw err;
  }

  const settings = await getTenantSettingsLazy(tenantId);
  const currentConfig = { ...(settings.dashboardConfig || DEFAULT_DASHBOARD_CONFIG) };

  if (role === 'ALL') {
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { dashboardConfig: null },
    });
  } else {
    currentConfig[role] = DEFAULT_DASHBOARD_CONFIG[role] || { widgets: ['metrics_overview'] };
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { dashboardConfig: currentConfig },
    });
  }

  await prisma.permissionAuditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorRole,
      action: 'RESET_DEFAULTS',
      targetRole: role,
      details: `Reset dashboard widget configuration to defaults for ${role === 'ALL' ? 'all roles' : `role ${role}`}.`,
    },
  });

  return getRoleDashboardConfig(tenantId, actor);
}

/**
 * Returns paginated audit trail logs for permissions, visibility, and dashboard configs.
 */
export async function getPermissionAuditLogs(tenantId, { page = 1, limit = 20, action, targetRole } = {}) {
  const where = {
    tenantId,
    ...(action ? { action } : {}),
    ...(targetRole ? { targetRole } : {}),
  };

  const skip = (page - 1) * limit;
  const [total, logs] = await Promise.all([
    prisma.permissionAuditLog.count({ where }),
    prisma.permissionAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        actor: {
          select: { id: true, name: true, email: true, role: true, designation: true },
        },
      },
    }),
  ]);

  return {
    items: logs.map((log) => ({
      id: log.id,
      action: log.action,
      targetRole: log.targetRole,
      details: log.details,
      changes: log.changes,
      createdAt: log.createdAt,
      actor: log.actor ? {
        id: log.actor.id,
        name: log.actor.name,
        email: log.actor.email,
        role: log.actor.role,
        designation: log.actor.designation,
      } : {
        id: log.actorId,
        name: 'System User',
        email: 'system',
        role: log.actorRole,
      },
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
