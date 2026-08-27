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
    });
  }
  return smtpTransporter;
}

export async function sendMail({ to, subject, html, text, event, registrationId = null }) {
  let status = 'DEV_LOGGED';
  let providerMessageId = null;
  let error = null;

  const transport = (env.mailTransport || 'smtp').toLowerCase();

  if (transport === 'smtp' || transport === 'zoho') {
    try {
      const transporter = getSmtpTransporter();
      const fromAddress = env.mailFrom || env.mailUsername;
      const formattedFrom = fromAddress.includes('<') ? fromAddress : `UEIBI <${fromAddress}>`;

      const info = await transporter.sendMail({
        from: formattedFrom,
        to,
        subject,
        text,
        html,
      });
      status = 'SENT';
      providerMessageId = info?.messageId || null;
      console.log(`[mailer] Email sent successfully via SMTP (${event}) to ${to}. MessageId: ${providerMessageId}`);
    } catch (err) {
      status = 'FAILED';
      error = err?.message || String(err);
      console.error(`[mailer] SMTP send failed for "${event}" to ${to}: ${error}`);
    }
  } else if (transport === 'sendgrid') {
    try {
      ensureSendgrid();
      const [response] = await sgMail.send({ to, from: env.mailFrom, subject, html, text });
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
    await prisma.notificationLog.create({
      data: {
        registrationId,
        event,
        recipient: to,
        subject,
        bodyText: text || (html ? html.replace(/<[^>]+>/g, '') : ''),
        status,
        providerMessageId,
        error,
      },
    });
  } catch (dbErr) {
    console.error('[mailer] Failed to write notification log to database:', dbErr?.message || dbErr);
  }

  return { status, providerMessageId, error };
}
