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
export async function getSystemRolesHierarchy(tenantId) {
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
export async function getOrgHierarchyTree(tenantId, { department, search } = {}) {
  const users = await prisma.tenantUser.findMany({
    where: {
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
      role: { not: 'PLATFORM_OWNER' },
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

  // Summary statistics strictly from real DB
  const totalHeadcount = users.length;
  const managersCount = users.filter((u) => (childrenMap.get(u.id) || []).length > 0).length;
  const unassignedCount = rootUsers.filter((u) => !['SUPER_ADMIN', 'CMD'].includes(u.role)).length;
  const activeRolesCount = Object.keys(roleCounts).length;

  return {
    tree: filteredTree,
    stats: {
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
export async function getEmployeeHierarchyChain(tenantId, employeeId) {
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

/**
 * Returns feature permission matrix dynamically tailored to ONLY the roles
 * actually present in this tenant's real database.
 */
export async function getRolePermissionMatrix(tenantId) {
  // Query active roles from the database
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

  const baseMatrix = [
    {
      category: 'Governance & Administration',
      features: [
        {
          feature: 'Manage Company Settings & Branding',
          SUPER_ADMIN: 'Full Control',
          CMD: 'View Only',
          ADMIN: 'Full Control',
          HR: 'Full Control',
          FINANCE: 'No Access',
          MANAGER: 'No Access',
          EMPLOYEE: 'No Access',
        },
        {
          feature: 'Manage Departments & Master Data',
          SUPER_ADMIN: 'Create, Edit, Archive',
          CMD: 'View Only',
          ADMIN: 'Create, Edit, Archive',
          HR: 'Create & Edit',
          FINANCE: 'View Only',
          MANAGER: 'View Only',
          EMPLOYEE: 'View Only',
        },
        {
          feature: 'Document Templates Builder',
          SUPER_ADMIN: 'Full Authoring',
          CMD: 'View Only',
          ADMIN: 'Full Authoring',
          HR: 'Full Authoring',
          FINANCE: 'No Access',
          MANAGER: 'No Access',
          EMPLOYEE: 'No Access',
        },
        {
          feature: 'Sub-Logins & Capability Delegation',
          SUPER_ADMIN: 'All Grants',
          CMD: 'View Only',
          ADMIN: 'All Grants',
          HR: 'Registry Credentials',
          FINANCE: 'No Access',
          MANAGER: 'No Access',
          EMPLOYEE: 'No Access',
        },
      ],
    },
    {
      category: 'User & Employee Lifecycle',
      features: [
        {
          feature: 'User Provisioning Rights',
          SUPER_ADMIN: 'All Configured Roles',
          CMD: 'None',
          ADMIN: 'HR, Manager, Employee',
          HR: 'Manager, Employee',
          FINANCE: 'None',
          MANAGER: 'Employee',
          EMPLOYEE: 'None',
        },
        {
          feature: 'Employee Profile Verification',
          SUPER_ADMIN: 'Approve & Edit',
          CMD: 'View',
          ADMIN: 'Approve & Edit',
          HR: 'Approve & Edit',
          FINANCE: 'View',
          MANAGER: 'View Direct Reports',
          EMPLOYEE: 'Self Profile',
        },
        {
          feature: 'Exit Process Initiation & Clearance',
          SUPER_ADMIN: 'Full Sign-off',
          CMD: 'View Only',
          ADMIN: 'Full Sign-off',
          HR: 'Full Sign-off & Docs',
          FINANCE: 'Finance Sign-off',
          MANAGER: 'Operational Sign-off',
          EMPLOYEE: 'Handover & Self',
        },
        {
          feature: 'Employee Reporting Line Assignment',
          SUPER_ADMIN: 'Any Employee',
          CMD: 'View Only',
          ADMIN: 'Any Employee',
          HR: 'Any Employee',
          FINANCE: 'No Access',
          MANAGER: 'No Access',
          EMPLOYEE: 'No Access',
        },
      ],
    },
    {
      category: 'Performance, Goals & Tasks',
      features: [
        {
          feature: 'Goal Creation & Allocation',
          SUPER_ADMIN: 'Company-Wide',
          CMD: 'Company-Wide',
          ADMIN: 'Company-Wide',
          HR: 'Company-Wide (Non-Super)',
          FINANCE: 'Self Only',
          MANAGER: 'Team Downline',
          EMPLOYEE: 'Self Only',
        },
        {
          feature: 'Super-Elevated Goal Allocation',
          SUPER_ADMIN: 'Permitted',
          CMD: 'Permitted',
          ADMIN: 'Permitted',
          HR: 'Forbidden (Protected)',
          FINANCE: 'Forbidden',
          MANAGER: 'Forbidden',
          EMPLOYEE: 'Forbidden',
        },
        {
          feature: 'Task Board Visibility Scope',
          SUPER_ADMIN: 'All Tasks (Org)',
          CMD: 'All Tasks (Org)',
          ADMIN: 'All Tasks (Org)',
          HR: 'All Tasks (Org)',
          FINANCE: 'Self Only',
          MANAGER: 'Downline Tree + Dept',
          EMPLOYEE: 'Self Only',
        },
        {
          feature: 'Annual Appraisal & 360 Reviews',
          SUPER_ADMIN: 'Final Sign-off',
          CMD: 'Executive Review',
          ADMIN: 'Admin Sign-off',
          HR: 'Cycle Management',
          FINANCE: 'Self & Peers',
          MANAGER: 'Direct Reports Review',
          EMPLOYEE: 'Self & Peer Nomination',
        },
      ],
    },
    {
      category: 'Time & Leave Management',
      features: [
        {
          feature: 'Leave Application & WFH Request',
          SUPER_ADMIN: 'Apply & Auto-Approve',
          CMD: 'Apply',
          ADMIN: 'Apply',
          HR: 'Apply',
          FINANCE: 'Apply',
          MANAGER: 'Apply',
          EMPLOYEE: 'Apply',
        },
        {
          feature: 'Leave Approval Workflow',
          SUPER_ADMIN: 'L1 & L2 Override',
          CMD: 'Direct Reports',
          ADMIN: 'L1 & L2 Override',
          HR: 'L2 Final Sign-off',
          FINANCE: 'No Approval Access',
          MANAGER: 'L1 Line Manager Approval',
          EMPLOYEE: 'Applicant Only',
        },
        {
          feature: 'Leave Policy & Balance Adjustment',
          SUPER_ADMIN: 'Full Control',
          CMD: 'View',
          ADMIN: 'Full Control',
          HR: 'Full Control',
          FINANCE: 'View',
          MANAGER: 'View Team Balances',
          EMPLOYEE: 'View Self Balances',
        },
      ],
    },
    {
      category: 'Commercial & Financial Operations',
      features: [
        {
          feature: 'License Quota Purchase & Payment',
          SUPER_ADMIN: 'Request & Pay',
          CMD: 'Request & Pay',
          ADMIN: 'Request & Pay',
          HR: 'Request Only',
          FINANCE: 'Approve & Pay',
          MANAGER: 'No Access',
          EMPLOYEE: 'No Access',
        },
        {
          feature: 'Invoices, Receipts & Subscriptions',
          SUPER_ADMIN: 'Full Access',
          CMD: 'Full Access',
          ADMIN: 'Full Access',
          HR: 'View Invoices',
          FINANCE: 'Manage & Reconcile',
          MANAGER: 'No Access',
          EMPLOYEE: 'No Access',
        },
      ],
    },
  ];

  // Dynamically retain columns for ONLY active roles present in DB
  const filteredMatrix = baseMatrix.map((section) => ({
    category: section.category,
    features: section.features.map((feat) => {
      const row = { feature: feat.feature };
      activeRoles.forEach((r) => {
        row[r] = feat[r] || 'Standard Access';
      });
      return row;
    }),
  }));

  return {
    matrix: filteredMatrix,
    activeRoles,
  };
}
