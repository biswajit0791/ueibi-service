/**
 * @file documentToken.service.js
 * @description Central Token Registry and Resolution Engine for Dynamic Document Templates.
 * Provides platform-wide token metadata, sample data for previews, and dynamically resolves
 * employee, tenant, exit, and rating tokens from the database.
 */

import { prisma } from '../lib/prisma.js';

/**
 * Standard formatters for dynamic tokens.
 */
export const FORMATTERS = {
  date: (val) => {
    if (!val) return '';
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  },
  shortDate: (val) => {
    if (!val) return '';
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  },
  maskedPan: (val) => {
    if (!val) return '';
    const s = String(val).trim();
    if (s.length < 5) return 'XXXXX';
    return `${'X'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
  },
  currency: (val) => {
    if (val === undefined || val === null || val === '') return '';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
  tenure: (start, end) => {
    if (!start || !end) return '';
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    const years = Math.floor(months / 12);
    const remainingMonths = Math.max(0, months % 12);
    if (years > 0 && remainingMonths > 0) return `${years} year(s) and ${remainingMonths} month(s)`;
    if (years > 0) return `${years} year(s)`;
    return `${remainingMonths} month(s)`;
  },
  uppercase: (val) => (val ? String(val).toUpperCase() : ''),
  lowercase: (val) => (val ? String(val).toLowerCase() : ''),
  capitalize: (val) => (val ? String(val).replace(/\b\w/g, (c) => c.toUpperCase()) : ''),
};

/**
 * Platform-wide tokens available to all document types and tenants.
 */
export const PLATFORM_TOKENS = [
  // ── Employee Details ──
  {
    group: 'Employee',
    token: 'employeeName',
    label: 'Employee Full Name',
    description: 'Full name of the employee as registered in UEIBI',
    dataSource: 'employee.name',
    sampleValue: 'Rahul Swain',
    isRequired: true,
  },
  {
    group: 'Employee',
    token: 'employeeId',
    label: 'Employee ID / Code',
    description: 'Official organization employee code or ID',
    dataSource: 'employee.employeeId',
    sampleValue: 'EMP-042',
    isRequired: false,
  },
  {
    group: 'Employee',
    token: 'designation',
    label: 'Designation / Role',
    description: 'Job role or designation title',
    dataSource: 'employee.designation',
    sampleValue: 'Senior Software Engineer',
    isRequired: true,
  },
  {
    group: 'Employee',
    token: 'department',
    label: 'Department',
    description: 'Department or business unit name',
    dataSource: 'employee.department',
    sampleValue: 'Engineering',
    isRequired: false,
  },
  {
    group: 'Employee',
    token: 'email',
    label: 'Employee Work Email',
    description: 'Corporate email address',
    dataSource: 'employee.email',
    sampleValue: 'rahul.swain@company.com',
    isRequired: false,
  },
  {
    group: 'Employee',
    token: 'phone',
    label: 'Contact Number',
    description: 'Registered contact phone number',
    dataSource: 'employee.phone',
    sampleValue: '+91 98765 43210',
    isRequired: false,
  },
  {
    group: 'Employee',
    token: 'joinDate',
    label: 'Date of Joining',
    description: 'Formatted start date with company',
    dataSource: 'employee.joinDate',
    formatter: 'date',
    sampleValue: '15 March 2022',
    isRequired: true,
  },
  {
    group: 'Employee',
    token: 'pan',
    label: 'PAN (Masked)',
    description: 'Masked Permanent Account Number for verification',
    dataSource: 'employee.pan',
    formatter: 'maskedPan',
    sampleValue: 'XXXXXX1234',
    isRequired: false,
  },

  // ── Company Details ──
  {
    group: 'Company',
    token: 'companyName',
    label: 'Company Name',
    description: 'Registered business/organization name',
    dataSource: 'tenant.companyName',
    sampleValue: 'Acme Technologies Pvt Ltd',
    isRequired: true,
  },
  {
    group: 'Company',
    token: 'companyLogo',
    label: 'Company Logo URL',
    description: 'Direct URL to company branding logo image',
    dataSource: 'tenant.logoUrl',
    sampleValue: 'https://placehold.co/180x60/png?text=Acme+Logo',
    isRequired: false,
  },
  {
    group: 'Company',
    token: 'companyAddress',
    label: 'Company Registered Address',
    description: 'Physical or registered office address',
    dataSource: 'tenant.address',
    sampleValue: 'Plot 42, Tech Park Avenue, Cyber City, Hyderabad - 500081',
    isRequired: false,
  },
  {
    group: 'Company',
    token: 'companyEmail',
    label: 'Company HR / Contact Email',
    description: 'Official contact or support email',
    dataSource: 'tenant.email',
    sampleValue: 'hr@acmetech.com',
    isRequired: false,
  },
  {
    group: 'Company',
    token: 'companyWebsite',
    label: 'Company Website',
    description: 'Corporate website URL',
    dataSource: 'tenant.website',
    sampleValue: 'www.acmetech.com',
    isRequired: false,
  },

  // ── Exit & Separation ──
  {
    group: 'Exit',
    token: 'resignationDate',
    label: 'Resignation / Notice Date',
    description: 'Date resignation was submitted or notice served',
    dataSource: 'exit.resignationDate',
    formatter: 'date',
    sampleValue: '10 September 2026',
    isRequired: false,
  },
  {
    group: 'Exit',
    token: 'lastWorkingDay',
    label: 'Last Working Day',
    description: 'Official final date of employment',
    dataSource: 'exit.lastWorkingDay',
    formatter: 'date',
    sampleValue: '08 October 2026',
    isRequired: true,
  },
  {
    group: 'Exit',
    token: 'exitReason',
    label: 'Reason for Separation',
    description: 'Stated separation reason (Resignation, Better Opportunity, etc.)',
    dataSource: 'exit.exitReason',
    sampleValue: 'Resignation - Career Advancement',
    isRequired: false,
  },
  {
    group: 'Exit',
    token: 'noticePeriod',
    label: 'Notice Period Duration',
    description: 'Standard or served notice period',
    dataSource: 'exit.noticePeriodDays',
    sampleValue: '30 Days',
    isRequired: false,
  },
  {
    group: 'Exit',
    token: 'tenure',
    label: 'Total Service Tenure',
    description: 'Computed duration of service (years and months)',
    dataSource: 'computed.tenure',
    sampleValue: '4 year(s) and 6 month(s)',
    isRequired: false,
  },

  // ── Performance & Conduct ──
  {
    group: 'Performance',
    token: 'conductValue',
    label: 'Conduct & Character',
    description: 'Assessment of professional conduct (e.g. Good, Satisfactory)',
    dataSource: 'exRecord.conductValue',
    sampleValue: 'Good and Professional',
    isRequired: false,
  },
  {
    group: 'Performance',
    token: 'techRating',
    label: 'Technical Capability Rating',
    description: 'Overall technical competence score (/10)',
    dataSource: 'exRecord.techRating',
    sampleValue: '9/10',
    isRequired: false,
  },
  {
    group: 'Performance',
    token: 'attitudeRating',
    label: 'Work Attitude Rating',
    description: 'Collaboration and attitude score (/10)',
    dataSource: 'exRecord.attitudeRating',
    sampleValue: '9/10',
    isRequired: false,
  },
  {
    group: 'Performance',
    token: 'feedbackRemarks',
    label: 'Exit Remarks / Feedback',
    description: 'Summary remarks from HR exit interview',
    dataSource: 'exit.feedbackRemarks',
    sampleValue: 'Rahul has been an integral contributor to our team. We wish him the best in his future endeavors.',
    isRequired: false,
  },

  // ── Document Metadata ──
  {
    group: 'Document',
    token: 'refNumber',
    label: 'Reference / Dispatch Number',
    description: 'Unique document reference sequence number',
    dataSource: 'computed.refNumber',
    sampleValue: 'UEIBI/DOC/2026/A9B4C2',
    isRequired: false,
  },
  {
    group: 'Document',
    token: 'issueDate',
    label: 'Date of Issue',
    description: 'Formatted date of document generation/dispatch',
    dataSource: 'computed.today',
    formatter: 'date',
    sampleValue: '08 October 2026',
    isRequired: true,
  },
  {
    group: 'Document',
    token: 'currentYear',
    label: 'Current Year',
    description: 'Four-digit current calendar year',
    dataSource: 'computed.year',
    sampleValue: '2026',
    isRequired: false,
  },
  {
    group: 'Document',
    token: 'authorizedSignatory',
    label: 'Authorized Signatory Name',
    description: 'Name of the HR Manager or Executive signing the document',
    dataSource: 'generator.name',
    sampleValue: 'Priya Sharma',
    isRequired: false,
  },
  {
    group: 'Document',
    token: 'signatoryDesignation',
    label: 'Authorized Signatory Title',
    description: 'Job title of the signatory',
    dataSource: 'generator.designation',
    sampleValue: 'Head of Human Resources',
    isRequired: false,
  },

  // ── Conditional Sections ──
  {
    group: 'Conditions',
    token: '#isTerminated',
    label: 'Conditional: If Terminated',
    description: 'Renders content only if the separation was a termination',
    dataSource: 'computed.isTerminated',
    sampleValue: 'true',
    isRequired: false,
  },
  {
    group: 'Conditions',
    token: '#isResigned',
    label: 'Conditional: If Resigned',
    description: 'Renders content only if the employee resigned',
    dataSource: 'computed.isResigned',
    sampleValue: 'true',
    isRequired: false,
  },
  {
    group: 'Conditions',
    token: '#hasRatings',
    label: 'Conditional: If Ratings Exist',
    description: 'Renders ratings block only if performance ratings were recorded',
    dataSource: 'computed.hasRatings',
    sampleValue: 'true',
    isRequired: false,
  },
];

/**
 * Get all available tokens for a specific tenant and document type.
 * Merges platform-seeded tokens with tenant custom tokens.
 */
export async function getAvailableTokens({ tenantId, documentType } = {}) {
  // Query custom tokens for this tenant if tenantId is provided
  let customTokens = [];
  if (tenantId) {
    try {
      customTokens = await prisma.documentToken.findMany({
        where: {
          tenantId,
          OR: [
            { documentType: null },
            ...(documentType ? [{ documentType }] : []),
          ],
        },
        orderBy: { sortOrder: 'asc' },
      });
    } catch {
      // Table may not exist yet or no tokens
      customTokens = [];
    }
  }

  // Filter platform tokens by documentType if needed
  const platformList = PLATFORM_TOKENS.map((t) => ({
    ...t,
    isCustom: false,
  }));

  const customList = customTokens.map((t) => ({
    group: t.group || 'Custom',
    token: t.token,
    label: t.label,
    description: t.description || '',
    dataSource: t.dataSource,
    sampleValue: t.sampleValue || '',
    formatter: t.formatter || null,
    isRequired: Boolean(t.isRequired),
    isCustom: true,
  }));

  return [...platformList, ...customList];
}

/**
 * Generate a complete sample token dictionary for template previewing.
 */
export async function getSampleTokenView({ tenantId, documentType } = {}) {
  const tokens = await getAvailableTokens({ tenantId, documentType });
  const view = {};

  for (const t of tokens) {
    let raw = t.sampleValue;
    if (t.formatter && FORMATTERS[t.formatter]) {
      raw = FORMATTERS[t.formatter](raw);
    }
    view[t.token] = raw;
  }

  // Pre-seed boolean flags for conditionals
  view.isTerminated = documentType === 'TERMINATION_LETTER';
  view.isResigned = documentType !== 'TERMINATION_LETTER';
  view.hasRatings = true;
  view.hasWorkHistory = true;

  return view;
}

/**
 * Resolves live data from DB for an employee, exit record, and tenant.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} [params.employeeId] - tenantUser ID
 * @param {string} [params.exitDetailsId] - ExitDetails ID
 * @param {Object} [params.currentUser] - Authenticated user triggering generation
 * @param {string} [params.documentType]
 * @returns {Promise<Object>} resolved token dictionary ready for Mustache
 */
export async function resolveTokensForEmployee({
  tenantId,
  employeeId,
  exitDetailsId,
  currentUser,
  documentType,
}) {
  let employee = null;
  let exitDetails = null;
  let exRecord = null;
  let tenant = null;

  // 1. Fetch Tenant branding & details
  if (tenantId) {
    tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        companyName: true,
        logoUrl: true,
        address: true,
        email: true,
        website: true,
      },
    });
  }

  // 2. Fetch Exit Details if provided
  if (exitDetailsId) {
    exitDetails = await prisma.exitDetails.findFirst({
      where: { id: exitDetailsId, tenantId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            employeeId: true,
            designation: true,
            department: true,
            joinDate: true,
            pan: true,
            phone: true,
          },
        },
      },
    });

    if (exitDetails?.user) {
      employee = exitDetails.user;
    }
  }

  // 3. If employeeId provided and not yet resolved
  if (employeeId && !employee) {
    employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        employeeId: true,
        designation: true,
        department: true,
        joinDate: true,
        pan: true,
        phone: true,
      },
    });
  }

  // 4. Fetch ExEmployeeRecord ratings if available
  if (employee?.email) {
    exRecord = await prisma.exEmployeeRecord.findFirst({
      where: { email: employee.email, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  const today = new Date();
  const joinDate = employee?.joinDate || exitDetails?.resignationDate || today;
  const lastWorkingDay = exitDetails?.lastWorkingDay || today;

  const isTerminated =
    documentType === 'TERMINATION_LETTER' ||
    String(exitDetails?.exitReason || '').toLowerCase().includes('terminat');

  const refSeq = Math.random().toString(36).substring(2, 8).toUpperCase();
  const refNumber = `UEIBI/${documentType ? documentType.slice(0, 3) : 'DOC'}/${today.getFullYear()}/${refSeq}`;

  // Assemble resolved token view
  const view = {
    // Employee
    employeeName: employee?.name || 'Employee Name',
    employeeId: employee?.employeeId || employee?.id || 'EMP-001',
    designation: employee?.designation || 'Team Member',
    department: employee?.department || 'General',
    email: employee?.email || '',
    phone: employee?.phone || '',
    joinDate: FORMATTERS.date(joinDate),
    pan: FORMATTERS.maskedPan(employee?.pan || exRecord?.pan || ''),

    // Company
    companyName: tenant?.companyName || 'UEIBI Organization',
    companyLogo: tenant?.logoUrl || '',
    companyAddress: tenant?.address || '',
    companyEmail: tenant?.email || '',
    companyWebsite: tenant?.website || '',

    // Exit
    resignationDate: exitDetails?.resignationDate
      ? FORMATTERS.date(exitDetails.resignationDate)
      : FORMATTERS.date(today),
    lastWorkingDay: FORMATTERS.date(lastWorkingDay),
    exitReason: exitDetails?.exitReason || 'Completion of Service',
    noticePeriod: `${exitDetails?.noticePeriodDays || 30} Days`,
    tenure: FORMATTERS.tenure(joinDate, lastWorkingDay),

    // Performance
    conductValue: exRecord?.conductValue || 'Good',
    techRating: exRecord?.techRating ? `${exRecord.techRating}/10` : '8/10',
    attitudeRating: exRecord?.attitudeRating ? `${exRecord.attitudeRating}/10` : '8/10',
    feedbackRemarks: exitDetails?.feedbackRemarks || exRecord?.feedback || '',

    // Document Metadata
    refNumber,
    issueDate: FORMATTERS.date(today),
    currentYear: String(today.getFullYear()),
    authorizedSignatory: currentUser?.name || 'Human Resources',
    signatoryDesignation: currentUser?.designation || 'Head of Human Resources',

    // Conditionals
    isTerminated,
    isResigned: !isTerminated,
    hasRatings: Boolean(exRecord),
    hasWorkHistory: true,
  };

  return view;
}
