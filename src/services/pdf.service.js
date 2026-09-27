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
