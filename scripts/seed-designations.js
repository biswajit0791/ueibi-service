import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const INITIAL_DESIGNATIONS = [
  {
    name: 'Chairman & Managing Director',
    code: 'CHAIRMAN_MANAGING_DIRECTOR',
    description: 'Primary company officer responsible for organization registration.',
    displayOrder: 1,
    isActive: true,
    isDefault: true,
  },
  {
    name: 'Managing Director',
    code: 'MANAGING_DIRECTOR',
    description: 'Senior corporate officer and executive director of the company.',
    displayOrder: 2,
    isActive: true,
    isDefault: false,
  },
  {
    name: 'Director',
    code: 'DIRECTOR',
    description: 'Appointed member of the corporate board of directors.',
    displayOrder: 3,
    isActive: true,
    isDefault: false,
  },
  {
    name: 'Chief Executive Officer',
    code: 'CHIEF_EXECUTIVE_OFFICER',
    description: 'Highest-ranking executive officer managing company operations.',
    displayOrder: 4,
    isActive: true,
    isDefault: false,
  },
  {
    name: 'Executive Director',
    code: 'EXECUTIVE_DIRECTOR',
    description: 'Full-time executive director on the management board.',
    displayOrder: 5,
    isActive: true,
    isDefault: false,
  },
];

export async function seedDesignations() {
  console.log('🎖️  Seeding initial Corporate Designations...');

  for (const item of INITIAL_DESIGNATIONS) {
    // Idempotent upsert by unique code:
    // If it exists, do not overwrite user-customized edits (displayOrder, description, isActive)
    // Always preserve isDefault on CHAIRMAN_MANAGING_DIRECTOR if not set
    const record = await prisma.designation.upsert({
      where: { code: item.code },
      update: {},
      create: {
        name: item.name,
        code: item.code,
        description: item.description,
        displayOrder: item.displayOrder,
        isActive: item.isActive,
        isDefault: item.isDefault,
        createdBy: 'SYSTEM_SEED',
      },
    });
    console.log(`  ✓ [${record.code}] ${record.name} (Default: ${record.isDefault}, ID: ${record.id})`);
  }

  // Safe backward-compatible backfill for existing CompanyRegistration records:
  // If an existing company registration has designation matching a designation name or code or legacy abbreviation,
  // link designationId if it is currently null.
  console.log('🔄 Checking existing Company Registrations for designation linking...');
  const allDesignations = await prisma.designation.findMany();
  let backfilledCount = 0;

  for (const des of allDesignations) {
    const updated = await prisma.companyRegistration.updateMany({
      where: {
        designationId: null,
        OR: [
          { designation: { equals: des.name, mode: 'insensitive' } },
          { designation: { equals: des.code, mode: 'insensitive' } },
          ...(des.code === 'CHAIRMAN_MANAGING_DIRECTOR' ? [{ designation: { equals: 'CMD', mode: 'insensitive' } }] : []),
        ],
      },
      data: {
        designationId: des.id,
      },
    });
    backfilledCount += updated.count;
  }

  console.log(`✅ Backfilled ${backfilledCount} existing company registrations with designationId.`);
  console.log('🎉 Designation seed completed successfully.');
}

if (process.argv[1]?.endsWith('seed-designations.js')) {
  seedDesignations()
    .catch((err) => {
      console.error('❌ Error seeding designations:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
