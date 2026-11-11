import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import registrationRoutes from '../../src/routes/registration.routes.js';

test('Registration Endpoints HTTP Integration Tests', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api', registrationRoutes);

  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}/api`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  await t.test('POST /api/public/mou/validate-company-domain rejects invalid syntax and webmail', async () => {
    const res1 = await fetch(`${baseUrl}/public/mou/validate-company-domain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainName: 'kruthkrtghkhfrgkhrgfh4trg' }),
    });
    const data1 = await res1.json();
    assert.equal(res1.status, 400);
    assert.equal(data1.valid, false);
    assert.match(data1.error, /invalid domain syntax/i);

    const res2 = await fetch(`${baseUrl}/public/mou/validate-company-domain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainName: 'gmail.com' }),
    });
    const data2 = await res2.json();
    assert.equal(res2.status, 400);
    assert.equal(data2.valid, false);
    assert.match(data2.error, /public email providers/i);
  });

  await t.test('POST /api/public/mou/validate-company-domain accepts valid company domain', async () => {
    const res = await fetch(`${baseUrl}/public/mou/validate-company-domain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainName: 'testcompany.com' }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.valid, true);
    assert.equal(data.domainName, 'testcompany.com');
  });

  await t.test('POST /api/public/mou/validate-official-email enforces exact domain match', async () => {
    // 1. Gmail rejected
    const res1 = await fetch(`${baseUrl}/public/mou/validate-official-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rajesh@gmail.com',
        domainName: 'shraddhaauromira.com',
      }),
    });
    const data1 = await res1.json();
    assert.equal(res1.status, 400);
    assert.equal(data1.valid, false);
    assert.match(data1.error, /public personal email accounts.*shraddhaauromira\.com/i);

    // 2. Subdomain rejected
    const res2 = await fetch(`${baseUrl}/public/mou/validate-official-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rajesh@sub.shraddhaauromira.com',
        domainName: 'shraddhaauromira.com',
      }),
    });
    const data2 = await res2.json();
    assert.equal(res2.status, 400);
    assert.equal(data2.valid, false);
    assert.match(data2.error, /subdomains.*are not permitted/i);

    // 3. Exact match accepted
    const res3 = await fetch(`${baseUrl}/public/mou/validate-official-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rajesh@shraddhaauromira.com',
        domainName: 'shraddhaauromira.com',
      }),
    });
    const data3 = await res3.json();
    assert.equal(res3.status, 200);
    assert.equal(data3.valid, true);
    assert.equal(data3.email, 'rajesh@shraddhaauromira.com');
  });
});
