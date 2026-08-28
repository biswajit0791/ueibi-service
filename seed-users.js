import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);
  
  // Create Tenant
  const tenant = await prisma.tenant.upsert({
    where: { domainName: 'acmecorp.com' },
    update: {},
    create: {
      companyName: 'Acme Corp',
      domainName: 'acmecorp.com',
      tenantCode: 'ACM',
      licenseLimit: 10,
    },
  });

  console.log('Created Tenant:', tenant.companyName);

  // Create HR
  const hr = await prisma.tenantUser.upsert({
    where: { email: 'biswajitparida1291@gmail.com' },
    update: {},
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
  console.log('Created HR User:', hr.email);

  // Create Super Admin
  const sa = await prisma.tenantUser.upsert({
    where: { email: 'biswajitparida0791@gmail.com' },
    update: {},
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
  console.log('Created Super Admin User:', sa.email);

  // Create Admin (Company Owner)
  const admin = await prisma.tenantUser.upsert({
    where: { email: 'biswajitparida5@gmail.com' },
    update: {},
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
  console.log('Created Admin User:', admin.email);
}

main().finally(() => prisma.$disconnect());
