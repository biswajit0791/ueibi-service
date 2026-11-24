import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { getRegistrationConfig, updateRegistrationConfig } from '../../src/services/registrationConfig.service.js';
import { create, update } from '../../src/controllers/coupon.controller.js';

test('BDM Coupon Creation & Update API Validation Suite', async (t) => {
  const originalMin = await getRegistrationConfig('MIN_LICENSE_QUANTITY', 1);

  // Set DB config to 6
  await updateRegistrationConfig({
    key: 'MIN_LICENSE_QUANTITY',
    value: '6',
    actor: 'test.admin',
    reason: 'Configure min license quantity to 6 for API test',
  });

  const mockUser = { id: 'u-owner-1', name: 'Platform Owner', role: 'PLATFORM_OWNER' };

  await t.test('Reject creation when totalLicenses is below minimum (2 < 6)', async () => {
    let statusCode = 200;
    let responseBody = null;

    const req = {
      user: mockUser,
      body: {
        companyName: 'Test Min License Co',
        industry: 'Technology',
        city: 'Mumbai',
        totalLicenses: 2,
        discountPercent: 10,
        startDate: new Date().toISOString(),
      },
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

    await create(req, res, (err) => { if (err) throw err; });

    assert.equal(statusCode, 400, 'Must return HTTP 400');
    assert.equal(responseBody.error, 'Minimum 6 employee licenses are required.');
    assert.equal(responseBody.code, 'MIN_LICENSE_QUANTITY_NOT_MET');
  });

  await t.test('Accept creation when totalLicenses satisfies minimum (6 >= 6)', async () => {
    let statusCode = 200;
    let responseBody = null;

    const req = {
      user: mockUser,
      body: {
        companyName: 'Test Valid License Co',
        industry: 'Technology',
        city: 'Mumbai',
        totalLicenses: 6,
        discountPercent: 10,
        startDate: new Date().toISOString(),
      },
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

    await create(req, res, (err) => { if (err) throw err; });

    assert.equal(statusCode, 201, 'Must succeed with HTTP 201');
    assert.equal(responseBody.totalLicenses, 6);

    // Clean up created coupon
    if (responseBody?.id) {
      await prisma.coupon.delete({ where: { id: responseBody.id } });
    }
  });

  // Restore config
  await updateRegistrationConfig({
    key: 'MIN_LICENSE_QUANTITY',
    value: String(originalMin || 6),
    actor: 'test.cleanup',
    reason: 'Restore min license quantity',
  });
});
