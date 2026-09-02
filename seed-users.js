import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');
  const passwordHash = await bcrypt.hash('password123', 10);
  
  // Create / Update Tenant
  const tenant = await prisma.tenant.upsert({
    where: { domainName: 'acmecorp.com' },
    update: {
      companyName: 'Acme Corp',
      tenantCode: 'ACM',
      licenseLimit: 50,
    },
    create: {
      companyName: 'Acme Corp',
      domainName: 'acmecorp.com',
      tenantCode: 'ACM',
      licenseLimit: 50,
    },
  });

  console.log('✅ Tenant:', tenant.companyName, `(ID: ${tenant.id})`);

  // 1. Biswajit HR
  const hr = await prisma.tenantUser.upsert({
    where: { email: 'biswajitparida1291@gmail.com' },
    update: {
      tenantId: tenant.id,
      name: 'Biswajit HR',
      role: 'HR',
      status: 'ACTIVE',
      mustChangePassword: false,
      passwordHash,
    },
    create: {
      tenantId: tenant.id,
      email: 'biswajitparida1291@gmail.com',
      passwordHash,
      name: 'Biswajit HR',
      role: 'HR',
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  });
  console.log('✅ HR User:', hr.name, `(${hr.email})`);

  // 2. Biswajit Director (Super Admin)
  const sa = await prisma.tenantUser.upsert({
    where: { email: 'biswajitparida0791@gmail.com' },
    update: {
      tenantId: tenant.id,
      name: 'Biswajit Director',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
      passwordHash,
    },
    create: {
      tenantId: tenant.id,
      email: 'biswajitparida0791@gmail.com',
      passwordHash,
      name: 'Biswajit Director',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  });
  console.log('✅ Super Admin User:', sa.name, `(${sa.email})`);

  // 3. Biswajit Admin (Admin)
  const admin = await prisma.tenantUser.upsert({
    where: { email: 'biswajitparida5@gmail.com' },
    update: {
      tenantId: tenant.id,
      name: 'Biswajit Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
      passwordHash,
    },
    create: {
      tenantId: tenant.id,
      email: 'biswajitparida5@gmail.com',
      passwordHash,
      name: 'Biswajit Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  });
  console.log('✅ Admin User:', admin.name, `(${admin.email})`);

  // 4. Biswajit Manager
  const manager = await prisma.tenantUser.upsert({
    where: { email: 'manager@acmecorp.com' },
    update: {
      tenantId: tenant.id,
      name: 'Biswajit Manager',
      role: 'MANAGER',
      status: 'ACTIVE',
      mustChangePassword: false,
      empType: 'PERMANENT',
      department: 'Engineering',
      designation: 'Engineering Lead',
      band: 'M1',
      passwordHash,
    },
    create: {
      tenantId: tenant.id,
      email: 'manager@acmecorp.com',
      passwordHash,
      name: 'Biswajit Manager',
      role: 'MANAGER',
      status: 'ACTIVE',
      mustChangePassword: false,
      empType: 'PERMANENT',
      department: 'Engineering',
      designation: 'Engineering Lead',
      band: 'M1',
    },
  });
  console.log('✅ Manager User:', manager.name, `(${manager.email}, ID: ${manager.id})`);

  // 5. Employee Pratik Parida (Linked to Manager)
  const employee = await prisma.tenantUser.upsert({
    where: { email: 'pratik@acmecorp.com' },
    update: {
      tenantId: tenant.id,
      name: 'pratik parida',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      mustChangePassword: false,
      empType: 'PERMANENT',
      managerId: manager.id,
      passwordHash,
    },
    create: {
      tenantId: tenant.id,
      email: 'pratik@acmecorp.com',
      passwordHash,
      name: 'pratik parida',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      mustChangePassword: false,
      empType: 'PERMANENT',
      managerId: manager.id,
    },
  });
  console.log('✅ Employee User Linked:', employee.name, `(${employee.email}, ManagerId: ${employee.managerId})`);
  
  // ── Seed Policies ──────────────────────────────────────────────────────────
  console.log('\n📜 Seeding Corporate Policies...');

  const policy1 = await prisma.policy.upsert({
    where: { id: 'seed-policy-it-sec' },
    update: {
      tenantId: tenant.id,
      title: 'IT Security & Clean Desk Policy 2026',
      category: 'Compliance',
      content: 'This policy governs the security of IT resources, including computer systems, servers, network structures, passwords, clean desk principles, and remote access safeguards. All employees must shut down local environments at the end of the day, use enterprise VPN, and avoid storing corporate credentials on unsecured local devices.',
      description: 'Mandatory information security and physical clean desk regulations for all staff.',
      status: 'PUBLISHED',
      version: 1,
      createdById: hr.id,
      publishedById: hr.id,
      publishedAt: new Date('2026-01-10T09:00:00Z'),
    },
    create: {
      id: 'seed-policy-it-sec',
      tenantId: tenant.id,
      title: 'IT Security & Clean Desk Policy 2026',
      category: 'Compliance',
      content: 'This policy governs the security of IT resources, including computer systems, servers, network structures, passwords, clean desk principles, and remote access safeguards. All employees must shut down local environments at the end of the day, use enterprise VPN, and avoid storing corporate credentials on unsecured local devices.',
      description: 'Mandatory information security and physical clean desk regulations for all staff.',
      status: 'PUBLISHED',
      version: 1,
      createdById: hr.id,
      publishedById: hr.id,
      publishedAt: new Date('2026-01-10T09:00:00Z'),
    },
  });
  console.log('✅ Policy 1:', policy1.title);

  const policy2 = await prisma.policy.upsert({
    where: { id: 'seed-policy-wfh' },
    update: {
      tenantId: tenant.id,
      title: 'Work From Home & Hybrid Work Policy',
      category: 'HR Operations',
      content: 'Employees are permitted up to 15 days of Work From Home (WFH) per quarter. Dual approvals from the respective Engineering Manager and HR Business Partner are strictly mandatory prior to commencement of leave or remote work periods. Core communication hours (10:00 AM - 4:00 PM) must be maintained.',
      description: 'Guidelines on hybrid attendance, connectivity expectations, and core working hours.',
      status: 'PUBLISHED',
      version: 1,
      createdById: hr.id,
      publishedById: hr.id,
      publishedAt: new Date('2026-03-01T09:00:00Z'),
    },
    create: {
      id: 'seed-policy-wfh',
      tenantId: tenant.id,
      title: 'Work From Home & Hybrid Work Policy',
      category: 'HR Operations',
      content: 'Employees are permitted up to 15 days of Work From Home (WFH) per quarter. Dual approvals from the respective Engineering Manager and HR Business Partner are strictly mandatory prior to commencement of leave or remote work periods. Core communication hours (10:00 AM - 4:00 PM) must be maintained.',
      description: 'Guidelines on hybrid attendance, connectivity expectations, and core working hours.',
      status: 'PUBLISHED',
      version: 1,
      createdById: hr.id,
      publishedById: hr.id,
      publishedAt: new Date('2026-03-01T09:00:00Z'),
    },
  });
  console.log('✅ Policy 2:', policy2.title);

  const policy3 = await prisma.policy.upsert({
    where: { id: 'seed-policy-posh' },
    update: {
      tenantId: tenant.id,
      title: 'Prevention of Sexual Harassment (POSH)',
      category: 'Legal & Ethics',
      content: 'Acme Corp is dedicated to providing a safe work environment free from discrimination and harassment. Under POSH guidelines, any behavior, communication, or actions violating the safety and professional conduct policies will result in immediate termination. Regular annual training modules are compulsory for all employees.',
      description: 'Statutory compliance mandate for prevention of workplace harassment.',
      status: 'PUBLISHED',
      version: 1,
      createdById: hr.id,
      publishedById: hr.id,
      publishedAt: new Date('2026-05-12T09:00:00Z'),
    },
    create: {
      id: 'seed-policy-posh',
      tenantId: tenant.id,
      title: 'Prevention of Sexual Harassment (POSH)',
      category: 'Legal & Ethics',
      content: 'Acme Corp is dedicated to providing a safe work environment free from discrimination and harassment. Under POSH guidelines, any behavior, communication, or actions violating the safety and professional conduct policies will result in immediate termination. Regular annual training modules are compulsory for all employees.',
      description: 'Statutory compliance mandate for prevention of workplace harassment.',
      status: 'PUBLISHED',
      version: 1,
      createdById: hr.id,
      publishedById: hr.id,
      publishedAt: new Date('2026-05-12T09:00:00Z'),
    },
  });
  console.log('✅ Policy 3:', policy3.title);

  // ── Seed Policy Assignments ───────────────────────────────────────────────
  console.log('\n📋 Seeding Policy Assignments...');

  // Assign Policy 1 to Pratik (PENDING) and Manager (SIGNED)
  const assign1Pratik = await prisma.policyAssignment.upsert({
    where: {
      policyId_userId_policyVersion: {
        policyId: policy1.id,
        userId: employee.id,
        policyVersion: 1,
      },
    },
    update: {
      status: 'PENDING',
      dueAt: new Date('2026-12-31'),
    },
    create: {
      tenantId: tenant.id,
      policyId: policy1.id,
      userId: employee.id,
      policyVersion: 1,
      assignedById: hr.id,
      status: 'PENDING',
      dueAt: new Date('2026-12-31'),
    },
  });

  const assign2Pratik = await prisma.policyAssignment.upsert({
    where: {
      policyId_userId_policyVersion: {
        policyId: policy2.id,
        userId: employee.id,
        policyVersion: 1,
      },
    },
    update: {
      status: 'PENDING',
      dueAt: new Date('2026-12-31'),
    },
    create: {
      tenantId: tenant.id,
      policyId: policy2.id,
      userId: employee.id,
      policyVersion: 1,
      assignedById: hr.id,
      status: 'PENDING',
      dueAt: new Date('2026-12-31'),
    },
  });

  const assign3Pratik = await prisma.policyAssignment.upsert({
    where: {
      policyId_userId_policyVersion: {
        policyId: policy3.id,
        userId: employee.id,
        policyVersion: 1,
      },
    },
    update: {
      status: 'PENDING',
      dueAt: new Date('2026-12-31'),
    },
    create: {
      tenantId: tenant.id,
      policyId: policy3.id,
      userId: employee.id,
      policyVersion: 1,
      assignedById: hr.id,
      status: 'PENDING',
      dueAt: new Date('2026-12-31'),
    },
  });

  // Assign and sign Policy 1 for Manager
  const assign1Manager = await prisma.policyAssignment.upsert({
    where: {
      policyId_userId_policyVersion: {
        policyId: policy1.id,
        userId: manager.id,
        policyVersion: 1,
      },
    },
    update: {
      status: 'SIGNED',
      signedAt: new Date('2026-06-20T10:15:30Z'),
    },
    create: {
      tenantId: tenant.id,
      policyId: policy1.id,
      userId: manager.id,
      policyVersion: 1,
      assignedById: hr.id,
      status: 'SIGNED',
      signedAt: new Date('2026-06-20T10:15:30Z'),
    },
  });

  // Create Acceptance Record for Manager
  await prisma.policyAcceptance.upsert({
    where: { assignmentId: assign1Manager.id },
    update: {
      ipAddress: '192.168.1.48',
      signedAt: new Date('2026-06-20T10:15:30Z'),
    },
    create: {
      tenantId: tenant.id,
      policyId: policy1.id,
      policyVersion: 1,
      assignmentId: assign1Manager.id,
      userId: manager.id,
      signedAt: new Date('2026-06-20T10:15:30Z'),
      ipAddress: '192.168.1.48',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      complianceCheck: 'Verified Audit',
      legalDeclaration: `I hereby electronically sign and confirm that I have read, understood, and agree to follow all conditions outlined in the ${policy1.title}.`,
    },
  });

  console.log('✅ Assignments and initial signature seeded successfully.');
  console.log('\n🎉 All users and policies seeded successfully with master password: password123\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding users:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
