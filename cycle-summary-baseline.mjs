// Captures getCycleSummary's exact output for several real cycles so the
// service extraction can be proven byte-identical. Run with `capture` to write
// the baseline, then `compare` after refactoring.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';

const prisma = new PrismaClient();
const BASE = 'http://127.0.0.1:4000/api';
const PASSWORD = 'TestPass123!';
const OUT = 'D:/UEIBI/ueibi-service/.cycle-summary-baseline.json';
const mode = process.argv[2] || 'capture';

const CYCLES = [
  'cmtlh9xkf0001uuxwn9p687ho', // September 2026 — 8 reviews, 60 params
  'cmtlhbom50055uuxwsalvpeij', // FY 2026-2027 — 4 reviews
  'cmtlhbqaq005xuuxwvbql89nl', // Q3 2026 — 4 reviews
  'cmtl60gso0001uujgog413r7w', // FY 2024-2025 (Annual Review) — 3 reviews
  'cmtlhbjhz004duuxw5f2h4fjn', // June 2026 — 0 reviews (empty-case)
];

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const d = await res.json();
  if (!res.ok) throw new Error(`login failed: ${JSON.stringify(d)}`);
  return d.token;
}

async function main() {
  const acme = await prisma.tenant.findFirst({ where: { domainName: 'acmecorp.com' } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const s = Date.now();
  const hr = await prisma.tenantUser.create({ data: { tenantId: acme.id, email: `basel-hr-${s}@acmecorp.com`, passwordHash, name: 'Baseline HR', role: 'HR', status: 'ACTIVE', mustChangePassword: false } });
  const token = await login(hr.email);

  const results = {};
  for (const id of CYCLES) {
    // plain + department-filtered, to cover both query branches
    for (const q of ['', '?department=Engineering', '?department=IT']) {
      const res = await fetch(`${BASE}/appraisal-cycles/${id}/summary${q}`, { headers: { Authorization: `Bearer ${token}` } });
      results[`${id}${q}`] = { status: res.status, body: await res.json() };
    }
  }

  await prisma.tenantUser.delete({ where: { id: hr.id } });
  await prisma.$disconnect();

  if (mode === 'capture') {
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log(`baseline captured for ${Object.keys(results).length} requests -> ${OUT}`);
  } else {
    const before = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const a = JSON.stringify(before, null, 2);
    const b = JSON.stringify(results, null, 2);
    if (a === b) {
      console.log(`IDENTICAL ✔ — all ${Object.keys(results).length} getCycleSummary responses unchanged after refactor`);
    } else {
      console.log('DIFFERENT ✗ — getCycleSummary output changed. Details:');
      for (const k of Object.keys(results)) {
        const x = JSON.stringify(before[k]);
        const y = JSON.stringify(results[k]);
        if (x !== y) { console.log(`\n--- ${k} ---\nBEFORE: ${x}\nAFTER:  ${y}`); }
      }
      process.exit(1);
    }
  }
}

main().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
