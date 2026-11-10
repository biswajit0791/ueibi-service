import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const INITIAL_ORGANIZATION_STRUCTURES = [
  {
    name: 'Private Limited',
    code: 'PRIVATE_LIMITED',
    description: 'Privately held legal business entity incorporated under company law with limited liability.',
    displayOrder: 1,
    isActive: true,
  },
  {
    name: 'Public Limited',
    code: 'PUBLIC_LIMITED',
    description: 'Company that offers shares to the general public and has limited liability.',
    displayOrder: 2,
    isActive: true,
  },
  {
    name: 'LLP',
    code: 'LLP',
    description: 'Limited Liability Partnership combining benefits of partnership with limited liability.',
    displayOrder: 3,
    isActive: true,
  },
  {
    name: 'Partnership',
    code: 'PARTNERSHIP',
    description: 'Formal arrangement by two or more parties to manage and operate a business together.',
    displayOrder: 4,
    isActive: true,
  },
  {
    name: 'Proprietorship',
    code: 'PROPRIETORSHIP',
    description: 'Unincorporated business owned and run by one individual with full personal liability.',
    displayOrder: 5,
    isActive: true,
  },
  {
    name: 'Other',
    code: 'OTHER',
    description: 'Other registered entities such as Trust, Society, Section 8 Company, or Autonomous Body.',
    displayOrder: 6,
    isActive: true,
  },
];

export async function seedOrganizationStructures() {
  console.log('🏛️  Seeding initial Organization Structures...');

  for (const item of INITIAL_ORGANIZATION_STRUCTURES) {
    // Idempotent upsert by code:
    // If it exists, we DO NOT overwrite administrator edits (name, isActive, displayOrder, description)
    // We only set them on create.
    const record = await prisma.organizationStructure.upsert({
      where: { code: item.code },
      update: {},
      create: {
        name: item.name,
        code: item.code,
        description: item.description,
        displayOrder: item.displayOrder,
        isActive: item.isActive,
      },
    });
    console.log(`  ✓ [${record.code}] ${record.name} (ID: ${record.id})`);
  }

  // Safe backward-compatible backfill for existing CompanyRegistration records:
  // If an existing company has companyType matching a structure name or code,
  // link organizationStructureId if it's currently null.
  console.log('🔄 Checking existing Company Registrations for backward-compatible linking...');
  const allStructures = await prisma.organizationStructure.findMany();
  let backfilledCount = 0;

  for (const struct of allStructures) {
    const updated = await prisma.companyRegistration.updateMany({
      where: {
        organizationStructureId: null,
        OR: [
          { companyType: { equals: struct.name, mode: 'insensitive' } },
          { companyType: { equals: struct.code, mode: 'insensitive' } },
        ],
      },
      data: {
        organizationStructureId: struct.id,
      },
    });
    backfilledCount += updated.count;
  }

  console.log(`✅ Backfilled ${backfilledCount} existing company registrations with organizationStructureId.`);
  console.log('🎉 Organization Structures seed completed successfully.');
}

if (process.argv[1]?.endsWith('seed-organization-structures.js')) {
  seedOrganizationStructures()
    .catch((err) => {
      console.error('❌ Failed to seed organization structures:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

