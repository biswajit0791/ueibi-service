import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEmployeeName,
  validateEmployeePhone,
  validateEmployeeDesignation,
  validateEmployeeType,
  validateEmployeeId,
  validateTenantEmail,
  validateDepartment,
  validateRoleAssignment,
  validateReportingManager,
  validateSingleField,
} from '../../src/lib/employeeValidation.js';

test('Employee Validation - First & Last Name', async (t) => {
  await t.test('accepts legitimate names with letters, spaces, hyphens and apostrophes', () => {
    assert.equal(validateEmployeeName('Ananya Sen', 'First Name').valid, true);
    assert.equal(validateEmployeeName("John O'Connor", 'Name').valid, true);
    assert.equal(validateEmployeeName('Mary-Jane', 'Last Name').valid, true);
    assert.equal(validateEmployeeName('St. John', 'Name').valid, true);
  });

  await t.test('strictly rejects numeric-only or digit-containing values', () => {
    const resNumOnly = validateEmployeeName('47523', 'Last Name');
    assert.equal(resNumOnly.valid, false);
    assert.match(resNumOnly.error, /cannot be numbers only|cannot contain numbers/i);

    const resWithDigits = validateEmployeeName('John2 Doe', 'Name');
    assert.equal(resWithDigits.valid, false);
    assert.match(resWithDigits.error, /cannot contain numbers/i);
  });

  await t.test('rejects too short, empty, or symbol-only names', () => {
    assert.equal(validateEmployeeName('', 'First Name').valid, false);
    assert.equal(validateEmployeeName('A', 'First Name').valid, false);
    assert.equal(validateEmployeeName('!@#$%^', 'First Name').valid, false);
  });
});

test('Employee Validation - Phone Number', async (t) => {
  await t.test('accepts empty/null phone as optional', () => {
    assert.equal(validateEmployeePhone(null).valid, true);
    assert.equal(validateEmployeePhone('').valid, true);
    assert.equal(validateEmployeePhone(undefined).valid, true);
  });

  await t.test('strictly rejects alphabetic characters in phone number', () => {
    const res = validateEmployeePhone('asxjl ask');
    assert.equal(res.valid, false);
    assert.match(res.error, /cannot contain alphabetic letters/i);
  });

  await t.test('accepts valid international or 10-digit formats', () => {
    assert.equal(validateEmployeePhone('+91 9876543210').valid, true);
    assert.equal(validateEmployeePhone('9876543210').valid, true);
    assert.equal(validateEmployeePhone('+1-202-555-0143').valid, true);
  });

  await t.test('rejects invalid symbols or too short/long digits', () => {
    assert.equal(validateEmployeePhone('12345').valid, false);
    assert.equal(validateEmployeePhone('<script>').valid, false);
  });
});

test('Employee Validation - Designation & Type', async (t) => {
  await t.test('validates designation requirements', () => {
    assert.equal(validateEmployeeDesignation('Senior Software Engineer').valid, true);
    assert.equal(validateEmployeeDesignation('').valid, false);
    assert.equal(validateEmployeeDesignation('   ').valid, false);
    assert.equal(validateEmployeeDesignation('X').valid, false);
  });

  await t.test('validates supported employment types', () => {
    assert.equal(validateEmployeeType('PERMANENT').valid, true);
    assert.equal(validateEmployeeType('contract').valid, true);
    assert.equal(validateEmployeeType('PROBATION').valid, true);
    assert.equal(validateEmployeeType('INTERN').valid, true);
    assert.equal(validateEmployeeType('part_time').valid, true);
    assert.equal(validateEmployeeType('FREELANCE_UNKNOWN').valid, false);
  });
});

test('Employee Validation - Tenant-Based Email Domain Enforcement', async (t) => {
  // Mock Prisma client with two tenants:
  // Tenant A: id 'tenant-a', domainName 'ekaryam.io'
  // Tenant B: id 'tenant-b', domainName 'ueibi.com'
  const mockPrisma = {
    tenant: {
      findUnique: async ({ where }) => {
        if (where.id === 'tenant-a') {
          return { id: 'tenant-a', companyName: 'Ekaryam Corp', domainName: 'ekaryam.io' };
        }
        if (where.id === 'tenant-b') {
          return { id: 'tenant-b', companyName: 'UEIBI Enterprises', domainName: 'ueibi.com' };
        }
        return null;
      },
    },
    tenantUser: {
      findFirst: async ({ where }) => {
        // Simulate existing user in Tenant A: existing@ekaryam.io
        if (where.email === 'existing@ekaryam.io') {
          return { id: 'user-existing', tenantId: 'tenant-a', status: 'ACTIVE' };
        }
        return null;
      },
    },
  };

  await t.test('Tenant A accepts matching employee@ekaryam.io', async () => {
    const res = await validateTenantEmail('employee@ekaryam.io', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, true);
    assert.equal(res.value, 'employee@ekaryam.io');
  });

  await t.test('Tenant A rejects public webmail employee@gmail.com', async () => {
    const res = await validateTenantEmail('employee@gmail.com', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /Public email accounts.*not permitted.*@ekaryam\.io/i);
  });

  await t.test('Tenant A rejects other tenant domain employee@ueibi.com', async () => {
    const res = await validateTenantEmail('employee@ueibi.com', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /must match registered company domain: @ekaryam\.io/i);
  });

  await t.test('Tenant B rejects employee@ekaryam.io', async () => {
    const res = await validateTenantEmail('employee@ekaryam.io', 'tenant-b', { prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /must match registered company domain: @ueibi\.com/i);
  });

  await t.test('rejects subdomains employee@sub.ekaryam.io by default', async () => {
    const res = await validateTenantEmail('employee@sub.ekaryam.io', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /Subdomain emails.*not permitted/i);
  });

  await t.test('rejects duplicate email within the same tenant', async () => {
    const res = await validateTenantEmail('existing@ekaryam.io', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /already exists in your organization/i);
  });

  await t.test('allows existing email when editing self (excludeUserId)', async () => {
    const res = await validateTenantEmail('existing@ekaryam.io', 'tenant-a', {
      excludeUserId: 'user-existing',
      prismaClient: {
        ...mockPrisma,
        tenantUser: {
          findFirst: async ({ where }) => {
            if (where.email === 'existing@ekaryam.io' && where.id?.not === 'user-existing') {
              return null; // excluded
            }
            return null;
          },
        },
      },
    });
    assert.equal(res.valid, true);
  });
});

test('Employee Validation - Employee ID Tenant Uniqueness', async (t) => {
  const mockPrisma = {
    tenantUser: {
      findFirst: async ({ where }) => {
        if (where.tenantId === 'tenant-a' && where.employeeId?.equals === 'EMP-001') {
          return { id: 'u1', employeeId: 'EMP-001' };
        }
        return null;
      },
    },
  };

  await t.test('accepts available alphanumeric employee ID', async () => {
    const res = await validateEmployeeId('EMP-002', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, true);
    assert.equal(res.value, 'EMP-002');
  });

  await t.test('rejects duplicate employee ID in same tenant', async () => {
    const res = await validateEmployeeId('EMP-001', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /already assigned to another employee/i);
  });

  await t.test('allows same employee ID in different tenant (Tenant B)', async () => {
    const res = await validateEmployeeId('EMP-001', 'tenant-b', { prismaClient: mockPrisma });
    assert.equal(res.valid, true);
  });
});

test('Employee Validation - Department Validation', async (t) => {
  const mockPrisma = {
    department: {
      findFirst: async ({ where }) => {
        if (where.tenantId === 'tenant-a' && where.isActive && (where.OR[0].id === 'dept-eng' || where.OR[1].name.equals === 'Engineering')) {
          return { id: 'dept-eng', name: 'Engineering', isActive: true };
        }
        return null;
      },
    },
  };

  await t.test('accepts active department belonging to tenant', async () => {
    const res = await validateDepartment('Engineering', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, true);
    assert.equal(res.departmentName, 'Engineering');
  });

  await t.test('rejects department from another tenant', async () => {
    const res = await validateDepartment('Engineering', 'tenant-b', { prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /does not exist, is inactive, or does not belong to your organization/i);
  });
});

test('Employee Validation - RBAC Role Assignment', () => {
  // SUPER_ADMIN can assign any role
  assert.equal(validateRoleAssignment('SUPER_ADMIN', 'ADMIN').valid, true);
  assert.equal(validateRoleAssignment('SUPER_ADMIN', 'HR').valid, true);
  assert.equal(validateRoleAssignment('SUPER_ADMIN', 'FINANCE').valid, true);

  // CMD can assign ADMIN, HR, FINANCE, MANAGER, EMPLOYEE
  assert.equal(validateRoleAssignment('CMD', 'HR').valid, true);
  assert.equal(validateRoleAssignment('CMD', 'FINANCE').valid, true);
  assert.equal(validateRoleAssignment('CMD', 'EMPLOYEE').valid, true);

  // HR can assign MANAGER, EMPLOYEE, but NOT SUPER_ADMIN or FINANCE
  assert.equal(validateRoleAssignment('HR', 'MANAGER').valid, true);
  assert.equal(validateRoleAssignment('HR', 'EMPLOYEE').valid, true);
  assert.equal(validateRoleAssignment('HR', 'SUPER_ADMIN').valid, false);
  assert.equal(validateRoleAssignment('HR', 'FINANCE').valid, false);

  // MANAGER can only assign EMPLOYEE
  assert.equal(validateRoleAssignment('MANAGER', 'EMPLOYEE').valid, true);
  assert.equal(validateRoleAssignment('MANAGER', 'HR').valid, false);
  assert.equal(validateRoleAssignment('MANAGER', 'ADMIN').valid, false);
});

test('Employee Validation - Reporting Manager & Circular Prevention', async (t) => {
  // Hierarchy setup:
  // User 1 (CEO, no manager)
  // User 2 (VP, manager is User 1)
  // User 3 (Lead, manager is User 2)
  const users = {
    'u1': { id: 'u1', name: 'Alice CEO', managerId: null, tenantId: 'tenant-a', isDeleted: false },
    'u2': { id: 'u2', name: 'Bob VP', managerId: 'u1', tenantId: 'tenant-a', isDeleted: false },
    'u3': { id: 'u3', name: 'Charlie Lead', managerId: 'u2', tenantId: 'tenant-a', isDeleted: false },
  };

  const mockPrisma = {
    tenantUser: {
      findFirst: async ({ where }) => {
        if (where.tenantId !== 'tenant-a' || where.isDeleted) return null;
        const id = where.id || where.OR?.[0]?.id;
        return users[id] || null;
      },
    },
  };

  await t.test('accepts valid active manager', async () => {
    const res = await validateReportingManager('u1', 'tenant-a', { prismaClient: mockPrisma });
    assert.equal(res.valid, true);
  });

  await t.test('rejects self-reporting', async () => {
    const res = await validateReportingManager('u2', 'tenant-a', { employeeId: 'u2', prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /cannot be their own reporting manager/i);
  });

  await t.test('detects circular reporting: u1 assigning u3 as manager when u3 reports to u2 which reports to u1', async () => {
    const res = await validateReportingManager('u3', 'tenant-a', { employeeId: 'u1', prismaClient: mockPrisma });
    assert.equal(res.valid, false);
    assert.match(res.error, /circular reporting hierarchy detected/i);
  });
});

test('Employee Validation - Single Field Dispatcher (AJAX Endpoint)', async () => {
  const mockPrisma = {
    tenant: {
      findUnique: async () => ({ id: 'tenant-a', domainName: 'ekaryam.io' }),
    },
    tenantUser: {
      findFirst: async () => null,
    },
  };

  const resEmail = await validateSingleField('tenant-a', 'HR', { field: 'email', value: 'hr@ekaryam.io' }, { prismaClient: mockPrisma });
  assert.equal(resEmail.valid, true);

  const resInvalidName = await validateSingleField('tenant-a', 'HR', { field: 'firstName', value: '47523' });
  assert.equal(resInvalidName.valid, false);

  const resInvalidPhone = await validateSingleField('tenant-a', 'HR', { field: 'phone', value: 'asxjl ask' });
  assert.equal(resInvalidPhone.valid, false);
});
