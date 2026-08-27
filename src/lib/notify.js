import { env } from '../config/env.js';
import { sendMail } from './mailer.js';
import {
  renderLevel1SubmittedEmail,
  renderFinanceApprovedEmail,
  renderHrActivatedEmail,
} from './emailTemplates.js';

/**
 * Sends a level-transition notification to the CMD/Director, Finance, HR, and the
 * fixed UEIBI ops inbox. Only the recipient matching `actionRole` (if any) gets the
 * actionable link in their copy — everyone else gets an informational copy without it.
 */
export async function notifyStakeholders({
  registration,
  event,
  subject,
  message,
  actionRole = null,
  actionUrl = null,
}) {
  const ueibiEmail = (env.ueibiNotifyEmail && !env.ueibiNotifyEmail.endsWith('.local'))
    ? env.ueibiNotifyEmail
    : (env.mailUsername || 'administrator@ueibi.com');

  const recipients = [
    { email: registration.email, role: 'CMD_DIRECTOR' },
    { email: registration.financeEmail, role: 'FINANCE' },
    { email: registration.hrEmail, role: 'HR' },
    { email: ueibiEmail, role: 'UEIBI' },
  ];

  await Promise.all(
    recipients.map(({ email, role }) => {
      const isActionRecipient = Boolean(actionRole && role === actionRole);
      let html = null;

      if (event === 'LEVEL1_SUBMITTED') {
        html = renderLevel1SubmittedEmail({ registration, actionUrl, isActionRecipient });
      } else if (event === 'FINANCE_APPROVED_ONLINE' || event === 'FINANCE_APPROVED_CHEQUE') {
        const paymentType = event === 'FINANCE_APPROVED_CHEQUE' ? 'CHEQUE' : 'ONLINE';
        html = renderFinanceApprovedEmail({ registration, actionUrl, isActionRecipient, paymentType });
      } else if (event === 'HR_ACTIVATED') {
        html = renderHrActivatedEmail({ registration });
      } else {
        const includeLink = isActionRecipient && actionUrl;
        const fallbackText = includeLink ? `${message}\n\nAction required: ${actionUrl}` : message;
        html = `<p>${fallbackText.replace(/\n/g, '<br/>')}</p>`;
      }

      const text = actionRole && role === actionRole && actionUrl ? `${message}\n\nAction required: ${actionUrl}` : message;

      return sendMail({
        to: email,
        subject,
        text,
        html,
        event,
        registrationId: registration.id,
      });
    }),
  );
}
