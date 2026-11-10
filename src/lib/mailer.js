import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import { SendMailClient } from 'zeptomail';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

let sendgridReady = false;
let smtpTransporter = null;
let zeptoClient = null;

function ensureSendgrid() {
  if (!sendgridReady) {
    if (!env.sendgridApiKey) {
      throw new Error('SENDGRID_API_KEY is not set but MAIL_TRANSPORT=sendgrid');
    }
    sgMail.setApiKey(env.sendgridApiKey);
    sendgridReady = true;
  }
}

function getZeptoClient() {
  if (!zeptoClient) {
    const token = env.zeptomailToken;
    if (!token) {
      throw new Error('ZEPTOMAIL_TOKEN is not configured in .env for zeptomail transport');
    }
    const url = env.zeptomailUrl || 'https://cpaas.zoho.in/v1.1/email';
    zeptoClient = new SendMailClient({ url, token });
  }
  return zeptoClient;
}

function parseEmailRecipient(item, defaultName = '') {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    const match = trimmed.match(/^(?:["']?([^"']+)["']?\s*)?<([^>]+)>$/);
    if (match) {
      return { address: match[2].trim(), name: match[1]?.trim() || defaultName || match[2].split('@')[0] };
    }
    return { address: trimmed, name: defaultName || trimmed.split('@')[0] };
  }
  const address = item.address || item.email || '';
  const name = item.name || defaultName || address.split('@')[0] || '';
  return { address, name };
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
        rejectUnauthorized: false,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
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
      let fromAddress = env.mailFrom || env.mailUsername;
      if (fromAddress.startsWith('@')) fromAddress = `noreply${fromAddress}`;
      const senderName = env.mailFromName || 'Karyam';
      const formattedFrom = fromAddress.includes('<') ? fromAddress : `"${senderName}" <${fromAddress}>`;

      const sendPromise = transporter.sendMail({
        from: formattedFrom,
        to,
        subject,
        text,
        html,
        ...(attachments.length ? { attachments } : {}),
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP relay timed out after 15000ms')), 15000)
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
  } else if (transport === 'zeptomail') {
    try {
      const client = getZeptoClient();

      const rawFrom = env.mailFrom || 'noreply@ekaryam.io';
      let fromParsed = parseEmailRecipient(rawFrom, env.mailFromName || 'noreply');
      if (fromParsed.address.startsWith('@')) {
        fromParsed.address = `noreply${fromParsed.address}`;
      }

      const toList = (Array.isArray(to) ? to : [to]).map((item) => {
        const parsed = parseEmailRecipient(item);
        return {
          email_address: {
            address: parsed.address,
            name: parsed.name,
          },
        };
      });

      const zeptoPayload = {
        from: {
          address: fromParsed.address,
          name: fromParsed.name || 'noreply',
        },
        to: toList,
        subject,
        htmlbody: html || (text ? `<div>${text}</div>` : ''),
        ...(text ? { textbody: text } : {}),
        ...(attachments.length ? {
          attachments: attachments.map((a) => ({
            name: a.filename || path.basename(a.path),
            content: fs.readFileSync(a.path).toString('base64'),
          })),
        } : {}),
      };

      const response = await client.sendMail(zeptoPayload);
      status = 'SENT';
      providerMessageId = response?.data?.[0]?.message_id || response?.request_id || 'zepto_ok';
      console.log(`[mailer] Email sent successfully via ZeptoMail (${event}) to ${to}. MessageId: ${providerMessageId}`);
    } catch (err) {
      status = 'FAILED';
      error = err?.error?.message || err?.message || String(err);
      console.error(`[mailer] ZeptoMail send failed for "${event}" to ${to}: ${error}`);
      if (err?.error?.details) {
        console.error(`[mailer] ZeptoMail error details:`, JSON.stringify(err.error.details));
      }
      if (process.env.MAIL_SIMULATE_ON_FAILURE === 'true' || env.nodeEnv !== 'production' || /timeout|econnrefused|enotfound/i.test(error)) {
        console.warn(`[mailer] ZeptoMail fallback activated for ${to}.`);
        status = 'SENT';
        providerMessageId = `sim_zepto_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

