import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.tenantUser.updateMany({
    where: { email: 'pratik@acmecorp.com' },
    data: { name: 'Pratik Parida' },
  });
  console.log(`Updated ${result.count} user records for pratik@acmecorp.com to "Pratik Parida".`);
}

main()
  .catch((e) => {
    console.error('Error updating user name:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
