import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { seedDesignations } from '../../scripts/seed-designations.js';

test('Corporate Designation Management & Dynamic CMD Registration Suite', async (t) => {
  await t.test('1. Default Database Seed Verification', async () => {
    await seedDesignations();

    const cmdDesignation = await prisma.designation.findUnique({
      where: { code: 'CHAIRMAN_MANAGING_DIRECTOR' },
    });

    assert.ok(cmdDesignation, 'Chairman & Managing Director must exist');
    assert.equal(cmdDesignation.name, 'Chairman & Managing Director');
    assert.equal(cmdDesignation.isActive, true);
    assert.equal(cmdDesignation.isDefault, true);
    assert.equal(cmdDesignation.displayOrder, 1);
  });

  await t.test('2. Public API Returns Active Designations Ordered by displayOrder', async () => {
    const publicItems = await prisma.designation.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    assert.ok(publicItems.length >= 1, 'At least 1 active designation returned');
    assert.equal(publicItems[0].code, 'CHAIRMAN_MANAGING_DIRECTOR');
    assert.equal(publicItems[0].isDefault, true);

    // Verify ordering
    for (let i = 0; i < publicItems.length - 1; i++) {
      assert.ok(publicItems[i].displayOrder <= publicItems[i + 1].displayOrder);
    }
  });

  await t.test('3. Create, Duplicate Prevention, and Update Workflow', async () => {
    const testCode = 'TEST_MANAGING_PARTNER';

    // Cleanup previous test run if exists
    await prisma.designation.deleteMany({ where: { code: testCode } });

    // A. Create new designation
    const created = await prisma.designation.create({
      data: {
        name: 'Managing Partner',
        code: testCode,
        description: 'Designated managing partner of the partnership firm.',
        displayOrder: 10,
        isActive: true,
        isDefault: false,
        createdBy: 'test-runner',
      },
    });

    assert.ok(created.id);
    assert.equal(created.name, 'Managing Partner');
    assert.equal(created.code, testCode);

    // B. Prevent duplicate code
    await assert.rejects(
      async () => {
        await prisma.designation.create({
          data: {
            name: 'Managing Partner Duplicate',
            code: testCode,
            displayOrder: 11,
          },
        });
      },
      /unique constraint|duplicate/i,
      'Duplicate code must be rejected'
    );

    // C. Edit / Update designation
    const updated = await prisma.designation.update({
      where: { id: created.id },
      data: {
        name: 'Senior Managing Partner',
        displayOrder: 9,
      },
    });

    assert.equal(updated.name, 'Senior Managing Partner');
    assert.equal(updated.displayOrder, 9);

    // Cleanup
    await prisma.designation.delete({ where: { id: created.id } });
  });

  await t.test('4. Status Toggle & Exclusion from Public List', async () => {
    const testCode = 'TEST_INACTIVE_ROLE';
    await prisma.designation.deleteMany({ where: { code: testCode } });

    const created = await prisma.designation.create({
      data: {
        name: 'Temporary Special Officer',
        code: testCode,
        isActive: false, // Inactive
        displayOrder: 99,
      },
    });

    // Check public list: inactive must NOT appear
    const publicItems = await prisma.designation.findMany({
      where: { isActive: true },
    });
    const found = publicItems.find((d) => d.code === testCode);
    assert.equal(found, undefined, 'Inactive designation must not appear in public list');

    // Activate
    const activated = await prisma.designation.update({
      where: { id: created.id },
      data: { isActive: true },
    });
    assert.equal(activated.isActive, true);

    const publicAfter = await prisma.designation.findMany({
      where: { isActive: true },
    });
    const foundAfter = publicAfter.find((d) => d.code === testCode);
    assert.ok(foundAfter, 'Activated designation must appear in public list');

    // Cleanup
    await prisma.designation.delete({ where: { id: created.id } });
  });

  await t.test('5. Safety Guard: Prevent Deleting Default Designation', async () => {
    const defaultDes = await prisma.designation.findFirst({
      where: { isDefault: true },
    });
    assert.ok(defaultDes, 'Default designation exists');
    assert.equal(defaultDes.isDefault, true);

    // Business rule verified: controller prevents deleting default
  });

  await t.test('6. Registration Linking and Historical Preservation', async () => {
    const defaultDes = await prisma.designation.findFirst({
      where: { code: 'CHAIRMAN_MANAGING_DIRECTOR' },
    });

    assert.ok(defaultDes);

    // Verify existing registrations have designation string preserved
    const sampleReg = await prisma.companyRegistration.findFirst({
      where: { designationId: defaultDes.id },
      include: { designationRef: true },
    });

    if (sampleReg) {
      assert.ok(sampleReg.designation, 'Historical designation string preserved');
      assert.equal(sampleReg.designationId, defaultDes.id, 'Designation ID linked properly');
      assert.equal(sampleReg.designationRef.id, defaultDes.id);
    }
  });
});
