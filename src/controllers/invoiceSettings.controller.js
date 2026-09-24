/**
 * invoiceSettings.controller.js — platform-wide invoicing configuration.
 *
 * Numbering is the part that needs care. `nextNumber` is a floor rather than an
 * override, so nothing an operator types here can cause an invoice number to be
 * reissued. The response always reports what the next number will *actually*
 * be, computed the same way allocation computes it, so the screen cannot
 * disagree with reality.
 */
import { prisma } from '../lib/prisma.js';
import {
  getInvoiceSettings,
  saveInvoiceSettings,
} from '../services/invoiceSettings.service.js';
import { nextInvoiceNumber, invoiceNumberPrefix } from '../services/billing.service.js';
import { invoiceSettingsSchema } from '../validations/invoiceTemplate.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

/** The settings, plus everything the screen needs to explain them. */
async function describe(settings) {
  const [preview, issuedCount] = await Promise.all([
    nextInvoiceNumber(),
    prisma.invoice.count({ where: { invoiceNumber: { not: null } } }),
  ]);
  const prefix = invoiceNumberPrefix(settings);
  const highest = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });

  return {
    settings,
    numbering: {
      // What allocation will actually produce, not what nextNumber says.
      nextInvoiceNumber: preview,
      prefix,
      highestIssued: highest?.invoiceNumber || null,
      issuedCount,
      // Stated so the screen can explain why a low nextNumber has no effect.
      floorNote: 'The next number is the higher of this value and one past the highest already issued, so lowering it can never reissue an existing number.',
    },
  };
}

/** GET /platform/invoice-settings */
export async function getSettings(req, res, next) {
  try {
    res.json(await describe(await getInvoiceSettings()));
  } catch (err) {
    next(err);
  }
}

/** PUT /platform/invoice-settings */
export async function updateSettings(req, res, next) {
  try {
    const parsed = invoiceSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    const before = await getInvoiceSettings();
    const saved = await saveInvoiceSettings(data, req.user.id);

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_SETTINGS_UPDATED,
      targetType: 'INVOICE_SETTINGS',
      targetId: 'singleton',
      beforeValue: {
        numberPrefix: before.numberPrefix,
        includeFinancialYear: before.includeFinancialYear,
        taxPercent: String(before.taxPercent),
        issuerGstin: before.issuerGstin,
      },
      afterValue: {
        numberPrefix: saved.numberPrefix,
        includeFinancialYear: saved.includeFinancialYear,
        taxPercent: String(saved.taxPercent),
        issuerGstin: saved.issuerGstin,
      },
    }).catch((err) => console.warn('[InvoiceSettings] audit write failed:', err.message));

    const described = await describe(saved);

    // Changing the series mid-year is legitimate but needs explaining to an
    // auditor, so it is said out loud rather than happening quietly.
    const seriesChanged = before.numberPrefix !== saved.numberPrefix
      || before.includeFinancialYear !== saved.includeFinancialYear;
    const taxChanged = Number(before.taxPercent) !== Number(saved.taxPercent);

    res.json({
      ...described,
      notes: [
        seriesChanged
          ? `The invoice series changes from here. Invoices already issued keep their numbers; the next one will be ${described.numbering.nextInvoiceNumber}.`
          : null,
        taxChanged
          ? `The tax rate applies to invoices raised from now on. Invoices already issued keep the rate they were raised at.`
          : null,
      ].filter(Boolean),
    });
  } catch (err) {
    next(err);
  }
}
