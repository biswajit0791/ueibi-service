/**
 * @file documentTemplate.service.js
 * @description Document Template Management and Versioning Service.
 * Handles template authoring, cloning, version snapshots, default assignments,
 * and built-in enterprise default template blueprints.
 */

import { prisma } from '../lib/prisma.js';

/**
 * Built-in default HTML blueprints for each document type.
 */
export const DEFAULT_BLUEPRINTS = {
  RELIEVING_LETTER: {
    name: 'Standard Relieving Letter',
    slug: 'standard-relieving-letter',
    documentType: 'RELIEVING_LETTER',
    description: 'Formal letter certifying employee separation, acceptance of resignation, and asset return.',
    layoutSettings: {
      paperSize: 'A4',
      orientation: 'PORTRAIT',
      pageMargin: 20,
      primaryBrand: '#0f172a',
      fontFamily: 'Helvetica',
      showWatermark: false,
    },
    headerHtml: `
<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 15px;">
  <div>
    <h2 style="margin: 0; color: #0f172a; font-size: 22px;">{{companyName}}</h2>
    <p style="margin: 3px 0 0; color: #64748b; font-size: 12px;">{{companyAddress}}</p>
  </div>
  <div style="text-align: right; color: #475569; font-size: 12px;">
    <strong>Human Resources Department</strong><br/>
    {{companyEmail}}
  </div>
</div>
    `.trim(),
    htmlTemplate: `
<div style="text-align: center; margin: 25px 0 20px;">
  <h3 style="margin: 0; text-transform: uppercase; letter-spacing: 2px; color: #0f172a; font-size: 18px;">RELIEVING LETTER</h3>
</div>

<div style="display: flex; justify-content: space-between; margin-bottom: 25px; font-size: 13px; color: #334155;">
  <div><strong>Ref No:</strong> {{refNumber}}</div>
  <div><strong>Date:</strong> {{issueDate}}</div>
</div>

<p><strong>Dear {{employeeName}},</strong></p>

<p>This is to certify that you were employed with <strong>{{companyName}}</strong> as a <strong>"{{designation}}"</strong> in the <strong>{{department}}</strong> department from <strong>{{joinDate}}</strong> to <strong>{{lastWorkingDay}}</strong>.</p>

<p>Your resignation dated <strong>{{resignationDate}}</strong> has been formally accepted by the management, and you are hereby relieved from your official duties and employment with effect from the close of business hours on <strong>{{lastWorkingDay}}</strong>.</p>

<p>During your tenure of <strong>{{tenure}}</strong> with our organization, you have performed your responsibilities with dedication and completed all clearance formalities. All company assets, access credentials, and records in your possession have been returned in satisfactory condition.</p>

<p>We take this opportunity to appreciate your valuable contributions during your service with us and wish you the very best in all your future professional endeavors.</p>

<div style="margin-top: 45px;">
  <p style="margin-bottom: 35px;">Yours sincerely,</p>
  <p style="margin: 0; font-weight: bold; color: #0f172a;">{{authorizedSignatory}}</p>
  <p style="margin: 2px 0 0; color: #475569; font-size: 13px;">{{signatoryDesignation}}</p>
  <p style="margin: 2px 0 0; color: #475569; font-size: 13px;">{{companyName}}</p>
</div>
    `.trim(),
    footerHtml: `
<div style="border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #94a3b8; text-align: center;">
  This is a computer-generated official document issued via UEIBI Platform. No physical signature required.
</div>
    `.trim(),
  },

  TERMINATION_LETTER: {
    name: 'Standard Termination Letter',
    slug: 'standard-termination-letter',
    documentType: 'TERMINATION_LETTER',
    description: 'Formal termination of employment letter with exit terms and clearance instructions.',
    layoutSettings: {
      paperSize: 'A4',
      orientation: 'PORTRAIT',
      pageMargin: 20,
      primaryBrand: '#991b1b',
      fontFamily: 'Helvetica',
      showWatermark: false,
    },
    headerHtml: `
<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #991b1b; padding-bottom: 15px;">
  <div>
    <h2 style="margin: 0; color: #0f172a; font-size: 22px;">{{companyName}}</h2>
    <p style="margin: 3px 0 0; color: #64748b; font-size: 12px;">{{companyAddress}}</p>
  </div>
  <div style="text-align: right; color: #475569; font-size: 12px;">
    <strong>Human Resources Division</strong>
  </div>
</div>
    `.trim(),
    htmlTemplate: `
<div style="text-align: center; margin: 25px 0 20px;">
  <h3 style="margin: 0; text-transform: uppercase; letter-spacing: 2px; color: #991b1b; font-size: 18px;">LETTER OF TERMINATION</h3>
</div>

<div style="display: flex; justify-content: space-between; margin-bottom: 25px; font-size: 13px; color: #334155;">
  <div><strong>Ref No:</strong> {{refNumber}}</div>
  <div><strong>Date:</strong> {{issueDate}}</div>
</div>

<p><strong>Dear {{employeeName}},</strong> (Employee ID: {{employeeId}})</p>

<p>This letter serves as formal notification that your employment with <strong>{{companyName}}</strong> in the role of <strong>{{designation}}</strong> is being terminated effective <strong>{{lastWorkingDay}}</strong>.</p>

<p>Reason for separation: <strong>{{exitReason}}</strong>.</p>

<p>In accordance with your employment agreement and organizational policy, your notice period of <strong>{{noticePeriod}}</strong> will be accounted for in your full and final settlement statement. You are requested to hand over all company property, equipment, identification badges, and confidential documents to your reporting manager before your departure on <strong>{{lastWorkingDay}}</strong>.</p>

<p>Your full and final settlement, including any encashment and statutory dues, will be processed and disbursed as per standard payroll timelines following satisfactory completion of departmental clearance.</p>

<p>We wish you well in your future pursuits.</p>

<div style="margin-top: 45px;">
  <p style="margin-bottom: 35px;">For {{companyName}},</p>
  <p style="margin: 0; font-weight: bold; color: #0f172a;">{{authorizedSignatory}}</p>
  <p style="margin: 2px 0 0; color: #475569; font-size: 13px;">{{signatoryDesignation}}</p>
</div>
    `.trim(),
    footerHtml: `
<div style="border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #94a3b8; text-align: center;">
  Confidential & Proprietary — {{companyName}}
</div>
    `.trim(),
  },

  SERVICE_CERTIFICATE: {
    name: 'Service Certificate & Experience Letter',
    slug: 'standard-service-certificate',
    documentType: 'SERVICE_CERTIFICATE',
    description: 'Official service certificate with designation, tenure, conduct rating, and performance assessment.',
    layoutSettings: {
      paperSize: 'A4',
      orientation: 'PORTRAIT',
      pageMargin: 20,
      primaryBrand: '#0369a1',
      fontFamily: 'Helvetica',
      showWatermark: false,
    },
    headerHtml: `
<div style="text-align: center; border-bottom: 2px solid #0369a1; padding-bottom: 16px;">
  <h2 style="margin: 0; color: #0369a1; font-size: 24px; text-transform: uppercase;">{{companyName}}</h2>
  <p style="margin: 4px 0 0; color: #64748b; font-size: 12px;">{{companyAddress}}</p>
</div>
    `.trim(),
    htmlTemplate: `
<div style="text-align: center; margin: 30px 0 25px;">
  <h3 style="margin: 0; text-transform: uppercase; letter-spacing: 2px; color: #0369a1; font-size: 19px;">CERTIFICATE OF SERVICE</h3>
  <p style="margin: 6px 0 0; color: #64748b; font-size: 13px; font-style: italic;">TO WHOMSOEVER IT MAY CONCERN</p>
</div>

<div style="display: flex; justify-content: space-between; margin-bottom: 25px; font-size: 13px; color: #334155;">
  <div><strong>Ref:</strong> {{refNumber}}</div>
  <div><strong>Date:</strong> {{issueDate}}</div>
</div>

<p>This is to certify that <strong>{{employeeName}}</strong> (Employee ID: <strong>{{employeeId}}</strong>) was a bona fide employee of <strong>{{companyName}}</strong> from <strong>{{joinDate}}</strong> to <strong>{{lastWorkingDay}}</strong>, serving for a total tenure of <strong>{{tenure}}</strong>.</p>

<p>During their employment, they held the designation of <strong>{{designation}}</strong> within the <strong>{{department}}</strong> department.</p>

<table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 13px;">
  <tr style="background: #f8fafc;">
    <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; width: 40%;">Professional Conduct:</td>
    <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #0f172a;">{{conductValue}}</td>
  </tr>
  <tr>
    <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Technical Competence:</td>
    <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #0f172a;">{{techRating}}</td>
  </tr>
  <tr style="background: #f8fafc;">
    <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Work Attitude & Integrity:</td>
    <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #0f172a;">{{attitudeRating}}</td>
  </tr>
</table>

<p>During the period of service with us, {{employeeName}} was found to be honest, hardworking, and professionally diligent. We have no objection to them seeking employment elsewhere.</p>

<p>We wish them great success in their career.</p>

<div style="margin-top: 50px;">
  <p style="margin-bottom: 35px;">For {{companyName}},</p>
  <p style="margin: 0; font-weight: bold; color: #0f172a;">{{authorizedSignatory}}</p>
  <p style="margin: 2px 0 0; color: #475569; font-size: 13px;">{{signatoryDesignation}}</p>
</div>
    `.trim(),
    footerHtml: `
<div style="border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #94a3b8; text-align: center;">
  Certified official certificate issued via UEIBI System.
</div>
    `.trim(),
  },

  REFERENCE_CHECK: {
    name: 'Reference Check & Verified Profile Dossier',
    slug: 'standard-reference-check',
    documentType: 'REFERENCE_CHECK',
    description: 'Comprehensive employee profile dossier for new employer verification and reference checks.',
    layoutSettings: {
      paperSize: 'A4',
      orientation: 'PORTRAIT',
      pageMargin: 20,
      primaryBrand: '#1e1b4b',
      fontFamily: 'Helvetica',
      showWatermark: false,
    },
    headerHtml: `
<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e1b4b; padding-bottom: 14px;">
  <div>
    <h2 style="margin: 0; color: #1e1b4b; font-size: 22px;">{{companyName}}</h2>
    <p style="margin: 2px 0 0; color: #64748b; font-size: 12px;">Verified Background & Credentials Dossier</p>
  </div>
  <div style="text-align: right; color: #1e1b4b; font-size: 13px; font-weight: bold;">
    UEIBI VERIFIED
  </div>
</div>
    `.trim(),
    htmlTemplate: `
<div style="text-align: center; margin: 25px 0 20px;">
  <h3 style="margin: 0; text-transform: uppercase; letter-spacing: 1.5px; color: #1e1b4b; font-size: 18px;">EMPLOYMENT VERIFICATION DOSSIER</h3>
  <p style="margin: 4px 0 0; color: #64748b; font-size: 12px;">CONFIDENTIAL EMPLOYMENT RECORD</p>
</div>

<div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 13px; color: #334155;">
  <div><strong>Verification Ref:</strong> {{refNumber}}</div>
  <div><strong>Verified On:</strong> {{issueDate}}</div>
</div>

<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;">
  <tr style="background: #f1f5f9;">
    <th colspan="2" style="padding: 10px 14px; text-align: left; border: 1px solid #cbd5e1; color: #0f172a;">1. Candidate Identity & Tenure</th>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; width: 40%; font-weight: bold;">Candidate Name:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{employeeName}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Employee ID:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{employeeId}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">PAN (Masked):</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{pan}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Designation / Title:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{designation}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Department:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{department}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Tenure:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{joinDate}} to {{lastWorkingDay}} ({{tenure}})</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Separation Reason:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{exitReason}}</td>
  </tr>
</table>

<table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 13px;">
  <tr style="background: #f1f5f9;">
    <th colspan="2" style="padding: 10px 14px; text-align: left; border: 1px solid #cbd5e1; color: #0f172a;">2. Verification Ratings & Assessment</th>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; width: 40%; font-weight: bold;">Conduct Rating:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{conductValue}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Technical Competence:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{techRating}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Work Attitude:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{attitudeRating}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-weight: bold;">Exit Remarks / Feedback:</td>
    <td style="padding: 8px 14px; border: 1px solid #e2e8f0;">{{feedbackRemarks}}</td>
  </tr>
</table>

<div style="margin-top: 40px; display: flex; justify-content: space-between;">
  <div>
    <p style="margin: 0; font-weight: bold;">Verified By:</p>
    <p style="margin: 2px 0 0; color: #475569;">{{authorizedSignatory}}</p>
    <p style="margin: 2px 0 0; color: #475569; font-size: 12px;">{{signatoryDesignation}}</p>
  </div>
  <div style="text-align: right;">
    <p style="margin: 0; font-weight: bold;">Issuing Entity:</p>
    <p style="margin: 2px 0 0; color: #475569;">{{companyName}}</p>
    <p style="margin: 2px 0 0; color: #475569; font-size: 12px;">Via UEIBI Verification Network</p>
  </div>
</div>
    `.trim(),
    footerHtml: `
<div style="border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #94a3b8; text-align: center;">
  This record has been authenticated against registered UEIBI payroll & HR databases.
</div>
    `.trim(),
  },
};

/**
 * List templates for a tenant, with optional filters.
 */
export async function getTemplatesByTenant({
  tenantId,
  documentType,
  search,
  isActive,
}) {
  const where = { tenantId };

  if (documentType) where.documentType = documentType;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  return prisma.documentTemplate.findMany({
    where,
    orderBy: [
      { isDefault: 'desc' },
      { updatedAt: 'desc' },
    ],
    include: {
      _count: { select: { versions: true, generatedDocs: true } },
    },
  });
}

/**
 * Find or fallback to default template for a document type.
 */
export async function getDefaultTemplate({ tenantId, documentType }) {
  // 1. Try finding tenant's default
  const defaultTpl = await prisma.documentTemplate.findFirst({
    where: {
      tenantId,
      documentType,
      isDefault: true,
      isActive: true,
    },
  });

  if (defaultTpl) return defaultTpl;

  // 2. Try any active template of this type
  const anyTpl = await prisma.documentTemplate.findFirst({
    where: {
      tenantId,
      documentType,
      isActive: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (anyTpl) return anyTpl;

  // 3. Fallback to built-in blueprint
  const blueprint = DEFAULT_BLUEPRINTS[documentType];
  if (blueprint) {
    return {
      id: `blueprint-${documentType.toLowerCase()}`,
      tenantId,
      ...blueprint,
      isDefault: true,
      isActive: true,
      isLocked: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return null;
}

/**
 * Get a specific template by ID.
 */
export async function getTemplateById({ id, tenantId }) {
  return prisma.documentTemplate.findFirst({
    where: { id, tenantId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 10,
      },
      _count: {
        select: { generatedDocs: true },
      },
    },
  });
}

/**
 * Create a new document template.
 */
export async function createTemplate({ tenantId, data, userId }) {
  const {
    name,
    slug: rawSlug,
    documentType,
    description,
    htmlTemplate,
    cssStyles,
    headerHtml,
    footerHtml,
    layoutSettings,
    logoUrl,
    watermarkUrl,
    signatureUrl,
    isDefault,
  } = data;

  const baseSlug = rawSlug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let slug = baseSlug;

  // Ensure unique slug within tenant
  const existing = await prisma.documentTemplate.findFirst({
    where: { tenantId, slug },
  });
  if (existing) {
    slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
  }

  // If set to default, unset other defaults for this documentType
  if (isDefault) {
    await prisma.documentTemplate.updateMany({
      where: { tenantId, documentType, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.documentTemplate.create({
      data: {
        tenantId,
        name,
        slug,
        documentType,
        description,
        htmlTemplate,
        cssStyles: cssStyles || '',
        headerHtml: headerHtml || '',
        footerHtml: footerHtml || '',
        layoutSettings: layoutSettings || {},
        logoUrl,
        watermarkUrl,
        signatureUrl,
        isDefault: Boolean(isDefault),
        version: 1,
        publishedAt: new Date(),
        publishedBy: userId,
        createdBy: userId,
      },
    });

    // Create initial version snapshot
    await tx.documentTemplateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        htmlTemplate,
        cssStyles: cssStyles || '',
        headerHtml: headerHtml || '',
        footerHtml: footerHtml || '',
        layoutSettings: layoutSettings || {},
        logoUrl,
        changeNote: 'Initial template creation',
        publishedBy: userId,
      },
    });

    return template;
  });
}

/**
 * Update template draft / contents.
 */
export async function updateTemplate({ id, tenantId, data, userId }) {
  const existing = await prisma.documentTemplate.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new Error('Template not found');
  }

  if (existing.isLocked) {
    throw new Error('Platform locked templates cannot be directly modified. Clone to create a custom version.');
  }

  if (data.isDefault) {
    await prisma.documentTemplate.updateMany({
      where: {
        tenantId,
        documentType: existing.documentType,
        id: { not: id },
        isDefault: true,
      },
      data: { isDefault: false },
    });
  }

  return prisma.documentTemplate.update({
    where: { id },
    data: {
      ...data,
      updatedBy: userId,
    },
  });
}

/**
 * Publish a new version snapshot of a template.
 */
export async function publishTemplate({ id, tenantId, changeNote, userId }) {
  const tpl = await prisma.documentTemplate.findFirst({
    where: { id, tenantId },
  });

  if (!tpl) throw new Error('Template not found');

  const newVersion = tpl.version + 1;

  return prisma.$transaction(async (tx) => {
    // 1. Create version record
    await tx.documentTemplateVersion.create({
      data: {
        templateId: tpl.id,
        version: newVersion,
        htmlTemplate: tpl.htmlTemplate,
        cssStyles: tpl.cssStyles,
        headerHtml: tpl.headerHtml,
        footerHtml: tpl.footerHtml,
        layoutSettings: tpl.layoutSettings || {},
        logoUrl: tpl.logoUrl,
        changeNote: changeNote || `Published version ${newVersion}`,
        publishedBy: userId,
      },
    });

    // 2. Bump template version and published timestamp
    return tx.documentTemplate.update({
      where: { id: tpl.id },
      data: {
        version: newVersion,
        publishedAt: new Date(),
        publishedBy: userId,
        updatedBy: userId,
      },
    });
  });
}

/**
 * Clone a template into a new custom editable template.
 */
export async function cloneTemplate({ id, tenantId, newName, userId }) {
  let source = await prisma.documentTemplate.findFirst({
    where: { id },
  });

  // If not found in DB, check if it's a default blueprint
  if (!source && id.startsWith('blueprint-')) {
    const docType = id.replace('blueprint-', '').toUpperCase();
    const blueprint = DEFAULT_BLUEPRINTS[docType];
    if (blueprint) {
      source = {
        ...blueprint,
        tenantId,
      };
    }
  }

  if (!source) throw new Error('Source template not found to clone');

  const name = newName || `${source.name} (Copy)`;
  const slug = `${source.slug}-copy-${Math.random().toString(36).substring(2, 6)}`;

  return prisma.$transaction(async (tx) => {
    const cloned = await tx.documentTemplate.create({
      data: {
        tenantId,
        name,
        slug,
        documentType: source.documentType,
        description: `Cloned from ${source.name}`,
        htmlTemplate: source.htmlTemplate,
        cssStyles: source.cssStyles || '',
        headerHtml: source.headerHtml || '',
        footerHtml: source.footerHtml || '',
        layoutSettings: source.layoutSettings || {},
        logoUrl: source.logoUrl,
        watermarkUrl: source.watermarkUrl,
        signatureUrl: source.signatureUrl,
        isDefault: false,
        isLocked: false,
        version: 1,
        publishedAt: new Date(),
        publishedBy: userId,
        createdBy: userId,
      },
    });

    await tx.documentTemplateVersion.create({
      data: {
        templateId: cloned.id,
        version: 1,
        htmlTemplate: source.htmlTemplate,
        cssStyles: source.cssStyles || '',
        headerHtml: source.headerHtml || '',
        footerHtml: source.footerHtml || '',
        layoutSettings: source.layoutSettings || {},
        logoUrl: source.logoUrl,
        changeNote: `Cloned from ${source.name}`,
        publishedBy: userId,
      },
    });

    return cloned;
  });
}

/**
 * Delete a template.
 */
export async function deleteTemplate({ id, tenantId }) {
  const tpl = await prisma.documentTemplate.findFirst({
    where: { id, tenantId },
  });

  if (!tpl) throw new Error('Template not found');
  if (tpl.isLocked) throw new Error('Platform locked templates cannot be deleted');

  return prisma.documentTemplate.delete({
    where: { id },
  });
}

/**
 * Set a template as the default for its document type.
 */
export async function setDefaultTemplate({ id, tenantId }) {
  const tpl = await prisma.documentTemplate.findFirst({
    where: { id, tenantId },
  });

  if (!tpl) throw new Error('Template not found');

  return prisma.$transaction(async (tx) => {
    await tx.documentTemplate.updateMany({
      where: {
        tenantId,
        documentType: tpl.documentType,
        id: { not: id },
        isDefault: true,
      },
      data: { isDefault: false },
    });

    return tx.documentTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
  });
}

/**
 * Roll back template to a previous version snapshot.
 */
export async function rollbackTemplateVersion({ templateId, versionNumber, tenantId, userId }) {
  const tpl = await prisma.documentTemplate.findFirst({
    where: { id: templateId, tenantId },
  });

  if (!tpl) throw new Error('Template not found');

  const targetVersion = await prisma.documentTemplateVersion.findFirst({
    where: { templateId, version: Number(versionNumber) },
  });

  if (!targetVersion) throw new Error(`Version ${versionNumber} not found`);

  return updateTemplate({
    id: templateId,
    tenantId,
    data: {
      htmlTemplate: targetVersion.htmlTemplate,
      cssStyles: targetVersion.cssStyles,
      headerHtml: targetVersion.headerHtml,
      footerHtml: targetVersion.footerHtml,
      layoutSettings: targetVersion.layoutSettings,
      logoUrl: targetVersion.logoUrl,
    },
    userId,
  });
}
