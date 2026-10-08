/**
 * @file seed-document-templates.mjs
 * @description Seeds standard corporate document templates across all active tenants.
 * Can be run via: node prisma/seed-document-templates.mjs
 */

import { PrismaClient } from '@prisma/client';
import { DEFAULT_BLUEPRINTS } from '../src/services/documentTemplate.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting document templates seeder...');

  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, companyName: true },
  });

  console.log(`Found ${tenants.length} active tenants.`);

  let createdCount = 0;

  for (const tenant of tenants) {
    for (const [docType, blueprint] of Object.entries(DEFAULT_BLUEPRINTS)) {
      const existing = await prisma.documentTemplate.findFirst({
        where: {
          tenantId: tenant.id,
          documentType: docType,
        },
      });

      if (!existing) {
        await prisma.documentTemplate.create({
          data: {
            tenantId: tenant.id,
            name: `${blueprint.name}`,
            slug: `${blueprint.slug}-${tenant.id.slice(0, 5)}`,
            documentType: docType,
            description: blueprint.description,
            htmlTemplate: blueprint.htmlTemplate,
            headerHtml: blueprint.headerHtml,
            footerHtml: blueprint.footerHtml,
            layoutSettings: blueprint.layoutSettings,
            isDefault: true,
            isLocked: false,
            version: 1,
            publishedAt: new Date(),
            publishedBy: 'system',
            createdBy: 'system',
            versions: {
              create: {
                version: 1,
                htmlTemplate: blueprint.htmlTemplate,
                headerHtml: blueprint.headerHtml,
                footerHtml: blueprint.footerHtml,
                layoutSettings: blueprint.layoutSettings,
                changeNote: 'Default enterprise platform template',
                publishedBy: 'system',
              },
            },
          },
        });
        createdCount++;
      }
    }
  }

  console.log(`✅ Seed complete! Created ${createdCount} template records.`);
}

main()
  .catch((e) => {
    console.error('❌ Seeder error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
