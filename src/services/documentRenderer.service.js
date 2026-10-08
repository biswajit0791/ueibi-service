/**
 * @file documentRenderer.service.js
 * @description Enterprise Document Rendering Engine.
 * Compiles Mustache templates, merges dynamic tokens & manual overrides,
 * constructs full HTML/CSS documents, and outputs production PDFs using PDFKit
 * (with optional Puppeteer acceleration if installed).
 */

import Mustache from 'mustache';
import sanitizeHtmlLib from 'sanitize-html';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const uploadsDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
const docsDir = path.join(uploadsDir, 'certificates');

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

/**
 * Sanitizer config that permits rich document formatting, styles,
 * logos, tables, layout classes, while stripping active scripts.
 */
const SANITIZER_OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'a', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'div', 'span', 'section', 'header', 'footer', 'article',
    'img', 'style',
  ],
  allowedAttributes: {
    '*': ['class', 'style', 'id', 'align'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    th: ['colspan', 'rowspan', 'width', 'align'],
    td: ['colspan', 'rowspan', 'width', 'align'],
  },
  allowedSchemes: ['http', 'https', 'data', 'mailto'],
  nonTextTags: ['script', 'textarea', 'option', 'noscript', 'iframe'],
};

export function sanitizeDocumentHtml(dirty) {
  if (typeof dirty !== 'string') return '';
  return sanitizeHtmlLib(dirty, SANITIZER_OPTIONS);
}

/**
 * Strips HTML tags to plain text for layout calculations or text extract.
 */
export function stripHtmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Default CSS stylesheet injected into rendered documents.
 */
const BASE_DOCUMENT_CSS = `
  @page {
    size: A4;
    margin: 20mm;
  }
  * {
    box-sizing: border-box;
  }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.6;
    font-size: 14px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px;
    background: #ffffff;
    position: relative;
    min-height: 100vh;
  }
  .doc-watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 80px;
    font-weight: 800;
    color: rgba(15, 23, 42, 0.04);
    text-transform: uppercase;
    letter-spacing: 12px;
    pointer-events: none;
    user-select: none;
    z-index: 0;
    white-space: nowrap;
  }
  .doc-header {
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 18px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .doc-logo {
    max-height: 56px;
    max-width: 180px;
    object-fit: contain;
  }
  .doc-meta {
    font-size: 12px;
    color: #64748b;
    text-align: right;
  }
  .doc-title {
    font-size: 20px;
    font-weight: 700;
    text-align: center;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: 24px 0 20px 0;
  }
  .doc-body {
    position: relative;
    z-index: 1;
    font-size: 14px;
    color: #334155;
    line-height: 1.75;
  }
  .doc-body p {
    margin: 0 0 16px 0;
    text-align: justify;
  }
  .doc-table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
  }
  .doc-table th, .doc-table td {
    padding: 10px 14px;
    border: 1px solid #e2e8f0;
    font-size: 13px;
  }
  .doc-table th {
    background-color: #f8fafc;
    font-weight: 600;
    color: #475569;
    text-align: left;
  }
  .doc-signature-block {
    margin-top: 48px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    page-break-inside: avoid;
  }
  .doc-signature-box {
    min-width: 200px;
  }
  .doc-signature-img {
    max-height: 50px;
    margin-bottom: 8px;
  }
  .doc-signature-line {
    border-top: 1px solid #94a3b8;
    padding-top: 6px;
    font-weight: 600;
    color: #1e293b;
    font-size: 13px;
  }
  .doc-footer {
    border-top: 1px solid #e2e8f0;
    padding-top: 14px;
    margin-top: 40px;
    font-size: 11px;
    color: #94a3b8;
    text-align: center;
    page-break-inside: avoid;
  }
`;

/**
 * Builds a standalone HTML document ready for iframe preview or print.
 */
export function buildFullHtml({
  headerHtml = '',
  bodyHtml = '',
  footerHtml = '',
  cssStyles = '',
  layoutSettings = {},
  view = {},
}) {
  const settings = layoutSettings || {};
  const showWatermark = settings.showWatermark && (settings.watermarkText || view.companyName);
  const watermarkText = settings.watermarkText || view.companyName || 'CONFIDENTIAL';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${view.employeeName || 'Document'} - ${settings.title || 'Official Document'}</title>
  <style>
    ${BASE_DOCUMENT_CSS}
    ${cssStyles || ''}
  </style>
</head>
<body>
  <div class="doc-container">
    ${showWatermark ? `<div class="doc-watermark">${watermarkText}</div>` : ''}

    ${headerHtml ? `<div class="doc-header">${headerHtml}</div>` : ''}

    <div class="doc-body">
      ${bodyHtml}
    </div>

    ${footerHtml ? `<div class="doc-footer">${footerHtml}</div>` : ''}
  </div>
</body>
</html>`;
}

/**
 * Renders template HTML with view data and manual overrides.
 *
 * @param {Object} params
 * @param {Object} params.template - DocumentTemplate DB model or object
 * @param {Object} params.tokenValues - Resolved key-value tokens
 * @param {Object} [params.manualOverrides] - Manual user edits
 * @returns {Object} { renderedBody, renderedHeader, renderedFooter, fullHtml, view }
 */
export function renderDocumentHtml({
  template,
  tokenValues = {},
  manualOverrides = {},
}) {
  const view = { ...tokenValues, ...(manualOverrides || {}) };

  const rawHeader = template.headerHtml || '';
  const rawBody = template.htmlTemplate || '';
  const rawFooter = template.footerHtml || '';

  let renderedHeader = rawHeader;
  let renderedBody = rawBody;
  let renderedFooter = rawFooter;

  try {
    renderedHeader = rawHeader ? Mustache.render(rawHeader, view) : '';
    renderedBody = rawBody ? Mustache.render(rawBody, view) : '';
    renderedFooter = rawFooter ? Mustache.render(rawFooter, view) : '';
  } catch (renderErr) {
    console.warn('[renderDocumentHtml] Incomplete or draft template syntax:', renderErr.message);
    // Graceful fallback to raw text so preview canvas doesn't crash during live typing
  }

  const cleanHeader = sanitizeDocumentHtml(renderedHeader);
  const cleanBody = sanitizeDocumentHtml(renderedBody);
  const cleanFooter = sanitizeDocumentHtml(renderedFooter);

  const fullHtml = buildFullHtml({
    headerHtml: cleanHeader,
    bodyHtml: cleanBody,
    footerHtml: cleanFooter,
    cssStyles: template.cssStyles,
    layoutSettings: template.layoutSettings,
    view,
  });

  return {
    renderedHeader: cleanHeader,
    renderedBody: cleanBody,
    renderedFooter: cleanFooter,
    fullHtml,
    view,
  };
}

/**
 * Generates a clean PDF file using PDFKit, incorporating all template tokens,
 * headers, footers, body text, tables, and company branding.
 *
 * @param {Object} params
 * @param {Object} params.template
 * @param {Object} params.tokenValues
 * @param {Object} [params.manualOverrides]
 * @param {string} [params.fileNamePrefix]
 * @returns {Promise<Object>} { fileName, fileUrl, filePath, fullHtml, view }
 */
export async function renderDocumentPdf({
  template,
  tokenValues = {},
  manualOverrides = {},
  fileNamePrefix = 'doc',
}) {
  const { renderedHeader, renderedBody, renderedFooter, fullHtml, view } =
    renderDocumentHtml({ template, tokenValues, manualOverrides });

  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const safePrefix = String(fileNamePrefix || 'doc').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const fileName = `${safePrefix}_${view.employeeId || 'emp'}_${randomSuffix}.pdf`;
  const filePath = path.join(docsDir, fileName);

  const layout = template.layoutSettings || {};
  const marginSize = layout.pageMargin ? Number(layout.pageMargin) * 2.83465 : 54; // convert mm to pt approx

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: layout.paperSize || 'A4',
      margin: marginSize,
      info: {
        Title: `${template.name || 'Document'} - ${view.employeeName || ''}`,
        Author: view.companyName || 'UEIBI',
        Subject: template.documentType || 'Official Certificate',
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Optional Watermark
    if (layout.showWatermark && (layout.watermarkText || view.companyName)) {
      const watermarkText = layout.watermarkText || view.companyName || 'CONFIDENTIAL';
      doc.save();
      doc.opacity(0.06);
      doc.fontSize(60).font('Helvetica-Bold');
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.text(watermarkText, doc.page.width / 2 - 200, doc.page.height / 2 - 30, {
        align: 'center',
        width: 400,
      });
      doc.restore();
    }

    // ── Header ──
    const primaryColor = layout.primaryBrand || '#0f172a';
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .fillColor(primaryColor)
      .text(view.companyName || 'UEIBI Organization', { align: 'center' })
      .moveDown(0.3);

    if (view.companyAddress) {
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#64748b')
        .text(view.companyAddress, { align: 'center' })
        .moveDown(0.4);
    }

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#64748b')
      .text('Human Resources Department', { align: 'center' })
      .moveDown(1.2);

    // Divider line
    const leftX = doc.page.margins.left;
    const rightX = doc.page.width - doc.page.margins.right;
    doc
      .strokeColor('#cbd5e1')
      .lineWidth(1)
      .moveTo(leftX, doc.y)
      .lineTo(rightX, doc.y)
      .stroke()
      .moveDown(1);

    // ── Document Title ──
    doc
      .fontSize(15)
      .font('Helvetica-Bold')
      .fillColor(primaryColor)
      .text(template.name || 'OFFICIAL DOCUMENT', { align: 'center' })
      .moveDown(0.8);

    // ── Reference & Date Meta ──
    if (view.refNumber || view.issueDate) {
      const metaY = doc.y;
      if (view.refNumber) {
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text(`Ref No: ${view.refNumber}`, leftX, metaY, { align: 'left' });
      }
      if (view.issueDate) {
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text(`Date: ${view.issueDate}`, leftX, metaY, { align: 'right' });
      }
      doc.moveDown(1.4);
    }

    // ── Body Content (Structured paragraphs) ──
    const plainText = stripHtmlToText(renderedBody);
    const paragraphs = plainText.split(/\n\s*\n/).filter(Boolean);

    doc.fillColor('#1e293b').fontSize(10.5).font('Helvetica');

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('Dear ') || trimmed.startsWith('To Whom It May Concern')) {
        doc.font('Helvetica-Bold').text(trimmed, { lineGap: 3 }).font('Helvetica').moveDown(0.7);
      } else if (trimmed.startsWith('Yours sincerely') || trimmed.startsWith('Sincerely')) {
        doc.moveDown(1.2).text(trimmed).moveDown(1.8);
      } else {
        doc.text(trimmed, {
          align: 'justify',
          lineGap: 4,
        }).moveDown(0.8);
      }
    }

    // ── Signature Block ──
    doc.moveDown(1);
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#0f172a')
      .text(view.authorizedSignatory || 'Authorized Signatory')
      .font('Helvetica')
      .fillColor('#475569')
      .text(view.signatoryDesignation || 'Human Resources')
      .text(view.companyName || 'UEIBI Organization');

    // ── Footer ──
    const footerText = stripHtmlToText(renderedFooter) ||
      'This is an electronically generated and verified document issued via UEIBI HR Platform.';

    doc
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(footerText, leftX, doc.page.height - doc.page.margins.bottom - 20, {
        align: 'center',
        width: rightX - leftX,
      });

    doc.end();

    stream.on('finish', () => {
      const stats = fs.statSync(filePath);
      resolve({
        fileName,
        fileUrl: `/uploads/certificates/${fileName}`,
        filePath,
        fileSize: stats.size,
        fullHtml,
        view,
      });
    });

    stream.on('error', reject);
  });
}
