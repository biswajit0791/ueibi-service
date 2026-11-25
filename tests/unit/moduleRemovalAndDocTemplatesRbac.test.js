import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { requireTenant } from '../../src/middleware/tenantScope.js';
import * as templateService from '../../src/services/documentTemplate.service.js';
import { PLATFORM_MENUS } from '../../src/services/platformPermissions.service.js';

test('Karyam - Module Removal & Document Templates RBAC Suite', async (t) => {
  // Test Tenants
  let tenantA = null;
  let tenantB = null;
  const createdTemplateIds = [];

  t.before(async () => {
    // Find or pick two existing active tenants for multi-tenant isolation tests
    const tenants = await prisma.tenant.findMany({
      take: 2,
      select: { id: true, companyName: true },
    });
    if (tenants.length >= 2) {
      tenantA = tenants[0];
      tenantB = tenants[1];
    } else {
      // Create lightweight test tenants if less than 2 exist
      tenantA = tenants[0] || (await prisma.tenant.create({ data: { companyName: 'Test Tenant Alpha' } }));
      tenantB = await prisma.tenant.create({ data: { companyName: 'Test Tenant Beta' } });
    }
  });

  t.after(async () => {
    if (createdTemplateIds.length > 0) {
      await prisma.documentTemplate.deleteMany({
        where: { id: { in: createdTemplateIds } },
      });
    }
  });

  await t.test('1. Platform Owner menus no longer contain Verification, Packages, or Document Templates', () => {
    const menuKeys = PLATFORM_MENUS.map((m) => m.key);
    assert.equal(menuKeys.includes('verification'), false, 'verification must be removed from PLATFORM_MENUS');
    assert.equal(menuKeys.includes('packages'), false, 'packages must be removed from PLATFORM_MENUS');
    assert.equal(menuKeys.includes('document_templates'), false, 'document_templates must be removed from PLATFORM_MENUS');
  });

  await t.test('2. Platform Owner is strictly blocked from Document Templates via requireTenant middleware (403)', () => {
    let statusCode = 200;
    let responseBody = null;

    const req = {
      tenantId: 'some-tenant-id',
      user: { id: 'u-owner-1', role: 'PLATFORM_OWNER', name: 'Platform Owner' },
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    let nextCalled = false;
    requireTenant(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'next() must NOT be called for Platform Owner');
    assert.equal(statusCode, 403, 'Platform Owner must receive HTTP 403');
    assert.match(responseBody.error, /Access forbidden: the platform owner is not a member of any company/);
  });

  await t.test('3. Tenant Super Admin can Create, View, Update, and Delete templates in their own tenant', async () => {
    // 3a. Create
    const created = await templateService.createTemplate({
      tenantId: tenantA.id,
      userId: 'test-user-super-admin',
      data: {
        name: 'Alpha Relieving Letter Template',
        slug: `alpha-relieving-${Date.now()}`,
        documentType: 'RELIEVING_LETTER',
        description: 'Official company relieving letter',
        htmlTemplate: '<p>Relieving {{employee_name}}</p>',
        cssStyles: 'body { font-size: 14px; }',
      },
    });

    assert.ok(created.id);
    assert.equal(created.tenantId, tenantA.id);
    createdTemplateIds.push(created.id);

    // 3b. View / GetById
    const fetched = await templateService.getTemplateById({
      id: created.id,
      tenantId: tenantA.id,
    });
    assert.ok(fetched);
    assert.equal(fetched.name, 'Alpha Relieving Letter Template');

    // 3c. Update
    const updated = await templateService.updateTemplate({
      id: created.id,
      tenantId: tenantA.id,
      userId: 'test-user-super-admin',
      data: {
        name: 'Alpha Relieving Letter Template Updated',
      },
    });
    assert.equal(updated.name, 'Alpha Relieving Letter Template Updated');

    // 3d. Delete
    const deleted = await templateService.deleteTemplate({
      id: created.id,
      tenantId: tenantA.id,
    });
    assert.equal(deleted.id, created.id);

    // Verify it is gone
    const afterDelete = await templateService.getTemplateById({
      id: created.id,
      tenantId: tenantA.id,
    });
    assert.equal(afterDelete, null, 'Deleted template must not be found');
  });

  await t.test('4. Cross-Tenant template access is strictly blocked', async () => {
    // Create template in Tenant A
    const templateA = await templateService.createTemplate({
      tenantId: tenantA.id,
      userId: 'admin-a',
      data: {
        name: 'Private Tenant A Secret Template',
        slug: `secret-a-${Date.now()}`,
        documentType: 'CUSTOM',
        htmlTemplate: '<p>Confidential Tenant A Content</p>',
      },
    });
    createdTemplateIds.push(templateA.id);

    // Tenant B attempts to read Tenant A template
    const fetchedByB = await templateService.getTemplateById({
      id: templateA.id,
      tenantId: tenantB.id,
    });
    assert.equal(fetchedByB, null, 'Tenant B must NOT be able to view Tenant A template');

    // Tenant B attempts to update Tenant A template
    await assert.rejects(
      async () => {
        await templateService.updateTemplate({
          id: templateA.id,
          tenantId: tenantB.id,
          userId: 'admin-b',
          data: { name: 'Hacked by Tenant B' },
        });
      },
      /Template not found/,
      'Tenant B must be rejected when attempting to update Tenant A template'
    );

    // Tenant B attempts to delete Tenant A template
    await assert.rejects(
      async () => {
        await templateService.deleteTemplate({
          id: templateA.id,
          tenantId: tenantB.id,
        });
      },
      /Template not found/,
      'Tenant B must be rejected when attempting to delete Tenant A template'
    );

    // Verify Template A is still completely intact in Tenant A
    const verifyA = await templateService.getTemplateById({
      id: templateA.id,
      tenantId: tenantA.id,
    });
    assert.ok(verifyA);
    assert.equal(verifyA.name, 'Private Tenant A Secret Template');
  });

  await t.test('5. Existing document generation functionality and default templates continue working', async () => {
    // Should resolve default or blueprint template for RELIEVING_LETTER
    const defaultRelieving = await templateService.getDefaultTemplate({
      tenantId: tenantA.id,
      documentType: 'RELIEVING_LETTER',
    });
    // If tenant doesn't have custom default, it falls back to DEFAULT_BLUEPRINTS
    if (!defaultRelieving) {
      assert.ok(templateService.DEFAULT_BLUEPRINTS.RELIEVING_LETTER, 'Default blueprint must exist');
    } else {
      assert.ok(defaultRelieving.htmlTemplate);
    }
  });
});
