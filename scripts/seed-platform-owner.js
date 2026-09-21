/**
 * Creates the internal platform tenant and the PLATFORM_OWNER account.
 *
 * This is the ONLY way a PLATFORM_OWNER can come into existence — no UI form
 * and no API endpoint creates one, so a company admin cannot escalate into the
 * platform role. Run it by hand on each environment:
 *
 *   PLATFORM_OWNER_EMAIL=ops@yourdomain.com \
 *   PLATFORM_OWNER_PASSWORD='a-strong-password' \
 *   npm run seed:platform-owner
 *
 * Idempotent: re-running reports what already exists and changes nothing. It
 * never touches an existing customer tenant or user.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

const PLATFORM_TENANT_CODE = 'PLATFORM';

async function main() {
  const email = (process.env.PLATFORM_OWNER_EMAIL || '').trim().toLowerCase();
  const password = process.env.PLATFORM_OWNER_PASSWORD || '';
  const name = (process.env.PLATFORM_OWNER_NAME || 'Platform Owner').trim();

  if (!email || !password) {
    console.error('\nPLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD are both required.\n');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('\nPLATFORM_OWNER_PASSWORD must be at least 8 characters.\n');
    process.exit(1);
  }

  // 1. The platform's own tenant. TenantUser.tenantId is NOT NULL, so the owner
  //    needs a tenant row; giving it a dedicated one is what keeps the account
  //    out of every customer company, since all tenant queries filter on tenantId.
  let tenant = await prisma.tenant.findFirst({ where: { isPlatform: true } });
  if (tenant) {
    console.log(`Platform tenant already exists: ${tenant.companyName} (${tenant.id})`);
  } else {
    tenant = await prisma.tenant.create({
      data: {
        companyName: 'UEIBI Platform',
        domainName: 'platform.ueibi.internal',
        tenantCode: PLATFORM_TENANT_CODE,
        licenseLimit: 0,
        isPlatform: true,
      },
    });
    console.log(`Created platform tenant: ${tenant.companyName} (${tenant.id})`);
  }

  // 2. The owner account. email is globally unique, so this also catches the
  //    case where the address is already in use by a company employee.
  const existing = await prisma.tenantUser.findUnique({
    where: { email },
    select: { id: true, role: true, tenantId: true },
  });
  if (existing) {
    if (existing.role === 'PLATFORM_OWNER') {
      console.log(`Platform owner already exists: ${email} (${existing.id}) — nothing changed.`);
    } else {
      console.error(
        `\n${email} already exists as a ${existing.role} in tenant ${existing.tenantId}.\n` +
        'Refusing to convert a company account into a platform owner. Use a different address.\n'
      );
      process.exit(1);
    }
  } else {
    const owner = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email,
        name,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'PLATFORM_OWNER',
        status: 'ACTIVE',
        mustChangePassword: false,
      },
      select: { id: true, email: true },
    });
    console.log(`Created platform owner: ${owner.email} (${owner.id})`);
  }

  console.log('\nSign in at the normal login page. You will land on /platform/overview.\n');
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
