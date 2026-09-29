/**
 * @file pdf.service.js
 * @description Generates Relieving Letters and Service Certificates as PDF documents.
 * Uses PDFKit for server-side PDF generation. PDFs are stored in /uploads/certificates/.
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const uploadsDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
const certDir = path.join(uploadsDir, 'certificates');

// Ensure certificates directory exists
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

/**
 * Helper: format a Date or ISO string as "DD Month YYYY"
 */
function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Helper: calculate tenure string
 */
function calcTenure(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years > 0 && remainingMonths > 0) return `${years} year(s) and ${remainingMonths} month(s)`;
  if (years > 0) return `${years} year(s)`;
  return `${remainingMonths} month(s)`;
}

/**
 * Generate a Relieving Letter PDF.
 *
 * @param {Object} data
 * @param {string} data.companyName
 * @param {string} data.employeeName
 * @param {string} data.employeeId
 * @param {string} data.designation
 * @param {string} data.department
 * @param {string|Date} data.joinDate
 * @param {string|Date} data.lastWorkingDay
 * @param {string|Date} data.resignationDate
 * @param {string} data.exitReason
 * @param {string} [data.authorizedSignatory]
 * @returns {Promise<string>} relative URL path to the generated PDF
 */
export async function generateRelievingLetter(data) {
  return new Promise((resolve, reject) => {
    const fileName = `relieving_${data.employeeId || 'emp'}_${crypto.randomBytes(4).toString('hex')}.pdf`;
    const filePath = path.join(certDir, fileName);
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // ── Header ──
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(data.companyName || 'Company Name', { align: 'center' })
      .moveDown(0.3);

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Human Resources Department', { align: 'center' })
      .moveDown(1.5);

    // Horizontal rule
    doc
      .strokeColor('#333333')
      .lineWidth(1)
      .moveTo(60, doc.y)
      .lineTo(535, doc.y)
      .stroke()
      .moveDown(1);

    // ── Title ──
    doc
      .fillColor('#000000')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('RELIEVING LETTER', { align: 'center' })
      .moveDown(0.5);

    // ── Reference & Date ──
    const refNo = `REF/RL/${new Date().getFullYear()}/${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Ref No: ${refNo}`, { align: 'left' })
      .text(`Date: ${formatDate(new Date())}`, { align: 'left' })
      .moveDown(1.5);

    // ── Body ──
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(`Dear ${data.employeeName},`, { lineGap: 4 })
      .moveDown(0.8);

    doc.text(
      `This is to certify that you were employed with ${data.companyName} as a "${data.designation || 'Member'}" ` +
      `in the ${data.department || 'General'} department from ${formatDate(data.joinDate)} to ${formatDate(data.lastWorkingDay)}.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(0.8);

    doc.text(
      `Your resignation dated ${formatDate(data.resignationDate)} has been accepted and you are hereby ` +
      `relieved from your duties effective ${formatDate(data.lastWorkingDay)}.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(0.8);

    doc.text(
      `During your tenure of ${calcTenure(data.joinDate, data.lastWorkingDay)}, you have fulfilled all ` +
      `your responsibilities and completed all necessary clearance formalities. All company assets and ` +
      `documents in your possession have been returned satisfactorily.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(0.8);

    doc.text(
      `We wish you all the best in your future endeavors.`,
      { lineGap: 4 }
    ).moveDown(2);

    // ── Signature Block ──
    doc
      .text('Yours sincerely,')
      .moveDown(2);

    doc
      .font('Helvetica-Bold')
      .text(data.authorizedSignatory || 'Authorized Signatory')
      .font('Helvetica')
      .text(data.companyName)
      .text('Human Resources Department');

    // ── Footer ──
    doc.moveDown(3);
    doc
      .fontSize(8)
      .fillColor('#999999')
      .text(
        'This is a computer-generated document. No physical signature is required.',
        { align: 'center' }
      );

    doc.end();

    stream.on('finish', () => resolve(`/uploads/certificates/${fileName}`));
    stream.on('error', reject);
  });
}

/**
 * Generate a formal Termination Letter PDF.
 *
 * @param {Object} data
 * @param {string} data.companyName
 * @param {string} data.employeeName
 * @param {string} data.employeeId
 * @param {string} data.designation
 * @param {string} data.department
 * @param {string|Date} data.joinDate
 * @param {string|Date} data.lastWorkingDay
 * @param {string} [data.exitReason]
 * @param {string} [data.authorizedSignatory]
 * @returns {Promise<string>} relative URL path to the generated PDF
 */
export async function generateTerminationLetter(data) {
  return new Promise((resolve, reject) => {
    const fileName = `termination_${data.employeeId || 'emp'}_${crypto.randomBytes(4).toString('hex')}.pdf`;
    const filePath = path.join(certDir, fileName);
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // ── Header ──
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(data.companyName || 'Company Name', { align: 'center' })
      .moveDown(0.3);

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Human Resources Department — Official Communication', { align: 'center' })
      .moveDown(1.5);

    // Horizontal rule
    doc
      .strokeColor('#dc2626')
      .lineWidth(1.5)
      .moveTo(60, doc.y)
      .lineTo(535, doc.y)
      .stroke()
      .moveDown(1);

    // ── Title ──
    doc
      .fillColor('#dc2626')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('LETTER OF TERMINATION', { align: 'center' })
      .moveDown(0.5);

    // ── Reference & Date ──
    const refNo = `REF/TL/${new Date().getFullYear()}/${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    doc
      .fillColor('#000000')
      .fontSize(10)
      .font('Helvetica')
      .text(`Ref No: ${refNo}`, { align: 'left' })
      .text(`Date of Issue: ${formatDate(new Date())}`, { align: 'left' })
      .moveDown(1.2);

    // ── Employee Address ──
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('To:')
      .font('Helvetica')
      .text(`Employee Name: ${data.employeeName}`)
      .text(`Employee ID: ${data.employeeId || 'N/A'}`)
      .text(`Designation: ${data.designation || 'Member'}`)
      .text(`Department: ${data.department || 'General'}`)
      .moveDown(1.2);

    // ── Subject ──
    doc
      .font('Helvetica-Bold')
      .text(`Subject: Notice of Termination of Employment Contract`)
      .moveDown(1);

    // ── Body ──
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .text(`Dear ${data.employeeName},`, { lineGap: 3 })
      .moveDown(0.8);

    doc.text(
      `This letter serves as formal notification that your employment with ${data.companyName} is being terminated, effective from your last working day on ${formatDate(data.lastWorkingDay)}.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(0.8);

    if (data.exitReason && data.exitReason !== 'Terminated') {
      doc.text(
        `Reason for Separation: ${data.exitReason}.`,
        { lineGap: 4, align: 'justify' }
      ).moveDown(0.8);
    }

    doc.text(
      `You were appointed to the position of "${data.designation || 'Member'}" on ${formatDate(data.joinDate)}. All contractual and official duties assigned to you shall cease as of the close of business hours on ${formatDate(data.lastWorkingDay)}.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(0.8);

    doc.text(
      `Department Clearance & Asset Return: You are required to complete all clearance formalities across IT, Finance, HR, and Department Manager. Please return all company-owned assets, including computing hardware, access ID cards, security tokens, confidential documents, and software licenses in your possession.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(0.8);

    doc.text(
      `Full & Final Settlement: Your full and final settlement (including unpaid salary, accrued leave encashment, and any applicable severance benefits) will be processed through the Finance department upon receipt of completed clearance approvals from all departments.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(0.8);

    doc.text(
      `Confidentiality & Non-Disclosure: Please be reminded that your non-disclosure and intellectual property agreements remain in full legal effect following your separation from ${data.companyName}.`,
      { lineGap: 4, align: 'justify' }
    ).moveDown(1.5);

    // ── Signature Block ──
    doc
      .text('For and on behalf of Management,')
      .moveDown(2);

    doc
      .font('Helvetica-Bold')
      .text(data.authorizedSignatory || 'Authorized HR Signatory')
      .font('Helvetica')
      .text(data.companyName)
      .text('Human Resources & Operations Department');

    // ── Footer ──
    doc.moveDown(2.5);
    doc
      .fontSize(8)
      .fillColor('#999999')
      .text(
        'This is an official computer-generated document issued by the enterprise management system.',
        { align: 'center' }
      );

    doc.end();

    stream.on('finish', () => resolve(`/uploads/certificates/${fileName}`));
    stream.on('error', reject);
  });
}

/**
 * Generate a Service Certificate / Experience Letter PDF.
 *
 * @param {Object} data
 * @param {string} data.companyName
 * @param {string} data.employeeName
 * @param {string} data.employeeId
 * @param {string} data.designation
 * @param {string} data.department
 * @param {string|Date} data.joinDate
 * @param {string|Date} data.lastWorkingDay
 * @param {string} data.exitReason
 * @param {string} data.conductValue - Excellent | Good | Average | Poor
 * @param {number} [data.techRating]
 * @param {number} [data.attitudeRating]
 * @param {string} [data.authorizedSignatory]
 * @returns {Promise<string>} relative URL path to the generated PDF
 */
export async function generateServiceCertificate(data) {
  return new Promise((resolve, reject) => {
    const fileName = `service_cert_${data.employeeId || 'emp'}_${crypto.randomBytes(4).toString('hex')}.pdf`;
    const filePath = path.join(certDir, fileName);
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // ── Header ──
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(data.companyName || 'Company Name', { align: 'center' })
      .moveDown(0.3);

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Human Resources Department', { align: 'center' })
      .moveDown(1.5);

    // Horizontal rule
    doc
      .strokeColor('#333333')
      .lineWidth(1)
      .moveTo(60, doc.y)
      .lineTo(535, doc.y)
      .stroke()
      .moveDown(1);

    // ── Title ──
    doc
      .fillColor('#000000')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('SERVICE CERTIFICATE', { align: 'center' })
      .moveDown(0.5);

    // ── Reference & Date ──
    const refNo = `REF/SC/${new Date().getFullYear()}/${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Ref No: ${refNo}`, { align: 'left' })
      .text(`Date: ${formatDate(new Date())}`, { align: 'left' })
      .moveDown(1);

    // ── To Whom It May Concern ──
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('TO WHOM IT MAY CONCERN', { align: 'center' })
      .moveDown(1);

    // ── Body ──
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(
        `This is to certify that ${data.employeeName} (Employee ID: ${data.employeeId || 'N/A'}) ` +
        `was employed with ${data.companyName} from ${formatDate(data.joinDate)} to ${formatDate(data.lastWorkingDay)}, ` +
        `serving a total tenure of ${calcTenure(data.joinDate, data.lastWorkingDay)}.`,
        { lineGap: 4, align: 'justify' }
      )
      .moveDown(0.8);

    // ── Employee Details Table ──
    doc
      .font('Helvetica-Bold')
      .text('Employment Details:', { underline: true })
      .moveDown(0.5);

    const details = [
      ['Employee Name', data.employeeName],
      ['Employee ID', data.employeeId || 'N/A'],
      ['Designation', data.designation || 'Member'],
      ['Department', data.department || 'General'],
      ['Date of Joining', formatDate(data.joinDate)],
      ['Last Working Day', formatDate(data.lastWorkingDay)],
      ['Reason for Leaving', data.exitReason || 'Resigned'],
      ['Conduct', data.conductValue || 'Good'],
    ];

    doc.font('Helvetica').fontSize(10);
    for (const [label, value] of details) {
      const y = doc.y;
      doc
        .font('Helvetica-Bold')
        .text(`${label}:`, 80, y, { width: 150 })
        .font('Helvetica')
        .text(value, 240, y, { width: 280 });
      doc.moveDown(0.3);
    }

    doc.moveDown(1);

    // ── Conduct Summary ──
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(
        `During the period of employment, ${data.employeeName}'s conduct and performance ` +
        `were found to be "${data.conductValue || 'Good'}". ` +
        (data.techRating ? `Technical proficiency rating: ${data.techRating}/10. ` : '') +
        (data.attitudeRating ? `Professional attitude rating: ${data.attitudeRating}/10.` : ''),
        { lineGap: 4, align: 'justify' }
      )
      .moveDown(0.8);

    doc.text(
      `We wish ${data.employeeName} all the best in future endeavors.`,
      { lineGap: 4 }
    ).moveDown(2);

    // ── Signature Block ──
    doc
      .text('For and on behalf of')
      .font('Helvetica-Bold')
      .text(data.companyName)
      .moveDown(2);

    doc
      .font('Helvetica-Bold')
      .text(data.authorizedSignatory || 'Authorized Signatory')
      .font('Helvetica')
      .text('Human Resources Department');

    // ── Footer ──
    doc.moveDown(3);
    doc
      .fontSize(8)
      .fillColor('#999999')
      .text(
        'This is a computer-generated document. No physical signature is required.',
        { align: 'center' }
      );

    doc.end();

    stream.on('finish', () => resolve(`/uploads/certificates/${fileName}`));
    stream.on('error', reject);
  });
}

/**
 * Generate an official Reference Check & Verified Profile Dossier PDF.
 * Used to share as a reference check or attach to a new employer.
 *
 * @param {Object} data
 * @param {string} data.companyName
 * @param {string} data.employeeName
 * @param {string} [data.employeeId]
 * @param {string} data.designation
 * @param {string} data.department
 * @param {string|Date} data.joinDate
 * @param {string|Date} data.lastWorkingDay
 * @param {string} [data.exitReason]
 * @param {string} [data.pan]
 * @param {string} [data.conductValue]
 * @param {number} [data.techRating]
 * @param {number} [data.attitudeRating]
 * @param {string} [data.feedback]
 * @param {Array} [data.workHistory]
 * @param {string} [data.authorizedSignatory]
 * @returns {Promise<string>} relative URL path to generated PDF
 */
export async function generateReferenceCheckProfile(data) {
  return new Promise((resolve, reject) => {
    const refCode = `REF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const fileName = `refcheck_${data.employeeId || 'emp'}_${Date.now()}.pdf`;
    const filePath = path.join(certDir, fileName);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // ── Header Banner ──
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .fillColor('#1e1b4b')
      .text(data.companyName || 'UEIBI Organization', { align: 'center' })
      .moveDown(0.2);

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#6b7280')
      .text('OFFICIAL EMPLOYEE REFERENCE CHECK & VERIFIED PROFILE DOSSIER', { align: 'center', characterSpacing: 0.5 })
      .moveDown(0.2);

    doc
      .fontSize(8)
      .fillColor('#9ca3af')
      .text(`Dossier Reference ID: ${refCode}  •  Issued Date: ${formatDate(new Date())}`, { align: 'center' })
      .moveDown(1);

    // Top dividing line
    doc
      .strokeColor('#4f46e5')
      .lineWidth(2)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke()
      .moveDown(1);

    // ── Official Verification Badge Box ──
    const badgeY = doc.y;
    doc
      .roundedRect(50, badgeY, 495, 34, 6)
      .fillColor('#f0fdf4')
      .fill()
      .strokeColor('#86efac')
      .lineWidth(1)
      .stroke();

    doc
      .fontSize(9.5)
      .font('Helvetica-Bold')
      .fillColor('#166534')
      .text('VERIFIED EMPLOYMENT & STATUTORY KYC RECORD', 65, badgeY + 11);

    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#15803d')
      .text('Status: HR & Registry Verified  |  Identity Masked for Privacy (DPDP Compliant)', 300, badgeY + 11, { align: 'right', width: 235 });

    doc.y = badgeY + 45;

    // ── Section 1: Candidate & Employment Overview ──
    doc
      .fillColor('#111827')
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('1. Employment Overview')
      .moveDown(0.4);

    const employmentDetails = [
      ['Full Name', data.employeeName],
      ['Employee ID', data.employeeId || 'N/A'],
      ['Designation / Role', data.designation || 'Member'],
      ['Department', data.department || 'General'],
      ['Date of Joining', formatDate(data.joinDate)],
      ['Relieving / End Date', formatDate(data.lastWorkingDay)],
      ['Tenure of Service', calcTenure(data.joinDate, data.lastWorkingDay)],
      ['Reason for Separation', data.exitReason || 'Resigned'],
      ['PAN (Statutory ID)', data.pan ? (data.pan.length === 10 ? `XXXXXX${data.pan.slice(6)}` : data.pan) : 'Verified on File'],
    ];

    doc.fontSize(9).font('Helvetica');
    for (const [label, val] of employmentDetails) {
      const curY = doc.y;
      doc
        .font('Helvetica-Bold')
        .fillColor('#4b5563')
        .text(label, 65, curY, { width: 160 })
        .font('Helvetica')
        .fillColor('#111827')
        .text(`:   ${val}`, 225, curY, { width: 310 });
      doc.moveDown(0.25);
    }

    doc.moveDown(0.8);

    // ── Section 2: Reference Check & Performance Evaluation ──
    doc
      .fillColor('#111827')
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('2. Reference Check & Conduct Assessment')
      .moveDown(0.4);

    const ratings = [
      ['General Conduct & Integrity', data.conductValue || 'Good'],
      ['Technical Competency Rating', `${data.techRating || 8} / 10`],
      ['Professional Attitude & Teamwork', `${data.attitudeRating || 8} / 10`],
      ['Re-hire Eligibility', data.conductValue === 'Poor' ? 'Conditional Review' : 'Eligible for Re-hire'],
    ];

    for (const [label, val] of ratings) {
      const curY = doc.y;
      doc
        .font('Helvetica-Bold')
        .fillColor('#4b5563')
        .text(label, 65, curY, { width: 180 })
        .font('Helvetica')
        .fillColor('#111827')
        .text(`:   ${val}`, 245, curY, { width: 290 });
      doc.moveDown(0.25);
    }

    if (data.feedback && data.feedback.trim()) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .fillColor('#4b5563')
        .text('Performance Remarks / Reference Feedback:', 65)
        .moveDown(0.2);

      doc
        .font('Helvetica-Oblique')
        .fillColor('#374151')
        .text(`"${data.feedback.trim()}"`, 75, doc.y, { width: 460, lineGap: 3 })
        .moveDown(0.5);
    }

    // ── Section 3: Verified Prior Work History (if any) ──
    if (Array.isArray(data.workHistory) && data.workHistory.length > 0) {
      doc.moveDown(0.5);
      doc
        .fillColor('#111827')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('3. Prior Employment Records on File')
        .moveDown(0.4);

      data.workHistory.forEach((wh, idx) => {
        const tenureStr = calcTenure(wh.startDate, wh.endDate || new Date());
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#1f2937')
          .text(`• ${wh.companyName || 'Prior Employer'} - ${wh.designation || 'Role'} (${tenureStr})`, 65)
          .font('Helvetica')
          .fillColor('#6b7280')
          .fontSize(8)
          .text(`  Dates: ${formatDate(wh.startDate)} to ${wh.endDate ? formatDate(wh.endDate) : 'Present'}${wh.reasonForExit ? ` | Reason for Exit: ${wh.reasonForExit}` : ''}`, 75)
          .moveDown(0.3);
      });
    }

    doc.moveDown(1);

    // ── Attestation & Signatory Block ──
    const signY = doc.y;
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#4b5563')
      .text('Attested and issued on behalf of HR Department:', 65, signY);

    doc
      .moveDown(0.4)
      .font('Helvetica-Bold')
      .fillColor('#111827')
      .text(data.authorizedSignatory || 'Authorized HR Officer', 65)
      .font('Helvetica')
      .fillColor('#6b7280')
      .text(`${data.companyName}  •  Reference Verification Authority`, 65)
      .moveDown(1.5);

    // ── Legal Footer ──
    doc
      .strokeColor('#e5e7eb')
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke()
      .moveDown(0.5);

    doc
      .fontSize(7.5)
      .fillColor('#9ca3af')
      .text(
        'CONFIDENTIAL: This reference check dossier contains verified employment history generated for reference verification or attachment to new employer records. ' +
        'Digitally authenticated via UEIBI HR Platform. No physical signature required.',
        { align: 'center', lineGap: 2 }
      );

    doc.end();

    stream.on('finish', () => resolve(`/uploads/certificates/${fileName}`));
    stream.on('error', reject);
  });
}
