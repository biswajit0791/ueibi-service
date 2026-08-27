-- CreateTable
CREATE TABLE `company_registrations` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL,
    `companyType` VARCHAR(191) NOT NULL,
    `domainName` VARCHAR(191) NOT NULL,
    `tenantCode` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `designation` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `financeEmail` VARCHAR(191) NOT NULL,
    `hrEmail` VARCHAR(191) NOT NULL,
    `acceptedTermsAt` DATETIME(3) NOT NULL,
    `gstin` VARCHAR(191) NULL,
    `licenseQuantity` INTEGER NULL,
    `unitPrice` DECIMAL(10, 2) NULL,
    `couponId` VARCHAR(191) NULL,
    `discountAmount` DECIMAL(10, 2) NULL,
    `subtotalAmount` DECIMAL(10, 2) NULL,
    `gstRate` DECIMAL(5, 4) NULL,
    `gstAmount` DECIMAL(10, 2) NULL,
    `totalAmount` DECIMAL(10, 2) NULL,
    `paymentMethod` ENUM('ONLINE', 'CHEQUE') NULL,
    `paymentReference` VARCHAR(191) NULL,
    `chequeNumber` VARCHAR(191) NULL,
    `chequeDate` DATETIME(3) NULL,
    `transactionId` VARCHAR(191) NULL,
    `financeApprovedAt` DATETIME(3) NULL,
    `activatedAt` DATETIME(3) NULL,
    `status` ENUM('PENDING_FINANCE_REVIEW', 'PENDING_CHEQUE_CONFIRMATION', 'PENDING_HR_ACTIVATION', 'ACTIVE') NOT NULL DEFAULT 'PENDING_FINANCE_REVIEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `company_registrations_domainName_key`(`domainName`),
    UNIQUE INDEX `company_registrations_tenantCode_key`(`tenantCode`),
    UNIQUE INDEX `company_registrations_email_key`(`email`),
    INDEX `company_registrations_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_verifications` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `domainName` VARCHAR(191) NOT NULL,
    `otpHash` VARCHAR(191) NOT NULL,
    `otpExpiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `verifiedAt` DATETIME(3) NULL,
    `verificationToken` VARCHAR(191) NULL,
    `verificationTokenExpiresAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_verifications_verificationToken_key`(`verificationToken`),
    INDEX `email_verifications_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registration_action_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NOT NULL,
    `role` ENUM('FINANCE', 'HR') NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `registration_action_tokens_tokenHash_key`(`tokenHash`),
    INDEX `registration_action_tokens_registrationId_role_idx`(`registrationId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `discountType` ENUM('PERCENT', 'FLAT') NOT NULL,
    `discountValue` DECIMAL(10, 2) NOT NULL,
    `bdmName` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `usageLimit` INTEGER NULL,
    `timesUsed` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupons_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_logs` (
    `id` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NULL,
    `event` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `bodyText` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_logs_registrationId_idx`(`registrationId`),
    INDEX `notification_logs_event_idx`(`event`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `company_registrations` ADD CONSTRAINT `company_registrations_couponId_fkey` FOREIGN KEY (`couponId`) REFERENCES `coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registration_action_tokens` ADD CONSTRAINT `registration_action_tokens_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `company_registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_logs` ADD CONSTRAINT `notification_logs_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `company_registrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
