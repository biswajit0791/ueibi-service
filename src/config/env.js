import 'dotenv/config';

const required = ['DATABASE_URL'];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[env] Missing required environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',

  // Email (Zoho SMTP / SendGrid / Console)
  mailTransport: process.env.MAIL_TRANSPORT || 'smtp',
  mailHost: process.env.MAIL_HOST || 'mail.ueibi.com',
  mailPort: parseInt(process.env.MAIL_PORT || '465', 10),
  mailEncryption: process.env.MAIL_ENCRYPTION || 'ssl',
  mailUsername: process.env.MAIL_USERNAME || 'administrator@ueibi.com',
  mailPassword: process.env.MAIL_PASSWORD || 'QKwp34MHkHgcz',
  mailFrom: process.env.MAIL_FROM_ADDRESS || process.env.MAIL_FROM || 'noreply@ueibi.com',
  sendgridApiKey: process.env.SENDGRID_API_KEY,
  ueibiNotifyEmail: process.env.UEIBI_NOTIFY_EMAIL || 'ops@ueibi.local',

  licenseUnitPrice: parseFloat(process.env.LICENSE_UNIT_PRICE || '3999'),
  gstRate: parseFloat(process.env.GST_RATE || '0.18'),

  otpTtlMinutes: parseInt(process.env.OTP_TTL_MINUTES || '10', 10),
  otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
  actionTokenTtlDays: parseInt(process.env.ACTION_TOKEN_TTL_DAYS || '14', 10),

  appPassword: process.env.APP_PASSWORD || 'YourStrongPasswordHere',
  adminSessionCookieName: process.env.ADMIN_SESSION_COOKIE_NAME || 'admin_session',
  adminSessionTtlMs: parseInt(process.env.ADMIN_SESSION_TTL_MS || String(24 * 60 * 60 * 1000), 10),
  jwtSecret: process.env.JWT_SECRET || process.env.APP_PASSWORD || 'YourStrongPasswordHere',
};
