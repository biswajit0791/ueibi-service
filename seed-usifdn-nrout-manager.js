/**
 * @file seed-usifdn-nrout-manager.js
 * @description Sets Rajesh Behari as the reporting manager of N Rout in the
 * "usifdn.org" tenant, so N Rout's exit Manager clearance has an approver.
 *
 * Safe to re-run: does nothing if the manager is already set. Dry run by
 * default — pass --apply to write.
 *
 * Usage:
 *   node seed-usifdn-nrout-manager.js           # show what would change
 *   node seed-usifdn-nrout-manager.js --apply   # make the change
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOMAIN = 'usifdn.org';
const EMPLOYEE_EMAIL = 'nrout@usifdn.org';
const MANAGER_EMAIL = 'rajesh@usifdn.org';
const APPLY = process.argv.includes('--apply');

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { domainName: DOMAIN },
    select: { id: true, companyName: true },
  });
  if (!tenant) throw new Error(`Tenant "${DOMAIN}" not found`);

  const findActive = (email) => prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, email, isDeleted: false },
    select: { id: true, name: true, email: true, role: true, managerId: true },
  });

  const employee = await findActive(EMPLOYEE_EMAIL);
  const manager = await findActive(MANAGER_EMAIL);
  if (!employee) throw new Error(`Active employee ${EMPLOYEE_EMAIL} not found in ${DOMAIN}`);
  if (!manager) throw new Error(`Active manager ${MANAGER_EMAIL} not found in ${DOMAIN}`);
  if (manager.managerId === employee.id) {
    throw new Error(`${manager.name} reports to ${employee.name}; assigning would create a cycle`);
  }

  console.log(`Tenant:   ${tenant.companyName} (${DOMAIN})`);
  console.log(`Employee: ${employee.name} <${employee.email}> — current managerId: ${employee.managerId ?? 'none'}`);
  console.log(`Manager:  ${manager.name} <${manager.email}> (${manager.role}) — id ${manager.id}`);

  if (employee.managerId === manager.id) {
    console.log('\n✅ Already set. Nothing to do.');
    return;
  }

  if (!APPLY) {
    console.log(`\nDry run: would set ${employee.name}'s reporting manager to ${manager.name}.`);
    console.log('Re-run with --apply to write the change.');
    return;
  }

  await prisma.tenantUser.update({
    where: { id: employee.id },
    data: { managerId: manager.id },
  });
  console.log(`\n✅ ${employee.name} now reports to ${manager.name}.`);
  console.log(`   To undo: set managerId back to ${employee.managerId ?? 'null'}.`);
}

main()
  .catch((err) => {
    console.error('❌', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
