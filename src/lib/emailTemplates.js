import { env } from '../config/env.js';

/**
 * Base email wrapper with UEIBI branding, clean card design, and responsive layout.
 */
export function renderEmailWrapper({ title, preheader, contentHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    table {border-collapse: collapse;}
    .fallback-font {font-family: Arial, sans-serif;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  ${preheader ? `<div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">${preheader}</div>` : ''}
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 580px; width: 100%;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 40px; border-top-left-radius: 16px; border-top-right-radius: 16px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background-color: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 10px 20px;">
                      <span style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">UEIBI</span>
                      <span style="display: inline-block; width: 8px; height: 8px; background-color: #6366f1; border-radius: 50%; margin-left: 4px;"></span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card Body -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); border: 1px solid #e2e8f0; border-top: none;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 20px; text-align: center; font-size: 13px; color: #64748b;">
              <p style="margin: 0 0 8px 0; font-weight: 500;">UEIBI Business Operations Platform</p>
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">This is an automated notification. If you need assistance, please contact administrator@ueibi.com.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * OTP Email Template
 */
export function renderOtpEmail({ code, expiresMinutes }) {
  const contentHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-block; width: 48px; height: 48px; background-color: #e0e7ff; border-radius: 50%; margin-bottom: 16px; line-height: 48px; text-align: center;">
        <span style="font-size: 24px; color: #4f46e5;">🔒</span>
      </div>
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 700; color: #0f172a;">Verify Your Email Address</h1>
      <p style="margin: 0; font-size: 15px; color: #475569; line-height: 1.5;">
        Thank you for initiating your signup with UEIBI. Enter the code below to complete your email verification.
      </p>
    </div>

    <!-- OTP Code Display Box -->
    <div style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
      <span style="display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 8px;">Your Verification Code</span>
      <span style="font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #4f46e5; margin-left: 10px;">${code}</span>
    </div>

    <div style="background-color: #fffbe0; border-left: 4px solid #eab308; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 13px; color: #854d0e; line-height: 1.4;">
        ⏱️ This code will expire in <strong>${expiresMinutes} minutes</strong>. Do not share this code with anyone.
      </p>
    </div>

    <p style="margin: 0; font-size: 13px; color: #94a3b8; text-align: center; line-height: 1.5;">
      If you did not request this verification code, no further action is required.
    </p>
  `;

  return renderEmailWrapper({
    title: 'Your UEIBI Verification Code',
    preheader: `Your verification code is ${code}. Valid for ${expiresMinutes} minutes.`,
    contentHtml,
  });
}

/**
 * Level 1 Signup Submitted Email Template
 */
export function renderLevel1SubmittedEmail({ registration, actionUrl = null, isActionRecipient = false }) {
  const isFinance = isActionRecipient;

  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <div style="display: inline-block; background-color: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
        Level 1 — Registration Submitted
      </div>
      <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
        ${isFinance ? 'New Company Signup Pending Finance Approval' : 'Registration Submitted Successfully'}
      </h1>
      <p style="margin: 0; font-size: 15px; color: #475569; line-height: 1.6;">
        ${
          isFinance
            ? `<strong>${registration.fullName}</strong> (${registration.designation}) has submitted a registration request for <strong>${registration.companyName}</strong>. Please review the details and configure pricing & license allocation.`
            : `Your company registration for <strong>${registration.companyName}</strong> has been submitted. Our Finance team has been notified to review your request.`
        }
      </p>
    </div>

    <!-- Registration Details Card -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 16px 0; font-size: 14px; text-transform: uppercase; tracking: 0.5px; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Registration Summary</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 14px; line-height: 1.8;">
        <tr>
          <td style="color: #64748b; width: 40%; font-weight: 500;">Company Name:</td>
          <td style="color: #0f172a; font-weight: 600;">${registration.companyName}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Company Type:</td>
          <td style="color: #0f172a;">${registration.companyType}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Domain:</td>
          <td style="color: #0f172a;">${registration.domainName}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Primary Contact:</td>
          <td style="color: #0f172a;">${registration.fullName} (${registration.designation})</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Contact Email:</td>
          <td style="color: #0f172a;">${registration.email}</td>
        </tr>
      </table>
    </div>

    ${
      isFinance && actionUrl
        ? `
    <div style="text-align: center; margin: 32px 0;">
      <a href="${actionUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
        Review Registration & Pricing &rarr;
      </a>
      <p style="margin: 12px 0 0 0; font-size: 12px; color: #94a3b8;">This action link is secure and valid for Finance authorization.</p>
    </div>
    `
        : ''
    }
  `;

  return renderEmailWrapper({
    title: `Registration Submitted: ${registration.companyName}`,
    preheader: `Registration request for ${registration.companyName} has been submitted.`,
    contentHtml,
  });
}

/**
 * Finance Approved Email Template (Level 2)
 */
export function renderFinanceApprovedEmail({ registration, actionUrl = null, isActionRecipient = false, paymentType = 'ONLINE' }) {
  const isHr = isActionRecipient;
  const isCheque = paymentType === 'CHEQUE';

  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <div style="display: inline-block; background-color: #dcfce7; color: #15803d; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
        Level 2 — Finance Approved
      </div>
      <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
        ${isHr ? 'Pending HR Activation' : `Finance & Payment Confirmed (${isCheque ? 'Cheque' : 'Online'})`}
      </h1>
      <p style="margin: 0; font-size: 15px; color: #475569; line-height: 1.6;">
        ${
          isHr
            ? `Finance has approved pricing and verified payment for <strong>${registration.companyName}</strong>. Please proceed to activate the tenant account.`
            : `Finance approval for <strong>${registration.companyName}</strong> has been completed. The registration has progressed to HR Activation stage.`
        }
      </p>
    </div>

    <!-- Billing Summary Box -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 16px 0; font-size: 14px; text-transform: uppercase; tracking: 0.5px; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Approved License & Billing</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 14px; line-height: 1.8;">
        <tr>
          <td style="color: #64748b; width: 40%; font-weight: 500;">Company:</td>
          <td style="color: #0f172a; font-weight: 600;">${registration.companyName}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">License Quantity:</td>
          <td style="color: #0f172a; font-weight: 600;">${registration.licenseQuantity || 1} licenses</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Payment Method:</td>
          <td style="color: #0f172a;">${registration.paymentMethod || paymentType}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Payment Reference:</td>
          <td style="color: #0f172a; font-family: monospace;">${registration.paymentReference || 'N/A'}</td>
        </tr>
        ${
          registration.totalAmount
            ? `
        <tr>
          <td style="color: #64748b; font-weight: 500;">Total Amount:</td>
          <td style="color: #16a34a; font-weight: 700; font-size: 16px;">₹${registration.totalAmount.toLocaleString('en-IN')}</td>
        </tr>
        `
            : ''
        }
      </table>
    </div>

    ${
      isHr && actionUrl
        ? `
    <div style="text-align: center; margin: 32px 0;">
      <a href="${actionUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #059669 100%); color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);">
        Activate Tenant Account &rarr;
      </a>
      <p style="margin: 12px 0 0 0; font-size: 12px; color: #94a3b8;">Click above to perform final HR activation and issue tenant access.</p>
    </div>
    `
        : ''
    }
  `;

  return renderEmailWrapper({
    title: `Finance Approved: ${registration.companyName}`,
    preheader: `Payment approved for ${registration.companyName}. Pending HR activation.`,
    contentHtml,
  });
}

/**
 * HR Activated Email Template (Level 3 - Final)
 */
export function renderHrActivatedEmail({ registration }) {
  const loginUrl = `${env.frontendOrigin}/login`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 28px;">
      <div style="display: inline-block; width: 56px; height: 56px; background-color: #dcfce7; border-radius: 50%; margin-bottom: 16px; line-height: 56px; text-align: center;">
        <span style="font-size: 28px;">🎉</span>
      </div>
      <div style="display: inline-block; background-color: #dcfce7; color: #15803d; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; display: block; width: max-content; margin-left: auto; margin-right: auto;">
        Level 3 — Account Active
      </div>
      <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #0f172a;">Welcome to UEIBI!</h1>
      <p style="margin: 0; font-size: 15px; color: #475569; line-height: 1.6;">
        Great news! Account setup for <strong>${registration.companyName}</strong> is complete and your workspace is fully activated.
      </p>
    </div>

    <!-- Active Account Details Card -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 16px 0; font-size: 14px; text-transform: uppercase; tracking: 0.5px; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Workspace Overview</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 14px; line-height: 1.8;">
        <tr>
          <td style="color: #64748b; width: 40%; font-weight: 500;">Company Name:</td>
          <td style="color: #0f172a; font-weight: 600;">${registration.companyName}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Domain:</td>
          <td style="color: #0f172a; font-weight: 600;">${registration.domainName}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Tenant Code:</td>
          <td style="color: #4f46e5; font-family: monospace; font-weight: 700;">${registration.tenantCode || 'ACTIVE'}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Active Licenses:</td>
          <td style="color: #0f172a; font-weight: 600;">${registration.licenseQuantity || 1} licenses</td>
        </tr>
      </table>
    </div>

    <!-- Login CTA -->
    <div style="text-align: center; margin: 32px 0;">
      <a href="${loginUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 8px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
        Log In to UEIBI Portal &rarr;
      </a>
    </div>

    <p style="margin: 0; font-size: 13px; color: #64748b; text-align: center; line-height: 1.5;">
      You can log in using your registered administrator email: <strong>${registration.email}</strong>.
    </p>
  `;

  return renderEmailWrapper({
    title: `Account Activated: Welcome to UEIBI (${registration.companyName})`,
    preheader: `Your account for ${registration.companyName} is now active!`,
    contentHtml,
  });
}
