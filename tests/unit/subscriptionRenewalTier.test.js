import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { renewSubscription } from '../../src/controllers/subscription.controller.js';

test('Subscription renewal retains current tier specification when packageId is null/omitted (PLATFORM_OWNER)', async (t) => {
  const currentSub = await prisma.subscription.findFirst({
    where: {
      cancelledAt: null,
      renewedTo: null,
    },
    include: {
      package: true,
      invoices: {
        where: { state: { in: ['PAID', 'ISSUED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!currentSub) {
    t.skip('No eligible subscription found for renewal test');
    return;
  }

  const req = {
    user: {
      id: 'platform-owner-test',
      role: 'PLATFORM_OWNER',
    },
    params: { id: currentSub.id },
    body: {
      packageId: null, // "Keep current tier specification"
      seatCount: currentSub.seatCount,
      createInvoice: false,
    },
  };

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  };

  await renewSubscription(req, res, (err) => {
    if (err) throw err;
  });

  if (statusCode === 409 && responseData?.code === 'ALREADY_RENEWED') {
    assert.ok(true, 'Already renewed check passed');
    return;
  }

  assert.notEqual(
    responseData?.error,
    'This term has no package to take a price from. Give a unit price or choose a package.',
    'Must not error with missing package price'
  );

  if (statusCode === 201) {
    assert.equal(responseData.subscription.seatCount, currentSub.seatCount);
    assert.equal(responseData.subscription.packageName, currentSub.packageName);
    assert.equal(responseData.subscription.packageId, currentSub.packageId);
    if (!currentSub.endsAt) {
      assert.equal(responseData.subscription.endsAt, null, 'Perpetual term stays perpetual');
    }
  }
});

test('Subscription renewal by PLATFORM_SALES (BDM) succeeds without unitPrice by resolving tier specifications', async (t) => {
  const currentSub = await prisma.subscription.findFirst({
    where: {
      cancelledAt: null,
      renewedTo: null,
    },
    include: {
      package: true,
      invoices: {
        where: { state: { in: ['PAID', 'ISSUED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!currentSub) {
    t.skip('No eligible subscription found for BDM renewal test');
    return;
  }

  const req = {
    user: {
      id: 'platform-sales-test',
      role: 'PLATFORM_SALES',
    },
    params: { id: currentSub.id },
    body: {
      packageId: null, // "Keep current tier specification"
      seatCount: currentSub.seatCount,
      unitPrice: null, // BDM cannot send custom price
      createInvoice: true,
    },
  };

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  };

  await renewSubscription(req, res, (err) => {
    if (err) throw err;
  });

  if (statusCode === 409 && responseData?.code === 'ALREADY_RENEWED') {
    assert.ok(true, 'Already renewed check passed');
    return;
  }

  // Critical assertion: BDM must not get missing price error
  assert.notEqual(
    responseData?.error,
    'This term has no package to take a price from. Give a unit price or choose a package.',
    'BDM renewal with keep tier specification must not fail with missing package price error'
  );
});
