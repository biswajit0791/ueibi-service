import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const registrations = await prisma.companyRegistration.findMany({
    where: { status: 'ACTIVE' },
    include: { tenant: true }
  });

  for (const reg of registrations) {
    if (!reg.tenant) continue;
    
    // Check HR
    if (reg.hrEmail.toLowerCase() !== reg.email.toLowerCase()) {
      const existingHr = await prisma.tenantUser.findUnique({ where: { email: reg.hrEmail } });
      if (!existingHr) {
        console.log(`Creating HR user: ${reg.hrEmail}`);
        await prisma.tenantUser.create({
          data: {
            tenantId: reg.tenant.id,
            email: reg.hrEmail,
            passwordHash: reg.passwordHash,
            name: 'HR Head',
            role: 'HR',
            status: 'ACTIVE',
            mustChangePassword: false,
            designation: 'HR Head',
          }
        });
      }
    }

    // Check Finance
    if (reg.financeEmail.toLowerCase() !== reg.email.toLowerCase() &&
        reg.financeEmail.toLowerCase() !== reg.hrEmail.toLowerCase()) {
      const existingFin = await prisma.tenantUser.findUnique({ where: { email: reg.financeEmail } });
      if (!existingFin) {
        console.log(`Creating Finance user: ${reg.financeEmail}`);
        await prisma.tenantUser.create({
          data: {
            tenantId: reg.tenant.id,
            email: reg.financeEmail,
            passwordHash: reg.passwordHash,
            name: 'Finance Head',
            role: 'FINANCE',
            status: 'ACTIVE',
            mustChangePassword: false,
            designation: 'Finance Head',
          }
        });
      }
    }
  }

  console.log('Backfill complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
