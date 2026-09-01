import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const isJsonOutput = process.argv.includes('--json');

  try {
    // 1. Fetch all Company Registrations (Level 1/2/3 pipeline)
    const registrations = await prisma.companyRegistration.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: {
          select: {
            id: true,
            tenantCode: true,
            licenseLimit: true,
          },
        },
      },
    });

    // 2. Fetch all Active Tenants with their Users
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          orderBy: { role: 'asc' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            designation: true,
            department: true,
            passwordHash: true,
            createdAt: true,
          },
        },
      },
    });

    // Compute Summary Numbers
    const totalRegistrations = registrations.length;
    const totalTenants = tenants.length;
    const totalUsers = tenants.reduce((acc, t) => acc + t.users.length, 0);

    const statusCounts = registrations.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    if (isJsonOutput) {
      console.log(JSON.stringify({
        summary: {
          totalRegistrations,
          totalTenants,
          totalUsers,
          statusBreakdown: statusCounts,
        },
        registrations: registrations.map(r => ({
          id: r.id,
          companyName: r.companyName,
          companyType: r.companyType,
          domainName: r.domainName,
          tenantCode: r.tenantCode,
          registrant: {
            fullName: r.fullName,
            designation: r.designation,
            email: r.email,
            passwordHash: r.passwordHash,
          },
          stakeholders: {
            financeEmail: r.financeEmail,
            hrEmail: r.hrEmail,
          },
          status: r.status,
          totalAmount: r.totalAmount ? Number(r.totalAmount) : null,
          paymentMethod: r.paymentMethod,
          activatedAt: r.activatedAt,
          createdAt: r.createdAt,
        })),
        tenants: tenants.map(t => ({
          id: t.id,
          companyName: t.companyName,
          domainName: t.domainName,
          tenantCode: t.tenantCode,
          licenseLimit: t.licenseLimit,
          createdAt: t.createdAt,
          userCount: t.users.length,
          users: t.users,
        })),
      }, null, 2));
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Formatted CLI Report
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(80));
    console.log('                 UEIBI SMART HR — REGISTERED COMPANIES REPORT');
    console.log('='.repeat(80));
    console.log(`Report Generated At: ${new Date().toISOString()}`);
    console.log(`Total Company Registrations : ${totalRegistrations}`);
    console.log(`Total Active Tenants       : ${totalTenants}`);
    console.log(`Total Registered Users     : ${totalUsers}`);
    console.log('-'.repeat(80));
    console.log('Registration Status Breakdown:');
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  • ${status.padEnd(30)} : ${count}`);
    }
    console.log('='.repeat(80) + '\n');

    // ─────────────────────────────────────────────────────────────────────────────
    // Section 1: All Company Registrations
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('📁 SECTION 1: ALL ONBOARDING REGISTRATIONS (' + totalRegistrations + ' total)\n');

    if (registrations.length === 0) {
      console.log('  No company registrations found in database.\n');
    } else {
      registrations.forEach((reg, index) => {
        console.log(`[#${index + 1}] COMPANY: ${reg.companyName.toUpperCase()}`);
        console.log(`  ├─ Company Type     : ${reg.companyType || 'N/A'}`);
        console.log(`  ├─ Domain Name      : ${reg.domainName}`);
        console.log(`  ├─ Tenant Code      : ${reg.tenantCode}`);
        console.log(`  ├─ Status           : ${reg.status}`);
        console.log(`  ├─ Registered By    : ${reg.fullName} (${reg.designation})`);
        console.log(`  ├─ Director Email   : ${reg.email}`);
        console.log(`  ├─ Password (Hash)  : ${reg.passwordHash.slice(0, 25)}... (bcrypt salted)`);
        console.log(`  ├─ Finance Email    : ${reg.financeEmail}`);
        console.log(`  ├─ HR Email         : ${reg.hrEmail}`);
        console.log(`  ├─ Payment Method   : ${reg.paymentMethod || 'Pending'}`);
        console.log(`  ├─ Total Amount     : ${reg.totalAmount ? `₹${reg.totalAmount}` : 'Pending'}`);
        console.log(`  ├─ Registered At    : ${reg.createdAt.toISOString()}`);
        console.log(`  └─ Activated At     : ${reg.activatedAt ? reg.activatedAt.toISOString() : 'Not Yet Activated'}`);
        console.log('');
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Section 2: Active Tenants & Employee Credentials
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('🏢 SECTION 2: ACTIVE TENANTS & USER DIRECTORY (' + totalTenants + ' companies, ' + totalUsers + ' users)\n');

    if (tenants.length === 0) {
      console.log('  No active tenants found in database.\n');
    } else {
      tenants.forEach((tenant, tIdx) => {
        console.log(`TENANT [${tIdx + 1}/${totalTenants}] : ${tenant.companyName.toUpperCase()}`);
        console.log(`  ├─ Tenant ID        : ${tenant.id}`);
        console.log(`  ├─ Domain Name      : ${tenant.domainName}`);
        console.log(`  ├─ Tenant Code      : ${tenant.tenantCode}`);
        console.log(`  ├─ License Limit    : ${tenant.licenseLimit} users`);
        console.log(`  ├─ Total Users      : ${tenant.users.length}`);
        console.log(`  └─ Created At       : ${tenant.createdAt.toISOString()}`);
        console.log('\n  USER ACCOUNTS:');

        if (tenant.users.length === 0) {
          console.log('    (No user accounts provisioned for this tenant)');
        } else {
          tenant.users.forEach((user, uIdx) => {
            console.log(`    [${uIdx + 1}] ${user.name}`);
            console.log(`        Email        : ${user.email}`);
            console.log(`        Role         : ${user.role}`);
            console.log(`        Status       : ${user.status}`);
            console.log(`        Designation  : ${user.designation || 'N/A'}`);
            console.log(`        Department   : ${user.department || 'N/A'}`);
            console.log(`        PasswordHash : ${user.passwordHash.slice(0, 25)}... (bcrypt salted)`);
            console.log(`        Default Seed : password123 (if seeded)`);
            console.log(`        Created At   : ${user.createdAt.toISOString()}`);
          });
        }
        console.log('\n' + '-'.repeat(80) + '\n');
      });
    }

    console.log('='.repeat(80));
    console.log('💡 TIP: Run with "--json" flag to output raw JSON data:');
    console.log('   node list-companies.js --json');
    console.log('='.repeat(80) + '\n');

  } catch (err) {
    console.error('Error fetching registered companies:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
