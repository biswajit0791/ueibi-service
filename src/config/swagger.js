import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'UEIBI API',
      version: '0.1.0',
      description:
        'UEIBI Company Registration & Onboarding API.\n\n' +
        'The registration workflow has three levels:\n' +
        '1. **Level 1 — CMD/Director** submits company registration (MOU signup)\n' +
        '2. **Level 2 — Finance** reviews pricing, applies coupons, approves payment\n' +
        '3. **Level 3 — HR** activates the company account\n\n' +
        'Admin endpoints manage coupons and require cookie-based session auth.',
      contact: { name: 'UEIBI', email: 'ops@ueibi.com' },
    },
    servers: [
      { url: 'http://localhost:4000/api', description: 'Local development' },
    ],
    tags: [
      { name: 'Health', description: 'Server & database health checks' },
      { name: 'Registration', description: 'Level 1 — Company registration (OTP verification + signup)' },
      { name: 'Finance', description: 'Level 2 — Finance review, pricing & payment approval' },
      { name: 'HR', description: 'Level 3 — HR activation of company accounts' },
      { name: 'Admin Session', description: 'Admin authentication (password-based cookie session)' },
      { name: 'Admin Coupons', description: 'CRUD operations for discount coupons (requires admin session)' },
      { name: 'Auth', description: 'User authentication & sessions (JWT-based)' },
      { name: 'Employees', description: 'User & Employee directory management' },
      { name: 'Tasks', description: 'Task board, dependencies, comments, and audit logs' },
      { name: 'Goals', description: 'Goal & OKR management' },
      { name: 'Notifications', description: 'Real-time alert notifications' },
      { name: 'Leaves & WFH', description: 'Leave & Work From Home applications, dynamic balances, and two-level approval workflow' },
      { name: 'Appraisals', description: 'Employee self-ratings, manager evaluations, and performance reviews' },
      { name: 'External Reviews', description: 'Client & external stakeholder performance review requests and submissions' },
      { name: 'Reports & Analytics', description: 'Enterprise performance and HR analytics summary' },
      { name: 'Policies & Compliance', description: 'Corporate policies, electronic signatures, versioning, reminders, and auditable compliance registry' },
      { name: 'Uploads', description: 'Secure document and file uploads' },
      { name: 'Company Hub', description: 'Team directory and personal hub profile management' },
      { name: 'Dev', description: 'Development-only endpoints (disabled in production)' },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Something went wrong' },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Validation failed' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string', example: 'too_small' },
                  message: { type: 'string', example: 'String must contain at least 1 character(s)' },
                  path: { type: 'array', items: { type: 'string' }, example: ['companyName'] },
                },
              },
            },
          },
        },

        // ── Company Hub schemas ──
        HubTeamMember: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clxyz123' },
            name: { type: 'string', example: 'Jane Doe' },
            role: { type: 'string', example: 'EMPLOYEE' },
            designation: { type: 'string', example: 'Software Engineer' },
            department: { type: 'string', example: 'Engineering' },
            status: { type: 'string', example: 'ACTIVE' },
            joinDate: { type: 'string', format: 'date-time', nullable: true, example: '2024-01-15T00:00:00.000Z' },
            hubBio: { type: 'string', example: 'Passionate about building great products.' },
            hubBirthday: { type: 'string', nullable: true, example: 'June 15 1990' },
            profileSnaps: { type: 'array', items: { type: 'string', format: 'uri' }, example: ['https://cdn.example.com/snap1.jpg'] },
            initials: { type: 'string', example: 'JD' },
          },
        },
        UpdateHubProfileRequest: {
          type: 'object',
          properties: {
            hubBio: { type: 'string', maxLength: 500, example: 'Passionate about building great products.' },
            hubBirthday: { type: 'string', maxLength: 50, nullable: true, example: 'June 15 1990', description: 'Social birthday display string, e.g. "June 15" or "June 15 1990"' },
            profileSnaps: {
              type: 'array',
              maxItems: 10,
              items: { type: 'string', format: 'uri' },
              example: ['https://cdn.example.com/snap1.jpg', 'https://cdn.example.com/snap2.jpg'],
            },
          },
          description: 'At least one field must be provided',
        },
        HubProfileResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Hub profile updated successfully' },
            profile: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'clxyz123' },
                name: { type: 'string', example: 'Jane Doe' },
                hubBio: { type: 'string', example: 'Passionate about building great products.' },
                hubBirthday: { type: 'string', format: 'date', nullable: true, example: '1990-06-15' },
                profileSnaps: { type: 'array', items: { type: 'string', format: 'uri' }, example: [] },
              },
            },
          },
        },
        HubEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'ev_123456789' },
            tenantId: { type: 'string', example: 'tenant_abc' },
            createdById: { type: 'string', example: 'user_xyz' },
            postedBy: { type: 'string', example: 'Priya Menon' },
            title: { type: 'string', example: 'Tech Innovation Hackathon' },
            date: { type: 'string', example: 'August 05, 2026' },
            time: { type: 'string', nullable: true, example: '09:00 AM' },
            location: { type: 'string', nullable: true, example: 'L4 Hack Space' },
            description: { type: 'string', example: '48-hour build cycle focusing on AI prompt caches.' },
            isFeatured: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateHubEventRequest: {
          type: 'object',
          required: ['title', 'date', 'description'],
          properties: {
            title: { type: 'string', example: 'Summer Outing 2026', minLength: 3, maxLength: 120 },
            date: { type: 'string', example: 'July 18, 2026', minLength: 1, maxLength: 60 },
            time: { type: 'string', nullable: true, example: '10:00 AM', maxLength: 40 },
            location: { type: 'string', nullable: true, example: 'Mountain Breeze Resort', maxLength: 150 },
            description: { type: 'string', example: 'Guidelines and transport details for all employees...', minLength: 5, maxLength: 2000 },
            isFeatured: { type: 'boolean', example: true },
            postedBy: { type: 'string', nullable: true, example: 'Priya Menon (HR Lead)', maxLength: 100 },
          },
        },
        UpdateHubEventRequest: {
          type: 'object',
          description: 'At least one field must be provided to update',
          properties: {
            title: { type: 'string', example: 'Summer Outing 2026 (Updated)', minLength: 3, maxLength: 120 },
            date: { type: 'string', example: 'July 25, 2026', minLength: 1, maxLength: 60 },
            time: { type: 'string', nullable: true, example: '11:00 AM', maxLength: 40 },
            location: { type: 'string', nullable: true, example: 'Mountain Breeze Resort Hall B', maxLength: 150 },
            description: { type: 'string', example: 'Updated guidelines and transport schedule...', minLength: 5, maxLength: 2000 },
            isFeatured: { type: 'boolean', example: true },
            postedBy: { type: 'string', nullable: true, example: 'Priya Menon (HR Lead)', maxLength: 100 },
          },
        },
        HubEventsListResponse: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/HubEvent' },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 6 },
                total: { type: 'integer', example: 12 },
                totalPages: { type: 'integer', example: 2 },
                hasNextPage: { type: 'boolean', example: true },
                hasPrevPage: { type: 'boolean', example: false },
              },
            },
          },
        },

        // ── Registration schemas ──
        OtpRequest: {
          type: 'object',
          required: ['email', 'domainName'],
          properties: {
            email: { type: 'string', format: 'email', example: 'ceo@acme.com' },
            domainName: { type: 'string', example: 'acme.com' },
          },
        },
        OtpResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'OTP sent' },
            expiresInSeconds: { type: 'integer', example: 600 },
          },
        },
        OtpVerifyRequest: {
          type: 'object',
          required: ['email', 'otp'],
          properties: {
            email: { type: 'string', format: 'email', example: 'ceo@acme.com' },
            otp: { type: 'string', minLength: 6, maxLength: 6, example: '482910' },
          },
        },
        OtpVerifyResponse: {
          type: 'object',
          properties: {
            verificationToken: { type: 'string', example: 'a1b2c3d4e5f6...' },
            expiresInSeconds: { type: 'integer', example: 1800 },
          },
        },
        RegistrationRequest: {
          type: 'object',
          required: [
            'companyName', 'companyType', 'domainName', 'fullName', 'designation',
            'email', 'password', 'confirmPassword', 'financeEmail', 'hrEmail',
            'acceptedTerms', 'verificationToken',
          ],
          properties: {
            companyName: { type: 'string', example: 'Acme Corp' },
            companyType: {
              type: 'string',
              enum: ['Private Limited', 'Public Limited', 'LLP', 'Partnership', 'Proprietorship', 'Other'],
              example: 'Private Limited',
            },
            domainName: { type: 'string', example: 'acme.com' },
            fullName: { type: 'string', example: 'John Doe' },
            designation: { type: 'string', enum: ['CMD', 'DIRECTOR'], example: 'CMD' },
            email: { type: 'string', format: 'email', example: 'ceo@acme.com' },
            password: { type: 'string', minLength: 8, example: 'Str0ngP@ss' },
            confirmPassword: { type: 'string', minLength: 8, example: 'Str0ngP@ss' },
            financeEmail: { type: 'string', format: 'email', example: 'finance@acme.com' },
            hrEmail: { type: 'string', format: 'email', example: 'hr@acme.com' },
            acceptedTerms: { type: 'boolean', enum: [true], example: true },
            verificationToken: { type: 'string', example: 'a1b2c3d4e5f6...' },
          },
        },
        RegistrationResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clxyz1234567890' },
            status: { type: 'string', enum: ['PENDING_FINANCE_REVIEW'], example: 'PENDING_FINANCE_REVIEW' },
          },
        },

        // ── Finance schemas ──
        FinanceSummary: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'PENDING_FINANCE_REVIEW' },
            pendingCheque: { type: 'boolean', example: false },
            companyName: { type: 'string', example: 'Acme Corp' },
            companyType: { type: 'string', example: 'Private Limited' },
            domainName: { type: 'string', example: 'acme.com' },
            fullName: { type: 'string', example: 'John Doe' },
            designation: { type: 'string', example: 'CMD' },
            email: { type: 'string', format: 'email', example: 'ceo@acme.com' },
            unitPrice: { type: 'number', example: 3999 },
            gstRate: { type: 'number', example: 0.18 },
          },
        },
        PricingPreviewRequest: {
          type: 'object',
          required: ['licenseQuantity'],
          properties: {
            licenseQuantity: { type: 'integer', minimum: 1, example: 50 },
            couponCode: { type: 'string', example: 'SAVE20' },
            gstin: { type: 'string', example: '22AAAAA0000A1Z5' },
          },
        },
        PricingPreviewResponse: {
          type: 'object',
          properties: {
            unitPrice: { type: 'number', example: 3999 },
            quantity: { type: 'integer', example: 50 },
            subtotal: { type: 'number', example: 199950 },
            discountAmount: { type: 'number', example: 39990 },
            gstRate: { type: 'number', example: 0.18 },
            gstAmount: { type: 'number', example: 28792.8 },
            total: { type: 'number', example: 188752.8 },
            couponValid: { type: 'boolean', example: true },
            couponError: { type: 'string', nullable: true, example: null },
          },
        },
        FinanceApproveRequest: {
          type: 'object',
          required: ['licenseQuantity', 'gstin', 'paymentMethod'],
          properties: {
            licenseQuantity: { type: 'integer', minimum: 1, example: 50 },
            gstin: { type: 'string', example: '22AAAAA0000A1Z5' },
            couponCode: { type: 'string', example: 'SAVE20' },
            paymentMethod: { type: 'string', enum: ['ONLINE', 'CHEQUE'], example: 'ONLINE' },
          },
        },
        FinanceApproveResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'PENDING_HR_ACTIVATION' },
            paymentReference: { type: 'string', example: 'STUB-L3KD9F2' },
          },
        },
        ConfirmChequeRequest: {
          type: 'object',
          required: ['chequeNumber', 'chequeDate', 'transactionId'],
          properties: {
            chequeNumber: { type: 'string', example: '123456' },
            chequeDate: { type: 'string', format: 'date', example: '2026-09-01' },
            transactionId: { type: 'string', example: 'TXN-20260901-001' },
          },
        },

        // ── HR schemas ──
        HrSummary: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'PENDING_HR_ACTIVATION' },
            companyName: { type: 'string', example: 'Acme Corp' },
            companyType: { type: 'string', example: 'Private Limited' },
            domainName: { type: 'string', example: 'acme.com' },
            fullName: { type: 'string', example: 'John Doe' },
            designation: { type: 'string', example: 'CMD' },
            email: { type: 'string', format: 'email', example: 'ceo@acme.com' },
            licenseQuantity: { type: 'integer', example: 50 },
            totalAmount: { type: 'string', example: '188752.80' },
            paymentMethod: { type: 'string', example: 'ONLINE' },
            paymentReference: { type: 'string', example: 'STUB-L3KD9F2' },
          },
        },

        // ── Admin schemas ──
        AdminLoginRequest: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', example: 'YourStrongPasswordHere' },
          },
        },

        // ── Coupon schemas ──
        Coupon: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clxyz1234567890' },
            code: { type: 'string', example: 'SAVE20' },
            discountType: { type: 'string', enum: ['PERCENT', 'FLAT'], example: 'PERCENT' },
            discountValue: { type: 'string', example: '20.00' },
            bdmName: { type: 'string', nullable: true, example: 'John Sales' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            usageLimit: { type: 'integer', nullable: true, example: 100 },
            timesUsed: { type: 'integer', example: 5 },
            active: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CouponCreateRequest: {
          type: 'object',
          required: ['code', 'discountType', 'discountValue'],
          properties: {
            code: { type: 'string', example: 'SAVE20' },
            discountType: { type: 'string', enum: ['PERCENT', 'FLAT'], example: 'PERCENT' },
            discountValue: { type: 'number', example: 20 },
            bdmName: { type: 'string', example: 'John Sales' },
            expiresAt: { type: 'string', format: 'date-time' },
            usageLimit: { type: 'integer', minimum: 1, example: 100 },
            active: { type: 'boolean', example: true },
          },
        },
        CouponUpdateRequest: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'SAVE25' },
            discountType: { type: 'string', enum: ['PERCENT', 'FLAT'] },
            discountValue: { type: 'number' },
            bdmName: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
            usageLimit: { type: 'integer', minimum: 1 },
            active: { type: 'boolean' },
          },
        },

        // ── Notification (dev) ──
        NotificationLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            registrationId: { type: 'string', nullable: true },
            event: { type: 'string', example: 'LEVEL1_SUBMITTED' },
            recipient: { type: 'string', format: 'email' },
            subject: { type: 'string' },
            bodyText: { type: 'string' },
            status: { type: 'string', example: 'sent' },
            providerMessageId: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        
        // ── User Auth schemas ──
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'arjun@acmecorp.com' },
            password: { type: 'string', example: 'password123' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsIn...' },
            user: { $ref: '#/components/schemas/Employee' },
          },
        },
        ForgotPasswordRequest: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', example: 'arjun@acmecorp.com' },
          },
        },
        ForgotPasswordResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'If an account exists for this email address, a password reset link has been sent.' },
          },
        },
        ResetPasswordRequest: {
          type: 'object',
          required: ['token', 'newPassword'],
          properties: {
            token: { type: 'string', example: '4a6b2c8d1e3f...' },
            newPassword: { type: 'string', minLength: 8, maxLength: 128, example: 'NewStr0ngP@ss123' },
          },
        },
        ResetPasswordResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Password reset successfully.' },
          },
        },

        // ── Employee schemas ──
        Employee: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clxyz1234567890' },
            email: { type: 'string', format: 'email', example: 'arjun@acmecorp.com' },
            name: { type: 'string', example: 'Arjun Sharma' },
            role: { type: 'string', enum: ['SUPER_ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE', 'STUDENT', 'MENTOR'], example: 'EMPLOYEE' },
            status: { type: 'string', enum: ['INVITED', 'ACTIVE', 'EXITED'], example: 'ACTIVE' },
            mustChangePassword: { type: 'boolean', example: false },
            tenantId: { type: 'string', example: 'cltenant123' },
            companyName: { type: 'string', example: 'Acme Corp' },
            designation: { type: 'string', example: 'Senior Engineer' },
            department: { type: 'string', example: 'Engineering' },
            band: { type: 'string', example: 'L4' },
            phone: { type: 'string', example: '+919876543210' },
            pan: { type: 'string', example: 'ABCDE1234F' },
            aadhaar: { type: 'string', example: '123456789012' },
            dob: { type: 'string', format: 'date' },
            joinDate: { type: 'string', format: 'date' },
          },
        },
        InviteEmployeeRequest: {
          type: 'object',
          required: ['email', 'name'],
          properties: {
            email: { type: 'string', format: 'email', example: 'new hire@acmecorp.com' },
            name: { type: 'string', example: 'Ravi Teja' },
            role: { type: 'string', enum: ['HR', 'FINANCE', 'MANAGER', 'EMPLOYEE'], example: 'EMPLOYEE' },
            designation: { type: 'string', example: 'Backend Engineer' },
            department: { type: 'string', example: 'Engineering' },
          },
        },
        OnboardEmployeeRequest: {
          type: 'object',
          required: ['newPassword'],
          properties: {
            newPassword: { type: 'string', minLength: 8, example: 'newSecurePassword123' },
            phone: { type: 'string', example: '+919876543210' },
            pan: { type: 'string', maxLength: 10, example: 'ABCDE1234F' },
            aadhaar: { type: 'string', maxLength: 12, example: '123456789012' },
            dob: { type: 'string', format: 'date' },
          },
        },

        // ── Task schemas ──
        TaskDependency: {
          type: 'object',
          required: ['type', 'concernedPersonId', 'title', 'dueDate'],
          properties: {
            type: { type: 'string', enum: ['pre', 'post'], example: 'pre' },
            concernedPersonId: { type: 'string', example: 'cluser12345' },
            concernedPersonName: { type: 'string', example: 'Pratik Parida' },
            concernedManagerId: { type: 'string', example: 'cluser67890' },
            concernedManagerName: { type: 'string', example: 'Biswajit HR' },
            title: { type: 'string', example: 'Design microservices schemas' },
            description: { type: 'string', nullable: true, example: 'What is needed and why...' },
            dueDate: { type: 'string', format: 'date', example: '2026-08-31' },
            status: { type: 'string', enum: ['pending_approval', 'approved', 'rejected', 'completed'], example: 'pending_approval' },
            createdTaskId: { type: 'string', example: 'cltask98765' },
            isManuallyHeldByOwnManager: { type: 'boolean', example: false },
            manualHoldRequested: { type: 'boolean', example: false },
          },
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'cltask12345' },
            title: { type: 'string', example: 'Setup e-commerce routes' },
            priority: { type: 'string', enum: ['high', 'critical', 'medium', 'low'], example: 'medium' },
            status: { type: 'string', enum: ['todo', 'in_progress', 'pending_on_others', 'in_review', 'done'], example: 'todo' },
            startDate: { type: 'string', format: 'date', nullable: true, example: '2026-08-28' },
            dueDate: { type: 'string', format: 'date', nullable: true, example: '2026-08-30' },
            financialYear: { type: 'string', nullable: true, example: 'FY 2026-27' },
            tags: { type: 'string', nullable: true, example: 'backend,routes' },
            goalId: { type: 'string', nullable: true, example: 'clgoal12345' },
            isPrivate: { type: 'boolean', example: false },
            isStandalone: { type: 'boolean', example: false },
            weight: { type: 'integer', example: 3 },
            description: { type: 'string', nullable: true, example: 'Create endpoints for adding items to cart' },
            employeeId: { type: 'string', example: 'cmtclxzzq0001uuek23nbb04s' },
            dependency: { $ref: '#/components/schemas/TaskDependency', nullable: true },
            isDependencyOf: { type: 'string', nullable: true, example: null },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        TaskCreateRequest: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', example: 'Setup e-commerce routes' },
            priority: { type: 'string', enum: ['high', 'critical', 'medium', 'low'], example: 'medium' },
            startDate: { type: 'string', format: 'date', example: '2026-08-28' },
            dueDate: { type: 'string', format: 'date', example: '2026-08-30' },
            financialYear: { type: 'string', example: 'FY 2026-27' },
            tags: { type: 'string', example: 'backend,routes' },
            goalId: { type: 'string', example: 'clgoal12345' },
            isPrivate: { type: 'boolean', example: false },
            isStandalone: { type: 'boolean', example: false },
            weight: { type: 'integer', example: 3 },
            description: { type: 'string', example: 'Create endpoints for adding items to cart' },
            employeeId: { type: 'string', example: 'cmtclxzzq0001uuek23nbb04s' },
            dependency: { $ref: '#/components/schemas/TaskDependency', nullable: true },
            isDependencyOf: { type: 'string', nullable: true },
          },
        },
        TaskUpdateRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            priority: { type: 'string', enum: ['high', 'critical', 'medium', 'low'] },
            status: { type: 'string', enum: ['todo', 'in_progress', 'pending_on_others', 'in_review', 'done'] },
            startDate: { type: 'string', format: 'date' },
            dueDate: { type: 'string', format: 'date' },
            financialYear: { type: 'string' },
            tags: { type: 'string' },
            goalId: { type: 'string', nullable: true },
            isPrivate: { type: 'boolean' },
            isStandalone: { type: 'boolean' },
            weight: { type: 'integer' },
            description: { type: 'string' },
            dependency: { $ref: '#/components/schemas/TaskDependency', nullable: true },
            isDependencyOf: { type: 'string', nullable: true },
          },
        },
        TaskCommentAttachment: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'att_1725183829_abc123' },
            originalName: { type: 'string', example: 'architecture_diagram.png' },
            storedName: { type: 'string', example: '1725183829-abc123-architecture_diagram.png' },
            mimeType: { type: 'string', example: 'image/png' },
            size: { type: 'integer', example: 245123 },
            storageKey: { type: 'string', example: 'tenants/tenant123/tasks/task456/1725183829-abc123-architecture_diagram.png' },
            storageProvider: { type: 'string', example: 'LOCAL' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        TaskComment: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clcomment12345' },
            taskId: { type: 'string', example: 'cltask12345' },
            authorId: { type: 'string', example: 'cmtclxzzq0001uuek23nbb04s' },
            comment: { type: 'string', example: 'Finished schema design.' },
            attachments: {
              type: 'array',
              items: { $ref: '#/components/schemas/TaskCommentAttachment' },
            },
            createdAt: { type: 'string', format: 'date-time' },
            author: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                role: { type: 'string' },
                designation: { type: 'string', nullable: true }
              }
            }
          },
        },
        TaskAuditLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            taskId: { type: 'string' },
            performedById: { type: 'string' },
            action: { type: 'string', example: 'status_changed' },
            details: { type: 'string', example: 'Status updated to IN PROGRESS.' },
            createdAt: { type: 'string', format: 'date-time' },
            performedBy: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                role: { type: 'string' }
              }
            }
          },
        },
        
        GoalAssignment: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'ga_clxyz123' },
            tenantId: { type: 'string', example: 'tenant_abc' },
            goalId: { type: 'string', example: 'clgoal123' },
            employeeId: { type: 'string', example: 'emp_456' },
            assignedById: { type: 'string', nullable: true, example: 'mgr_789' },
            progress: { type: 'integer', example: 60, description: 'Employee-specific progress percentage (0-100)' },
            status: { type: 'string', example: 'IN_PROGRESS', description: 'Employee-specific goal status' },
            milestones: { type: 'integer', example: 3 },
            completedMilestones: { type: 'integer', example: 1 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            employee: { $ref: '#/components/schemas/Employee' },
          },
        },
        Goal: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            title: { type: 'string', example: 'Improve product stability' },
            description: { type: 'string', example: 'Refactor goals repository module to support direct tenancy.' },
            goalType: { type: 'string', example: 'General' },
            category: { type: 'string', example: 'Project Delivery' },
            priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'], example: 'medium' },
            progress: { type: 'integer', example: 45 },
            status: { type: 'string', example: 'DRAFT' },
            financialYear: { type: 'string', example: 'FY 2026-27' },
            quarter: { type: 'string', example: 'Q1' },
            startDate: { type: 'string', format: 'date-time' },
            targetDate: { type: 'string', format: 'date-time' },
            attachments: { type: 'array', items: { type: 'string' } },
            specialNotes: { type: 'string', example: 'Ensure that the indexes are added to tenantId.' },
            dueDate: { type: 'string', format: 'date' },
            employeeId: { type: 'string', nullable: true },
            milestones: { type: 'integer', example: 4 },
            completedMilestones: { type: 'integer', example: 1 },
            assignments: {
              type: 'array',
              items: { $ref: '#/components/schemas/GoalAssignment' },
              description: 'Independent relational assignments for all employees allocated to this goal',
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        GoalCreateRequest: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', example: 'Improve product stability' },
            description: { type: 'string', example: 'Refactor goals repository module to support direct tenancy.' },
            category: { type: 'string', example: 'Project Delivery' },
            goalType: { type: 'string', example: 'General' },
            priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'], example: 'medium' },
            financialYear: { type: 'string', example: 'FY 2026-27' },
            quarter: { type: 'string', example: 'Q1' },
            startDate: { type: 'string', format: 'date-time' },
            targetDate: { type: 'string', format: 'date-time' },
            dueDate: { type: 'string', format: 'date' },
            attachments: { type: 'array', items: { type: 'string' } },
            specialNotes: { type: 'string', example: 'Ensure that the indexes are added to tenantId.' },
            employeeIds: {
              type: 'array',
              items: { type: 'string' },
              example: ['emp_123', 'emp_456'],
              description: 'Array of employee IDs to assign this goal to. Validated against reporting hierarchy.',
            },
            employeeId: { type: 'string', description: 'Legacy single target employee ID (auto-normalized to employeeIds)' },
          },
        },
        GoalUpdateRequest: {
          type: 'object',
          properties: {
            title: { type: 'string', example: 'Improve product stability' },
            description: { type: 'string', example: 'Refactor goals module.' },
            category: { type: 'string', example: 'Performance & Delivery' },
            goalType: { type: 'string', example: 'OKR' },
            priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'] },
            financialYear: { type: 'string', example: 'FY 2026-27' },
            quarter: { type: 'string', example: 'Q1' },
            startDate: { type: 'string', format: 'date-time' },
            targetDate: { type: 'string', format: 'date-time' },
            specialNotes: { type: 'string' },
            status: { type: 'string', example: 'DRAFT' },
          },
        },
        GoalSubmitRequest: {
          type: 'object',
          properties: {
            comment: { type: 'string', maxLength: 1000, example: 'Completed all tasks. Ready for manager review.' },
            targetEmployeeId: { type: 'string', example: 'emp_123' },
          },
        },
        GoalApproveRequest: {
          type: 'object',
          properties: {
            comment: { type: 'string', maxLength: 1000, example: 'Approved and verified deliverables.' },
            rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            targetEmployeeId: { type: 'string', example: 'emp_123', description: 'Target assignee ID when reviewing multi-employee goals' },
          },
        },
        GoalRejectRequest: {
          type: 'object',
          required: ['comment'],
          properties: {
            comment: { type: 'string', minLength: 1, maxLength: 1000, example: 'Please complete remaining integration tests.' },
            targetEmployeeId: { type: 'string', example: 'emp_123', description: 'Target assignee ID when requesting revisions' },
          },
        },
        GoalResubmitRequest: {
          type: 'object',
          properties: {
            comment: { type: 'string', maxLength: 1000, example: 'Revised according to review feedback.' },
            targetEmployeeId: { type: 'string', example: 'emp_123' },
          },
        },
        GoalReviewRequest: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['APPROVE', 'REJECT'], example: 'APPROVE' },
            comment: { type: 'string', example: 'Goal deliverables successfully verified against SLAs.' },
            rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            targetEmployeeId: { type: 'string', example: 'emp_123' },
          },
        },
        GoalCommentCreateRequest: {
          type: 'object',
          required: ['comment'],
          properties: {
            comment: { type: 'string', minLength: 1, maxLength: 2000, example: 'Finished all unit and integration tests.' },
            attachments: { type: 'array', items: { type: 'string' }, example: ['https://cdn.example.com/test-report.pdf'] },
          },
        },
        GoalComment: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clcomm12345' },
            goalId: { type: 'string', example: 'clgoal12345' },
            comment: { type: 'string', example: 'Progress update: completed integration testing.' },
            attachments: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            author: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                role: { type: 'string' },
                designation: { type: 'string' },
              },
            },
          },
        },
        GoalAuditLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            goalId: { type: 'string' },
            action: { type: 'string', example: 'GOAL_SUBMITTED' },
            details: { type: 'string', example: 'Arjun Sharma submitted goal for review.' },
            createdAt: { type: 'string', format: 'date-time' },
            performedBy: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },

        // ── User Notification schemas ──
        UserNotification: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            recipientId: { type: 'string' },
            type: { type: 'string', example: 'task_update' },
            title: { type: 'string', example: 'New feedback on your task' },
            body: { type: 'string', example: 'Manager added comment: "Looks great"' },
            entityType: { type: 'string', example: 'task' },
            entityId: { type: 'string' },
            isRead: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // ── Leave & WFH schemas ──
        LeaveBalanceDetail: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 18 },
            used: { type: 'integer', example: 5 },
            pending: { type: 'integer', example: 2 },
            remaining: { type: 'integer', example: 13 },
          },
        },
        LeaveBalancesResponse: {
          type: 'object',
          properties: {
            annual: { $ref: '#/components/schemas/LeaveBalanceDetail' },
            sick: { $ref: '#/components/schemas/LeaveBalanceDetail' },
            casual: { $ref: '#/components/schemas/LeaveBalanceDetail' },
            wfh: { $ref: '#/components/schemas/LeaveBalanceDetail' },
          },
        },
        LeaveRequest: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clleave12345' },
            employeeId: { type: 'string', example: 'clemp12345' },
            employee: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string', example: 'Arjun Sharma' },
                email: { type: 'string', example: 'arjun@company.com' },
                department: { type: 'string', example: 'Engineering' },
                designation: { type: 'string', example: 'Senior Engineer' },
                managerId: { type: 'string', nullable: true },
              },
            },
            type: { type: 'string', example: 'Sick Leave' },
            requestType: { type: 'string', enum: ['LEAVE', 'WFH'], example: 'LEAVE' },
            leaveType: { type: 'string', example: 'Sick Leave' },
            startDate: { type: 'string', format: 'date', example: '2026-09-02' },
            endDate: { type: 'string', format: 'date', example: '2026-09-03' },
            totalDays: { type: 'integer', example: 2 },
            reason: { type: 'string', example: 'Medical appointment' },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], example: 'PENDING' },
            managerStatus: { type: 'string', enum: ['Pending', 'Approved', 'Rejected'], example: 'Pending' },
            managerId: { type: 'string', nullable: true },
            managerComment: { type: 'string', nullable: true },
            managerActedAt: { type: 'string', format: 'date-time', nullable: true },
            hrStatus: { type: 'string', enum: ['Pending', 'Approved', 'Rejected', 'Not Required'], example: 'Pending' },
            hrId: { type: 'string', nullable: true },
            hrComment: { type: 'string', nullable: true },
            hrActedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateLeaveRequest: {
          type: 'object',
          required: ['startDate', 'endDate', 'reason'],
          properties: {
            requestType: { type: 'string', enum: ['LEAVE', 'WFH'], default: 'LEAVE' },
            leaveTypeId: { type: 'string', nullable: true, example: 'cltype12345' },
            leaveType: { type: 'string', example: 'Casual Leave' },
            startDate: { type: 'string', format: 'date', example: '2026-09-02' },
            endDate: { type: 'string', format: 'date', example: '2026-09-03' },
            dayType: { type: 'string', enum: ['FULL', 'FIRST_HALF', 'SECOND_HALF'], default: 'FULL' },
            reason: { type: 'string', example: 'Personal urgent affairs.' },
            attachmentUrl: { type: 'string', nullable: true, example: '/uploads/medical-cert.pdf' },
          },
        },
        LeaveType: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'cltype12345' },
            tenantId: { type: 'string', example: 'cltenant123' },
            name: { type: 'string', example: 'Study Leave' },
            code: { type: 'string', example: 'STUDY' },
            description: { type: 'string', nullable: true, example: 'Time off for certification exams' },
            defaultDays: { type: 'number', example: 5 },
            allocationType: { type: 'string', enum: ['ANNUAL', 'MONTHLY', 'ACCRUAL', 'LUMP_SUM'], example: 'ANNUAL' },
            year: { type: 'integer', example: 2026 },
            isPaid: { type: 'boolean', example: true },
            requiresApproval: { type: 'boolean', example: true },
            allowHalfDay: { type: 'boolean', example: true },
            allowNegativeBalance: { type: 'boolean', example: false },
            maxConsecutiveDays: { type: 'integer', nullable: true, example: 5 },
            minNoticeDays: { type: 'integer', example: 2 },
            carryForwardAllowed: { type: 'boolean', example: false },
            maxCarryForwardDays: { type: 'integer', example: 0 },
            encashmentAllowed: { type: 'boolean', example: false },
            requiresDocument: { type: 'boolean', example: true },
            documentRequiredAfterDays: { type: 'integer', example: 2 },
            isActive: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateLeaveType: {
          type: 'object',
          required: ['name', 'code'],
          properties: {
            name: { type: 'string', example: 'Study Leave' },
            code: { type: 'string', example: 'STUDY' },
            description: { type: 'string', nullable: true },
            defaultDays: { type: 'number', default: 0, example: 5 },
            allocationType: { type: 'string', enum: ['ANNUAL', 'MONTHLY', 'ACCRUAL', 'LUMP_SUM'], default: 'ANNUAL' },
            isPaid: { type: 'boolean', default: true },
            requiresApproval: { type: 'boolean', default: true },
            allowHalfDay: { type: 'boolean', default: true },
            allowNegativeBalance: { type: 'boolean', default: false },
            maxConsecutiveDays: { type: 'integer', nullable: true },
            minNoticeDays: { type: 'integer', default: 0 },
            carryForwardAllowed: { type: 'boolean', default: false },
            maxCarryForwardDays: { type: 'integer', default: 0 },
            requiresDocument: { type: 'boolean', default: false },
            documentRequiredAfterDays: { type: 'integer', default: 2 },
            isActive: { type: 'boolean', default: true },
          },
        },
        WfhPolicy: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clwfh12345' },
            tenantId: { type: 'string', example: 'cltenant123' },
            isEnabled: { type: 'boolean', example: true },
            annualDays: { type: 'number', example: 15 },
            requiresApproval: { type: 'boolean', example: true },
            maxConsecutiveDays: { type: 'integer', example: 5 },
            minNoticeDays: { type: 'integer', example: 0 },
            monthlyLimit: { type: 'integer', nullable: true },
            isActive: { type: 'boolean', example: true },
          },
        },

        // ── Appraisal schemas ──
        AppraisalCycle: {
          type: 'object',
          properties: {
            id:              { type: 'string', example: 'clcycle12345' },
            tenantId:        { type: 'string', example: 'cltenant123' },
            name:            { type: 'string', example: 'September 2026' },
            frequency:       { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'], example: 'MONTHLY' },
            year:            { type: 'integer', example: 2026 },
            month:           { type: 'string', example: 'September' },
            monthNumber:     { type: 'integer', example: 9 },
            startDate:       { type: 'string', format: 'date-time' },
            endDate:         { type: 'string', format: 'date-time' },
            status:          { type: 'string', enum: ['ACTIVE', 'CLOSED'], example: 'ACTIVE' },
            createdById:     { type: 'string', nullable: true, example: 'cluser12345' },
            createdBy:       { type: 'object', nullable: true },
            reviewCount:     { type: 'integer', example: 5 },
            nominationCount: { type: 'integer', example: 2 },
            parameters:      { type: 'array', items: { $ref: '#/components/schemas/AppraisalParameter' } },
            createdAt:       { type: 'string', format: 'date-time' },
            updatedAt:       { type: 'string', format: 'date-time' },
          },
        },
        CreateCycleRequest: {
          type: 'object',
          required: ['year'],
          properties: {
            year:        { type: 'integer', minimum: 2000, maximum: 2100, example: 2026 },
            month:       { type: 'string', example: 'September' },
            monthNumber: { type: 'integer', minimum: 1, maximum: 12, example: 9 },
            frequency:   { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'], default: 'MONTHLY', example: 'MONTHLY' },
            name:        { type: 'string', example: 'September 2026' },
            startDate:   { type: 'string', format: 'date-time' },
            endDate:     { type: 'string', format: 'date-time' },
            dueDate:     { type: 'string', format: 'date-time' },
            status:      { type: 'string', enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE', example: 'ACTIVE' },
          },
        },
        AppraisalCycleListResponse: {
          type: 'object',
          properties: {
            success:       { type: 'boolean', example: true },
            count:         { type: 'integer', example: 3 },
            distinctYears: { type: 'array', items: { type: 'integer' }, example: [2026, 2025] },
            cycles:        { type: 'array', items: { $ref: '#/components/schemas/AppraisalCycle' } },
          },
        },
        AppraisalParameter: {
          type: 'object',
          properties: {
            id:        { type: 'string', example: 'clparam12345' },
            tenantId:  { type: 'string', example: 'cltenant123' },
            cycleId:   { type: 'string', example: 'clcycle12345' },
            name:      { type: 'string', example: 'Technical Skills' },
            order:     { type: 'integer', example: 1 },
            isActive:  { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateParameterRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name:     { type: 'string', minLength: 1, maxLength: 100, example: 'Cloud Infrastructure & DevOps' },
            cycleId:  { type: 'string', example: 'clcycle12345', description: 'Target cycle ID. Defaults to active cycle if omitted' },
            order:    { type: 'integer', minimum: 1, maximum: 100, example: 6 },
            isActive: { type: 'boolean', default: true, example: true },
          },
        },
        ParameterListResponse: {
          type: 'object',
          properties: {
            success:    { type: 'boolean', example: true },
            count:      { type: 'integer', example: 5 },
            parameters: { type: 'array', items: { $ref: '#/components/schemas/AppraisalParameter' } },
          },
        },
        PerformanceReview: {
          type: 'object',
          properties: {
            id:                  { type: 'string', example: 'clreview12345' },
            cycleId:             { type: 'string', example: 'clcycle12345' },
            employeeId:          { type: 'string', example: 'cluser12345' },
            reviewType:          { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'], example: 'ANNUAL' },
            status:              { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED'], example: 'DRAFT' },
            selfAccomplishments: { type: 'string', nullable: true, example: 'Delivered the database migration on time.' },
            selfWeaknesses:      { type: 'string', nullable: true, example: 'Need to improve presentation skills.' },
            selfRating:          { type: 'number', nullable: true, example: 4.2 },
            selfSubmittedAt:     { type: 'string', format: 'date-time', nullable: true },
            managerRemarks:      { type: 'string', nullable: true, example: 'Strong technical delivery.' },
            managerRating:       { type: 'number', nullable: true, example: 4.5 },
            managerSubmittedAt:  { type: 'string', format: 'date-time', nullable: true },
            hikePercentage:      { type: 'number', nullable: true, example: 12 },
            hrSignoffStatus:     { type: 'string', enum: ['PENDING_RELEASE', 'RELEASED'], example: 'PENDING_RELEASE' },
            hrRemarks:           { type: 'string', nullable: true },
            hrSignedOffAt:       { type: 'string', format: 'date-time', nullable: true },
            dueDate:             { type: 'string', format: 'date-time', nullable: true },
            scores:              { type: 'array', items: { $ref: '#/components/schemas/ReviewScore' } },
            createdAt:           { type: 'string', format: 'date-time' },
            updatedAt:           { type: 'string', format: 'date-time' },
          },
        },
        ReviewScore: {
          type: 'object',
          properties: {
            id:           { type: 'string' },
            reviewId:     { type: 'string' },
            parameterId:  { type: 'string' },
            selfScore:    { type: 'integer', minimum: 1, maximum: 5, nullable: true, example: 4 },
            managerScore: { type: 'integer', minimum: 1, maximum: 5, nullable: true, example: 4 },
            hrScore:      { type: 'integer', minimum: 1, maximum: 5, nullable: true, example: 4 },
            parameter:    { $ref: '#/components/schemas/AppraisalParameter' },
          },
        },
        UpdateCycleRequest: {
          type: 'object',
          properties: {
            name:      { type: 'string', example: 'FY 2025-2026' },
            frequency: { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'], example: 'QUARTERLY' },
            year:      { type: 'integer', minimum: 2000, maximum: 2100, example: 2026 },
            month:     { type: 'string', example: 'September' },
            startDate: { type: 'string', format: 'date-time', example: '2025-04-01T00:00:00Z' },
            endDate:   { type: 'string', format: 'date-time', example: '2026-03-31T00:00:00Z' },
            dueDate:   { type: 'string', format: 'date-time', example: '2026-03-31T00:00:00Z' },
            status:    { type: 'string', enum: ['ACTIVE', 'CLOSED'], example: 'ACTIVE' },
          },
        },
        UpdateParameterRequest: {
          type: 'object',
          description: 'At least one field must be provided to update',
          properties: {
            name:     { type: 'string', minLength: 1, maxLength: 100, example: 'Leadership & Initiative' },
            order:    { type: 'integer', minimum: 1, maximum: 100, example: 3 },
            isActive: { type: 'boolean', example: false },
          },
        },
        ScoreInput: {
          type: 'object',
          required: ['parameterId'],
          properties: {
            parameterId: { type: 'string', example: 'clparam12345' },
            selfScore:    { type: 'integer', minimum: 1, maximum: 5, example: 4 },
            managerScore: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            hrScore:      { type: 'integer', minimum: 1, maximum: 5, example: 4 },
          },
        },
        SelfAssessmentRequest: {
          type: 'object',
          properties: {
            selfAccomplishments: { type: 'string', maxLength: 5000, example: 'Completed microservices migration with zero downtime.' },
            selfWeaknesses:      { type: 'string', maxLength: 5000, example: 'Need to improve async communication during cross-team projects.' },
            selfRating:          { type: 'number', minimum: 1, maximum: 5, example: 4.2 },
            submit:              { type: 'boolean', default: false, example: true, description: 'Set to true to finalize and submit (locks the form)' },
            scores: {
              type: 'array',
              items: {
                type: 'object',
                required: ['parameterId', 'selfScore'],
                properties: {
                  parameterId: { type: 'string', example: 'clparam12345' },
                  selfScore:   { type: 'integer', minimum: 1, maximum: 5, example: 4 },
                },
              },
            },
          },
        },
        ManagerReviewRequest: {
          type: 'object',
          properties: {
            managerRemarks:  { type: 'string', maxLength: 5000, example: 'Consistent high-quality output throughout the cycle.' },
            managerComments: { type: 'string', maxLength: 5000, example: 'Consistent high-quality output throughout the cycle.' },
            managerRating:   { type: 'number', minimum: 1, maximum: 5, example: 4.5 },
            submit:          { type: 'boolean', example: true, description: 'True to finalize and mark status as MANAGER_REVIEWED' },
            scores: {
              type: 'array',
              items: {
                type: 'object',
                required: ['parameterId'],
                properties: {
                  parameterId:  { type: 'string', example: 'clparam12345' },
                  managerScore: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
                  score:        { type: 'integer', minimum: 1, maximum: 5, example: 5 },
                },
              },
            },
          },
        },
        HrAuditRequest: {
          type: 'object',
          properties: {
            hikePercentage:  { type: 'number', minimum: 0, maximum: 100, example: 12 },
            hrSignoffStatus: { type: 'string', enum: ['PENDING_RELEASE', 'RELEASED'], example: 'RELEASED' },
            hrRemarks:       { type: 'string', maxLength: 3000, example: 'Compensation review finalized and approved.' },
            scores: {
              type: 'array',
              items: {
                type: 'object',
                required: ['parameterId', 'hrScore'],
                properties: {
                  parameterId: { type: 'string', example: 'clparam12345' },
                  hrScore:     { type: 'integer', minimum: 1, maximum: 5, example: 4 },
                },
              },
            },
          },
        },
        PeerNominationRequest: {
          type: 'object',
          required: ['reviewerId'],
          properties: {
            reviewerId: { type: 'string', example: 'cluser56789', description: 'The ID of the colleague you are nominating to give you feedback' },
            revieweeId: { type: 'string', example: 'cluser12345', description: 'Optional — defaults to the requesting user (HR/Manager can specify for direct report)' },
            cycleId:    { type: 'string', example: 'clcycle12345', description: 'Optional target cycle ID' },
            year:       { type: 'integer', minimum: 2000, maximum: 2100, example: 2026, description: 'Optional cycle year' },
            month:      { type: 'string', example: 'September', description: 'Optional cycle month' },
            reNotify:   { type: 'boolean', example: false, description: 'Optional — if true, resends notification reminder to an existing pending reviewer' },
          },
        },
        PeerFeedbackRequest: {
          type: 'object',
          required: ['rating', 'strengths', 'growthAreas'],
          properties: {
            rating:      { type: 'number', minimum: 1, maximum: 5, example: 4.5 },
            strengths:   { type: 'string', minLength: 10, maxLength: 3000, example: 'Exceptional problem-solver who unblocks teammates quickly.' },
            growthAreas: { type: 'string', minLength: 10, maxLength: 3000, example: 'Could delegate more to junior team members.' },
          },
        },
        PeerNomination: {
          type: 'object',
          properties: {
            id:         { type: 'string' },
            cycleId:    { type: 'string' },
            revieweeId: { type: 'string' },
            reviewerId: { type: 'string' },
            status:     { type: 'string', enum: ['PENDING', 'COMPLETED', 'REJECTED'], example: 'PENDING' },
            createdAt:  { type: 'string', format: 'date-time' },
          },
        },
        PeerFeedbackItem: {
          type: 'object',
          properties: {
            id:          { type: 'string' },
            rating:      { type: 'number', example: 4.5 },
            strengths:   { type: 'string', example: 'Outstanding technical contribution.' },
            growthAreas: { type: 'string', example: 'Needs to improve documentation habits.' },
            reviewerId:  { type: 'string', nullable: true, description: 'Null for non-CMD users (anonymized)' },
            createdAt:   { type: 'string', format: 'date-time' },
          },
        },
        SubmitSelfRatingRequest: {
          type: 'object',
          properties: {
            cycleId:             { type: 'string', example: 'clcycle12345', description: 'Optional appraisal cycle ID. Defaults to active cycle.' },
            frequency:           { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'], example: 'MONTHLY' },
            periodName:          { type: 'string', example: 'September 2026', description: 'Optional month/quarter/period name' },
            rating:              { type: 'number', minimum: 1, maximum: 5, example: 4.5, description: 'Overall self-rating (1 to 5)' },
            comments:            { type: 'string', example: 'Achieved quarterly sprint targets.', description: 'Overall comments' },
            selfAccomplishments: { type: 'string', example: 'Delivered database migration and microservices architecture.' },
            selfWeaknesses:      { type: 'string', example: 'Need to improve async documentation habits.' },
            selfRating:          { type: 'number', minimum: 1, maximum: 5, example: 4.5 },
            submit:              { type: 'boolean', example: true, description: 'True to submit and lock review, false for draft' },
            scores: {
              type: 'array',
              description: 'Parameter-wise rating scores',
              items: {
                type: 'object',
                required: ['parameterId', 'selfScore'],
                properties: {
                  parameterId: { type: 'string', example: 'clparam12345' },
                  selfScore:   { type: 'integer', minimum: 1, maximum: 5, example: 4 },
                },
              },
            },
          },
        },
        SubmitManagerRatingRequest: {
          type: 'object',
          properties: {
            managerRating:  { type: 'number', minimum: 1, maximum: 5, example: 4.8, description: 'Overall manager rating (1 to 5)' },
            managerRemarks: { type: 'string', example: 'Exceptional leadership and execution throughout the cycle.' },
            managerComments:{ type: 'string', example: 'Exceptional leadership and execution throughout the cycle.' },
            scores: {
              type: 'array',
              description: 'Parameter-wise scores assigned by manager',
              items: {
                type: 'object',
                required: ['parameterId', 'managerScore'],
                properties: {
                  parameterId:  { type: 'string', example: 'clparam12345' },
                  managerScore: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
                },
              },
            },
          },
        },
        UpdateReviewRequest: {
          type: 'object',
          description: 'Partial update for a performance review (RBAC governed)',
          properties: {
            selfAccomplishments: { type: 'string', maxLength: 5000, example: 'Updated key accomplishments for the month.' },
            selfWeaknesses:      { type: 'string', maxLength: 5000, example: 'Identified training areas in system architecture.' },
            selfRating:          { type: 'number', minimum: 1, maximum: 5, example: 4.0 },
            managerRemarks:      { type: 'string', maxLength: 5000, example: 'Solid execution and team contribution.' },
            managerRating:       { type: 'number', minimum: 1, maximum: 5, example: 4.5 },
            status:              { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED'], example: 'SUBMITTED' },
            hikePercentage:      { type: 'number', minimum: 0, maximum: 100, example: 10.5 },
          },
        },
        AppraisalListResponse: {
          type: 'object',
          properties: {
            reviews: {
              type: 'array',
              items: { $ref: '#/components/schemas/PerformanceReview' },
            },
            pagination: {
              type: 'object',
              properties: {
                page:        { type: 'integer', example: 1 },
                limit:       { type: 'integer', example: 10 },
                total:       { type: 'integer', example: 25 },
                totalPages:  { type: 'integer', example: 3 },
                hasNextPage: { type: 'boolean', example: true },
                hasPrevPage: { type: 'boolean', example: false },
              },
            },
            total:      { type: 'integer', example: 25 },
            page:       { type: 'integer', example: 1 },
            totalPages: { type: 'integer', example: 3 },
          },
        },
        SyncGoalsToAppraisalRequest: {
          type: 'object',
          properties: {
            reviewId: { type: 'string', example: 'clreview12345', description: 'Target review ID' },
            cycleId: { type: 'string', example: 'clcycle12345', description: 'Target cycle ID' },
            frequency: { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'], example: 'MONTHLY' },
            periodName: { type: 'string', example: 'September 2026' },
          },
        },
        SyncGoalsToAppraisalResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Synchronized 2 goal(s) into appraisal draft successfully' },
            accomplishmentsText: { type: 'string', example: 'Key Delivered Objectives & Goal Alignments:\n• GOOGLE O AUTH LOGIN (Completed)' },
            suggestedRating: { type: 'number', example: 5.0 },
            review: { $ref: '#/components/schemas/PerformanceReview' },
          },
        },
        GoalAlignmentMetrics: {
          type: 'object',
          properties: {
            totalGoals: { type: 'integer', example: 4 },
            completedGoals: { type: 'integer', example: 3 },
            inProgressGoals: { type: 'integer', example: 1 },
            averageProgress: { type: 'number', example: 85 },
            alignmentScore: { type: 'number', example: 4.3 },
            milestonesTotal: { type: 'integer', example: 12 },
            milestonesCompleted: { type: 'integer', example: 10 },
            completionRate: { type: 'integer', example: 75 },
          },
        },
        GoalAlignmentResponse: {
          type: 'object',
          properties: {
            goals: {
              type: 'array',
              items: { $ref: '#/components/schemas/Goal' },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 5 },
                total: { type: 'integer', example: 4 },
                totalPages: { type: 'integer', example: 1 },
                hasNextPage: { type: 'boolean', example: false },
                hasPrevPage: { type: 'boolean', example: false },
              },
            },
            metrics: { $ref: '#/components/schemas/GoalAlignmentMetrics' },
            employee: { $ref: '#/components/schemas/Employee' },
          },
        },

        // ── External Review schemas ──
        ExternalReviewRequest: {
          type: 'object',
          required: ['employeeId', 'clientName', 'clientEmail'],
          properties: {
            employeeId: { type: 'string' },
            clientName: { type: 'string', example: 'Acme Corp Lead' },
            clientEmail: { type: 'string', format: 'email', example: 'client@acme.com' },
            projectRole: { type: 'string', example: 'Lead Architect' },
          },
        },
        SubmitExternalReviewRequest: {
          type: 'object',
          required: ['rating', 'feedback'],
          properties: {
            rating: { type: 'number', minimum: 1, maximum: 5, example: 5 },
            feedback: { type: 'string', example: 'Great communication and prompt delivery.' },
            skillsDemonstrated: { type: 'array', items: { type: 'string' }, example: ['Node.js', 'PostgreSQL', 'Architecture'] },
          },
        },

        // ── Analytics & Upload schemas ──
        AnalyticsSummary: {
          type: 'object',
          properties: {
            totalEmployees: { type: 'integer', example: 48 },
            activeGoals: { type: 'integer', example: 120 },
            completedTasks: { type: 'integer', example: 340 },
            averageAppraisalRating: { type: 'number', example: 4.3 },
            leaveApprovalRate: { type: 'number', example: 92.5 },
          },
        },
        FileUploadResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'File uploaded successfully' },
            fileName: { type: 'string', example: '1725189000-12345678-document.pdf' },
            originalName: { type: 'string', example: 'document.pdf' },
            path: { type: 'string', example: '/uploads/1725189000-12345678-document.pdf' },
          },
        },

        // ── Policies & Compliance schemas ──
        PolicyItem: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'cmtk4hy3o000cuuuo9ngxfkud' },
            title: { type: 'string', example: 'IT Security & Clean Desk Policy 2026' },
            description: { type: 'string', nullable: true, example: 'Mandatory information security and physical clean desk regulations.' },
            content: { type: 'string', example: 'All employees must adhere to clean desk principles and lock machines when unattended.' },
            category: { type: 'string', example: 'Compliance' },
            version: { type: 'integer', example: 1 },
            status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], example: 'PUBLISHED' },
            pdfUrl: { type: 'string', nullable: true, example: '/uploads/it-security-policy.pdf' },
            pdfOriginalName: { type: 'string', nullable: true, example: 'it-security.pdf' },
            contentHash: { type: 'string', nullable: true, example: '4dd5683aa35273b9c02d02dee1e1059e6ad5aa6642fbc568c8b337edf847ea29' },
            effectiveDate: { type: 'string', format: 'date-time', nullable: true },
            dueDate: { type: 'string', format: 'date-time', nullable: true },
            publishedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            totalAssigned: { type: 'integer', example: 25 },
            signedCount: { type: 'integer', example: 20 },
            pendingCount: { type: 'integer', example: 5 },
            compliancePercentage: { type: 'integer', example: 80 },
          },
        },
        EmployeePolicyItem: {
          type: 'object',
          properties: {
            assignmentId: { type: 'string', example: 'cmtk4opvk000juuvkmquwaveb' },
            id: { type: 'string', example: 'cmtk4oox2000euuvkhxnmcc4v' },
            title: { type: 'string', example: 'IT Security & Clean Desk Policy 2026' },
            description: { type: 'string', nullable: true },
            content: { type: 'string' },
            category: { type: 'string', example: 'Compliance' },
            version: { type: 'integer', example: 1 },
            pdfUrl: { type: 'string', nullable: true },
            pdfOriginalName: { type: 'string', nullable: true },
            publishedAt: { type: 'string', format: 'date-time', nullable: true },
            assignedAt: { type: 'string', format: 'date-time' },
            dueAt: { type: 'string', format: 'date-time', nullable: true },
            status: { type: 'string', enum: ['PENDING', 'SIGNED', 'OVERDUE', 'REVOKED'], example: 'PENDING' },
            signedAt: { type: 'string', format: 'date-time', nullable: true },
            hasSigned: { type: 'boolean', example: false },
            acceptance: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string' },
                signedAt: { type: 'string', format: 'date-time' },
                ipAddress: { type: 'string', example: '127.0.0.1 (Localhost)' },
                complianceCheck: { type: 'string', example: 'Verified Audit' },
                contentHash: { type: 'string' },
              },
            },
          },
        },
        CreatePolicyRequest: {
          type: 'object',
          required: ['title', 'content'],
          properties: {
            title: { type: 'string', example: 'Zero Trust & Access Control Policy' },
            content: { type: 'string', example: 'All internal systems must be accessed through corporate MFA and VPN.' },
            category: { type: 'string', example: 'Security' },
            description: { type: 'string', nullable: true, example: 'Zero Trust security mandates for 2026' },
            status: { type: 'string', enum: ['DRAFT', 'PUBLISHED'], default: 'PUBLISHED' },
            pdfUrl: { type: 'string', nullable: true },
            pdfOriginalName: { type: 'string', nullable: true },
            effectiveDate: { type: 'string', format: 'date' },
            dueDate: { type: 'string', format: 'date' },
            assignees: {
              oneOf: [
                { type: 'string', enum: ['ALL'] },
                { type: 'array', items: { type: 'string' } },
              ],
              example: 'ALL',
            },
          },
        },
        UpdatePolicyRequest: {
          type: 'object',
          properties: {
            title: { type: 'string', example: 'Zero Trust & Access Control Policy (v2)' },
            content: { type: 'string', example: 'Updated zero trust requirements...' },
            category: { type: 'string', example: 'Security' },
            description: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] },
            pdfUrl: { type: 'string', nullable: true },
            pdfOriginalName: { type: 'string', nullable: true },
            effectiveDate: { type: 'string', format: 'date' },
            dueDate: { type: 'string', format: 'date' },
            incrementVersion: { type: 'boolean', example: true },
            assignees: {
              oneOf: [
                { type: 'string', enum: ['ALL'] },
                { type: 'array', items: { type: 'string' } },
              ],
            },
          },
        },
        SignPolicyRequest: {
          type: 'object',
          required: ['acknowledged'],
          properties: {
            acknowledged: { type: 'boolean', example: true },
          },
        },
        SignPolicyResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Policy electronically signed and verified successfully' },
            acceptance: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                policyId: { type: 'string' },
                policyVersion: { type: 'integer', example: 1 },
                signedAt: { type: 'string', format: 'date-time' },
                ipAddress: { type: 'string', example: '127.0.0.1 (Localhost)' },
                userAgent: { type: 'string' },
                complianceCheck: { type: 'string', example: 'Verified Audit' },
                contentHash: { type: 'string' },
                legalDeclaration: { type: 'string' },
              },
            },
          },
        },
        ComplianceRegistryItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            employeeName: { type: 'string', example: 'Pratik Parida' },
            userEmail: { type: 'string', example: 'pratik@acmecorp.com' },
            userRole: { type: 'string', example: 'EMPLOYEE' },
            policyId: { type: 'string' },
            signedPolicyMandate: { type: 'string', example: 'IT Security & Clean Desk Policy 2026' },
            policyCategory: { type: 'string', example: 'Compliance' },
            policyVersion: { type: 'integer', example: 1 },
            auditIpAddress: { type: 'string', example: '127.0.0.1 (Localhost)' },
            verificationTimestamp: { type: 'string', format: 'date-time' },
            complianceCheck: { type: 'string', example: 'Verified Audit' },
            contentHash: { type: 'string' },
          },
        },
        PendingComplianceItem: {
          type: 'object',
          properties: {
            assignmentId: { type: 'string' },
            policyId: { type: 'string' },
            policyTitle: { type: 'string' },
            policyCategory: { type: 'string' },
            policyVersion: { type: 'integer' },
            userId: { type: 'string' },
            userName: { type: 'string' },
            userEmail: { type: 'string' },
            assignedAt: { type: 'string', format: 'date-time' },
            dueAt: { type: 'string', format: 'date-time', nullable: true },
            status: { type: 'string', example: 'PENDING' },
            reminderCount: { type: 'integer', example: 0 },
            reminderSentAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },

        // ── Leaves & WFH Schemas ──
        LeaveType: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'lt_annual123' },
            tenantId: { type: 'string', example: 'tenant_abc' },
            name: { type: 'string', example: 'Annual Leave' },
            code: { type: 'string', example: 'ANNUAL' },
            description: { type: 'string', nullable: true, example: 'Standard paid annual leave allowance' },
            color: { type: 'string', nullable: true, example: '#6366f1' },
            defaultDays: { type: 'number', example: 18 },
            allocationType: { type: 'string', enum: ['ANNUAL', 'MONTHLY_ACCRUAL'], example: 'ANNUAL' },
            year: { type: 'integer', example: 2026 },
            isPaid: { type: 'boolean', example: true },
            requiresApproval: { type: 'boolean', example: true },
            allowHalfDay: { type: 'boolean', example: true },
            allowNegativeBalance: { type: 'boolean', example: false },
            maxConsecutiveDays: { type: 'integer', nullable: true, example: 14 },
            minNoticeDays: { type: 'integer', example: 2 },
            carryForwardAllowed: { type: 'boolean', example: true },
            maxCarryForwardDays: { type: 'integer', example: 5 },
            encashmentAllowed: { type: 'boolean', example: false },
            requiresDocument: { type: 'boolean', example: false },
            documentRequiredAfterDays: { type: 'integer', nullable: true, example: 2 },
            isActive: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateLeaveTypeRequest: {
          type: 'object',
          required: ['name', 'code', 'defaultDays'],
          properties: {
            name: { type: 'string', example: 'Maternity Leave', minLength: 2, maxLength: 80 },
            code: { type: 'string', example: 'MATERNITY', pattern: '^[A-Z0-9_]+$', minLength: 2, maxLength: 30 },
            description: { type: 'string', nullable: true, example: 'Paid maternal leave for expecting mothers' },
            color: { type: 'string', nullable: true, example: '#ec4899' },
            defaultDays: { type: 'number', minimum: 0, example: 90 },
            allocationType: { type: 'string', enum: ['ANNUAL', 'MONTHLY_ACCRUAL'], default: 'ANNUAL' },
            isPaid: { type: 'boolean', default: true },
            requiresApproval: { type: 'boolean', default: true },
            allowHalfDay: { type: 'boolean', default: false },
            allowNegativeBalance: { type: 'boolean', default: false },
            maxConsecutiveDays: { type: 'integer', nullable: true, minimum: 1, example: 90 },
            minNoticeDays: { type: 'integer', default: 15, minimum: 0 },
            carryForwardAllowed: { type: 'boolean', default: false },
            maxCarryForwardDays: { type: 'integer', default: 0, minimum: 0 },
            encashmentAllowed: { type: 'boolean', default: false },
            requiresDocument: { type: 'boolean', default: true },
            documentRequiredAfterDays: { type: 'integer', nullable: true, minimum: 1, example: 1 },
            isActive: { type: 'boolean', default: true },
          },
        },
        UpdateLeaveTypeRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 80 },
            description: { type: 'string', nullable: true },
            color: { type: 'string', nullable: true },
            defaultDays: { type: 'number', minimum: 0 },
            allocationType: { type: 'string', enum: ['ANNUAL', 'MONTHLY_ACCRUAL'] },
            isPaid: { type: 'boolean' },
            requiresApproval: { type: 'boolean' },
            allowHalfDay: { type: 'boolean' },
            allowNegativeBalance: { type: 'boolean' },
            maxConsecutiveDays: { type: 'integer', nullable: true, minimum: 1 },
            minNoticeDays: { type: 'integer', minimum: 0 },
            carryForwardAllowed: { type: 'boolean' },
            maxCarryForwardDays: { type: 'integer', minimum: 0 },
            encashmentAllowed: { type: 'boolean' },
            requiresDocument: { type: 'boolean' },
            documentRequiredAfterDays: { type: 'integer', nullable: true, minimum: 1 },
            isActive: { type: 'boolean' },
          },
        },
        LeaveTypeStatusRequest: {
          type: 'object',
          required: ['isActive'],
          properties: {
            isActive: { type: 'boolean', example: false },
          },
        },
        LeaveBalanceItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            typeId: { type: 'string' },
            code: { type: 'string', example: 'ANNUAL' },
            name: { type: 'string', example: 'Annual Leave' },
            color: { type: 'string', example: '#6366f1' },
            allowHalfDay: { type: 'boolean', example: true },
            requiresDocument: { type: 'boolean', example: false },
            documentRequiredAfterDays: { type: 'integer', nullable: true, example: 2 },
            allocated: { type: 'number', example: 18 },
            carriedForward: { type: 'number', example: 0 },
            adjusted: { type: 'number', example: 0 },
            totalQuota: { type: 'number', example: 18 },
            used: { type: 'number', example: 4 },
            pending: { type: 'number', example: 2 },
            available: { type: 'number', example: 12 },
          },
        },
        MyLeaveBalancesResponse: {
          type: 'object',
          properties: {
            year: { type: 'integer', example: 2026 },
            leaveTypes: {
              type: 'array',
              items: { $ref: '#/components/schemas/LeaveBalanceItem' },
            },
            wfh: {
              type: 'object',
              properties: {
                allocated: { type: 'number', example: 15 },
                adjusted: { type: 'number', example: 0 },
                totalQuota: { type: 'number', example: 15 },
                used: { type: 'number', example: 3 },
                pending: { type: 'number', example: 1 },
                available: { type: 'number', example: 11 },
                isEnabled: { type: 'boolean', example: true },
              },
            },
            summary: {
              type: 'object',
              properties: {
                totalAllocated: { type: 'number', example: 36 },
                totalUsed: { type: 'number', example: 7 },
                totalPending: { type: 'number', example: 3 },
                totalAvailable: { type: 'number', example: 26 },
              },
            },
          },
        },
        AdjustBalanceRequest: {
          type: 'object',
          required: ['employeeId', 'days', 'operation', 'reason'],
          properties: {
            employeeId: { type: 'string', example: 'user_123' },
            leaveTypeId: { type: 'string', nullable: true, example: 'lt_annual123', description: 'Leave type ID (null if adjusting WFH)' },
            isWfh: { type: 'boolean', default: false, example: false },
            days: { type: 'number', minimum: 0.5, example: 3 },
            operation: { type: 'string', enum: ['ADD', 'DEDUCT'], example: 'ADD' },
            reason: { type: 'string', example: 'Special management quota incentive for weekend hackathon support' },
          },
        },
        CreateLeaveRequest: {
          type: 'object',
          required: ['startDate', 'endDate', 'reason'],
          properties: {
            leaveTypeId: { type: 'string', nullable: true, example: 'lt_sick123', description: 'Omit or null if requestType is WFH' },
            requestType: { type: 'string', enum: ['LEAVE', 'WFH'], default: 'LEAVE', example: 'LEAVE' },
            startDate: { type: 'string', format: 'date', example: '2026-09-15' },
            endDate: { type: 'string', format: 'date', example: '2026-09-16' },
            dayType: { type: 'string', enum: ['FULL', 'FIRST_HALF', 'SECOND_HALF'], default: 'FULL', example: 'FULL' },
            reason: { type: 'string', example: 'High fever and doctor consultation', minLength: 3, maxLength: 500 },
            attachmentUrl: { type: 'string', nullable: true, example: 'https://ueibi-storage.s3.amazonaws.com/tenants/t1/doc.pdf' },
          },
        },
        LeaveRequestItem: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'lr_123456' },
            employeeId: { type: 'string', example: 'user_123' },
            leaveTypeId: { type: 'string', nullable: true, example: 'lt_sick123' },
            leaveType: { $ref: '#/components/schemas/LeaveType' },
            requestType: { type: 'string', enum: ['LEAVE', 'WFH'], example: 'LEAVE' },
            dayType: { type: 'string', enum: ['FULL', 'FIRST_HALF', 'SECOND_HALF'], example: 'FULL' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            totalDays: { type: 'number', example: 2 },
            reason: { type: 'string', example: 'High fever and doctor consultation' },
            attachmentUrl: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], example: 'PENDING' },
            managerStatus: { type: 'string', enum: ['Pending', 'Approved', 'Rejected'], example: 'Pending' },
            hrStatus: { type: 'string', enum: ['Pending', 'Approved', 'Rejected'], example: 'Pending' },
            managerComment: { type: 'string', nullable: true },
            hrComment: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            employee: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                department: { type: 'string', nullable: true },
                role: { type: 'string' },
              },
            },
          },
        },
        ApprovalActionRequest: {
          type: 'object',
          properties: {
            comment: { type: 'string', example: 'Approved, take rest.' },
          },
        },
        WfhPolicy: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            isEnabled: { type: 'boolean', example: true },
            annualDays: { type: 'number', example: 15 },
            monthlyLimit: { type: 'number', nullable: true, example: 4 },
            requiresApproval: { type: 'boolean', example: true },
            maxConsecutiveDays: { type: 'integer', example: 5 },
            minNoticeDays: { type: 'integer', example: 1 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        UpdateWfhPolicyRequest: {
          type: 'object',
          properties: {
            isEnabled: { type: 'boolean' },
            annualDays: { type: 'number', minimum: 0 },
            monthlyLimit: { type: 'number', nullable: true, minimum: 1 },
            requiresApproval: { type: 'boolean' },
            maxConsecutiveDays: { type: 'integer', minimum: 1 },
            minNoticeDays: { type: 'integer', minimum: 0 },
          },
        },
        LeaveAuditLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            action: { type: 'string', example: 'CREATE_LEAVE_TYPE' },
            performedById: { type: 'string' },
            performedBy: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
              },
            },
            details: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      securitySchemes: {
        adminCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'admin_session',
          description: 'Admin session cookie set by POST /api/admin/session',
        },
        userCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'ueibi_session',
          description: 'User session cookie set by POST /api/auth/login',
        },
      },
    },

    // ── Paths ──
    paths: {
      // ───── Health ─────
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Server health check',
          operationId: 'getHealth',
          responses: {
            200: {
              description: 'Server is running',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } } },
            },
          },
        },
      },

      // ───── Auth ─────
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Log in as a tenant user or admin',
          operationId: 'loginUser',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: {
              description: 'Logged in successfully',
              headers: {
                'Set-Cookie': { schema: { type: 'string', example: 'ueibi_session=token; HttpOnly; Path=/' } },
              },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } },
            },
            400: { description: 'Missing fields' },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Log out current session',
          operationId: 'logoutUser',
          responses: {
            200: {
              description: 'Logged out successfully',
            },
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Request a password reset link via registered email',
          description: 'Generates a secure, cryptographically random one-time password reset token and emails it to the user. Always returns a generic 200 response to prevent user enumeration.',
          operationId: 'forgotPassword',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ForgotPasswordRequest' } } },
          },
          responses: {
            200: {
              description: 'Generic success response',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ForgotPasswordResponse' } } },
            },
            400: {
              description: 'Validation error (e.g. invalid email format)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            429: {
              description: 'Rate limit exceeded',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            500: { description: 'Internal server error' },
          },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Reset password using a valid one-time reset token',
          description: 'Validates the high-entropy reset token, checks that it is unexpired and unused, hashes the new password with bcrypt, marks the token as used atomically, and clears previous tokens.',
          operationId: 'resetPassword',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordRequest' } } },
          },
          responses: {
            200: {
              description: 'Password reset successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordResponse' } } },
            },
            400: {
              description: 'Invalid or expired token, or invalid password',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            429: {
              description: 'Rate limit exceeded',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            500: { description: 'Internal server error' },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current authenticated user profile details',
          operationId: 'currentUser',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'Profile details retrieved',
              content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/Employee' } } } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ───── Employees ─────
      '/employees': {
        post: {
          tags: ['Employees'],
          summary: 'Invite a new employee (creates pending profile + generates temp password)',
          description: 'Requires SUPER_ADMIN, ADMIN, or HR role. Verifies that the tenant has not reached their purchased license limit.',
          operationId: 'inviteEmployee',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InviteEmployeeRequest' } } },
          },
          responses: {
            201: {
              description: 'Employee invited successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, user: { $ref: '#/components/schemas/Employee' } } } } },
            },
            400: { description: 'License limit reached or invalid request body' },
            401: { description: 'Unauthorized' },
            409: { description: 'User already exists' },
          },
        },
        get: {
          tags: ['Employees'],
          summary: 'List all active/invited employees in the current tenant',
          operationId: 'listEmployees',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by name or email' },
            { name: 'role', in: 'query', schema: { type: 'string' }, description: 'Filter by role' },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status' },
          ],
          responses: {
            200: {
              description: 'Employees list retrieved',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Employee' } } } } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/employees/onboard': {
        patch: {
          tags: ['Employees'],
          summary: 'Complete profile onboarding and update temporary password',
          description: 'Must be authenticated using the temporary password credentials.',
          operationId: 'onboardEmployee',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OnboardEmployeeRequest' } } },
          },
          responses: {
            200: {
              description: 'Onboarding completed successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, user: { $ref: '#/components/schemas/Employee' } } } } },
            },
            400: { description: 'Missing password' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/employees/{id}': {
        patch: {
          tags: ['Employees'],
          summary: 'Update an active employee record',
          description: 'Requires SUPER_ADMIN, ADMIN, or HR role. Applies partial updates to an employee profile.',
          operationId: 'updateEmployee',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', description: 'Partial employee object matching updateActiveEmployeeSchema' } } },
          },
          responses: {
            200: { description: 'Employee updated successfully' },
            400: { description: 'Validation failed' },
            404: { description: 'Employee not found' },
          },
        },
      },
      '/employees/ex/{id}': {
        patch: {
          tags: ['Employees'],
          summary: 'Update an ex-employee record',
          operationId: 'updateExEmployee',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', description: 'Partial ex-employee object matching updateExEmployeeSchema' } } },
          },
          responses: {
            200: { description: 'Ex-Employee updated successfully' },
            400: { description: 'Validation failed' },
            404: { description: 'Ex-Employee not found' },
          },
        },
      },
      '/employees/offers/{id}': {
        patch: {
          tags: ['Employees'],
          summary: 'Update a non-joiner record',
          operationId: 'updateNonJoiner',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', description: 'Partial non-joiner object matching updateNonJoinerSchema' } } },
          },
          responses: {
            200: { description: 'Non-Joiner updated successfully' },
            400: { description: 'Validation failed' },
            404: { description: 'Non-Joiner not found' },
          },
        },
      },
      '/health/db': {
        get: {
          tags: ['Health'],
          summary: 'Database connectivity check',
          operationId: 'getHealthDb',
          responses: {
            200: {
              description: 'Database is connected',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, database: { type: 'string', example: 'connected' } } } } },
            },
            500: {
              description: 'Database connection failed',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },

      // ───── Registration ─────
      '/registrations/otp/request': {
        post: {
          tags: ['Registration'],
          summary: 'Request an OTP for email verification',
          description: 'Sends a 6-digit OTP to the specified email. The email domain must match the provided domain name. Rate-limited to 10 requests per 15 minutes.',
          operationId: 'requestOtp',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OtpRequest' } } },
          },
          responses: {
            200: {
              description: 'OTP sent successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/OtpResponse' } } },
            },
            400: { description: 'Domain/email mismatch', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            409: { description: 'Email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/registrations/otp/verify': {
        post: {
          tags: ['Registration'],
          summary: 'Verify OTP and get a verification token',
          description: 'Validates the 6-digit OTP. On success, returns a one-time verification token (valid for 30 minutes) to be used in the registration step.',
          operationId: 'verifyOtp',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OtpVerifyRequest' } } },
          },
          responses: {
            200: {
              description: 'OTP verified, token returned',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/OtpVerifyResponse' } } },
            },
            400: { description: 'Invalid / expired OTP or no pending OTP', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            429: { description: 'Too many incorrect attempts or rate limit', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/registrations': {
        post: {
          tags: ['Registration'],
          summary: 'Submit company registration (Level 1)',
          description: 'Creates a new company registration. Requires a valid verification token from the OTP flow. Sends notification to finance for review.',
          operationId: 'createRegistration',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegistrationRequest' } } },
          },
          responses: {
            201: {
              description: 'Registration created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/RegistrationResponse' } } },
            },
            400: { description: 'Validation failed or invalid/expired verification token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            409: { description: 'Duplicate email or domain', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },

      // ───── Finance ─────
      '/finance/registrations/{token}': {
        get: {
          tags: ['Finance'],
          summary: 'Get registration summary for finance review',
          description: 'Retrieves company details and pricing config for the finance reviewer. Token is sent via email to the finance contact.',
          operationId: 'getFinanceSummary',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' }, description: 'Finance action token (from email link)' },
          ],
          responses: {
            200: { description: 'Finance summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/FinanceSummary' } } } },
            404: { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            410: { description: 'Token expired or already processed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/finance/registrations/{token}/pricing-preview': {
        post: {
          tags: ['Finance'],
          summary: 'Preview pricing calculation',
          description: 'Calculates pricing with optional coupon discount for preview purposes without committing the approval.',
          operationId: 'pricingPreview',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PricingPreviewRequest' } } },
          },
          responses: {
            200: { description: 'Pricing preview', content: { 'application/json': { schema: { $ref: '#/components/schemas/PricingPreviewResponse' } } } },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            404: { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            410: { description: 'Token expired', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/finance/registrations/{token}/approve': {
        post: {
          tags: ['Finance'],
          summary: 'Approve registration (Finance Level 2)',
          description: 'Approves pricing and payment method. Advances registration to PENDING_HR_ACTIVATION and notifies HR.',
          operationId: 'financeApprove',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/FinanceApproveRequest' } } },
          },
          responses: {
            200: { description: 'Approved successfully', content: { 'application/json': { schema: { $ref: '#/components/schemas/FinanceApproveResponse' } } } },
            400: { description: 'Validation failed or invalid coupon', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            404: { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            409: { description: 'Not in PENDING_FINANCE_REVIEW state', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            410: { description: 'Token expired', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/finance/registrations/{token}/confirm-cheque': {
        post: {
          tags: ['Finance'],
          summary: 'Confirm cheque payment details',
          description: 'Confirms cheque payment for registrations awaiting cheque confirmation. Advances to PENDING_HR_ACTIVATION.',
          operationId: 'confirmCheque',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ConfirmChequeRequest' } } },
          },
          responses: {
            200: {
              description: 'Cheque confirmed',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'PENDING_HR_ACTIVATION' } } } } },
            },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            404: { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            409: { description: 'Not in PENDING_CHEQUE_CONFIRMATION state', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },

      // ───── HR ─────
      '/hr/registrations/{token}': {
        get: {
          tags: ['HR'],
          summary: 'Get registration summary for HR review',
          description: 'Retrieves company and payment details for the HR reviewer before activation.',
          operationId: 'getHrSummary',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' }, description: 'HR action token (from email link)' },
          ],
          responses: {
            200: { description: 'HR summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/HrSummary' } } } },
            404: { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            410: { description: 'Token expired or already activated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/hr/registrations/{token}/activate': {
        post: {
          tags: ['HR'],
          summary: 'Activate company account (Level 3)',
          description: 'Activates the company registration. This is the final step in the onboarding workflow.',
          operationId: 'hrActivate',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Company activated',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ACTIVE' } } } } },
            },
            404: { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            410: { description: 'Token expired or already activated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },

      // ───── Admin Session ─────
      '/admin/session': {
        post: {
          tags: ['Admin Session'],
          summary: 'Admin login',
          description: 'Authenticates with app password and sets an HTTP-only session cookie. Rate-limited to 10 attempts per 15 minutes.',
          operationId: 'adminLogin',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminLoginRequest' } } },
          },
          responses: {
            200: {
              description: 'Login successful (session cookie set)',
              content: { 'application/json': { schema: { type: 'object', properties: { authenticated: { type: 'boolean', example: true } } } } },
              headers: { 'Set-Cookie': { schema: { type: 'string' }, description: 'admin_session cookie' } },
            },
            401: { description: 'Incorrect password', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/admin/session/verify': {
        get: {
          tags: ['Admin Session'],
          summary: 'Verify admin session',
          description: 'Checks if the current admin session cookie is still valid.',
          operationId: 'adminVerifySession',
          security: [{ adminCookie: [] }],
          responses: {
            200: {
              description: 'Session is valid',
              content: { 'application/json': { schema: { type: 'object', properties: { authenticated: { type: 'boolean', example: true } } } } },
            },
            401: {
              description: 'Not authenticated or session expired',
              content: { 'application/json': { schema: { type: 'object', properties: { authenticated: { type: 'boolean', example: false } } } } },
            },
          },
        },
      },
      '/admin/session/logout': {
        post: {
          tags: ['Admin Session'],
          summary: 'Admin logout',
          description: 'Clears the admin session cookie.',
          operationId: 'adminLogout',
          responses: {
            200: {
              description: 'Logged out',
              content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } } },
            },
          },
        },
      },

      // ───── Admin Coupons ─────
      '/admin/coupons': {
        get: {
          tags: ['Admin Coupons'],
          summary: 'List all coupons',
          description: 'Returns coupons ordered by creation date (newest first). Supports filtering by active status and search by code.',
          operationId: 'listCoupons',
          security: [{ adminCookie: [] }],
          parameters: [
            { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Filter by active status' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by coupon code (case-insensitive contains)' },
          ],
          responses: {
            200: {
              description: 'List of coupons',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Coupon' } } } } } },
            },
            401: { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
        post: {
          tags: ['Admin Coupons'],
          summary: 'Create a coupon',
          operationId: 'createCoupon',
          security: [{ adminCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CouponCreateRequest' } } },
          },
          responses: {
            201: { description: 'Coupon created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Coupon' } } } },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            401: { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            409: { description: 'Coupon code already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/admin/coupons/{id}': {
        get: {
          tags: ['Admin Coupons'],
          summary: 'Get a coupon by ID',
          operationId: 'getCoupon',
          security: [{ adminCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Coupon details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Coupon' } } } },
            401: { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Coupon not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
        patch: {
          tags: ['Admin Coupons'],
          summary: 'Update a coupon',
          operationId: 'updateCoupon',
          security: [{ adminCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CouponUpdateRequest' } } },
          },
          responses: {
            200: { description: 'Coupon updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Coupon' } } } },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            401: { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Coupon not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
        delete: {
          tags: ['Admin Coupons'],
          summary: 'Soft-delete a coupon (deactivate)',
          description: 'Sets the coupon\'s active status to false. Does not permanently delete.',
          operationId: 'deleteCoupon',
          security: [{ adminCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Coupon deactivated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Coupon' } } } },
            401: { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Coupon not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },

      // ───── File Upload ─────
      '/upload': {
        post: {
          tags: ['Employees'],
          summary: 'Upload verification document file',
          description: 'Uploads a single file (under key `file` in multipart/form-data) to the server. File is stored in ./uploads directory.',
          operationId: 'uploadFile',
          security: [{ userToken: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                      description: 'The file to upload (maximum 5MB)'
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'File uploaded successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string', example: 'File uploaded successfully' },
                      fileName: { type: 'string', example: '17248382910-avatar.png' },
                      originalName: { type: 'string', example: 'avatar.png' },
                      path: { type: 'string', example: '/uploads/17248382910-avatar.png' }
                    }
                  }
                }
              }
            },
            400: { description: 'No file uploaded or file too large' },
            401: { description: 'Not authenticated' }
          }
        }
      },

      // ───── Employee Onboarding & Updates ─────
      '/employees/onboard': {
        patch: {
          tags: ['Employees'],
          summary: 'Complete employee first-time onboarding',
          description: 'Allows an invited employee to complete onboarding by setting password, phone, personal details, statutory docs, bank details, work history, and uploading verification docs.',
          operationId: 'onboardEmployee',
          security: [{ userToken: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['newPassword', 'phone'],
                  properties: {
                    newPassword: { type: 'string', example: 'SecurePassword123' },
                    phone: { type: 'string', example: '6372422478' },
                    pan: { type: 'string', example: 'ABCDE1234F' },
                    aadhaar: { type: 'string', example: '123456789012' },
                    dob: { type: 'string', format: 'date', example: '1995-10-23' },
                    gender: { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'], example: 'MALE' },
                    bloodGroup: { type: 'string', example: 'O+ve' },
                    personalEmail: { type: 'string', format: 'email', example: 'personal@gmail.com' },
                    emergencyContact: { type: 'string', example: 'Father / 9876543210' },
                    uan: { type: 'string', example: '100918273645' },
                    esic: { type: 'string', example: '3112345678' },
                    docs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'Graduation Certificate' },
                          fileName: { type: 'string', example: '17248382910-degree.pdf' }
                        }
                      }
                    },
                    bankDetails: {
                      type: 'object',
                      properties: {
                        bankName: { type: 'string', example: 'HDFC Bank' },
                        accountNumber: { type: 'string', example: '50100293810293' },
                        ifscCode: { type: 'string', example: 'HDFC0000123' },
                        branchName: { type: 'string', example: 'Downtown Branch' }
                      }
                    },
                    workHistory: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          companyName: { type: 'string', example: 'Acme Corp' },
                          designation: { type: 'string', example: 'Software Engineer' },
                          startDate: { type: 'string', format: 'date', example: '2021-06-01' },
                          endDate: { type: 'string', format: 'date', example: '2024-05-15' },
                          reasonForExit: { type: 'string', example: 'Career Growth' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Onboarding completed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string', example: 'Onboarding completed successfully' },
                      user: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', example: 'cmtclxzzq0001uuek23nbb04s' },
                          email: { type: 'string', example: 'pratik@defigo.in' },
                          name: { type: 'string', example: 'pratik parida' },
                          status: { type: 'string', example: 'ACTIVE' },
                          mustChangePassword: { type: 'boolean', example: false }
                        }
                      }
                    }
                  }
                }
              }
            },
            400: { description: 'Validation failed or missing required fields' },
            401: { description: 'Not authenticated' }
          }
        }
      },
      '/employees/{id}': {
        patch: {
          tags: ['Employees'],
          summary: 'Update active employee details',
          description: 'Allows HR or Admins to update active employee profile details (Designation, Department, Phone, PAN, Aadhaar, DOB, Joining Date, docs, etc.).',
          operationId: 'updateEmployee',
          security: [{ userToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Employee User ID' }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'pratik parida' },
                    designation: { type: 'string', example: 'backend' },
                    phone: { type: 'string', example: '6372422478' },
                    pan: { type: 'string', example: 'ABCDE1234F' },
                    department: { type: 'string', example: 'it' },
                    band: { type: 'string', example: '1' },
                    aadhaar: { type: 'string', example: '4tt5t' },
                    dob: { type: 'string', format: 'date', example: '2026-08-21' },
                    joinDate: { type: 'string', format: 'date', example: '2026-08-29' },
                    docs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'CHSE' },
                          fileName: { type: 'string', example: 'Capturerydytrd.PNG' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Employee updated successfully' },
            400: { description: 'Validation failed' },
            401: { description: 'Not authenticated or authorized' },
            404: { description: 'Employee not found' }
          }
        },
        delete: {
          tags: ['Employees'],
          summary: 'Soft-delete active employee record',
          description: 'Allows HR or Admins to soft-delete an active employee profile.',
          operationId: 'deleteEmployee',
          security: [{ userToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Employee User ID' }
          ],
          responses: {
            200: { description: 'Employee soft-deleted successfully' },
            401: { description: 'Not authenticated or authorized' },
            404: { description: 'Employee not found' }
          }
        }
      },
      '/employees/ex/{id}': {
        patch: {
          tags: ['Employees'],
          summary: 'Update ex-employee exit conduct record',
          description: 'Allows HR or Admins to update an ex-employee record exit evaluations.',
          operationId: 'updateExEmployee',
          security: [{ userToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Ex-Employee Record ID' }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    serviceStart: { type: 'string', format: 'date', example: '2020-11-01' },
                    serviceEnd: { type: 'string', format: 'date', example: '2024-05-15' },
                    conductValue: { type: 'string', enum: ['Excellent', 'Good', 'Average', 'Poor'], example: 'Good' },
                    techRating: { type: 'integer', minimum: 1, maximum: 10, example: 8 },
                    attitudeRating: { type: 'integer', minimum: 1, maximum: 10, example: 8 },
                    feedback: { type: 'string', example: 'Notice period exit.' },
                    docs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'Exit evaluation proof' },
                          fileName: { type: 'string', example: '17248382910-exit.pdf' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Ex-Employee record updated successfully' },
            400: { description: 'Validation failed' },
            401: { description: 'Not authorized' },
            404: { description: 'Record not found' }
          }
        },
        delete: {
          tags: ['Employees'],
          summary: 'Soft-delete ex-employee record',
          description: 'Allows HR or Admins to soft-delete an ex-employee conduct record.',
          operationId: 'deleteExEmployee',
          security: [{ userToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Ex-Employee Record ID' }
          ],
          responses: {
            200: { description: 'Ex-Employee record soft-deleted successfully' },
            401: { description: 'Not authorized' },
            404: { description: 'Record not found' }
          }
        }
      },
      '/employees/offers/{id}': {
        patch: {
          tags: ['Employees'],
          summary: 'Update non-joiner / offer record details',
          description: 'Allows HR or Admins to update non-joiner candidate status and offer details.',
          operationId: 'updateNonJoiner',
          security: [{ userToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Offer Record ID' }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    offerReleaseDate: { type: 'string', format: 'date', example: '2026-06-01' },
                    dateOfJoining: { type: 'string', format: 'date', example: '2026-07-01' },
                    salary: { type: 'string', example: '14' },
                    offerAccepted: { type: 'string', enum: ['Yes', 'No', 'Sent'], example: 'Yes' },
                    feedback: { type: 'string', example: 'Offer accepted but did not join.' },
                    docs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'Offer Letter Copy' },
                          fileName: { type: 'string', example: '17248382910-offer.pdf' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Offer record updated successfully' },
            400: { description: 'Validation failed' },
            401: { description: 'Not authorized' },
            404: { description: 'Record not found' }
          }
        },
        delete: {
          tags: ['Employees'],
          summary: 'Soft-delete non-joiner / offer record',
          description: 'Allows HR or Admins to soft-delete a non-joiner candidate record.',
          operationId: 'deleteNonJoiner',
          security: [{ userToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Offer Record ID' }
          ],
          responses: {
            200: { description: 'Offer record soft-deleted successfully' },
            401: { description: 'Not authorized' },
            404: { description: 'Record not found' }
          }
        }
      },

      // ───── Dev ─────
      '/dev/notifications': {
        get: {
          tags: ['Dev'],
          summary: 'List notification logs (dev only)',
          description: 'Returns the latest 50 notification logs. Disabled in production.',
          operationId: 'listNotifications',
          parameters: [
            { name: 'email', in: 'query', schema: { type: 'string' }, description: 'Filter by recipient email' },
            { name: 'registrationId', in: 'query', schema: { type: 'string' }, description: 'Filter by registration ID' },
            { name: 'event', in: 'query', schema: { type: 'string' }, description: 'Filter by event type' },
          ],
          responses: {
            200: {
              description: 'Notification logs',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/NotificationLog' } } } } } },
            },
          },
        },
      },

      // ───── Tasks ─────
      '/tasks': {
        get: {
          tags: ['Tasks'],
          summary: 'List all tasks for an employee',
          operationId: 'listTasks',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Employee ID (defaults to current user, use "all" to retrieve organization/team tasks)' },
            { name: 'fy', in: 'query', schema: { type: 'string' }, description: 'Filter by Financial Year' },
          ],
          responses: {
            200: {
              description: 'List of tasks retrieved',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
        post: {
          tags: ['Tasks'],
          summary: 'Create a new task',
          operationId: 'createTask',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskCreateRequest' } } },
          },
          responses: {
            201: {
              description: 'Task created successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            400: { description: 'Bad request (missing title)' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/tasks/{id}': {
        put: {
          tags: ['Tasks'],
          summary: 'Update task details (full update)',
          operationId: 'updateTask',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskUpdateRequest' } } },
          },
          responses: {
            200: {
              description: 'Task updated successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Task not found' },
          },
        },
        delete: {
          tags: ['Tasks'],
          summary: 'Delete a task',
          operationId: 'deleteTask',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
          ],
          responses: {
            200: {
              description: 'Task deleted successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Task not found' },
          },
        },
      },
      '/tasks/{id}/status': {
        patch: {
          tags: ['Tasks'],
          summary: 'Update task status',
          operationId: 'updateTaskStatus',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { type: 'object', required: ['status'], properties: { status: { type: 'string', example: 'in_progress' } } } },
          },
          responses: {
            200: {
              description: 'Task status updated',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            400: { description: 'Missing status' },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Task not found' },
          },
        },
      },
      '/tasks/{id}/comments': {
        get: {
          tags: ['Tasks'],
          summary: 'List all comments on a task with pagination',
          operationId: 'listTaskComments',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
            { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1 }, description: 'Page number' },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 }, description: 'Items per page' },
          ],
          responses: {
            200: {
              description: 'Comments list retrieved successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/TaskComment' } },
                      pagination: {
                        type: 'object',
                        properties: {
                          page: { type: 'integer', example: 1 },
                          limit: { type: 'integer', example: 20 },
                          total: { type: 'integer', example: 5 },
                          pages: { type: 'integer', example: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Task not found' },
          },
        },
        post: {
          tags: ['Tasks'],
          summary: 'Add a comment / feedback with optional file attachment',
          operationId: 'addTaskComment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    comment: { type: 'string', description: 'Comment text content', example: 'Added initial test suites.' },
                    file: { type: 'string', format: 'binary', description: 'Optional attachment file (Max 10MB)' },
                  },
                },
              },
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    comment: { type: 'string', example: 'Finished API integrations.' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Comment created successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskComment' } } },
            },
            400: { description: 'Validation failed or missing comment text / attachment' },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Task not found' },
          },
        },
      },
      '/tasks/{id}/comments/{cid}': {
        delete: {
          tags: ['Tasks'],
          summary: 'Delete a comment and its attachments',
          operationId: 'deleteTaskComment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' }, description: 'Comment ID' },
          ],
          responses: {
            200: {
              description: 'Comment deleted successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Comment not found' },
          },
        },
      },
      '/tasks/{id}/comments/{cid}/attachments/{aid}': {
        get: {
          tags: ['Tasks'],
          summary: 'Stream / download an authorized comment attachment file',
          operationId: 'getTaskCommentAttachment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' }, description: 'Comment ID' },
            { name: 'aid', in: 'path', required: true, schema: { type: 'string' }, description: 'Attachment ID' },
            { name: 'download', in: 'query', required: false, schema: { type: 'boolean', default: false }, description: 'Set true for download attachment header' },
          ],
          responses: {
            200: {
              description: 'Attachment file binary stream',
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Attachment or task not found' },
          },
        },
        delete: {
          tags: ['Tasks'],
          summary: 'Delete a specific attachment from a comment',
          operationId: 'deleteTaskCommentAttachment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' }, description: 'Comment ID' },
            { name: 'aid', in: 'path', required: true, schema: { type: 'string' }, description: 'Attachment ID' },
          ],
          responses: {
            200: {
              description: 'Attachment deleted successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Attachment not found' },
          },
        },
      },
      '/tasks/{id}/audit': {
        get: {
          tags: ['Tasks'],
          summary: 'Get task audit logs history',
          operationId: 'listTaskAudit',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
          ],
          responses: {
            200: {
              description: 'Audit logs retrieved',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/TaskAuditLog' } } } } } },
            },
            401: { description: 'Unauthorized' },
            404: { description: 'Task not found' },
          },
        },
      },

      // ───── Goals ─────
      '/goals/assignable-users': {
        get: {
          tags: ['Goals'],
          summary: 'List users available for goal assignment',
          operationId: 'getAssignableUsers',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'Assignable users retrieved successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      users: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            email: { type: 'string' },
                            role: { type: 'string' },
                            department: { type: 'string' },
                            designation: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/goals': {
        get: {
          tags: ['Goals'],
          summary: 'List authorized goals with RBAC hierarchy scoping',
          description: 'Returns goals based on caller role: EMPLOYEE sees only own goals; MANAGER sees own goals + goals assigned to reporting downline (including HR/Admin created goals) + created goals; HR/ADMIN sees tenant-wide goals.',
          operationId: 'listGoals',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Employee ID filter ("all" for all team/tenant goals, or specific employee ID)' },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by goal status' },
            { name: 'financialYear', in: 'query', schema: { type: 'string' }, description: 'Filter by financial year' },
            { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Filter by category' },
          ],
          responses: {
            200: {
              description: 'Goals list retrieved successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Goal' } } } } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — not authorized to view target employee goals' },
          },
        },
        post: {
          tags: ['Goals'],
          summary: 'Create a new goal with atomic multi-employee assignment',
          description: 'Creates a goal and assigns it transactionally to one or multiple employees. Validates all target employees against the manager reporting downline. If any employee is unauthorized, the entire request is rejected with 403.',
          operationId: 'createGoal',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalCreateRequest' } } },
          },
          responses: {
            201: {
              description: 'Goal created and assigned successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } },
            },
            400: { description: 'Validation failed or missing target employees', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — one or more target employees are not in reporting hierarchy' },
          },
        },
      },
      '/goals/mine': {
        get: {
          tags: ['Goals', 'Appraisals'],
          summary: 'Fetch goals and rollup alignment metrics for employee appraisal with pagination',
          operationId: 'getMyGoalsForAppraisal',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Target employee ID (defaults to logged-in user or downline subordinate)' },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number for pagination' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 5 }, description: 'Number of goals per page (max 100)' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search term filtering title, description, or category' },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by goal status (e.g. COMPLETED, IN_PROGRESS, DRAFT)' },
            { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Filter by goal category' },
          ],
          responses: {
            200: {
              description: 'Exact created goals with pagination and rollup alignment metrics',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalAlignmentResponse' } } },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden — target user is not in reporting downline' },
            404: { description: 'Target employee not found in organization' },
          },
        },
      },
      '/goals/sync-to-appraisal': {
        post: {
          tags: ['Goals', 'Appraisals'],
          summary: 'Synchronize completed and active goals into employee self-assessment accomplishments',
          operationId: 'syncGoalsToAppraisal',
          security: [{ userCookie: [] }],
          requestBody: {
            required: false,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SyncGoalsToAppraisalRequest' } } },
          },
          responses: {
            200: {
              description: 'Goals successfully formatted and appended to self-appraisal draft',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SyncGoalsToAppraisalResponse' } } },
            },
            400: { description: 'Validation failed or no goals found to sync' },
            401: { description: 'Unauthorized' },
            404: { description: 'Review record not found' },
          },
        },
      },
      '/goals/{id}': {
        delete: {
          tags: ['Goals'],
          summary: 'Delete a goal',
          operationId: 'deleteGoal',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Goal ID' },
          ],
          responses: {
            200: {
              description: 'Goal deleted successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Goal not found' },
          },
        },
      },

      // ───── Notifications ─────
      '/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List unread notifications for logged-in user',
          operationId: 'listNotificationsForUser',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'Unread notifications list',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/UserNotification' } } } } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/notifications/read-all': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark all notifications as read',
          operationId: 'markAllNotificationsRead',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'All notifications marked read',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/notifications/{id}/read': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark single notification as read',
          operationId: 'markNotificationRead',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Notification ID' },
          ],
          responses: {
            200: {
              description: 'Notification marked read',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/UserNotification' } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Notification not found' },
          },
        },
      },
      '/notifications/{id}': {
        delete: {
          tags: ['Notifications'],
          summary: 'Delete a notification',
          operationId: 'deleteNotification',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Notification ID' },
          ],
          responses: {
            200: {
              description: 'Notification deleted successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
            404: { description: 'Notification not found' },
          },
        },
      },

      // ── Leave & WFH Endpoints ──
      '/leaves': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List leave requests (My, Team, or Company wide)',
          operationId: 'listLeaveRequests',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'scope', in: 'query', required: false, schema: { type: 'string', enum: ['my', 'team', 'company'], default: 'my' }, description: 'Query scope' },
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] }, description: 'Filter by status' },
            { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            200: {
              description: 'Leave requests retrieved successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/LeaveRequest' } },
                      pagination: {
                        type: 'object',
                        properties: {
                          page: { type: 'integer' },
                          limit: { type: 'integer' },
                          total: { type: 'integer' },
                          pages: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Access forbidden' },
          },
        },
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Submit a new Leave or Work From Home request',
          operationId: 'createLeaveRequest',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateLeaveRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Leave request submitted successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequest' } } },
            },
            400: { description: 'Validation error, insufficient balance, or date overlap' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/leaves/balances': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get leave and WFH balances for authenticated employee',
          operationId: 'getMyLeaveBalances',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'year', in: 'query', required: false, schema: { type: 'integer', default: 2026 }, description: 'Year' },
          ],
          responses: {
            200: {
              description: 'Leave balances retrieved',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveBalancesResponse' } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/leaves/{id}/manager/approve': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Manager approves leave request',
          operationId: 'managerApproveLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Leave Request ID' },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { comment: { type: 'string', example: 'Approved by Manager' } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Manager approval registered',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequest' } } },
            },
            400: { description: 'Invalid state transition' },
            403: { description: 'Access forbidden: not reporting manager' },
            404: { description: 'Request not found' },
          },
        },
      },
      '/leaves/{id}/manager/reject': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Manager rejects leave request',
          operationId: 'managerRejectLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Leave Request ID' },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['comment'],
                  properties: { comment: { type: 'string', example: 'Project deadline conflict.' } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Manager rejection registered',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequest' } } },
            },
            400: { description: 'Missing rejection reason or invalid state' },
            403: { description: 'Access forbidden: not reporting manager' },
            404: { description: 'Request not found' },
          },
        },
      },
      '/leaves/{id}/hr/approve': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'HR provides final approval for leave request',
          operationId: 'hrApproveLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Leave Request ID' },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { comment: { type: 'string', example: 'HR approved' } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'HR final approval registered',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequest' } } },
            },
            400: { description: 'Manager has not approved yet' },
            403: { description: 'Access forbidden: HR authorization required' },
            404: { description: 'Request not found' },
          },
        },
      },
      '/leaves/{id}/hr/reject': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'HR rejects leave request',
          operationId: 'hrRejectLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Leave Request ID' },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['comment'],
                  properties: { comment: { type: 'string', example: 'Policy violation.' } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'HR rejection registered',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequest' } } },
            },
            400: { description: 'Missing rejection reason' },
            403: { description: 'Access forbidden: HR authorization required' },
            404: { description: 'Request not found' },
          },
        },
      },
      '/leaves/{id}/cancel': {
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Employee cancels pending leave request',
          operationId: 'cancelLeaveRequest',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Leave Request ID' },
          ],
          responses: {
            200: {
              description: 'Leave request cancelled',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequest' } } },
            },
            400: { description: 'Cannot cancel non-pending request' },
            403: { description: 'Access forbidden: not owner' },
            404: { description: 'Request not found' },
          },
        },
      },
      '/admin/leave-types': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List all leave types with search and status filters (Admin/HR)',
          operationId: 'adminListLeaveTypes',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['ALL', 'ACTIVE', 'INACTIVE'] } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            200: { description: 'Leave types retrieved successfully' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Create a dynamic leave type (Admin/HR)',
          operationId: 'adminCreateLeaveType',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateLeaveType' } } },
          },
          responses: {
            201: { description: 'Leave type created successfully' },
            400: { description: 'Validation error' },
            409: { description: 'Code already exists' },
          },
        },
      },
      '/admin/leave-types/{id}': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get leave type details',
          operationId: 'adminGetLeaveTypeById',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Leave type details' }, 404: { description: 'Not found' } },
        },
        put: {
          tags: ['Leaves & WFH'],
          summary: 'Update leave type configuration',
          operationId: 'adminUpdateLeaveType',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 200: { description: 'Leave type updated' }, 404: { description: 'Not found' } },
        },
        delete: {
          tags: ['Leaves & WFH'],
          summary: 'Safely delete leave type (only if no dependent records exist)',
          operationId: 'adminDeleteLeaveType',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Leave type safely deleted' },
            409: { description: 'Cannot delete: historical records depend on this leave type' },
          },
        },
      },
      '/admin/leave-types/{id}/status': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Activate or deactivate leave type',
          operationId: 'adminToggleLeaveTypeStatus',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { isActive: { type: 'boolean' } } } } } },
          responses: { 200: { description: 'Status updated successfully' } },
        },
      },
      '/leave-types': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List active leave types for employee application dropdown',
          operationId: 'listActiveLeaveTypes',
          security: [{ userCookie: [] }],
          responses: { 200: { description: 'Active leave types list' } },
        },
      },
      '/wfh/policy': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get company Work From Home policy',
          operationId: 'getWfhPolicy',
          security: [{ userCookie: [] }],
          responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WfhPolicy' } } } } },
        },
      },
      '/admin/wfh/policy': {
        put: {
          tags: ['Leaves & WFH'],
          summary: 'Update company Work From Home policy (Admin)',
          operationId: 'adminUpdateWfhPolicy',
          security: [{ userCookie: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 200: { description: 'WFH policy updated' } },
        },
      },
      '/admin/leave-balances': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List employee leave and WFH balances (Admin/HR)',
          operationId: 'adminListEmployeeBalances',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'year', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Employee balances retrieved' } },
        },
      },
      '/admin/leave-balances/adjust': {
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Manually adjust employee balance with audit log (Admin)',
          operationId: 'adminAdjustEmployeeBalance',
          security: [{ userCookie: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 200: { description: 'Balance adjusted successfully' } },
        },
      },
      '/admin/leave-overview/stats': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get leave and WFH overview statistics (Admin/HR)',
          operationId: 'adminGetLeaveStats',
          security: [{ userCookie: [] }],
          responses: { 200: { description: 'Statistics summary' } },
        },
      },
      '/admin/leave-overview/calendar': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get leave calendar events (Admin/HR)',
          operationId: 'adminGetLeaveCalendar',
          security: [{ userCookie: [] }],
          responses: { 200: { description: 'Calendar events list' } },
        },
      },
      '/admin/leave-logs': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get leave and WFH audit trail (Admin/HR)',
          operationId: 'adminGetLeaveAuditLogs',
          security: [{ userCookie: [] }],
          responses: { 200: { description: 'Audit trail records' } },
        },
      },

      // ── Goal Management Endpoints ──
      '/goals/categories': {
        get: {
          tags: ['Goals'],
          summary: 'List available dynamic goal categories',
          operationId: 'getGoalCategories',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'List of goal categories',
              content: { 'application/json': { schema: { type: 'object', properties: { categories: { type: 'array', items: { type: 'string' } } } } } },
            },
          },
        },
      },
      '/goals/types': {
        get: {
          tags: ['Goals'],
          summary: 'List supported goal types (General, KPI, OKR, etc.)',
          operationId: 'getGoalTypes',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'List of goal types',
              content: { 'application/json': { schema: { type: 'object', properties: { types: { type: 'array', items: { type: 'string' } } } } } },
            },
          },
        },
      },
      '/goals/priorities': {
        get: {
          tags: ['Goals'],
          summary: 'List goal priority levels',
          operationId: 'getGoalPriorities',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'List of priorities',
              content: { 'application/json': { schema: { type: 'object', properties: { priorities: { type: 'array', items: { type: 'string' } } } } } },
            },
          },
        },
      },
      '/goals/assignable-users': {
        get: {
          tags: ['Goals'],
          summary: 'List employees eligible for goal assignment based on RBAC and reporting downline',
          operationId: 'getGoalAssignableUsers',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'List of assignable users',
              content: { 'application/json': { schema: { type: 'object', properties: { users: { type: 'array', items: { type: 'object' } } } } } },
            },
          },
        },
      },
      '/goals': {
        get: {
          tags: ['Goals'],
          summary: 'List goals with optional filtering',
          operationId: 'listGoals',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Filter by employee' },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by workflow status' },
            { name: 'financialYear', in: 'query', schema: { type: 'string' }, description: 'Filter by financial year' },
            { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Filter by category' },
          ],
          responses: {
            200: {
              description: 'List of goals with tasks and audit logs',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Goal' } } } } } },
            },
          },
        },
        post: {
          tags: ['Goals'],
          summary: 'Create a new Goal',
          operationId: 'createGoal',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalCreateRequest' } } },
          },
          responses: {
            201: {
              description: 'Goal created successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } },
            },
            400: { description: 'Validation failed' },
            403: { description: 'Forbidden: unauthorized goal assignment' },
          },
        },
      },
      '/goals/{id}': {
        get: {
          tags: ['Goals'],
          summary: 'Get goal details by ID',
          operationId: 'getGoalById',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            404: { description: 'Goal not found' },
          },
        },
        patch: {
          tags: ['Goals'],
          summary: 'Update goal details',
          operationId: 'updateGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalUpdateRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            400: { description: 'Validation failed' },
            403: { description: 'Forbidden' },
            404: { description: 'Goal not found' },
          },
        },
        delete: {
          tags: ['Goals'],
          summary: 'Delete a goal',
          operationId: 'deleteGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Goal deleted successfully' },
            403: { description: 'Forbidden' },
            404: { description: 'Goal not found' },
          },
        },
      },
      '/goals/{id}/submit': {
        post: {
          tags: ['Goals'],
          summary: 'Employee submits completed goal for manager review',
          operationId: 'submitGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalSubmitRequest' } } },
          },
          responses: {
            200: { description: 'Goal submitted for manager review', content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            400: { description: 'Incomplete tasks or invalid status', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Only goal assignee can submit' },
          },
        },
      },
      '/goals/{id}/approve': {
        post: {
          tags: ['Goals'],
          summary: 'Manager approves goal and forwards for HR review',
          operationId: 'managerApproveGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalApproveRequest' } } },
          },
          responses: {
            200: { description: 'Goal approved by manager', content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden: not reporting manager' },
          },
        },
      },
      '/goals/{id}/reject': {
        post: {
          tags: ['Goals'],
          summary: 'Manager requests changes or rejects goal',
          operationId: 'managerRejectGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalRejectRequest' } } },
          },
          responses: {
            200: { description: 'Goal returned for revisions', content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            400: { description: 'Rejection reason is required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          },
        },
      },
      '/goals/{id}/hr-approve': {
        post: {
          tags: ['Goals'],
          summary: 'HR gives final sign-off and marks goal as COMPLETED',
          operationId: 'hrApproveGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalApproveRequest' } } },
          },
          responses: {
            200: { description: 'Goal finalized as COMPLETED', content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden: HR role required' },
          },
        },
      },
      '/goals/{id}/hr-reject': {
        post: {
          tags: ['Goals'],
          summary: 'HR requests revisions on goal',
          operationId: 'hrRejectGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalRejectRequest' } } },
          },
          responses: {
            200: { description: 'Goal returned for revisions by HR', content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            400: { description: 'Rejection reason is required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          },
        },
      },
      '/goals/{id}/resubmit': {
        post: {
          tags: ['Goals'],
          summary: 'Employee resubmits revised goal for review',
          operationId: 'resubmitGoal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalResubmitRequest' } } },
          },
          responses: {
            200: { description: 'Goal resubmitted for manager review', content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          },
        },
      },
      '/goals/{id}/comments': {
        get: {
          tags: ['Goals'],
          summary: 'Get comments and feedback for a goal',
          operationId: 'listGoalComments',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/GoalComment' } } } } } } },
          },
        },
        post: {
          tags: ['Goals'],
          summary: 'Post feedback or progress update comment on a goal',
          operationId: 'addGoalComment',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalCommentCreateRequest' } } },
          },
          responses: {
            201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalComment' } } } },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          },
        },
      },
      '/goals/{id}/comments/{cid}': {
        delete: {
          tags: ['Goals'],
          summary: 'Delete a goal comment',
          operationId: 'deleteGoalComment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
            403: { description: 'Forbidden' },
            404: { description: 'Comment not found' },
          },
        },
      },
      '/goals/{id}/audit': {
        get: {
          tags: ['Goals'],
          summary: 'Get audit history logs for a goal',
          operationId: 'listGoalAudit',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/GoalAuditLog' } } } } } } },
          },
        },
      },

      // ── Task Management Endpoints ──
      '/tasks': {
        get: {
          tags: ['Tasks'],
          summary: 'List tasks with optional filtering',
          operationId: 'listTasks',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Employee user ID or "all"' },
            { name: 'fy', in: 'query', schema: { type: 'string' }, description: 'Financial year filter' },
          ],
          responses: {
            200: {
              description: 'List of tasks',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } } } },
            },
          },
        },
        post: {
          tags: ['Tasks'],
          summary: 'Create a new task',
          operationId: 'createTask',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskCreateRequest' } } },
          },
          responses: {
            201: {
              description: 'Task created successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            400: { description: 'Validation failed' },
            403: { description: 'Unauthorized task assignment' },
          },
        },
      },
      '/tasks/{id}': {
        patch: {
          tags: ['Tasks'],
          summary: 'Update task fields (PATCH)',
          operationId: 'patchTask',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskUpdateRequest' } } },
          },
          responses: {
            200: { description: 'Task updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } },
            400: { description: 'Validation failed' },
            404: { description: 'Task not found' },
          },
        },
        put: {
          tags: ['Tasks'],
          summary: 'Update task fields (PUT)',
          operationId: 'putTask',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskUpdateRequest' } } },
          },
          responses: {
            200: { description: 'Task updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } },
            400: { description: 'Validation failed' },
            404: { description: 'Task not found' },
          },
        },
        delete: {
          tags: ['Tasks'],
          summary: 'Delete task',
          operationId: 'deleteTask',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Task deleted successfully' },
            403: { description: 'Forbidden' },
            404: { description: 'Task not found' },
          },
        },
      },
      '/tasks/{id}/status': {
        patch: {
          tags: ['Tasks'],
          summary: 'Quickly update task board status and progress',
          operationId: 'updateTaskStatus',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: {
                    status: { type: 'string', enum: ['todo', 'in_progress', 'pending_on_others', 'in_review', 'done'] },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Status updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } },
          },
        },
      },
      '/tasks/{id}/comments': {
        get: {
          tags: ['Tasks'],
          summary: 'List comments for a task',
          operationId: 'listTaskComments',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/TaskComment' } } } } } } },
          },
        },
        post: {
          tags: ['Tasks'],
          summary: 'Add a comment with optional file attachment to a task',
          operationId: 'addTaskComment',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    comment: { type: 'string', example: 'Refactored controller' },
                    file: { type: 'string', format: 'binary' },
                  },
                },
              },
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    comment: { type: 'string', example: 'Refactored controller' },
                  },
                },
              },
            },
          },
          responses: {
            201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskComment' } } } },
          },
        },
      },
      '/tasks/{id}/comments/{cid}': {
        delete: {
          tags: ['Tasks'],
          summary: 'Delete a comment from a task',
          operationId: 'deleteTaskComment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Comment deleted' },
          },
        },
      },
      '/tasks/{id}/comments/{cid}/attachments/{aid}': {
        get: {
          tags: ['Tasks'],
          summary: 'Download a task comment attachment',
          operationId: 'getTaskCommentAttachment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'aid', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Binary attachment file stream' },
          },
        },
        delete: {
          tags: ['Tasks'],
          summary: 'Delete an attachment from a task comment',
          operationId: 'deleteTaskCommentAttachment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'aid', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Attachment deleted' },
          },
        },
      },
      '/tasks/{id}/audit': {
        get: {
          tags: ['Tasks'],
          summary: 'Get audit history logs for a task',
          operationId: 'listTaskAudit',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/TaskAuditLog' } } } } } } },
          },
        },
      },

      // ── Notifications Endpoints ──
      '/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List user alert notifications',
          operationId: 'listNotifications',
          security: [{ userCookie: [] }],
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/UserNotification' } } } } } } },
          },
        },
      },
      '/notifications/read-all': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark all notifications as read',
          operationId: 'markAllNotificationsRead',
          security: [{ userCookie: [] }],
          responses: {
            200: { description: 'All notifications marked as read' },
          },
        },
      },
      '/notifications/{id}/read': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark specific notification as read',
          operationId: 'markNotificationRead',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Notification marked as read' },
          },
        },
      },
      '/notifications/{id}': {
        delete: {
          tags: ['Notifications'],
          summary: 'Delete notification',
          operationId: 'deleteNotification',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Notification deleted' },
          },
        },
      },

      // ── External Reviews Endpoints ──
      '/reviews/request': {
        post: {
          tags: ['External Reviews'],
          summary: 'Initiate an external/client stakeholder review invitation',
          operationId: 'requestExReview',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ExternalReviewRequest' } } },
          },
          responses: {
            201: {
              description: 'Review invitation generated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string', example: 'rev_abc123xyz' },
                      inviteUrl: { type: 'string', example: 'http://localhost:5173/review/rev_abc123xyz' },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/public/reviews/{token}': {
        get: {
          tags: ['External Reviews'],
          summary: 'Get public review invitation details by secure token',
          operationId: 'getExReviewByToken',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' }, description: 'Secure review token' },
          ],
          responses: {
            200: {
              description: 'Review details retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      employeeName: { type: 'string', example: 'Arjun Sharma' },
                      clientName: { type: 'string', example: 'Acme Corp Lead' },
                      status: { type: 'string', example: 'PENDING' },
                    },
                  },
                },
              },
            },
            404: { description: 'Invalid or expired review token' },
          },
        },
        post: {
          tags: ['External Reviews'],
          summary: 'Submit external stakeholder review feedback',
          operationId: 'submitExReview',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' }, description: 'Secure review token' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitExternalReviewRequest' } } },
          },
          responses: {
            200: {
              description: 'Review feedback recorded successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { success: { type: 'boolean', example: true } },
                  },
                },
              },
            },
            400: { description: 'Review already submitted or invalid payload' },
            404: { description: 'Invalid or expired review token' },
          },
        },
      },

      // ── Reports & Analytics Endpoints ──
      '/reports/analytics': {
        get: {
          tags: ['Reports & Analytics'],
          summary: 'Get high-level organizational analytics and KPI summary',
          operationId: 'getAnalyticsSummary',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'Analytics summary retrieved',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalyticsSummary' } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ── Uploads Endpoints ──
      '/upload': {
        post: {
          tags: ['Uploads'],
          summary: 'Upload a document or image file (max 5MB)',
          operationId: 'uploadFile',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'File uploaded successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/FileUploadResponse' } } },
            },
            400: { description: 'No file uploaded or size limit exceeded' },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ── Policies & Compliance Endpoints ──
      '/policies/my': {
        get: {
          tags: ['Policies & Compliance'],
          summary: 'List policies assigned to current authenticated employee',
          operationId: 'getMyPolicies',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'List of assigned policies with status and signature details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/EmployeePolicyItem' },
                      },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/policies/my/{id}': {
        get: {
          tags: ['Policies & Compliance'],
          summary: 'Get details of a single policy assigned to current employee',
          operationId: 'getMyPolicyById',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Policy ID' },
          ],
          responses: {
            200: {
              description: 'Policy assignment details retrieved',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/EmployeePolicyItem' } } },
            },
            401: { description: 'Unauthorized' },
            404: { description: 'Policy not assigned or not found' },
          },
        },
      },
      '/policies/{id}/sign': {
        post: {
          tags: ['Policies & Compliance'],
          summary: 'Digitally sign & accept a corporate policy mandate',
          description: 'Captures IP address and user-agent server-side, generates SHA-256 verification hash, and logs an immutable audit event.',
          operationId: 'signPolicy',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Policy ID' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SignPolicyRequest' } } },
          },
          responses: {
            200: {
              description: 'Policy agreement digitally signed and certified',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SignPolicyResponse' } } },
            },
            400: { description: 'Already signed or policy not in published state' },
            401: { description: 'Unauthorized' },
            403: { description: 'Not assigned to this policy' },
            404: { description: 'Policy not found' },
          },
        },
      },
      '/policies': {
        get: {
          tags: ['Policies & Compliance'],
          summary: 'List corporate policies with calculated compliance statistics (HR/Admin)',
          operationId: 'listPolicies',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['ALL', 'DRAFT', 'PUBLISHED', 'ARCHIVED'] } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Policies list retrieved with compliance metrics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/PolicyItem' } },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — requires HR/Admin privileges' },
          },
        },
        post: {
          tags: ['Policies & Compliance'],
          summary: 'Publish new corporate policy and assign to employees (HR/Admin)',
          operationId: 'createPolicy',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePolicyRequest' } } },
          },
          responses: {
            201: {
              description: 'Policy created, assigned, and published successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyItem' } } },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — requires HR/Admin privileges' },
          },
        },
      },
      '/policies/{id}': {
        get: {
          tags: ['Policies & Compliance'],
          summary: 'Get policy details with assignment breakdown (HR/Admin)',
          operationId: 'getPolicyById',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Policy details with employee assignment breakdown',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyItem' } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Policy not found' },
          },
        },
        put: {
          tags: ['Policies & Compliance'],
          summary: 'Update policy text, version, or assign additional employees (HR/Admin)',
          operationId: 'updatePolicy',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdatePolicyRequest' } } },
          },
          responses: {
            200: {
              description: 'Policy updated successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyItem' } } },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Policy not found' },
          },
        },
        delete: {
          tags: ['Policies & Compliance'],
          summary: 'Permanently delete a corporate policy and its assignment records (HR/Admin)',
          operationId: 'deletePolicy',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Policy deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Policy deleted successfully' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Policy not found' },
          },
        },
      },
      '/policies/{id}/publish': {
        post: {
          tags: ['Policies & Compliance'],
          summary: 'Publish a draft policy and assign to target employees',
          operationId: 'publishPolicy',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    assignees: {
                      oneOf: [{ type: 'string', enum: ['ALL'] }, { type: 'array', items: { type: 'string' } }],
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Policy published' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/policies/{id}/archive': {
        post: {
          tags: ['Policies & Compliance'],
          summary: 'Archive a policy mandate (HR/Admin)',
          operationId: 'archivePolicy',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Policy archived successfully' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/policies/{id}/reminders': {
        post: {
          tags: ['Policies & Compliance'],
          summary: 'Dispatch digital sign-off reminders to non-compliant employees (HR/Admin)',
          operationId: 'sendPolicyReminders',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    userId: { type: 'string', nullable: true, description: 'Optional: target specific user. If omitted, sends to all pending employees.' },
                    customMessage: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Reminders dispatched successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      count: { type: 'integer', example: 4 },
                      message: { type: 'string', example: 'Successfully dispatched sign-off reminders to 4 employee(s).' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/policies/compliance/registry': {
        get: {
          tags: ['Policies & Compliance'],
          summary: 'HR Compliance Sign-Off Registry with auditable IP & timestamps',
          operationId: 'getComplianceRegistry',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'policyId', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            200: {
              description: 'Audit registry items retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/ComplianceRegistryItem' } },
                      total: { type: 'integer' },
                      page: { type: 'integer' },
                      totalPages: { type: 'integer' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/policies/compliance/pending': {
        get: {
          tags: ['Policies & Compliance'],
          summary: 'List non-compliant employees across active mandates (HR/Admin)',
          operationId: 'getPendingCompliance',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'policyId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Pending non-signed employee records',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/PendingComplianceItem' } },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/policies/compliance/export': {
        get: {
          tags: ['Policies & Compliance'],
          summary: 'Export digital compliance registry as RFC-4180 CSV (HR/Admin)',
          operationId: 'exportComplianceCSV',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'policyId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'CSV file download containing digital acceptance audit logs',
              content: {
                'text/csv': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ── Appraisal Module Paths ─────────────────────────────────────────────

      '/appraisals/submit': {
        post: {
          tags: ['Appraisals'],
          summary: 'Submit employee self-rating, accomplishments, and parameter scores',
          description: 'Submits or saves draft for employee self-assessment. Links automatically to the active monthly, quarterly, or annual cycle.',
          operationId: 'submitSelfRating',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SubmitSelfRatingRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Appraisal review recorded / updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PerformanceReview' },
                },
              },
            },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/appraisals': {
        get: {
          tags: ['Appraisals'],
          summary: 'List my appraisal submissions with pagination and search filter',
          operationId: 'listAppraisals',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 }, description: 'Items per page (max 100)' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search across cycle name, accomplishments, remarks' },
            { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'] }, description: 'Filter by cycle frequency' },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED'] }, description: 'Filter by review status' },
          ],
          responses: {
            200: {
              description: 'Paginated list of appraisals',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AppraisalListResponse' },
                },
              },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/appraisals/{id}': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get full appraisal breakdown by ID with employee profile and scores',
          operationId: 'getAppraisalById',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Complete appraisal breakdown',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      review: { $ref: '#/components/schemas/PerformanceReview' },
                    },
                  },
                },
              },
            },
            404: { description: 'Appraisal not found' },
          },
        },
        patch: {
          tags: ['Appraisals'],
          summary: 'Update appraisal review fields (RBAC governed)',
          operationId: 'updateAppraisalReview',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateReviewRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated review record',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      review: { $ref: '#/components/schemas/PerformanceReview' },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation error' },
            403: { description: 'Access denied: Insufficient permissions' },
            404: { description: 'Appraisal not found' },
          },
        },
        delete: {
          tags: ['Appraisals'],
          summary: 'Delete appraisal review record (Employee owner, Manager, or Admin)',
          operationId: 'deleteAppraisalReview',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Appraisal review deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Appraisal review record deleted successfully.' },
                      deletedId: { type: 'string' },
                    },
                  },
                },
              },
            },
            403: { description: 'Access denied' },
            404: { description: 'Review not found' },
          },
        },
      },
      '/appraisals/{id}/manager-review': {
        patch: {
          tags: ['Appraisals'],
          summary: 'Submit manager review for an employee appraisal',
          operationId: 'submitManagerRatingForAppraisal',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SubmitManagerRatingRequest' },
              },
            },
          },
          responses: {
            200: { description: 'Manager evaluation saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/PerformanceReview' } } } },
            400: { description: 'Validation error' },
            403: { description: 'Forbidden' },
            404: { description: 'Review not found' },
          },
        },
      },
      '/performance-reviews/{id}': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get performance review by ID',
          operationId: 'getPerformanceReviewById',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Review breakdown', content: { 'application/json': { schema: { type: 'object', properties: { review: { $ref: '#/components/schemas/PerformanceReview' } } } } } },
            404: { description: 'Review not found' },
          },
        },
        patch: {
          tags: ['Appraisals'],
          summary: 'Update performance review metadata (RBAC)',
          operationId: 'updatePerformanceReviewById',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateReviewRequest' },
              },
            },
          },
          responses: {
            200: { description: 'Review updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, review: { $ref: '#/components/schemas/PerformanceReview' } } } } } },
            403: { description: 'Access denied' },
            404: { description: 'Review not found' },
          },
        },
        delete: {
          tags: ['Appraisals'],
          summary: 'Delete performance review by ID',
          operationId: 'deletePerformanceReviewById',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Review deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } } },
            403: { description: 'Access denied' },
            404: { description: 'Review not found' },
          },
        },
      },

      '/appraisal-cycles': {
        post: {
          tags: ['Appraisals'],
          summary: 'Create a new appraisal cycle for any year & month (HR / Admin / CMD)',
          description: 'Creates an appraisal cycle for a designated year, month, or quarter. Automatically clones tenant evaluation parameters or seeds default skills.',
          operationId: 'createCycle',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateCycleRequest' },
                example: {
                  year: 2026,
                  month: 'September',
                  monthNumber: 9,
                  frequency: 'MONTHLY',
                  name: 'September 2026',
                  status: 'ACTIVE',
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Cycle created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Appraisal cycle for September 2026 created successfully.' },
                      cycle: { $ref: '#/components/schemas/AppraisalCycle' },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden — requires HR, Admin, Super Admin, or CMD role' },
            409: { description: 'Cycle for this cadence/month/year already exists' },
          },
        },
        get: {
          tags: ['Appraisals'],
          summary: 'List all appraisal cycles with year, cadence, and status filters',
          description: 'Retrieve all appraisal cycles for the tenant with distinct years list and cycle counts.',
          operationId: 'listCycles',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'year', in: 'query', schema: { type: 'integer', minimum: 2000, maximum: 2100 }, description: 'Filter by appraisal cycle year' },
            { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'] }, description: 'Filter by cycle cadence' },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'CLOSED'] }, description: 'Filter by cycle status' },
          ],
          responses: {
            200: {
              description: 'List of cycles and distinct years',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AppraisalCycleListResponse' },
                },
              },
            },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/appraisal-cycles/active': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get active appraisal cycle with parameters (supports dynamic cadence, year & month)',
          operationId: 'getActiveCycle',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL'], default: 'MONTHLY' }, description: 'Appraisal cadence' },
            { name: 'period', in: 'query', schema: { type: 'string' }, description: 'Specific month/quarter period name, e.g. "September 2026"' },
            { name: 'cycleId', in: 'query', schema: { type: 'string' }, description: 'Target cycle ID' },
            { name: 'year', in: 'query', schema: { type: 'integer', minimum: 2000, maximum: 2100 }, description: 'Target appraisal year' },
            { name: 'month', in: 'query', schema: { type: 'string' }, description: 'Target month name or number (e.g. "September" or "9")' },
          ],
          responses: {
            200: {
              description: 'Active cycle with parameters and available cycles',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      cycle: { $ref: '#/components/schemas/AppraisalCycle' },
                      parameters: { type: 'array', items: { $ref: '#/components/schemas/AppraisalParameter' } },
                      availableCycles: { type: 'array', items: { $ref: '#/components/schemas/AppraisalCycle' } },
                      currentPeriods: {
                        type: 'object',
                        properties: {
                          monthly: { type: 'object' },
                          quarterly: { type: 'object' },
                          annual: { type: 'object' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/appraisal-cycles/{id}': {
        patch: {
          tags: ['Appraisals'],
          summary: 'Update cycle settings (HR / SUPER_ADMIN / CMD / ADMIN)',
          operationId: 'updateCycle',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateCycleRequest' },
                example: {
                  name: 'September 2026',
                  frequency: 'MONTHLY',
                  year: 2026,
                  month: 'September',
                  status: 'ACTIVE',
                },
              },
            },
          },
          responses: {
            200: { description: 'Updated cycle', content: { 'application/json': { schema: { $ref: '#/components/schemas/AppraisalCycle' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden — insufficient role' },
            404: { description: 'Cycle not found' },
          },
        },
      },
      '/appraisal-parameters': {
        get: {
          tags: ['Appraisals'],
          summary: 'List evaluation skill parameters for active or specified cycle',
          description: 'Fetches the ordered list of appraisal rating parameters (Technical Skills, Communication, etc.) for a cycle.',
          operationId: 'listParameters',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'cycleId', in: 'query', schema: { type: 'string' }, description: 'Appraisal Cycle ID (defaults to active cycle if omitted)' },
          ],
          responses: {
            200: {
              description: 'List of evaluation parameters',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ParameterListResponse' },
                },
              },
            },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            401: { description: 'Unauthorized' },
          },
        },
        post: {
          tags: ['Appraisals'],
          summary: 'Create a new evaluation skill parameter (HR / Admin / CMD)',
          description: 'Adds a custom dynamic appraisal parameter skill to the cycle with designated display order.',
          operationId: 'createParameter',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateParameterRequest' },
                example: {
                  name: 'Cloud Infrastructure & DevOps',
                  order: 6,
                  isActive: true,
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Parameter created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Skill parameter "Cloud Infrastructure & DevOps" added successfully.' },
                      parameter: { $ref: '#/components/schemas/AppraisalParameter' },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden — requires HR, Admin, Super Admin, or CMD role' },
            404: { description: 'Appraisal cycle not found' },
          },
        },
      },
      '/appraisal-parameters/{id}': {
        patch: {
          tags: ['Appraisals'],
          summary: 'Enable / disable, rename, or reorder a rating parameter (HR / Admin / CMD)',
          operationId: 'updateParameter',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Parameter ID' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateParameterRequest' },
                example: {
                  name: 'Leadership & Initiative',
                  order: 3,
                  isActive: true,
                },
              },
            },
          },
          responses: {
            200: { description: 'Updated parameter', content: { 'application/json': { schema: { $ref: '#/components/schemas/AppraisalParameter' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden' },
            404: { description: 'Parameter not found' },
          },
        },
        delete: {
          tags: ['Appraisals'],
          summary: 'Delete or safely soft-deactivate an evaluation parameter (HR / Admin / CMD)',
          description: 'Hard deletes the parameter if no review scores reference it. If review scores already exist, automatically deactivates it (isActive: false) to preserve historical review data integrity.',
          operationId: 'deleteParameter',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Parameter ID' }],
          responses: {
            200: {
              description: 'Parameter deleted or deactivated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      deactivated: { type: 'boolean', example: false },
                      message: { type: 'string', example: 'Parameter deleted successfully.' },
                      parameter: { $ref: '#/components/schemas/AppraisalParameter' },
                    },
                  },
                },
              },
            },
            400: { description: 'Invalid parameter ID parameter', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden' },
            404: { description: 'Parameter not found' },
          },
        },
      },
      '/performance-reviews/mine': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get my performance review for current or specified cadence/period',
          operationId: 'getMyReview',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL'] } },
            { name: 'period', in: 'query', schema: { type: 'string' } },
            { name: 'cycleId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Review and active parameters',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      review: { $ref: '#/components/schemas/PerformanceReview' },
                      activeParameters: { type: 'array', items: { $ref: '#/components/schemas/AppraisalParameter' } },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/performance-reviews/mine/all': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get all my reviews across all cycles with pagination & search',
          operationId: 'getMyAllReviews',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'] } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED'] } },
          ],
          responses: {
            200: {
              description: 'Paginated performance review list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AppraisalListResponse' },
                },
              },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/performance-reviews/{id}/self': {
        patch: {
          tags: ['Appraisals'],
          summary: 'Save or submit self assessment (employee only — own review)',
          description: 'Call this endpoint to save progress (submit=false) or finalize (submit=true). Get the review ID from GET /performance-reviews/mine, and parameter IDs from the activeParameters array.',
          operationId: 'updateSelfAssessment',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Performance Review ID — get from GET /performance-reviews/mine' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SelfAssessmentRequest' },
                example: {
                  selfAccomplishments: 'Delivered the full database migration with zero downtime. Led architecture design for the new microservices layer.',
                  selfWeaknesses: 'Need to improve async communication and documentation during cross-team projects.',
                  scores: [
                    { parameterId: '<get from GET /performance-reviews/mine → activeParameters[0].id>', selfScore: 4 },
                    { parameterId: '<activeParameters[1].id>', selfScore: 5 },
                    { parameterId: '<activeParameters[2].id>', selfScore: 3 },
                    { parameterId: '<activeParameters[3].id>', selfScore: 4 },
                    { parameterId: '<activeParameters[4].id>', selfScore: 5 },
                  ],
                  submit: false,
                },
              },
            },
          },
          responses: {
            200: { description: 'Updated performance review', content: { 'application/json': { schema: { $ref: '#/components/schemas/PerformanceReview' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden — can only update own self-assessment' },
            404: { description: 'Review not found' },
          },
        },
      },
      '/goals/mine': {
        get: {
          tags: ['Appraisals', 'Goals'],
          summary: 'Get goals aligned with performance review (with rollup metrics & completion statistics)',
          operationId: 'getAppraisalGoals',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Target employee ID (defaults to current user)' },
          ],
          responses: {
            200: {
              description: 'Goals alignment list with rollup completion metrics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      goals: { type: 'array', items: { $ref: '#/components/schemas/Goal' } },
                      metrics: {
                        type: 'object',
                        properties: {
                          totalGoals: { type: 'integer', example: 5 },
                          completedGoals: { type: 'integer', example: 3 },
                          inProgressGoals: { type: 'integer', example: 2 },
                          averageProgress: { type: 'integer', example: 78 },
                          alignmentScore: { type: 'number', example: 4.2 },
                          completionRate: { type: 'integer', example: 60 },
                          milestonesTotal: { type: 'integer', example: 14 },
                          milestonesCompleted: { type: 'integer', example: 11 },
                        },
                      },
                      employee: { $ref: '#/components/schemas/Employee' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/goals/sync-to-appraisal': {
        post: {
          tags: ['Appraisals', 'Goals'],
          summary: 'Synchronize completed goals directly into employee appraisal accomplishments',
          operationId: 'syncGoalsToAppraisal',
          security: [{ userCookie: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    reviewId: { type: 'string' },
                    frequency: { type: 'string', enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL'] },
                    periodName: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Accomplishments synchronized into performance review',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string' },
                      accomplishmentsText: { type: 'string' },
                      suggestedRating: { type: 'number', example: 4.2 },
                      review: { $ref: '#/components/schemas/PerformanceReview' },
                    },
                  },
                },
              },
            },
            400: { description: 'No goals found to sync' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/performance-reviews/employee/{employeeId}': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get a direct report\'s review (Manager / HR / CMD)',
          operationId: 'getEmployeeReviewForManager',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' }, description: 'Target direct report employee ID' },
            { name: 'cycleId', in: 'query', schema: { type: 'string' }, description: 'Defaults to the active cycle' },
            { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL'], default: 'MONTHLY' }, description: 'Appraisal cadence' },
            { name: 'period', in: 'query', schema: { type: 'string' }, description: 'Period name string' },
            { name: 'year', in: 'query', schema: { type: 'integer', minimum: 2000, maximum: 2100 }, description: 'Appraisal year' },
            { name: 'month', in: 'query', schema: { type: 'string' }, description: 'Month name or number' },
          ],
          responses: {
            200: { description: 'Review and parameters', content: { 'application/json': { schema: { type: 'object', properties: { review: { $ref: '#/components/schemas/PerformanceReview' }, activeParameters: { type: 'array', items: { $ref: '#/components/schemas/AppraisalParameter' } } } } } } },
            400: { description: 'Validation error' },
            403: { description: 'Forbidden — not the manager of this employee' },
            404: { description: 'Employee not found' },
          },
        },
      },
      '/performance-reviews/{id}/manager': {
        patch: {
          tags: ['Appraisals'],
          summary: 'Submit manager evaluation for a direct report (Manager / HR / CMD)',
          description: 'Get the review ID from GET /performance-reviews/employee/{employeeId}. Use the activeParameters from the same response for parameterId values.',
          operationId: 'updateManagerReview',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Performance Review ID — get from GET /performance-reviews/employee/{employeeId}' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ManagerReviewRequest' },
                example: {
                  managerRemarks: 'Consistent high-quality delivery throughout the cycle. Showed strong initiative during the platform migration. Needs to improve cross-team communication.',
                  submit: true,
                  scores: [
                    { parameterId: '<activeParameters[0].id>', managerScore: 5 },
                    { parameterId: '<activeParameters[1].id>', managerScore: 4 },
                    { parameterId: '<activeParameters[2].id>', managerScore: 4 },
                    { parameterId: '<activeParameters[3].id>', managerScore: 5 },
                    { parameterId: '<activeParameters[4].id>', managerScore: 4 },
                  ],
                },
              },
            },
          },
          responses: {
            200: { description: 'Updated review', content: { 'application/json': { schema: { $ref: '#/components/schemas/PerformanceReview' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden' },
            404: { description: 'Review not found' },
          },
        },
      },
      '/performance-reviews/{employeeId}/hr-audit': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get HR audit view for an employee\'s review (HR / SUPER_ADMIN / CMD)',
          operationId: 'getHrAuditReview',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cycleId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Review with HR audit fields', content: { 'application/json': { schema: { $ref: '#/components/schemas/PerformanceReview' } } } },
            403: { description: 'Forbidden' },
            404: { description: 'Employee not found' },
          },
        },
      },
      '/performance-reviews/{id}/hr-audit': {
        patch: {
          tags: ['Appraisals'],
          summary: 'Set hike %, HR scores, and release sign-off (HR / SUPER_ADMIN)',
          description: 'Step 1: Save hike and HR scores (hrSignoffStatus omitted or PENDING_RELEASE). Step 2: Release the appraisal by setting hrSignoffStatus=RELEASED — this is irreversible and notifies the employee.',
          operationId: 'updateHrAuditReview',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Performance Review ID — get from GET /performance-reviews/{employeeId}/hr-audit' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HrAuditRequest' },
                example: {
                  hikePercentage: 12,
                  hrRemarks: 'Strong performance — compensation reviewed and approved by leadership.',
                  hrSignoffStatus: 'PENDING_RELEASE',
                  scores: [
                    { parameterId: '<activeParameters[0].id>', hrScore: 5 },
                    { parameterId: '<activeParameters[1].id>', hrScore: 4 },
                    { parameterId: '<activeParameters[2].id>', hrScore: 4 },
                    { parameterId: '<activeParameters[3].id>', hrScore: 5 },
                    { parameterId: '<activeParameters[4].id>', hrScore: 4 },
                  ],
                },
              },
            },
          },
          responses: {
            200: { description: 'Updated review with hike details', content: { 'application/json': { schema: { $ref: '#/components/schemas/PerformanceReview' } } } },
            400: { description: 'Validation error or review already released', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden' },
            409: { description: 'Audit sign-off already released — immutable' },
          },
        },
      },
      '/peer-nominations': {
        post: {
          tags: ['Appraisals'],
          summary: 'Nominate a colleague to give you peer feedback',
          description: 'Nominate a colleague to leave anonymous 360° feedback about you. Get the reviewerId from GET /team/direct-reports or the employee directory. One nomination per reviewer per cycle.',
          operationId: 'createPeerNomination',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PeerNominationRequest' },
                example: {
                  reviewerId: 'cmtuser98765abcde',
                },
              },
            },
          },
          responses: {
            201: { description: 'Nomination created successfully', content: { 'application/json': { schema: { $ref: '#/components/schemas/PeerNomination' } } } },
            200: { description: 'Nomination reactivated or reminder notification resent', content: { 'application/json': { schema: { $ref: '#/components/schemas/PeerNomination' } } } },
            400: { description: 'Validation error or self-nomination not allowed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            404: { description: 'Reviewer not found in organization' },
            409: { description: 'Nomination already exists or feedback already submitted for this cycle' },
          },
        },
      },
      '/peer-nominations/mine': {
        get: {
          tags: ['Appraisals'],
          summary: 'List nominated peers for 360 feedback for the active or specified cycle',
          description: 'Fetches peer nominations for the current user, or for a specified revieweeId/employeeId if requested by an HR/Manager/CMD user.',
          operationId: 'getMyNominatedPeers',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'cycleId', in: 'query', schema: { type: 'string' }, description: 'Target cycle ID (optional)' },
            { name: 'year', in: 'query', schema: { type: 'integer', minimum: 2000, maximum: 2100 }, description: 'Appraisal year' },
            { name: 'month', in: 'query', schema: { type: 'string' }, description: 'Appraisal month' },
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Target reviewee employee ID (for HR, Manager, CMD)' },
            { name: 'revieweeId', in: 'query', schema: { type: 'string' }, description: 'Alias for employeeId' },
          ],
          responses: {
            200: {
              description: 'List of peer nominations created by current user',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      nominations: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            reviewerId: { type: 'string' },
                            name: { type: 'string', example: 'Arjun Sharma' },
                            email: { type: 'string', example: 'arjun@acmecorp.com' },
                            designation: { type: 'string', example: 'Senior Engineer' },
                            status: { type: 'string', enum: ['PENDING', 'COMPLETED', 'REJECTED'] },
                            createdAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/peer-nominations/{id}': {
        delete: {
          tags: ['Appraisals'],
          summary: 'Cancel or delete a peer feedback nomination',
          operationId: 'deletePeerNomination',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Nomination ID to cancel' },
          ],
          responses: {
            200: {
              description: 'Nomination cancelled successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Nomination cancelled successfully' },
                    },
                  },
                },
              },
            },
            400: { description: 'Invalid nomination ID or cannot cancel completed nomination' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — not nomination owner' },
            404: { description: 'Nomination not found' },
          },
        },
      },
      '/peer-nominations/pending-for-me': {
        get: {
          tags: ['Appraisals'],
          summary: 'List peer feedback requests assigned to me (pending)',
          operationId: 'getPendingNominationsForMe',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'Pending nominations',
              content: { 'application/json': { schema: { type: 'object', properties: { nominations: { type: 'array', items: { $ref: '#/components/schemas/PeerNomination' } } } } } },
            },
          },
        },
      },
      '/peer-nominations/{id}/feedback': {
        post: {
          tags: ['Appraisals'],
          summary: 'Submit peer feedback for a nomination assigned to me',
          description: 'Get the nomination ID from GET /peer-nominations/pending-for-me. Once submitted, cannot be changed. Reviewer identity is anonymized for the reviewee (non-CMD).',
          operationId: 'submitPeerFeedback',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Nomination ID — get from GET /peer-nominations/pending-for-me' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PeerFeedbackRequest' },
                example: {
                  rating: 4.5,
                  strengths: 'Exceptional problem-solver who consistently unblocks teammates. Great at breaking down complex backend issues and explaining them clearly.',
                  growthAreas: 'Could improve on proactive communication during sprint planning. Sometimes takes on too much solo and misses delegation opportunities.',
                },
              },
            },
          },
          responses: {
            201: { description: 'Feedback submitted successfully' },
            400: { description: 'Validation error or feedback already submitted', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden — not the assigned reviewer' },
            404: { description: 'Nomination not found' },
          },
        },
      },
      '/peer-feedback/received-by-me': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get peer feedback received by me (reviewer identities masked for non-CMD)',
          operationId: 'getReceivedPeerFeedback',
          security: [{ userCookie: [] }],
          parameters: [{ name: 'cycleId', in: 'query', schema: { type: 'string' }, description: 'Defaults to active cycle' }],
          responses: {
            200: {
              description: 'Anonymized peer feedback items',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      count: { type: 'integer', example: 3 },
                      averageRating: { type: 'string', example: '4.3' },
                      items: { type: 'array', items: { $ref: '#/components/schemas/PeerFeedbackItem' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/cmd/peer-feedback/{employeeId}': {
        get: {
          tags: ['Appraisals'],
          summary: 'CMD / SUPER_ADMIN: view all peer feedback (with reviewer identities) for an employee',
          operationId: 'getCmdPeerFeedback',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cycleId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Full peer feedback with reviewer identities', content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'integer' }, averageRating: { type: 'string' }, items: { type: 'array', items: { $ref: '#/components/schemas/PeerFeedbackItem' } } } } } } },
            403: { description: 'Forbidden — CMD or SUPER_ADMIN only' },
          },
        },
      },
      '/team/direct-reports': {
        get: {
          tags: ['Appraisals'],
          summary: 'List direct reports (Manager sees own team / downline; HR/CMD sees all active employees)',
          description: 'Fetches direct reports with fallback to unassigned employees or department colleagues. Supports search and department filtering.',
          operationId: 'getDirectReports',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'search', in: 'query', required: false, schema: { type: 'string' }, description: 'Filter by employee name, email, or designation' },
            { name: 'department', in: 'query', required: false, schema: { type: 'string' }, description: 'Filter by employee department' },
          ],
          responses: {
            200: {
              description: 'List of direct reports',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      directReports: { type: 'array', items: { $ref: '#/components/schemas/Employee' } },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ───── Appraisals & Performance Reviews ─────
      '/appraisals': {
        get: {
          tags: ['Appraisals'],
          summary: 'List all appraisal reviews and submission history with pagination and search',
          operationId: 'listAppraisals',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 }, description: 'Items per page (max 100)' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search cycle name, accomplishments, or remarks' },
            { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'] } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED'] } },
          ],
          responses: {
            200: {
              description: 'Appraisal submissions history',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/AppraisalListResponse' } } },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/appraisals/submit': {
        post: {
          tags: ['Appraisals'],
          summary: 'Submit employee self-rating or save draft for active cycle',
          operationId: 'submitSelfRating',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitSelfRatingRequest' } } },
          },
          responses: {
            200: {
              description: 'Self rating saved or submitted successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PerformanceReview' } } },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/appraisals/{id}': {
        get: {
          tags: ['Appraisals'],
          summary: 'Get detailed performance review by ID with scores and signoffs',
          operationId: 'getAppraisalById',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Review ID' },
          ],
          responses: {
            200: {
              description: 'Review details with computed parameter score averages',
              content: { 'application/json': { schema: { type: 'object', properties: { review: { $ref: '#/components/schemas/PerformanceReview' } } } } },
            },
            400: { description: 'Invalid review ID' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Performance review not found' },
          },
        },
        patch: {
          tags: ['Appraisals'],
          summary: 'Update review metadata, comments, or ratings (RBAC enforced)',
          operationId: 'updateAppraisalReview',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Review ID' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateReviewRequest' } } },
          },
          responses: {
            200: {
              description: 'Review updated successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true }, review: { $ref: '#/components/schemas/PerformanceReview' } } } } },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Review not found' },
          },
        },
        delete: {
          tags: ['Appraisals'],
          summary: 'Delete an appraisal review record (owner, direct manager, HR/Admin)',
          operationId: 'deleteAppraisalReview',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Review ID' },
          ],
          responses: {
            200: {
              description: 'Review deleted successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true }, message: { type: 'string' }, deletedId: { type: 'string' } } } } },
            },
            400: { description: 'Invalid review ID' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — not authorized to delete' },
            404: { description: 'Review not found' },
          },
        },
      },
      '/appraisals/{id}/manager-review': {
        patch: {
          tags: ['Appraisals'],
          summary: 'Submit manager review evaluation scores and remarks',
          operationId: 'submitManagerAppraisalRating',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Review ID' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitManagerRatingRequest' } } },
          },
          responses: {
            200: {
              description: 'Manager review saved successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PerformanceReview' } } },
            },
            400: { description: 'Validation failed' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — not direct manager' },
            404: { description: 'Review not found' },
          },
        },
      },

      // ── Company Hub paths ────────────────────────────────────────────────────
      '/hub/team': {
        get: {
          tags: ['Company Hub'],
          summary: 'Get the full team directory for the authenticated tenant',
          operationId: 'getHubTeam',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'search', in: 'query', required: false, schema: { type: 'string', maxLength: 100 }, description: 'Search term for name, designation, or department' },
            { name: 'department', in: 'query', required: false, schema: { type: 'string', maxLength: 100 }, description: 'Filter members by department' },
          ],
          responses: {
            200: {
              description: 'List of active team members with hub profile data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/HubTeamMember' },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Validation failed',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
            },
            401: { description: 'Unauthorized — valid session required' },
          },
        },
      },
      '/hub/me': {
        patch: {
          tags: ['Company Hub'],
          summary: 'Update the authenticated user\'s own hub profile (bio, birthday, snaps)',
          operationId: 'updateMyHubProfile',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateHubProfileRequest' },
                examples: {
                  updateBio: {
                    summary: 'Update bio only',
                    value: { hubBio: 'Passionate about building great products.' },
                  },
                  updateBirthday: {
                    summary: 'Update birthday',
                    value: { hubBirthday: '1990-06-15' },
                  },
                  updateProfileSnaps: {
                    summary: 'Update profile snaps array',
                    value: { profileSnaps: ['https://cdn.example.com/snap1.jpg', 'https://cdn.example.com/snap2.jpg'] },
                  },
                  updateAll: {
                    summary: 'Update all hub profile fields',
                    value: {
                      hubBio: 'Passionate about building great products.',
                      hubBirthday: '1990-06-15',
                      profileSnaps: ['https://cdn.example.com/snap1.jpg'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Hub profile updated successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HubProfileResponse' } } },
            },
            400: {
              description: 'Validation failed — invalid fields or no fields provided',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
            },
            401: { description: 'Unauthorized — valid session required' },
          },
        },
      },
      '/hub/events': {
        get: {
          tags: ['Company Hub'],
          summary: 'Get paginated corporate events with search, filtering, and sorting',
          operationId: 'getHubEvents',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'search', in: 'query', required: false, schema: { type: 'string' }, description: 'Search term across title, description, location, or author' },
            { name: 'filter', in: 'query', required: false, schema: { type: 'string', enum: ['all', 'featured', 'mine'], default: 'all' }, description: 'Quick filter option' },
            { name: 'sortBy', in: 'query', required: false, schema: { type: 'string', enum: ['newest', 'oldest', 'title_asc', 'title_desc'], default: 'newest' }, description: 'Sort criteria' },
            { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1, minimum: 1 }, description: 'Page number' },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 6, minimum: 1, maximum: 50 }, description: 'Items per page' },
          ],
          responses: {
            200: {
              description: 'List of corporate events with pagination metadata',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HubEventsListResponse' } } },
            },
            400: {
              description: 'Validation failed — invalid query parameters',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
            },
            401: { description: 'Unauthorized — valid session required' },
          },
        },
        post: {
          tags: ['Company Hub'],
          summary: 'Create and publish a new corporate event announcement',
          description: 'Restricted to HR, Managers, Leadership, CMD, and Admins.',
          operationId: 'createHubEvent',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateHubEventRequest' } } },
          },
          responses: {
            201: {
              description: 'Corporate event created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string', example: 'Event published successfully' },
                      event: { $ref: '#/components/schemas/HubEvent' },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
            403: { description: 'Forbidden — only HR or Management can create events' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/hub/events/{id}': {
        patch: {
          tags: ['Company Hub'],
          summary: 'Update a corporate event announcement',
          description: 'Restricted to event author or HR/Admins.',
          operationId: 'updateHubEvent',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Event ID' },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateHubEventRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Corporate event updated successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string', example: 'Event updated successfully' },
                      event: { $ref: '#/components/schemas/HubEvent' },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Validation failed',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
            },
            403: { description: 'Forbidden — not authorized to edit this event' },
            404: { description: 'Event not found' },
            401: { description: 'Unauthorized' },
          },
        },
        delete: {
          tags: ['Company Hub'],
          summary: 'Delete a corporate event',
          description: 'Restricted to event author or HR/Admins.',
          operationId: 'deleteHubEvent',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Event ID' },
          ],
          responses: {
            200: {
              description: 'Event deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string', example: 'Event deleted successfully' },
                      id: { type: 'string', example: 'ev_123' },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Validation failed — invalid event ID parameter',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
            },
            403: { description: 'Forbidden — not authorized to delete this event' },
            404: { description: 'Event not found' },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ───── Leaves & Work From Home ─────
      '/admin/leave-types': {
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Create a new dynamic leave type (HR/Admin)',
          operationId: 'createLeaveType',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateLeaveTypeRequest' } } },
          },
          responses: {
            201: {
              description: 'Leave type created successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveType' } } },
            },
            400: { description: 'Validation failed' },
            409: { description: 'Conflict — leave type code already exists for tenant' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — requires HR or Admin role' },
          },
        },
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List all configured leave types for tenant (HR/Admin)',
          operationId: 'listAdminLeaveTypes',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'includeInactive', in: 'query', schema: { type: 'boolean' }, description: 'Include inactive categories' },
          ],
          responses: {
            200: {
              description: 'List of leave types',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/LeaveType' },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/admin/leave-types/{id}': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get leave type details by ID (HR/Admin)',
          operationId: 'getAdminLeaveTypeById',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveType' } } } },
            404: { description: 'Leave type not found' },
          },
        },
        put: {
          tags: ['Leaves & WFH'],
          summary: 'Update leave type configuration (HR/Admin)',
          operationId: 'updateLeaveTypePut',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateLeaveTypeRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveType' } } } },
            400: { description: 'Validation failed' },
            404: { description: 'Leave type not found' },
          },
        },
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Partially update leave type configuration (HR/Admin)',
          operationId: 'updateLeaveTypePatch',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateLeaveTypeRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveType' } } } },
            400: { description: 'Validation failed' },
            404: { description: 'Leave type not found' },
          },
        },
        delete: {
          tags: ['Leaves & WFH'],
          summary: 'Safely delete a leave type (blocked if historical records exist)',
          operationId: 'deleteLeaveType',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Deleted successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } },
            },
            409: { description: 'Conflict — cannot delete leave type with existing employee requests; deactivate instead' },
            404: { description: 'Leave type not found' },
          },
        },
      },
      '/admin/leave-types/{id}/status': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Toggle active/inactive status of a leave type',
          operationId: 'toggleLeaveTypeStatus',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveTypeStatusRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveType' } } } },
            404: { description: 'Leave type not found' },
          },
        },
      },
      '/leave-types': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List active leave categories for employee application dropdown',
          operationId: 'listActiveLeaveTypes',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              description: 'Active leave categories',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/LeaveType' },
                  },
                },
              },
            },
          },
        },
      },
      '/leave-types/{id}': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get public policy details of a leave category',
          operationId: 'getLeaveTypePublic',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveType' } } } },
            404: { description: 'Leave type not found' },
          },
        },
      },
      '/leaves/balances': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get current employee dynamic leave balances and WFH quota',
          operationId: 'getMyLeaveBalances',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'year', in: 'query', schema: { type: 'integer' }, description: 'Target year (defaults to current year)' },
          ],
          responses: {
            200: {
              description: 'Employee dynamic balance cards payload',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/MyLeaveBalancesResponse' } } },
            },
          },
        },
      },
      '/leave-balances/me': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Alias for current employee dynamic balances',
          operationId: 'getMyLeaveBalancesAlias',
          security: [{ userCookie: [] }],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/MyLeaveBalancesResponse' } } } },
          },
        },
      },
      '/admin/leave-balances': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List all employee leave quotas and balances across tenant (HR/Admin)',
          operationId: 'listEmployeeBalances',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'year', in: 'query', schema: { type: 'integer' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Employee balance lists',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        employeeId: { type: 'string' },
                        employee: { type: 'object' },
                        balances: { type: 'array', items: { $ref: '#/components/schemas/LeaveBalanceItem' } },
                        wfh: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/leave-balances/adjust': {
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Manually adjust an employee quota with audit log (HR/Admin)',
          operationId: 'adjustEmployeeBalance',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AdjustBalanceRequest' } } },
          },
          responses: {
            200: {
              description: 'Adjustment recorded successfully',
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } },
            },
            400: { description: 'Validation failed' },
          },
        },
      },
      '/leaves': {
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Submit a new leave or work from home application',
          operationId: 'createLeaveRequest',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateLeaveRequest' } } },
          },
          responses: {
            201: {
              description: 'Request submitted successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequestItem' } } },
            },
            400: { description: 'Validation failed (insufficient balance, overlap, missing document, or notice rule)' },
          },
        },
        get: {
          tags: ['Leaves & WFH'],
          summary: 'List leave applications (scoped by role or parameter)',
          operationId: 'listLeaveRequests',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'scope', in: 'query', schema: { type: 'string', enum: ['my', 'team', 'company'] }, description: 'View scope' },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/LeaveRequestItem' } },
                      total: { type: 'integer' },
                      page: { type: 'integer' },
                      limit: { type: 'integer' },
                      totalPages: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/leaves/{id}/cancel': {
        post: {
          tags: ['Leaves & WFH'],
          summary: 'Cancel own pending leave application and restore quota',
          operationId: 'cancelLeaveRequest',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } },
            },
            400: { description: 'Only pending leaves can be cancelled' },
          },
        },
      },
      '/leaves/{id}/admin/approve': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Administrator Supreme Approval (Finalizes leave and marks both manager and HR approved)',
          operationId: 'adminApproveLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalActionRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequestItem' } } } },
            403: { description: 'Forbidden — requires Administrator or HR role' },
          },
        },
      },
      '/leaves/{id}/admin/reject': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Administrator Supreme Rejection (Rejects leave and releases pending balance)',
          operationId: 'adminRejectLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalActionRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequestItem' } } } },
            403: { description: 'Forbidden — requires Administrator or HR role' },
          },
        },
      },
      '/leaves/{id}/manager/approve': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Level 1: Manager approval of employee leave/WFH',
          operationId: 'managerApproveLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalActionRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequestItem' } } } },
          },
        },
      },
      '/leaves/{id}/manager/reject': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Level 1: Manager rejection of employee leave/WFH (releases pending balance)',
          operationId: 'managerRejectLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalActionRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequestItem' } } } },
          },
        },
      },
      '/leaves/{id}/hr/approve': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Level 2: Final HR approval of employee leave/WFH (deducts from used quota)',
          operationId: 'hrApproveLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalActionRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequestItem' } } } },
          },
        },
      },
      '/leaves/{id}/hr/reject': {
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Level 2: Final HR rejection of employee leave/WFH (releases pending balance)',
          operationId: 'hrRejectLeave',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalActionRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveRequestItem' } } } },
          },
        },
      },
      '/wfh/policy': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get current tenant WFH policy configuration',
          operationId: 'getWfhPolicy',
          security: [{ userCookie: [] }],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WfhPolicy' } } } },
          },
        },
      },
      '/admin/wfh/policy': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get current tenant WFH policy configuration (HR/Admin)',
          operationId: 'getAdminWfhPolicy',
          security: [{ userCookie: [] }],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WfhPolicy' } } } },
          },
        },
        put: {
          tags: ['Leaves & WFH'],
          summary: 'Update tenant WFH policy configuration (HR/Admin)',
          operationId: 'updateWfhPolicyPut',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateWfhPolicyRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WfhPolicy' } } } },
          },
        },
        patch: {
          tags: ['Leaves & WFH'],
          summary: 'Partially update tenant WFH policy configuration (HR/Admin)',
          operationId: 'updateWfhPolicyPatch',
          security: [{ userCookie: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateWfhPolicyRequest' } } },
          },
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WfhPolicy' } } } },
          },
        },
      },
      '/admin/leave-overview/stats': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'High-level aggregate metrics for company leave overview dashboard',
          operationId: 'getLeaveOverviewStats',
          security: [{ userCookie: [] }],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      todayOnLeaveCount: { type: 'integer' },
                      pendingManagerCount: { type: 'integer' },
                      pendingHrCount: { type: 'integer' },
                      approvedThisMonth: { type: 'integer' },
                      leaveTypeBreakdown: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/leave-overview/calendar': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Calendar feed of approved and pending leaves',
          operationId: 'getLeaveCalendarView',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'month', in: 'query', schema: { type: 'string' } },
            { name: 'year', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        employeeName: { type: 'string' },
                        title: { type: 'string' },
                        startDate: { type: 'string', format: 'date-time' },
                        endDate: { type: 'string', format: 'date-time' },
                        color: { type: 'string' },
                        status: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/leave-logs': {
        get: {
          tags: ['Leaves & WFH'],
          summary: 'Get chronological audit logs of all leave & policy modifications',
          operationId: 'getLeaveAuditLogs',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/LeaveAuditLog' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [], // We defined everything inline, no JSDoc annotations needed

};

export const swaggerSpec = swaggerJsdoc(options);
export const swaggerUiServe = swaggerUi.serve;
export const swaggerUiSetup = swaggerUi.setup(swaggerSpec, {
  customCss: `
    .swagger-ui .topbar { background-color: #1a1a2e; }
    .swagger-ui .topbar .download-url-wrapper .select-label select { border-color: #e94560; }
  `,
  customSiteTitle: 'UEIBI API Docs',
});
