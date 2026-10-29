import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlatformOwner, isPlatformUser, isPlatformSales, isElevated } from '../../src/lib/roles.js';

test('platform sales is a platform user but never passes an owner check', () => {
  assert.equal(isPlatformOwner('PLATFORM_SALES'), false);
  assert.equal(isPlatformUser('PLATFORM_SALES'), true);
  assert.equal(isPlatformSales('platform_sales'), true);
  assert.equal(isPlatformOwner('PLATFORM_OWNER'), true);
  assert.equal(isPlatformUser('SUPER_ADMIN'), false);
});

test('platform sales holds no company-level permission', () => {
  assert.equal(isElevated('PLATFORM_SALES'), false);
});
