import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLicenseTerm,
  resolveAnnualUnitPrice,
  calculateProRataLicensePrice,
  DEFAULT_ANNUAL_UNIT_PRICE,
} from '../../src/services/billing.service.js';

const d = (s) => new Date(s);

test('annual cycle: bought January 2025 renews January 2026, then January 2027', () => {
  const t = resolveLicenseTerm({ subscriptionStartsAt: d('2025-01-01'), tenantCreatedAt: d('2025-01-01') }, d('2025-06-15'));
  assert.equal(t.endsAt.toISOString().slice(0, 10), '2026-01-01');
  const lapsed = resolveLicenseTerm({ subscriptionStartsAt: d('2025-01-01'), subscriptionEndsAt: d('2026-01-01') }, d('2026-03-10'));
  assert.equal(lapsed.startsAt.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(lapsed.endsAt.toISOString().slice(0, 10), '2027-01-01');
});

test('additional licences in August against a January renewal are charged for 5 months', () => {
  const t = resolveLicenseTerm({ subscriptionStartsAt: d('2025-01-01'), subscriptionEndsAt: d('2026-01-01') }, d('2025-08-10'));
  assert.equal(t.remainingMonths, 5);
  const p = calculateProRataLicensePrice({ annualUnitPrice: 1200, remainingMonths: t.remainingMonths, seats: 3, taxRate: 0 });
  assert.equal(p.proRataUnitPrice, 500);
  assert.equal(p.subtotal, 1500);
});

test('10 licences bought Jan 2026, 5 returned in May: Jan–Apr consumed, May–Dec credited', () => {
  const t = resolveLicenseTerm({ subscriptionStartsAt: d('2026-01-01'), subscriptionEndsAt: d('2027-01-01') }, d('2026-05-05'));
  assert.equal(t.remainingMonths, 8);
  const unitCredit = (1200 * t.remainingMonths) / 12;
  assert.equal(5 * unitCredit, 4000); // 5 seats × ₹1200/yr × 8/12
});

test('planEndsAt is used when no subscription term is in force', () => {
  const t = resolveLicenseTerm({ planEndsAt: d('2026-12-01'), tenantCreatedAt: d('2024-03-01') }, d('2026-09-15'));
  assert.equal(t.endsAt.toISOString().slice(0, 10), '2026-12-01');
  assert.equal(t.remainingMonths, 3);
});

test('price comes from the term invoice, then the package, then the default', () => {
  assert.equal(resolveAnnualUnitPrice({ invoiceUnitPrice: '999.00', packageUnitPrice: 799 }), 999);
  assert.equal(resolveAnnualUnitPrice({ invoiceUnitPrice: null, packageUnitPrice: '799.50' }), 799.5);
  assert.equal(resolveAnnualUnitPrice({}), DEFAULT_ANNUAL_UNIT_PRICE);
});
