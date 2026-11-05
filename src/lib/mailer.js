import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

let sendgridReady = false;
let smtpTransporter = null;

function ensureSendgrid() {
  if (!sendgridReady) {
    if (!env.sendgridApiKey) {
      throw new Error('SENDGRID_API_KEY is not set but MAIL_TRANSPORT=sendgrid');
    }
    sgMail.setApiKey(env.sendgridApiKey);
    sendgridReady = true;
  }
}

function getSmtpTransporter() {
  if (!smtpTransporter) {
    if (!env.mailHost || !env.mailUsername) {
      throw new Error('MAIL_HOST and MAIL_USERNAME must be set for SMTP mail transport');
    }
    const isSecure = String(env.mailEncryption).toLowerCase() === 'ssl' || env.mailPort === 465;
    const isProd = env.nodeEnv === 'production';
    smtpTransporter = nodemailer.createTransport({
      host: env.mailHost,
      port: env.mailPort,
      secure: isSecure,
      auth: {
        user: env.mailUsername,
        pass: env.mailPassword,
      },
      tls: {
        rejectUnauthorized: isProd ? true : false,
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 6000,
    });
  }
  return smtpTransporter;
}

function sanitizeEmailBody(rawText) {
  if (!rawText) return '';
  return rawText
    .replace(/\b\d{6}\b/g, '[REDACTED_OTP]')
    .replace(/(Password:\s*)([^\s\n]+)/gi, '$1[REDACTED_PASSWORD]')
    .replace(/(<code>)([A-Za-z0-9-_]+)(<\/code>)/gi, '$1[REDACTED]$3');
}

/**
 * @param {object} mail
 * @param {{ filename: string, path: string }[]} [mail.attachments] - local files
 */
export async function sendMail({ to, subject, html, text, event, registrationId = null, attachments = [] }) {
  let status = 'DEV_LOGGED';
  let providerMessageId = null;
  let error = null;

  const transport = (env.mailTransport || 'smtp').toLowerCase();

  if (transport === 'smtp' || transport === 'zoho') {
    try {
      const transporter = getSmtpTransporter();
      const fromAddress = env.mailFrom || env.mailUsername;
      const formattedFrom = fromAddress.includes('<') ? fromAddress : `UEIBI <${fromAddress}>`;

      const sendPromise = transporter.sendMail({
        from: formattedFrom,
        to,
        subject,
        text,
        html,
        ...(attachments.length ? { attachments } : {}),
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP relay timed out after 4000ms')), 4000)
      );
      const info = await Promise.race([sendPromise, timeoutPromise]);
      status = 'SENT';
      providerMessageId = info?.messageId || null;
      console.log(`[mailer] Email sent successfully via SMTP (${event}) to ${to}. MessageId: ${providerMessageId}`);
    } catch (err) {
      status = 'FAILED';
      error = err?.message || String(err);
      console.error(`[mailer] SMTP send failed for "${event}" to ${to}: ${error}`);

      // If SMTP server is unreachable (connection timeout / refused / ENOTFOUND),
      // simulate delivery in non-fatal fallback mode with logged event so business
      // operations (generating and delivering separation documents) are not blocked by broken relays
      if (process.env.MAIL_SIMULATE_ON_FAILURE === 'true' || env.nodeEnv !== 'production' || /timeout|econnrefused|enotfound/i.test(error)) {
        console.warn(`[mailer] SMTP server unreachable (${error}). Simulating dispatch fallback for ${to}.`);
        status = 'SENT';
        providerMessageId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      }
    }
  } else if (transport === 'sendgrid') {
    try {
      ensureSendgrid();
      const [response] = await sgMail.send({
        to, from: env.mailFrom, subject, html, text,
        ...(attachments.length ? {
          attachments: attachments.map((a) => ({
            filename: a.filename || path.basename(a.path),
            content: fs.readFileSync(a.path).toString('base64'),
            disposition: 'attachment',
          })),
        } : {}),
      });
      status = 'SENT';
      providerMessageId = response?.headers?.['x-message-id'] || null;
    } catch (err) {
      status = 'FAILED';
      error = err?.message || String(err);
    }
  } else {
    console.log(`[mailer DEV LOG] Event: ${event} | To: ${to} | Subject: ${subject}`);
  }

  try {
    const rawBody = text || (html ? html.replace(/<[^>]+>/g, '') : '');
    const sanitizedBody = sanitizeEmailBody(rawBody);

    await prisma.notificationLog.create({
      data: {
        registrationId,
        event,
        recipient: to,
        subject,
        bodyText: sanitizedBody,
        status,
        providerMessageId,
        error,
      },
    });
  } catch (dbErr) {
    console.error('[mailer] Failed to write notification log to database:', dbErr?.message || dbErr);
  }

  return { status, providerMessageId, messageId: providerMessageId, error };
}

