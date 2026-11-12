import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const DEFAULT_CONFIGURATIONS = [
  // ── Pricing Category ──
  {
    key: 'LICENSE_UNIT_PRICE',
    value: '3999',
    dataType: 'NUMBER',
    category: 'PRICING',
    label: 'Employee License Unit Price',
    description: 'Annual cost in INR per employee license for newly registered companies.',
    isActive: true,
  },
  {
    key: 'CURRENCY',
    value: 'INR',
    dataType: 'STRING',
    category: 'PRICING',
    label: 'Billing Currency',
    description: 'Default standard currency code for registration transactions.',
    isActive: true,
  },
  {
    key: 'MIN_LICENSE_QUANTITY',
    value: '1',
    dataType: 'NUMBER',
    category: 'PRICING',
    label: 'Minimum License Purchase Quantity',
    description: 'Minimum license count allowed during company MOU signup.',
    isActive: true,
  },
  {
    key: 'MAX_LICENSE_QUANTITY',
    value: '10000',
    dataType: 'NUMBER',
    category: 'PRICING',
    label: 'Maximum License Purchase Quantity',
    description: 'Maximum license count allowed during company MOU signup.',
    isActive: true,
  },
  {
    key: 'LICENSE_PRICING_ACTIVE',
    value: 'true',
    dataType: 'BOOLEAN',
    category: 'PRICING',
    label: 'License Pricing Status',
    description: 'Master switch enabling employee license pricing on registration.',
    isActive: true,
  },

  // ── Tax Category ──
  {
    key: 'GST_RATE',
    value: '0.18',
    dataType: 'PERCENT',
    category: 'TAX',
    label: 'Goods & Services Tax (GST) Rate',
    description: 'Applicable tax rate as a decimal (e.g. 0.18 for 18%).',
    isActive: true,
  },
  {
    key: 'TAX_ENABLED',
    value: 'true',
    dataType: 'BOOLEAN',
    category: 'TAX',
    label: 'Tax Calculation Enabled',
    description: 'Enable or disable statutory tax addition during checkout.',
    isActive: true,
  },
  {
    key: 'TAX_DISPLAY_NAME',
    value: 'GST',
    dataType: 'STRING',
    category: 'TAX',
    label: 'Tax Display Name',
    description: 'Display label shown on summary card and invoices (e.g., GST).',
    isActive: true,
  },
  {
    key: 'TAX_CALCULATION_METHOD',
    value: 'EXCLUSIVE',
    dataType: 'STRING',
    category: 'TAX',
    label: 'Tax Calculation Method',
    description: 'Tax calculated on top of subtotal (EXCLUSIVE) or included in license unit price (INCLUSIVE).',
    isActive: true,
  },
  {
    key: 'TAX_ACTIVE',
    value: 'true',
    dataType: 'BOOLEAN',
    category: 'TAX',
    label: 'Tax Configuration Status',
    description: 'Master toggle for active tax rules.',
    isActive: true,
  },

  // ── OTP Category ──
  {
    key: 'OTP_TTL_MINUTES',
    value: '10',
    dataType: 'NUMBER',
    category: 'OTP',
    label: 'OTP Expiry Time (Minutes)',
    description: 'Time-to-live for email verification OTP codes.',
    isActive: true,
  },
  {
    key: 'OTP_MAX_ATTEMPTS',
    value: '5',
    dataType: 'NUMBER',
    category: 'OTP',
    label: 'Maximum Verification Attempts',
    description: 'Max wrong code attempts allowed before OTP challenge is locked.',
    isActive: true,
  },
  {
    key: 'OTP_RESEND_COOLDOWN_SECONDS',
    value: '60',
    dataType: 'NUMBER',
    category: 'OTP',
    label: 'OTP Resend Cooldown (Seconds)',
    description: 'Mandatory wait time between consecutive OTP resend requests.',
    isActive: true,
  },
  {
    key: 'OTP_MAX_RESEND_ATTEMPTS',
    value: '3',
    dataType: 'NUMBER',
    category: 'OTP',
    label: 'Maximum Resend Attempts',
    description: 'Maximum times an OTP can be resent per challenge session.',
    isActive: true,
  },
  {
    key: 'OTP_LENGTH',
    value: '6',
    dataType: 'NUMBER',
    category: 'OTP',
    label: 'OTP Code Length',
    description: 'Number of digits in generated verification code.',
    isActive: true,
  },

  // ── Action Token Category ──
  {
    key: 'ACTION_TOKEN_TTL_DAYS',
    value: '14',
    dataType: 'NUMBER',
    category: 'ACTION_TOKEN',
    label: 'Action Token Expiry (Days)',
    description: 'Validity duration for Finance review and HR activation action links.',
    isActive: true,
  },
  {
    key: 'ACTION_TOKEN_ENABLED',
    value: 'true',
    dataType: 'BOOLEAN',
    category: 'ACTION_TOKEN',
    label: 'Action Tokens Status',
    description: 'Master toggle for action token link generation.',
    isActive: true,
  },

  // ── Login Security & Two-Factor Authentication (2FA) ──
  {
    key: 'LOGIN_2FA_ENABLED',
    value: 'true',
    dataType: 'BOOLEAN',
    category: 'SECURITY',
    label: 'Email Two-Factor Authentication (2FA)',
    description: 'Require email OTP verification on user login before issuing authenticated sessions.',
    isActive: true,
  },
  {
    key: 'LOGIN_2FA_ENFORCEMENT',
    value: 'MANDATORY',
    dataType: 'STRING',
    category: 'SECURITY',
    label: '2FA Enforcement Mode',
    description: 'MANDATORY enforces 2FA for all accounts. OPTIONAL allows users without 2FA enforcement to bypass.',
    isActive: true,
  },
  {
    key: 'LOGIN_2FA_ROLES',
    value: 'ALL',
    dataType: 'STRING',
    category: 'SECURITY',
    label: 'Enforced Roles',
    description: 'ALL applies to all roles, or specify comma-separated roles e.g. PLATFORM_OWNER,CMD,HR,FINANCE,EMPLOYEE.',
    isActive: true,
  },
  {
    key: 'LOGIN_MAX_ACTIVE_CHALLENGES',
    value: '5',
    dataType: 'NUMBER',
    category: 'SECURITY',
    label: 'Maximum Active Login Challenges',
    description: 'Maximum concurrent unexpired login challenges allowed per user account.',
    isActive: true,
  },
];

/**
 * Idempotently seeds default configurations.
 * Crucial: If a record already exists, it does NOT overwrite value or updatedBy,
 * preserving any modifications made by the Platform Owner!
 */
export async function seedRegistrationConfigurations() {
  console.log('⚙️  Seeding Registration Configurations...');
  let createdCount = 0;
  let preservedCount = 0;

  for (const cfg of DEFAULT_CONFIGURATIONS) {
    const existing = await prisma.registrationConfiguration.findUnique({
      where: { key: cfg.key },
    });

    if (!existing) {
      const created = await prisma.registrationConfiguration.create({
        data: {
          ...cfg,
          updatedBy: 'SYSTEM_SEED',
        },
      });

      await prisma.registrationConfigurationAudit.create({
        data: {
          configurationId: created.id,
          key: created.key,
          oldValue: null,
          newValue: created.value,
          category: created.category,
          reason: 'Initial system seed default value',
          changedBy: 'SYSTEM_SEED',
        },
      });

      createdCount++;
    } else {
      // Preserve existing value, only ensure metadata (label, description, dataType) is up to date
      await prisma.registrationConfiguration.update({
        where: { id: existing.id },
        data: {
          label: cfg.label,
          description: cfg.description,
          dataType: cfg.dataType,
          category: cfg.category,
        },
      });
      preservedCount++;
    }
  }

  console.log(`✅ Registration Configurations seeded: ${createdCount} created, ${preservedCount} preserved.`);
  return { createdCount, preservedCount };
}

// Direct execution support
if (process.argv[1]?.endsWith('seed-registration-configurations.js')) {
  seedRegistrationConfigurations()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error('❌ Failed to seed registration configurations:', err);
      prisma.$disconnect();
      process.exit(1);
    });
}

