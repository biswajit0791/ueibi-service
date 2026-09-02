import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const targetEmail = (process.argv[2] || 'pratik@defigo.in').trim().toLowerCase();
  const newPassword = process.argv[3] || '123456789';

  console.log(`\n========================================================`);
  console.log(`🔑 UEIBI PASSWORD RESET & ACCOUNT PROVISIONING`);
  console.log(`========================================================`);
  console.log(`Target Email : ${targetEmail}`);
  console.log(`New Password : ${newPassword}`);
  console.log(`--------------------------------------------------------`);

  const passwordHash = await bcrypt.hash(newPassword, 10);

  // 1. Check CompanyRegistration
  const reg = await prisma.companyRegistration.findUnique({
    where: { email: targetEmail },
  });

  if (reg) {
    await prisma.companyRegistration.update({
      where: { email: targetEmail },
      data: {
        passwordHash,
        status: 'ACTIVE',
        activatedAt: reg.activatedAt || new Date(),
      },
    });
    console.log(`[✓] Updated CompanyRegistration password and set status = ACTIVE for "${reg.companyName}"`);
  }

  // 2. Check if Tenant exists for this domain/registration
  let tenant = null;
  if (reg) {
    tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { domainName: reg.domainName },
          { tenantCode: reg.tenantCode },
          { registrationId: reg.id },
        ],
      },
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          companyName: reg.companyName,
          domainName: reg.domainName,
          tenantCode: reg.tenantCode,
          licenseLimit: reg.licenseQuantity || 50,
          registrationId: reg.id,
        },
      });
      console.log(`[✓] Provisioned Tenant record: "${tenant.companyName}" (${tenant.domainName})`);
    } else {
      console.log(`[✓] Found existing Tenant: "${tenant.companyName}" (${tenant.id})`);
    }
  }

  // 3. Update or Create TenantUser
  const existingUser = await prisma.tenantUser.findUnique({
    where: { email: targetEmail },
  });

  if (existingUser) {
    const updated = await prisma.tenantUser.update({
      where: { email: targetEmail },
      data: {
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
    console.log(`[✓] Updated password for existing TenantUser: ${updated.email} (${updated.role})`);
  } else if (tenant && reg) {
    const newUser = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email: targetEmail,
        passwordHash,
        name: reg.fullName || 'Admin User',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        designation: reg.designation || 'Director',
      },
    });
    console.log(`[✓] Created new active TenantUser account: ${newUser.email} (SUPER_ADMIN) in Tenant "${tenant.companyName}"`);
  } else {
    // Fallback: If no registration, search for any tenant or default tenant
    const defaultTenant = await prisma.tenant.findFirst();
    if (defaultTenant) {
      const newUser = await prisma.tenantUser.create({
        data: {
          tenantId: defaultTenant.id,
          email: targetEmail,
          passwordHash,
          name: targetEmail.split('@')[0],
          role: 'ADMIN',
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      });
      console.log(`[✓] Created new TenantUser account in Tenant "${defaultTenant.companyName}": ${newUser.email}`);
    } else {
      console.error(`[!] No Tenant found to attach user.`);
    }
  }

  console.log(`========================================================`);
  console.log(`🎉 READY! You can now log in with:`);
  console.log(`   Email    : ${targetEmail}`);
  console.log(`   Password : ${newPassword}`);
  console.log(`========================================================\n`);
}

main()
  .catch((err) => {
    console.error('Error resetting password / provisioning user:', err);
  })
  .finally(() => prisma.$disconnect());
