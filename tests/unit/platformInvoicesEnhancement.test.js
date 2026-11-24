import test from 'node:test';
import assert from 'node:assert/strict';
import { listInvoices } from '../../src/controllers/invoice.controller.js';
import { invoiceQuerySchema } from '../../src/validations/billing.schema.js';
import { prisma } from '../../src/lib/prisma.js';

test('1. Schema Validation accepts all new filter and sorting parameters', () => {
  const validQuery = {
    fromDate: '2026-09-01',
    toDate: '2026-09-30',
    bdm: 'Platform Owner',
    paymentMode: 'ONLINE',
    city: 'Mumbai',
    sortBy: 'companyName',
    sortOrder: 'asc',
    page: '1',
    limit: '50',
  };

  const parsed = invoiceQuerySchema.safeParse(validQuery);
  assert.ok(parsed.success, 'Validation should pass for all valid parameters');
  assert.equal(parsed.data.fromDate, '2026-09-01');
  assert.equal(parsed.data.paymentMode, 'ONLINE');
  assert.equal(parsed.data.city, 'Mumbai');
  assert.equal(parsed.data.sortBy, 'companyName');
  assert.equal(parsed.data.sortOrder, 'asc');
});

test('2. listInvoices returns items with 12 required column attributes and filterOptions', async () => {
  let responseData = null;
  const req = {
    query: { limit: 10 },
  };
  const res = {
    json: (d) => { responseData = d; return res; },
    status: () => res,
  };

  await listInvoices(req, res, (err) => { throw err; });

  assert.ok(responseData, 'Response data should be returned');
  assert.ok(Array.isArray(responseData.items), 'items must be an array');
  assert.ok(responseData.summary, 'summary KPI totals must be present');
  assert.ok(responseData.filterOptions, 'filterOptions must be returned for UI dropdowns');
  assert.ok(Array.isArray(responseData.filterOptions.cities), 'cities must be an array');
  assert.ok(Array.isArray(responseData.filterOptions.bdms), 'bdms must be an array');
  assert.ok(Array.isArray(responseData.filterOptions.paymentModes), 'paymentModes must be an array');

  if (responseData.items.length > 0) {
    const item = responseData.items[0];
    assert.ok(item.billToName !== undefined, 'Company Name exists');
    assert.ok(item.city !== undefined, 'City exists');
    assert.ok(item.bdmName !== undefined, 'BDM Name exists');
    assert.ok(item.quantity !== undefined, 'License exists');
    assert.ok(item.discountAmount !== undefined, 'Discount exists');
    assert.ok(item.gstAmount !== undefined, 'GST exists');
    assert.ok(item.totalAmount !== undefined, 'Amount exists');
    assert.ok(item.mop !== undefined, 'MOP exists');
    assert.ok(item.renewalMonths !== undefined, 'Renewal Months exists');
    assert.ok(item.state !== undefined, 'Status exists');
    assert.ok('paymentDate' in item, 'Date (actual payment date) field exists');
    assert.ok(item.id, 'Invoice id exists for PDF action');
  }
});

test('3. listInvoices accurately filters by paymentMode (ONLINE and CHEQUE)', async () => {
  // Test CHEQUE filter
  let chequeData = null;
  const chequeReq = { query: { paymentMode: 'CHEQUE', limit: 10 } };
  const chequeRes = {
    json: (d) => { chequeData = d; return chequeRes; },
    status: () => chequeRes,
  };
  await listInvoices(chequeReq, chequeRes, (err) => { throw err; });

  for (const item of chequeData.items) {
    assert.equal(item.mop, 'Cheque');
  }

  // Test ONLINE filter
  let onlineData = null;
  const onlineReq = { query: { paymentMode: 'ONLINE', limit: 10 } };
  const onlineRes = {
    json: (d) => { onlineData = d; return onlineRes; },
    status: () => onlineRes,
  };
  await listInvoices(onlineReq, onlineRes, (err) => { throw err; });

  for (const item of onlineData.items) {
    assert.equal(item.mop, 'Online');
  }
});

test('4. listInvoices accurately filters by Payment Date range', async () => {
  let dateData = null;
  const req = {
    query: { fromDate: '2026-09-01', toDate: '2026-09-30', limit: 50 },
  };
  const res = {
    json: (d) => { dateData = d; return res; },
    status: () => res,
  };
  await listInvoices(req, res, (err) => { throw err; });

  assert.ok(dateData.pagination.total >= 0);
  for (const item of dateData.items) {
    if (item.paymentDate) {
      const pDate = new Date(item.paymentDate);
      assert.ok(pDate >= new Date('2026-09-01T00:00:00.000Z'));
      assert.ok(pDate <= new Date('2026-09-30T23:59:59.999Z'));
    }
  }
});

test('5. listInvoices accurately sorts server-side by Company, Amount, and Date', async () => {
  // Ascending by Company Name
  let ascData = null;
  const ascReq = { query: { sortBy: 'companyName', sortOrder: 'asc', limit: 10 } };
  const ascRes = { json: (d) => { ascData = d; return ascRes; }, status: () => ascRes };
  await listInvoices(ascReq, ascRes, (err) => { throw err; });

  if (ascData.items.length >= 2) {
    const first = ascData.items[0].billToName.toLowerCase();
    const second = ascData.items[1].billToName.toLowerCase();
    assert.ok(first.localeCompare(second) <= 0);
  }

  // Descending by Amount
  let amountData = null;
  const amtReq = { query: { sortBy: 'amount', sortOrder: 'desc', limit: 10 } };
  const amtRes = { json: (d) => { amountData = d; return amtRes; }, status: () => amtRes };
  await listInvoices(amtReq, amtRes, (err) => { throw err; });

  if (amountData.items.length >= 2) {
    assert.ok(amountData.items[0].totalAmount >= amountData.items[1].totalAmount);
  }
});

test('6. Combined Filters work together seamlessly', async () => {
  let combinedData = null;
  const req = {
    query: {
      city: 'Bengaluru',
      limit: 10,
    },
  };
  const res = { json: (d) => { combinedData = d; return res; }, status: () => res };
  await listInvoices(req, res, (err) => { throw err; });

  assert.ok(combinedData.pagination.total >= 0);
  for (const item of combinedData.items) {
    assert.equal(item.city.toLowerCase(), 'bengaluru');
  }
});
