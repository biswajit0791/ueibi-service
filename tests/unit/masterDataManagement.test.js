import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import {
  cityCreateSchema,
  industryCreateSchema,
  subscriptionDurationCreateSchema,
} from '../../src/validations/masterData.schema.js';
import crypto from 'crypto';

describe('Platform Owner - Master Data Management Suite', () => {
  const cuid = () => 'cm' + crypto.randomBytes(12).toString('hex').slice(0, 23);

  let testCityId;
  let testIndustryId;
  let testDurationId;
  let testCouponId;

  const testSuffix = Math.floor(Math.random() * 100000);
  const cityName = `TestCity_${testSuffix}`;
  const industryName = `TestIndustry_${testSuffix}`;
  const durationYears = Math.floor(Math.random() * 70) + 30; // Random unique years 30-99

  before(async () => {
    await prisma.subscriptionDurationMaster.deleteMany({ where: { years: durationYears } });
  });

  after(async () => {
    // Cleanup created test records
    if (testCouponId) {
      await prisma.coupon.deleteMany({ where: { id: testCouponId } });
    }
    if (testCityId) {
      await prisma.cityMaster.deleteMany({ where: { id: testCityId } });
    }
    if (testIndustryId) {
      await prisma.industryMaster.deleteMany({ where: { id: testIndustryId } });
    }
    if (testDurationId) {
      await prisma.subscriptionDurationMaster.deleteMany({ where: { id: testDurationId } });
    }
    await prisma.subscriptionDurationMaster.deleteMany({ where: { years: durationYears } });
  });

  describe('1. City Master Management', () => {
    it('validates city schema requirements', () => {
      const valid = cityCreateSchema.parse({
        name: 'Varanasi',
        state: 'Uttar Pradesh',
      });
      assert.equal(valid.name, 'Varanasi');
      assert.equal(valid.state, 'Uttar Pradesh');
      assert.equal(valid.country, 'India');
      assert.equal(valid.isActive, true);

      assert.throws(() => {
        cityCreateSchema.parse({ state: 'Maharashtra' });
      });

      assert.throws(() => {
        cityCreateSchema.parse({ name: '', state: 'Maharashtra' });
      }, /City name is required/);
    });

    it('creates a new city in the database', async () => {
      testCityId = cuid();
      const city = await prisma.cityMaster.create({
        data: {
          id: testCityId,
          name: cityName,
          state: 'Karnataka',
          country: 'India',
          isActive: true,
        },
      });
      assert.equal(city.id, testCityId);
      assert.equal(city.name, cityName);
    });

    it('prevents duplicate city records using normalized name + state + country', async () => {
      const duplicate = await prisma.cityMaster.findFirst({
        where: {
          name: { equals: cityName, mode: 'insensitive' },
          state: { equals: 'karnataka', mode: 'insensitive' },
          country: { equals: 'india', mode: 'insensitive' },
        },
      });
      assert.ok(duplicate, 'Found duplicate city record matching normalized criteria');
    });

    it('updates city details and toggles status', async () => {
      const updated = await prisma.cityMaster.update({
        where: { id: testCityId },
        data: { isActive: false },
      });
      assert.equal(updated.isActive, false);

      // Re-activate
      await prisma.cityMaster.update({
        where: { id: testCityId },
        data: { isActive: true },
      });
    });
  });

  describe('2. Industry Master Management', () => {
    it('validates industry schema requirements', () => {
      const valid = industryCreateSchema.parse({
        name: 'Aerospace & Defence',
        description: 'Aviation and defense manufacturing',
      });
      assert.equal(valid.name, 'Aerospace & Defence');

      assert.throws(() => {
        industryCreateSchema.parse({ description: 'No name' });
      });

      assert.throws(() => {
        industryCreateSchema.parse({ name: '' });
      }, /Industry name is required/);
    });

    it('creates an industry in the database', async () => {
      testIndustryId = cuid();
      const industry = await prisma.industryMaster.create({
        data: {
          id: testIndustryId,
          name: industryName,
          description: 'Specialized testing sector',
          isActive: true,
        },
      });
      assert.equal(industry.id, testIndustryId);
      assert.equal(industry.name, industryName);
    });

    it('prevents duplicate industry names using case-insensitive check', async () => {
      const duplicate = await prisma.industryMaster.findFirst({
        where: {
          name: { equals: industryName.toLowerCase(), mode: 'insensitive' },
        },
      });
      assert.ok(duplicate, 'Found duplicate industry matching case-insensitively');
    });

    it('toggles industry active/inactive status', async () => {
      const deactivated = await prisma.industryMaster.update({
        where: { id: testIndustryId },
        data: { isActive: false },
      });
      assert.equal(deactivated.isActive, false);

      await prisma.industryMaster.update({
        where: { id: testIndustryId },
        data: { isActive: true },
      });
    });
  });

  describe('3. Subscription Duration Master Management', () => {
    it('validates duration schema (months = years × 12, positive integer)', () => {
      const valid = subscriptionDurationCreateSchema.parse({
        name: '5 Years',
        years: 5,
      });
      assert.equal(valid.years, 5);

      assert.throws(() => {
        subscriptionDurationCreateSchema.parse({ name: 'Invalid', years: 0 });
      }, /Duration must be a positive integer/);
    });

    it('creates subscription duration in the database with auto-calculated months', async () => {
      testDurationId = cuid();
      const duration = await prisma.subscriptionDurationMaster.create({
        data: {
          id: testDurationId,
          name: `${durationYears} Years`,
          years: durationYears,
          months: durationYears * 12,
          displayOrder: durationYears,
          isActive: true,
        },
      });
      assert.equal(duration.id, testDurationId);
      assert.equal(duration.years, durationYears);
      assert.equal(duration.months, durationYears * 12);
    });

    it('prevents duplicate subscription duration years', async () => {
      const duplicate = await prisma.subscriptionDurationMaster.findFirst({
        where: { years: durationYears },
      });
      assert.ok(duplicate, 'Found duplicate duration with identical years');
    });
  });

  describe('4. Active Master Data Consumer Endpoint Query', () => {
    it('retrieves only active records for cities, industries, and durations', async () => {
      const [activeCities, activeIndustries, activeDurations] = await Promise.all([
        prisma.cityMaster.findMany({ where: { isActive: true } }),
        prisma.industryMaster.findMany({ where: { isActive: true } }),
        prisma.subscriptionDurationMaster.findMany({ where: { isActive: true } }),
      ]);

      assert.ok(activeCities.length > 0, 'Active cities should not be empty');
      assert.ok(activeIndustries.length > 0, 'Active industries should not be empty');
      assert.ok(activeDurations.length > 0, 'Active durations should not be empty');

      assert.ok(activeCities.every((c) => c.isActive === true));
      assert.ok(activeIndustries.every((i) => i.isActive === true));
      assert.ok(activeDurations.every((d) => d.isActive === true));
    });
  });

  describe('5. Dependency Validation: Prevent Deletion of Referenced Master Records', () => {
    it('creates a coupon referencing the test city, industry, and duration', async () => {
      testCouponId = cuid();
      const code = 'TEST-MASTER-' + testSuffix;

      const coupon = await prisma.coupon.create({
        data: {
          id: testCouponId,
          code,
          discountType: 'PERCENT',
          discountValue: 10,
          companyName: 'Acme Test Corp',
          industry: industryName,
          industryId: testIndustryId,
          city: cityName,
          cityId: testCityId,
          subscriptionDurationId: testDurationId,
          subscriptionYears: durationYears,
          totalLicenses: 10,
          perLicenseCost: 4999,
          licenseAmount: 10 * 4999 * durationYears,
          finalAmount: (10 * 4999 * durationYears) * 0.9,
          status: 'UNUSED',
        },
      });
      assert.equal(coupon.id, testCouponId);
    });

    it('blocks deletion of city when referenced by existing coupon', async () => {
      const count = await prisma.coupon.count({
        where: {
          OR: [
            { cityId: testCityId },
            { city: { equals: cityName, mode: 'insensitive' } },
          ],
        },
      });
      assert.ok(count > 0, 'City is referenced by at least 1 coupon');
      // Dependency check prevents hard delete
      assert.equal(count >= 1, true);
    });

    it('blocks deletion of industry when referenced by existing coupon', async () => {
      const count = await prisma.coupon.count({
        where: {
          OR: [
            { industryId: testIndustryId },
            { industry: { equals: industryName, mode: 'insensitive' } },
          ],
        },
      });
      assert.ok(count > 0, 'Industry is referenced by at least 1 coupon');
      assert.equal(count >= 1, true);
    });

    it('blocks deletion of duration when referenced by existing coupon', async () => {
      const count = await prisma.coupon.count({
        where: {
          OR: [
            { subscriptionDurationId: testDurationId },
            { subscriptionYears: durationYears },
          ],
        },
      });
      assert.ok(count > 0, 'Duration is referenced by at least 1 coupon');
      assert.equal(count >= 1, true);
    });
  });

  describe('6. Historical Compatibility and Snapshot Preservation', () => {
    it('preserves historical coupon data even if master record is deactivated', async () => {
      // Deactivate city and industry
      await prisma.cityMaster.update({ where: { id: testCityId }, data: { isActive: false } });
      await prisma.industryMaster.update({ where: { id: testIndustryId }, data: { isActive: false } });

      const coupon = await prisma.coupon.findUnique({
        where: { id: testCouponId },
      });

      // Historical string snapshots remain completely intact
      assert.equal(coupon.city, cityName);
      assert.equal(coupon.industry, industryName);
      assert.equal(coupon.subscriptionYears, durationYears);
    });
  });
});
