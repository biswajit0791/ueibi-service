/**
 * @file seed-usifdn.js
 * @description Dedicated seed script to create and fully activate the tenant for "usifdn.org".
 *
 * This ensures:
 * 1. CompanyRegistration is set to status: "ACTIVE" with licenseQuantity: 100.
 * 2. Tenant is created/updated with domainName: "usifdn.org" and licenseLimit: 100.
 * 3. HR user "biswajit@usifdn.org" (password: "12345678") is ACTIVE with role: "HR".
 * 4. Fallback/Admin users (admin@usifdn.org, finance@usifdn.org, manager@usifdn.org) are provisioned.
 * 5. Default Departments and Leave Types are initialized for the tenant.
 *
 * Usage:
 *   node seed-usifdn.js
 *   npm run seed-usifdn
 */

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOMAIN = 'usifdn.org';
const TENANT_CODE = 'USI';
const COMPANY_NAME = 'USIFDN Foundation';
const HR_EMAIL = 'biswajit@usifdn.org';
const DEFAULT_PASSWORD = 'password' in process.env ? process.env.DEFAULT_PASSWORD : '12345678';
const LICENSE_CAPACITY = 100;

async function main() {
  console.log('====================================================');
  console.log(`🌱 Seeding & Activating Tenant: "${DOMAIN}"`);
  console.log('====================================================');

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // ── 1. Upsert CompanyRegistration ──────────────────────────────────────────
  console.log('\n[1/5] Checking Company Registration...');
  let registration = await prisma.companyRegistration.findFirst({
    where: {
      OR: [
        { domainName: { equals: DOMAIN, mode: 'insensitive' } },
        { tenantCode: { equals: TENANT_CODE, mode: 'insensitive' } },
        { email: { equals: HR_EMAIL, mode: 'insensitive' } },
        { hrEmail: { equals: HR_EMAIL, mode: 'insensitive' } },
      ],
    },
  });

  if (registration) {
    registration = await prisma.companyRegistration.update({
      where: { id: registration.id },
      data: {
        companyName: COMPANY_NAME,
        companyType: 'Non-Profit',
        domainName: DOMAIN,
        tenantCode: TENANT_CODE,
        fullName: 'Biswajit HR',
        designation: 'Head of Human Resources',
        email: HR_EMAIL,
        hrEmail: HR_EMAIL,
        financeEmail: 'finance@usifdn.org',
        passwordHash,
        status: 'ACTIVE',
        licenseQuantity: LICENSE_CAPACITY,
        activatedAt: new Date(),
      },
    });
    console.log(`✅ Updated existing CompanyRegistration: ID=${registration.id}, Status=${registration.status}`);
  } else {
    registration = await prisma.companyRegistration.create({
      data: {
        companyName: COMPANY_NAME,
        companyType: 'Non-Profit',
        domainName: DOMAIN,
        tenantCode: TENANT_CODE,
        fullName: 'Biswajit HR',
        designation: 'Head of Human Resources',
        email: HR_EMAIL,
        hrEmail: HR_EMAIL,
        financeEmail: 'finance@usifdn.org',
        passwordHash,
        acceptedTermsAt: new Date(),
        status: 'ACTIVE',
        licenseQuantity: LICENSE_CAPACITY,
        unitPrice: 3999,
        totalAmount: 399900,
        paymentMethod: 'ONLINE',
        paymentReference: 'PAY-USIFDN-SEED',
        activatedAt: new Date(),
      },
    });
    console.log(`✅ Created new CompanyRegistration: ID=${registration.id}, Status=${registration.status}`);
  }

  // ── 2. Upsert Tenant ───────────────────────────────────────────────────────
  console.log('\n[2/5] Creating / Activating Tenant Record...');
  let tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { domainName: { equals: DOMAIN, mode: 'insensitive' } },
        { tenantCode: { equals: TENANT_CODE, mode: 'insensitive' } },
        { registrationId: registration.id },
      ],
    },
  });

  if (tenant) {
    tenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        companyName: COMPANY_NAME,
        domainName: DOMAIN,
        tenantCode: TENANT_CODE,
        licenseLimit: Math.max(tenant.licenseLimit || 0, LICENSE_CAPACITY),
        registrationId: registration.id,
      },
    });
    console.log(`✅ Updated existing Tenant: ID=${tenant.id}, Code=${tenant.tenantCode}, LicenseLimit=${tenant.licenseLimit}`);
  } else {
    tenant = await prisma.tenant.create({
      data: {
        companyName: COMPANY_NAME,
        domainName: DOMAIN,
        tenantCode: TENANT_CODE,
        licenseLimit: LICENSE_CAPACITY,
        registrationId: registration.id,
      },
    });
    console.log(`✅ Created new Tenant: ID=${tenant.id}, Code=${tenant.tenantCode}, LicenseLimit=${tenant.licenseLimit}`);
  }

  // ── 3. Upsert Users ────────────────────────────────────────────────────────
  console.log('\n[3/5] Provisioning Key Users...');

  const usersToSeed = [
    {
      email: HR_EMAIL,
      name: 'Biswajit HR',
      role: 'HR',
      designation: 'Head of Human Resources',
      department: 'HR',
    },
    {
      email: 'admin@usifdn.org',
      name: 'USIFDN Administrator',
      role: 'SUPER_ADMIN',
      designation: 'Executive Director',
      department: 'Executive',
    },
    {
      email: 'finance@usifdn.org',
      name: 'USIFDN Finance Head',
      role: 'FINANCE',
      designation: 'Finance Lead',
      department: 'Finance',
    },
    {
      email: 'manager@usifdn.org',
      name: 'USIFDN Operations Manager',
      role: 'MANAGER',
      designation: 'Operations Lead',
      department: 'Operations',
    },
    {
      email: 'employee@usifdn.org',
      name: 'Sample Employee',
      role: 'EMPLOYEE',
      designation: 'Associate Member',
      department: 'Operations',
    },
  ];

  for (const u of usersToSeed) {
    const existing = await prisma.tenantUser.findFirst({
      where: {
        email: { equals: u.email, mode: 'insensitive' },
      },
    });

    if (existing) {
      const updated = await prisma.tenantUser.update({
        where: { id: existing.id },
        data: {
          tenantId: tenant.id,
          email: u.email.toLowerCase(),
          name: u.name,
          role: u.role,
          status: 'ACTIVE',
          mustChangePassword: false,
          designation: u.designation,
          department: u.department,
          passwordHash,
          isDeleted: false,
        },
      });
      console.log(`  ✔ User updated: ${updated.email} [Role: ${updated.role}] -> Password: "${DEFAULT_PASSWORD}"`);
    } else {
      const created = await prisma.tenantUser.create({
        data: {
          tenantId: tenant.id,
          email: u.email.toLowerCase(),
          name: u.name,
          role: u.role,
          status: 'ACTIVE',
          mustChangePassword: false,
          designation: u.designation,
          department: u.department,
          passwordHash,
          isDeleted: false,
        },
      });
      console.log(`  ✔ User created: ${created.email} [Role: ${created.role}] -> Password: "${DEFAULT_PASSWORD}"`);
    }
  }

  // ── 4. Seed Departments ───────────────────────────────────────────────────
  console.log('\n[4/5] Initializing Default Departments...');
  const departments = [
    { name: 'HR', description: 'Human Resources & Talent Management', color: '#ec4899', sortOrder: 1 },
    { name: 'Engineering', description: 'Engineering, Technology & Infrastructure', color: '#3b82f6', sortOrder: 2 },
    { name: 'Operations', description: 'Operations & Field Programs', color: '#10b981', sortOrder: 3 },
    { name: 'Finance', description: 'Finance, Accounts & Compliance', color: '#f59e0b', sortOrder: 4 },
    { name: 'Executive', description: 'Executive Leadership & Board', color: '#8b5cf6', sortOrder: 5 },
  ];

  for (const dept of departments) {
    await prisma.department.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: dept.name,
        },
      },
      update: {
        description: dept.description,
        color: dept.color,
        isActive: true,
        sortOrder: dept.sortOrder,
      },
      create: {
        tenantId: tenant.id,
        name: dept.name,
        description: dept.description,
        color: dept.color,
        isActive: true,
        sortOrder: dept.sortOrder,
      },
    });
  }
  console.log(`  ✔ Seeded ${departments.length} departments for tenant "${tenant.companyName}".`);

  // ── 5. Seed Leave Types ───────────────────────────────────────────────────
  console.log('\n[5/5] Initializing Default Leave Types...');
  const leaveTypes = [
    { name: 'Casual Leave', code: 'CL', defaultDays: 12, description: 'Short-term casual and emergency leave' },
    { name: 'Sick Leave', code: 'SL', defaultDays: 10, description: 'Medical and sick leave' },
    { name: 'Privilege Leave', code: 'PL', defaultDays: 15, description: 'Annual planned leave' },
  ];

  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: lt.code,
        },
      },
      update: {
        name: lt.name,
        defaultDays: lt.defaultDays,
        description: lt.description,
        isActive: true,
      },
      create: {
        tenantId: tenant.id,
        name: lt.name,
        code: lt.code,
        defaultDays: lt.defaultDays,
        description: lt.description,
        isActive: true,
      },
    });
  }
  console.log(`  ✔ Seeded ${leaveTypes.length} leave types for tenant "${tenant.companyName}".`);

  // ── Final Verification Summary ───────────────────────────────────────────
  const activeCount = await prisma.tenantUser.count({
    where: {
      tenantId: tenant.id,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
    },
  });

  console.log('\n====================================================');
  console.log('🎉 TENANT SEEDING COMPLETE & ACTIVATED SUCCESSFULLY');
  console.log('====================================================');
  console.log(`🏢 Company Name    : ${tenant.companyName}`);
  console.log(`🌐 Domain          : ${tenant.domainName}`);
  console.log(`🏷️  Tenant Code     : ${tenant.tenantCode}`);
  console.log(`🆔 Tenant ID       : ${tenant.id}`);
  console.log(`📊 License Limit   : ${tenant.licenseLimit}`);
  console.log(`👥 Active Members  : ${activeCount}/${tenant.licenseLimit} (Capacity Available: ${tenant.licenseLimit - activeCount})`);
  console.log('----------------------------------------------------');
  console.log('🔐 LOGIN CREDENTIALS:');
  console.log(`   HR Login        : ${HR_EMAIL}`);
  console.log(`   Admin Login     : admin@usifdn.org`);
  console.log(`   Password        : ${DEFAULT_PASSWORD}`);
  console.log('====================================================\n');
}

main()
  .catch((err) => {
    console.error('❌ Error seeding tenant:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
