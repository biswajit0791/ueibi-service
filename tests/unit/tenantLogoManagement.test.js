import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { updateCompanySettings, getCompanySettings } from '../../src/services/companySettings.service.js';
import { uploadCompanyLogo, deleteCompanyLogo } from '../../src/controllers/companySettings.controller.js';
import { updateCompanySettingsSchema } from '../../src/validations/companySettings.schema.js';
import { registrationSchema } from '../../src/validations/registration.schema.js';

describe('Tenant-wise Company Logo Management System', () => {
  const testTenantId1 = `test-tenant-logo-1-${Date.now()}`;
  const testTenantId2 = `test-tenant-logo-2-${Date.now()}`;

  beforeEach(async () => {
    // Clean up test data if present
    await prisma.tenantSettings.deleteMany({
      where: { tenantId: { in: [testTenantId1, testTenantId2] } },
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [testTenantId1, testTenantId2] } },
    });

    // Create 2 test tenants to verify strict tenant isolation
    await prisma.tenant.createMany({
      data: [
        {
          id: testTenantId1,
          companyName: 'Acme Technologies',
          domainName: `acme-${Date.now()}.com`,
          tenantCode: `ACME${Math.floor(1000 + Math.random() * 9000)}`,
          logoUrl: null,
        },
        {
          id: testTenantId2,
          companyName: 'Beta Industries',
          domainName: `beta-${Date.now()}.com`,
          tenantCode: `BETA${Math.floor(1000 + Math.random() * 9000)}`,
          logoUrl: null,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.tenantSettings.deleteMany({
      where: { tenantId: { in: [testTenantId1, testTenantId2] } },
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [testTenantId1, testTenantId2] } },
    });
  });

  // ─── 1. Registration Without Logo (Optional Field) ──────────────────────────
  it('allows registration without a logo and defaults to null (not mandatory)', () => {
    const payload = {
      companyName: 'Gamma Corp Pvt Ltd',
      companyType: 'Private Limited Company',
      domainName: 'gammacorp.com',
      fullName: 'Robert Director',
      designation: 'Managing Director',
      email: 'robert@gammacorp.com',
      password: 'Password@123',
      confirmPassword: 'Password@123',
      hrNotRequired: true,
      financeNotRequired: true,
      acceptedTerms: true,
      verificationToken: 'valid-token',
      // logoUrl is omitted
    };

    const parsed = registrationSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data.logoUrl).toBeUndefined();
  });

  // ─── 2. Registration With Logo ──────────────────────────────────────────────
  it('accepts and validates logoUrl during Level-1 registration', () => {
    const payload = {
      companyName: 'Delta Systems Pvt Ltd',
      companyType: 'Private Limited Company',
      domainName: 'deltasystems.com',
      fullName: 'Sarah CEO',
      designation: 'CEO',
      email: 'sarah@deltasystems.com',
      password: 'Password@123',
      confirmPassword: 'Password@123',
      hrNotRequired: true,
      financeNotRequired: true,
      logoUrl: '/api/uploads/logo-delta-123.png',
      acceptedTerms: true,
      verificationToken: 'valid-token',
    };

    const parsed = registrationSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data.logoUrl).toBe('/api/uploads/logo-delta-123.png');
  });

  // ─── 3. Company Settings Schema Validation ──────────────────────────────────
  it('validates logoUrl in company settings schema both independently and in theme', () => {
    const parsedDirect = updateCompanySettingsSchema.safeParse({
      logoUrl: '/api/uploads/tenant-logo.webp',
    });
    expect(parsedDirect.success).toBe(true);
    expect(parsedDirect.data.logoUrl).toBe('/api/uploads/tenant-logo.webp');

    const parsedInTheme = updateCompanySettingsSchema.safeParse({
      theme: {
        preset: 'indigo',
        logoUrl: '/api/uploads/theme-logo.svg',
      },
    });
    expect(parsedInTheme.success).toBe(true);
    expect(parsedInTheme.data.theme.logoUrl).toBe('/api/uploads/theme-logo.svg');
  });

  // ─── 4. Uploading and Persisting Logo After Registration ────────────────────
  it('persists uploaded logo in both TenantSettings and Tenant models', async () => {
    const logoPath = '/api/uploads/company-logo-acme.png';

    await updateCompanySettings(testTenantId1, {
      logoUrl: logoPath,
    });

    const tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: testTenantId1 } });

    expect(tenant.logoUrl).toBe(logoPath);
    expect(settings.logoUrl).toBe(logoPath);
  });

  // ─── 5. Replacing an Existing Logo ──────────────────────────────────────────
  it('replaces an existing logo with a new logoUrl', async () => {
    const initialLogo = '/api/uploads/initial-logo.jpg';
    const replacedLogo = '/api/uploads/updated-logo.webp';

    await updateCompanySettings(testTenantId1, { logoUrl: initialLogo });
    let tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    expect(tenant.logoUrl).toBe(initialLogo);

    await updateCompanySettings(testTenantId1, { logoUrl: replacedLogo });
    tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: testTenantId1 } });

    expect(tenant.logoUrl).toBe(replacedLogo);
    expect(settings.logoUrl).toBe(replacedLogo);
  });

  // ─── 6. Removing a Logo and Restoring Default Branding ──────────────────────
  it('removes logo when null is passed and resets to default look', async () => {
    await updateCompanySettings(testTenantId1, { logoUrl: '/api/uploads/test.png' });
    let tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    expect(tenant.logoUrl).toBe('/api/uploads/test.png');

    // Reset/remove logo
    await updateCompanySettings(testTenantId1, { logoUrl: null });
    tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: testTenantId1 } });

    expect(tenant.logoUrl).toBeNull();
    expect(settings.logoUrl).toBeNull();
  });

  // ─── 7. Reset to Default Clears Both Theme and Logo ─────────────────────────
  it('clears logo when appearance is reset to default (theme: null)', async () => {
    await updateCompanySettings(testTenantId1, {
      logoUrl: '/api/uploads/test.png',
      theme: { preset: 'emerald' },
    });

    let tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    expect(tenant.logoUrl).toBe('/api/uploads/test.png');

    // Resetting appearance to default look (theme: null)
    await updateCompanySettings(testTenantId1, { theme: null });
    tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: testTenantId1 } });

    expect(tenant.logoUrl).toBeNull();
    expect(settings.logoUrl).toBeNull();
    expect(settings.theme).toBeNull();
  });

  // ─── 8. Strict Tenant Isolation ─────────────────────────────────────────────
  it('enforces strict tenant isolation: Tenant 1 logo changes do not affect Tenant 2', async () => {
    const tenant1Logo = '/api/uploads/tenant1-custom-logo.png';
    const tenant2Logo = '/api/uploads/tenant2-different-logo.svg';

    await updateCompanySettings(testTenantId1, { logoUrl: tenant1Logo });
    await updateCompanySettings(testTenantId2, { logoUrl: tenant2Logo });

    const tenant1 = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const tenant2 = await prisma.tenant.findUnique({ where: { id: testTenantId2 } });

    expect(tenant1.logoUrl).toBe(tenant1Logo);
    expect(tenant2.logoUrl).toBe(tenant2Logo);
    expect(tenant1.logoUrl).not.toBe(tenant2.logoUrl);

    // Modifying tenant 1 does not alter tenant 2
    await updateCompanySettings(testTenantId1, { logoUrl: null });
    const tenant1After = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const tenant2After = await prisma.tenant.findUnique({ where: { id: testTenantId2 } });

    expect(tenant1After.logoUrl).toBeNull();
    expect(tenant2After.logoUrl).toBe(tenant2Logo);
  });

  // ─── 9. Controller Action: uploadCompanyLogo & deleteCompanyLogo ────────────
  it('handles uploadCompanyLogo controller action cleanly without id mismatch', async () => {
    let responseData = null;
    const req = {
      tenantId: testTenantId1,
      user: { id: 'usr-1', email: 'cmd@acme.com', name: 'CMD Admin' },
      body: { logoUrl: '/api/uploads/controller-logo.png' },
    };
    const res = {
      json: (data) => { responseData = data; },
      status: () => res,
    };
    await uploadCompanyLogo(req, res, (err) => { if (err) throw err; });

    expect(responseData).not.toBeNull();
    expect(responseData.logoUrl).toBe('/api/uploads/controller-logo.png');

    const tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: testTenantId1 } });

    expect(tenant.logoUrl).toBe('/api/uploads/controller-logo.png');
    expect(settings.logoUrl).toBe('/api/uploads/controller-logo.png');
    expect(settings.theme?.logoUrl).toBe('/api/uploads/controller-logo.png');
  });

  it('handles deleteCompanyLogo controller action cleanly', async () => {
    let responseData = null;
    const req = {
      tenantId: testTenantId1,
      user: { id: 'usr-1', email: 'cmd@acme.com', name: 'CMD Admin' },
    };
    const res = {
      json: (data) => { responseData = data; },
      status: () => res,
    };
    await deleteCompanyLogo(req, res, (err) => { if (err) throw err; });

    expect(responseData).not.toBeNull();
    expect(responseData.logoUrl).toBeNull();

    const tenant = await prisma.tenant.findUnique({ where: { id: testTenantId1 } });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: testTenantId1 } });

    expect(tenant.logoUrl).toBeNull();
    expect(settings.logoUrl).toBeNull();
  });
});
