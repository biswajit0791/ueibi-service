/**
 * seed-legal.mjs — create the User Agreement and Privacy Policy.
 *
 * The signup page has always shown "User Agreement & Privacy Policy" as plain
 * spans that went nowhere, so these documents have never existed. This creates
 * them with a workable starting draft that the platform owner then edits.
 *
 * The text below is a STARTING POINT, not legal advice. It is deliberately
 * plain and marked where it needs your details, because shipping confident
 * boilerplate that has never been read by a lawyer would be worse than shipping
 * something obviously unfinished.
 *
 * Idempotent: an existing document is left completely alone.
 *
 *   node -r dotenv/config prisma/seed-legal.mjs
 *   node -r dotenv/config prisma/seed-legal.mjs --publish   # also make live
 */
import { prisma } from '../src/lib/prisma.js';
import { sanitizeLegalHtml } from '../src/lib/sanitizeHtml.js';

const PUBLISH = process.argv.includes('--publish');

const USER_AGREEMENT = `
<h2>1. About this agreement</h2>
<p>This agreement is between UEIBI and the company registering for the service. By completing registration, the person signing confirms they are authorised to bind their organisation.</p>

<h2>2. The service</h2>
<p>UEIBI provides a hosted human resources platform covering goals, tasks, leave, appraisals, policies and related functions. Access is granted for the number of licensed users purchased.</p>

<h2>3. Licences</h2>
<p>Each active user account consumes one licence. New users cannot be created once the purchased licence count is reached. Additional licences may be purchased at any time.</p>

<h2>4. Fees and payment</h2>
<p>Fees are set out in the invoice issued at registration and are payable by the due date shown on it. All fees are exclusive of GST, which is charged at the prevailing rate.</p>

<h2>5. Your data</h2>
<p>The company retains ownership of all data it enters. UEIBI processes that data only to provide the service. Each company's data is isolated from every other company's data.</p>

<h2>6. Acceptable use</h2>
<p>The service must not be used to store unlawful content, to attempt unauthorised access, or in any way that interferes with other customers' use of the platform.</p>

<h2>7. Availability</h2>
<p>UEIBI aims to keep the service available at all times but does not guarantee uninterrupted access. Planned maintenance will be notified in advance where practicable.</p>

<h2>8. Suspension and termination</h2>
<p>Access may be suspended where fees remain unpaid or where the acceptable use provisions are breached. On termination, the company may request an export of its data.</p>

<h2>9. Limitation of liability</h2>
<p><strong>[Replace this section with wording reviewed by your legal adviser.]</strong> Liability limits materially affect your exposure and should not be taken from a template.</p>

<h2>10. Changes to these terms</h2>
<p>These terms may be amended. Amendments create a new version, and the version accepted at registration remains on record for each company.</p>

<h2>11. Governing law</h2>
<p><strong>[Specify the governing law and jurisdiction — for example, the courts of Bengaluru, India.]</strong></p>

<h2>12. Contact</h2>
<p>Questions about this agreement can be sent to <strong>[your contact email]</strong>.</p>
`;

const PRIVACY_POLICY = `
<h2>1. Who we are</h2>
<p>UEIBI operates a hosted human resources platform. This policy explains what personal data we handle and why.</p>

<h2>2. What we collect</h2>
<p>At registration we collect the company name, domain, the signatory's name, designation and email address, and the email addresses nominated for finance and HR contact.</p>
<p>Once a company is active, its administrators enter employee records. The data held depends on what that company chooses to record, and typically includes names, work email addresses, job titles, reporting lines and performance information.</p>

<h2>3. Why we hold it</h2>
<p>Personal data is processed solely to provide the service to the company that entered it — for example, to route an approval to the right manager or to show an employee their own goals.</p>

<h2>4. Who can see it</h2>
<p>A company's data is visible only to authorised users within that company. UEIBI staff can see company names, licence counts and billing records; they do not read employee records, goals, appraisals or messages.</p>

<h2>5. Where it is held</h2>
<p><strong>[State where your database and backups are hosted, and in which country.]</strong></p>

<h2>6. How long we keep it</h2>
<p><strong>[State your retention period after an account closes.]</strong> Billing records are kept for as long as tax law requires.</p>

<h2>7. Security</h2>
<p>Passwords are stored hashed and are never recoverable in plain text. Access is authenticated on every request, and each company's records are separated at the database level.</p>

<h2>8. Your rights</h2>
<p>Employees should direct requests to access, correct or delete their data to their own employer, who controls that data. UEIBI acts on the employer's instructions.</p>

<h2>9. Cookies</h2>
<p>The platform sets a session cookie to keep users signed in. No advertising or third-party tracking cookies are used.</p>

<h2>10. Changes to this policy</h2>
<p>This policy may be updated. Each update creates a new version, and the version in force when a company registered remains on record.</p>

<h2>11. Contact</h2>
<p>Privacy questions can be sent to <strong>[your privacy contact email]</strong>.</p>
`;

const DOCUMENTS = [
  {
    slug: 'user-agreement',
    title: 'User Agreement',
    description: 'The terms under which companies use UEIBI.',
    bodyHtml: USER_AGREEMENT,
  },
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    description: 'What personal data UEIBI handles, and why.',
    bodyHtml: PRIVACY_POLICY,
  },
];

async function main() {
  const owner = await prisma.tenantUser.findFirst({
    where: { role: 'PLATFORM_OWNER' },
    select: { id: true, name: true },
  });
  if (!owner) {
    console.error('\nNo PLATFORM_OWNER exists. Seed one first.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\nAuthoring as ${owner.name}\n`);

  for (const doc of DOCUMENTS) {
    const existing = await prisma.legalDocument.findUnique({
      where: { slug: doc.slug },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });

    if (existing) {
      const v = existing.versions[0];
      console.log(`  SKIP  ${doc.title.padEnd(18)} already exists`
        + (v ? ` (v${v.version}${v.publishedAt ? ', live' : ', draft'})` : ''));
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.legalDocument.create({
        data: { slug: doc.slug, title: doc.title, description: doc.description },
      });
      await tx.legalDocumentVersion.create({
        data: {
          documentSlug: doc.slug,
          version: 1,
          title: doc.title,
          // Sanitised on the way in, exactly like operator-authored content.
          bodyHtml: sanitizeLegalHtml(doc.bodyHtml),
          changeNote: 'Initial draft. Sections marked in bold still need your details.',
          authorId: owner.id,
          publishedAt: PUBLISH ? new Date() : null,
        },
      });
    });

    console.log(`  ${PUBLISH ? 'LIVE' : 'DRAFT'}  ${doc.title.padEnd(18)} /${doc.slug}`);
  }

  console.log(
    PUBLISH
      ? '\n  Both documents are live and the signup page links to them.'
      : '\n  Created as drafts. Review them in the console and publish when ready —'
        + '\n  the signup links stay disabled until a version is published.',
  );
  console.log('\n  These are a starting point, not legal advice. The sections in bold'
    + '\n  need your own details, and the liability clause needs a lawyer.\n');
}

main()
  .catch((err) => { console.error('\nFAILED:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
