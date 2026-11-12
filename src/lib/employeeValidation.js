import { prisma } from './prisma.js';
import { canCreateRole, getAllowedRoles } from './roleHierarchy.js';
import { PUBLIC_WEBMAIL_DOMAINS, normalizeDomain } from './mouValidation.js';

export const VALID_EMPLOYMENT_TYPES = [
  'PERMANENT',
  'CONTRACT',
  'PROBATION',
  'INTERN',
  'PART_TIME',
];

/**
 * Validates First Name or Last Name:
 * - Required
 * - Minimum 2 characters, maximum 50 characters
 * - Allows letters (including Unicode accented letters), spaces, hyphens, and apostrophes
 * - Strictly rejects numbers-only or values without letters (e.g. "47523")
 * - Strictly rejects HTML / script tags / control characters
 */
export function validateEmployeeName(name, fieldName = 'Name') {
  if (name === undefined || name === null || String(name).trim() === '') {
    return { valid: false, error: `${fieldName} is required.` };
  }

  const trimmed = String(name).trim();

  if (trimmed.length < 2) {
    return { valid: false, error: `${fieldName} must be at least 2 characters.` };
  }

  if (trimmed.length > 50) {
    return { valid: false, error: `${fieldName} cannot exceed 50 characters.` };
  }

  // Reject numeric-only or values with digits
  if (/^\d+$/.test(trimmed.replace(/[\s.'-]/g, ''))) {
    return { valid: false, error: `${fieldName} cannot be numbers only. Please enter a valid name.` };
  }

  // Count alphabetical letters (Unicode supported)
  const letters = trimmed.match(/[\p{L}]/gu) || [];
  if (letters.length < 2) {
    return { valid: false, error: `${fieldName} must contain at least 2 alphabetic letters.` };
  }

  // Disallow digits entirely in human names
  if (/\d/.test(trimmed)) {
    return { valid: false, error: `${fieldName} cannot contain numbers.` };
  }

  // Disallow dangerous symbols or code injections
  if (/[<>{}[\]()$#!%^*+=~`|\\/?_;:"]/.test(trimmed)) {
    return { valid: false, error: `${fieldName} contains invalid special characters.` };
  }

  // Allow letters, spaces, hyphens, apostrophes, and periods (e.g. St. John, O'Connor)
  const validNameRegex = /^[\p{L}\s.'-]+$/u;
  if (!validNameRegex.test(trimmed)) {
    return { valid: false, error: `${fieldName} contains invalid characters.` };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validates Designation:
 * - Required
 * - 2 to 100 characters
 * - Non-empty after trimming
 */
export function validateEmployeeDesignation(designation) {
  if (designation === undefined || designation === null || String(designation).trim() === '') {
    return { valid: false, error: 'Designation is required.' };
  }

  const trimmed = String(designation).trim();

  if (trimmed.length < 2) {
    return { valid: false, error: 'Designation must be at least 2 characters.' };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: 'Designation cannot exceed 100 characters.' };
  }

  if (/[<>{}[\]$^*~`\\|]/.test(trimmed)) {
    return { valid: false, error: 'Designation contains invalid characters.' };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validates Employee Type:
 * - Required
 * - Must belong to supported enum
 */
export function validateEmployeeType(empType) {
  if (!empType || typeof empType !== 'string' || !empType.trim()) {
    return { valid: false, error: 'Employee Type is required.' };
  }

  const clean = empType.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!VALID_EMPLOYMENT_TYPES.includes(clean)) {
    return {
      valid: false,
      error: `Invalid employee type. Supported types: ${VALID_EMPLOYMENT_TYPES.join(', ')}`,
    };
  }

  return { valid: true, value: clean };
}

/**
 * Validates Phone Number:
 * - Optional
 * - If provided, must not contain alphabetic characters
 * - Validates standard international format (7-15 digits, optional + prefix, spaces, hyphens)
 */
export function validateEmployeePhone(phone) {
  if (phone === undefined || phone === null || String(phone).trim() === '') {
    return { valid: true, value: null };
  }

  const raw = String(phone).trim();

  // Strictly reject alphabetic characters (e.g., "asxjl ask")
  if (/[a-zA-Z]/.test(raw)) {
    return {
      valid: false,
      error: 'Phone number cannot contain alphabetic letters. Please enter a valid phone number (e.g. +91 9876543210).',
    };
  }

  // Reject invalid symbols
  if (/[<>{}[\]()$#!%^*=~`|\\/?_;:"]/.test(raw)) {
    return { valid: false, error: 'Phone number contains invalid special characters.' };
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return {
      valid: false,
      error: 'Phone number must contain between 7 and 15 digits.',
    };
  }

  // Phone regex allowing optional leading +, optional country code, hyphens, spaces, and parentheses
  const phonePattern = /^(\+?[0-9]{1,4}[\s-]?)?(\([0-9]{1,4}\)[\s-]?)?[0-9\s-]{6,16}$/;
  if (!phonePattern.test(raw)) {
    return {
      valid: false,
      error: 'Invalid phone number format. Example: +91 9876543210 or 9876543210',
    };
  }

  return { valid: true, value: raw.replace(/\s+/g, ' ') };
}

/**
 * Strict Tenant-Based Email Validation:
 * - Valid RFC email syntax
 * - Exact match against authenticated tenant's registered and verified domainName
 * - Rejects public webmail providers (gmail, yahoo, etc.)
 * - Rejects subdomains unless explicitly configured
 * - Checks duplicate email within the tenant / database
 */
export async function validateTenantEmail(email, tenantId, options = {}) {
  const { excludeUserId = null, prismaClient = prisma } = options;

  if (email === undefined || email === null || String(email).trim() === '') {
    return { valid: false, error: 'Email address is required.' };
  }

  const raw = String(email).trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(raw)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  const [localPart, emailDomain] = raw.split('@');
  if (!localPart || !emailDomain) {
    return { valid: false, error: 'Invalid email address format.' };
  }

  // 1. Fetch tenant registered domain from verified server context
  const tenant = await prismaClient.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, companyName: true, domainName: true },
  });

  if (!tenant || !tenant.domainName) {
    return {
      valid: false,
      error: 'Tenant domain is not configured or verified. Please contact your administrator.',
    };
  }

  const expectedDomain = normalizeDomain(tenant.domainName);

  // 2. Reject public free webmail
  if (PUBLIC_WEBMAIL_DOMAINS.has(emailDomain)) {
    return {
      valid: false,
      error: `Public email accounts (@${emailDomain}) are not permitted. Employee email must belong to company domain: @${expectedDomain}`,
    };
  }

  // 3. Strict exact domain matching
  if (emailDomain !== expectedDomain) {
    if (emailDomain.endsWith(`.${expectedDomain}`)) {
      return {
        valid: false,
        error: `Subdomain emails (@${emailDomain}) are not permitted. Email must match company domain exactly: @${expectedDomain}`,
      };
    }
    return {
      valid: false,
      error: `Email domain must match registered company domain: @${expectedDomain} (received @${emailDomain}).`,
    };
  }

  // 4. Duplicate email check in database (case-insensitive)
  const existingUser = await prismaClient.tenantUser.findFirst({
    where: {
      email: raw,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, tenantId: true, status: true },
  });

  if (existingUser) {
    if (existingUser.tenantId === tenantId) {
      return {
        valid: false,
        error: `An employee with email "${raw}" already exists in your organization (${existingUser.status === 'INVITED' ? 'Pending Setup' : 'Active'}).`,
      };
    } else {
      // Cross-tenant email conflict without leaking other tenant's details
      return {
        valid: false,
        error: `Email address "${raw}" is already registered in the system.`,
      };
    }
  }

  return { valid: true, value: raw, expectedDomain };
}

/**
 * Validates Employee ID:
 * - Optional (if not provided, returns null)
 * - 1 to 30 characters
 * - Alphanumeric, hyphen, underscore, slash
 * - Scoped uniqueness within the tenant
 */
export async function validateEmployeeId(employeeId, tenantId, options = {}) {
  const { excludeUserId = null, prismaClient = prisma } = options;

  if (employeeId === undefined || employeeId === null || String(employeeId).trim() === '') {
    return { valid: true, value: null };
  }

  const trimmed = String(employeeId).trim();

  if (trimmed.length > 30) {
    return { valid: false, error: 'Employee ID cannot exceed 30 characters.' };
  }

  const pattern = /^[a-zA-Z0-9_\-\/]+$/;
  if (!pattern.test(trimmed)) {
    return {
      valid: false,
      error: 'Employee ID can only contain letters, numbers, hyphens, underscores, and slashes.',
    };
  }

  // Check tenant-scoped uniqueness (case-insensitive)
  const existing = await prismaClient.tenantUser.findFirst({
    where: {
      tenantId,
      employeeId: { equals: trimmed, mode: 'insensitive' },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, name: true, employeeId: true },
  });

  if (existing) {
    return {
      valid: false,
      error: `Employee ID "${trimmed}" is already assigned to another employee in your organization.`,
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validates Department:
 * - Required
 * - Must belong to authenticated tenant
 * - Must be active (isActive: true)
 */
export async function validateDepartment(departmentInput, tenantId, options = {}) {
  const { prismaClient = prisma } = options;

  if (departmentInput === undefined || departmentInput === null || String(departmentInput).trim() === '') {
    return { valid: false, error: 'Department is required.' };
  }

  const trimmed = String(departmentInput).trim();

  const dept = await prismaClient.department.findFirst({
    where: {
      tenantId,
      isActive: true,
      OR: [
        { id: trimmed },
        { name: { equals: trimmed, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, isActive: true },
  });

  if (!dept) {
    return {
      valid: false,
      error: 'Selected department does not exist, is inactive, or does not belong to your organization.',
    };
  }

  return { valid: true, departmentName: dept.name, departmentId: dept.id };
}

/**
 * Validates Role Assignment (RBAC hierarchy):
 * - Target role must be allowed for the creator role
 */
export function validateRoleAssignment(creatorRole, targetRole) {
  if (!targetRole || typeof targetRole !== 'string') {
    return { valid: false, error: 'Role is required.' };
  }

  const role = targetRole.trim().toUpperCase();
  if (!canCreateRole(creatorRole, role)) {
    const allowed = getAllowedRoles(creatorRole);
    return {
      valid: false,
      error: `Your role (${creatorRole}) is not permitted to assign the role "${role}". Allowed roles: ${allowed.join(', ') || 'None'}.`,
    };
  }

  return { valid: true, role };
}

/**
 * Validates Reporting Manager:
 * - Optional (null / empty string allowed for top level)
 * - Must belong to authenticated tenant
 * - Must be active (isDeleted: false)
 * - Cannot self-report
 * - Cannot create circular reporting hierarchy
 */
export async function validateReportingManager(managerId, tenantId, options = {}) {
  const { employeeId = null, prismaClient = prisma } = options;

  if (managerId === undefined || managerId === null || String(managerId).trim() === '') {
    return { valid: true, value: null };
  }

  const trimmed = String(managerId).trim();

  if (employeeId && trimmed === employeeId) {
    return { valid: false, error: 'An employee cannot be their own reporting manager.' };
  }

  // Look up manager within tenant
  const manager = await prismaClient.tenantUser.findFirst({
    where: {
      tenantId,
      isDeleted: false,
      OR: [
        { id: trimmed },
        { name: { equals: trimmed, mode: 'insensitive' } },
        { email: { equals: trimmed.toLowerCase(), mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, managerId: true },
  });

  if (!manager) {
    return {
      valid: false,
      error: 'Selected reporting manager was not found or is inactive in your organization.',
    };
  }

  // Check circular reporting if employee already exists
  if (employeeId) {
    let currentAncestorId = manager.managerId;
    const visited = new Set([manager.id]);

    while (currentAncestorId) {
      if (currentAncestorId === employeeId) {
        return {
          valid: false,
          error: 'Circular reporting hierarchy detected: the selected manager currently reports to this employee (directly or indirectly).',
        };
      }

      if (visited.has(currentAncestorId)) {
        // Cycle already exists upstream; break out
        break;
      }
      visited.add(currentAncestorId);

      const ancestor = await prismaClient.tenantUser.findFirst({
        where: { id: currentAncestorId, tenantId, isDeleted: false },
        select: { managerId: true },
      });

      currentAncestorId = ancestor?.managerId || null;
    }
  }

  return { valid: true, value: manager.id, managerName: manager.name };
}

/**
 * Central Field Validation Dispatcher for AJAX endpoint:
 * POST /api/employees/validate-field
 */
export async function validateSingleField(tenantId, creatorRole, body, options = {}) {
  const { field, value, employeeIdToExclude = null } = body || {};
  const { prismaClient = prisma } = options;

  if (!field) {
    return { valid: false, error: 'Field name is required.' };
  }

  switch (field) {
    case 'firstName':
      return validateEmployeeName(value, 'First Name');

    case 'lastName':
      return validateEmployeeName(value, 'Last Name');

    case 'email':
      return await validateTenantEmail(value, tenantId, {
        excludeUserId: employeeIdToExclude,
        prismaClient,
      });

    case 'phone':
      return validateEmployeePhone(value);

    case 'employeeId':
      return await validateEmployeeId(value, tenantId, {
        excludeUserId: employeeIdToExclude,
        prismaClient,
      });

    case 'empType':
      return validateEmployeeType(value);

    case 'designation':
      return validateEmployeeDesignation(value);

    case 'department':
      return await validateDepartment(value, tenantId, { prismaClient });

    case 'role':
      return validateRoleAssignment(creatorRole, value);

    case 'reportingManagerId':
    case 'managerId':
      return await validateReportingManager(value, tenantId, {
        employeeId: employeeIdToExclude,
        prismaClient,
      });

    default:
      return { valid: true, value };
  }
}
