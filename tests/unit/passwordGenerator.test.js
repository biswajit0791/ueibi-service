import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from '../../src/lib/mouValidation.js';

// Replicate the exact generator implementation tested on the client
function generateSecurePassword(length = 16) {
  const fullUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const fullLower = 'abcdefghijkmnopqrstuvwxyz';
  const fullNumbers = '23456789';
  const fullSpecial = '!@#$%^&*()_+-=[]{};:,.<>?';
  const allChars = fullUpper + fullLower + fullNumbers + fullSpecial;

  const pwdLength = Math.max(length, 16);
  const randomBytes = new Uint32Array(pwdLength);
  crypto.getRandomValues(randomBytes);

  const guaranteed = [
    fullUpper[randomBytes[0] % fullUpper.length],
    fullLower[randomBytes[1] % fullLower.length],
    fullNumbers[randomBytes[2] % fullNumbers.length],
    fullSpecial[randomBytes[3] % fullSpecial.length],
  ];

  const remaining = [];
  for (let i = 4; i < pwdLength; i++) {
    remaining.push(allChars[randomBytes[i] % allChars.length]);
  }

  const combined = [...guaranteed, ...remaining];
  const shuffleBytes = new Uint32Array(combined.length);
  crypto.getRandomValues(shuffleBytes);
  for (let i = combined.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join('');
}

test('Cryptographically Secure Password Generator Tests', async (t) => {
  await t.test('generates password of specified default length (16)', () => {
    const pwd = generateSecurePassword(16);
    assert.equal(pwd.length, 16);
  });

  await t.test('100 generated passwords all satisfy Strong security policy without exception', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) {
      const pwd = generateSecurePassword(16);
      assert.equal(pwd.length, 16);
      assert.equal(seen.has(pwd), false, 'Every generated password must be unique');
      seen.add(pwd);

      const val = validatePassword(pwd);
      assert.equal(val.valid, true, `Password "${pwd}" failed policy: ${val.message}`);
      assert.equal(val.strength, 'Strong');
      assert.equal(val.checks.minLength, true);
      assert.equal(val.checks.hasUpper, true);
      assert.equal(val.checks.hasLower, true);
      assert.equal(val.checks.hasNumber, true);
      assert.equal(val.checks.hasSpecial, true);
      assert.equal(val.checks.noWhitespace, true);
    }
  });

  await t.test('supports custom lengths >= 16', () => {
    const pwd24 = generateSecurePassword(24);
    assert.equal(pwd24.length, 24);
    const val = validatePassword(pwd24);
    assert.equal(val.valid, true);
    assert.equal(val.strength, 'Strong');
  });
});

