import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.tenantUser.findMany({
    include: {
      tenant: { select: { companyName: true, domainName: true } },
      manager: { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log('\n--- All Users in Database ---');
  users.forEach((u) => {
    console.log(`ID: ${u.id}, Name: ${u.name}, Email: ${u.email}, Role: ${u.role}, TenantId: ${u.tenantId}${u.manager ? `, Manager: ${u.manager.name} (${u.manager.email})` : ''}`);
  });

  console.log('\n--- Detailed User Breakdown ---');
  users.forEach((u) => {
    console.log(JSON.stringify({
      id: u.id,
      tenantId: u.tenantId,
      company: u.tenant?.companyName,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      mustChangePassword: u.mustChangePassword,
      empType: u.empType,
      department: u.department,
      designation: u.designation,
      band: u.band,
      managerId: u.managerId,
      managerName: u.manager?.name || null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }, null, 2));
  });
}

main()
  .catch((e) => {
    console.error('Error fetching users:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
