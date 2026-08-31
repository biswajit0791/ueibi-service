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
        TaskComment: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clcomment12345' },
            taskId: { type: 'string', example: 'cltask12345' },
            authorId: { type: 'string', example: 'cmtclxzzq0001uuek23nbb04s' },
            comment: { type: 'string', example: 'Finished schema design.' },
            attachments: { type: 'array', items: { type: 'string' } },
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
        
        // ── Goal schemas ──
        Goal: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            title: { type: 'string', example: 'Improve product stability' },
            description: { type: 'string', example: 'Refactor goals repository module to support direct tenancy.' },
            goalType: { type: 'string', example: 'General' },
            category: { type: 'string', example: 'Project Delivery' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], example: 'medium' },
            progress: { type: 'integer', example: 45 },
            status: { type: 'string', example: 'DRAFT' },
            financialYear: { type: 'string', example: 'FY 2026-27' },
            quarter: { type: 'string', example: 'Q1' },
            startDate: { type: 'string', format: 'date-time' },
            targetDate: { type: 'string', format: 'date-time' },
            attachments: { type: 'array', items: { type: 'string' } },
            specialNotes: { type: 'string', example: 'Ensure that the indexes are added to tenantId.' },
            dueDate: { type: 'string', format: 'date' },
            employeeId: { type: 'string' },
            milestones: { type: 'integer', example: 4 },
            completedMilestones: { type: 'integer', example: 1 },
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
            priority: { type: 'string', enum: ['high', 'medium', 'low'], example: 'medium' },
            financialYear: { type: 'string', example: 'FY 2026-27' },
            quarter: { type: 'string', example: 'Q1' },
            startDate: { type: 'string', format: 'date-time' },
            targetDate: { type: 'string', format: 'date-time' },
            attachments: { type: 'array', items: { type: 'string' } },
            specialNotes: { type: 'string', example: 'Ensure that the indexes are added to tenantId.' },
            dueDate: { type: 'string', format: 'date' },
            employeeId: { type: 'string' },
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
          summary: 'List all comments on a task',
          operationId: 'listTaskComments',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
          ],
          responses: {
            200: {
              description: 'Comments list retrieved',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/TaskComment' } } } } } },
            },
            401: { description: 'Unauthorized' },
            404: { description: 'Task not found' },
          },
        },
        post: {
          tags: ['Tasks'],
          summary: 'Add a comment (progress update) on a task',
          operationId: 'addTaskComment',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['comment'],
                  properties: {
                    comment: { type: 'string', example: 'Finished API integrations.' },
                    attachments: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Comment added successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskComment' } } },
            },
            400: { description: 'Missing comment text' },
            401: { description: 'Unauthorized' },
            404: { description: 'Task not found' },
          },
        },
      },
      '/tasks/{id}/comments/{cid}': {
        delete: {
          tags: ['Tasks'],
          summary: 'Delete a comment',
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
          summary: 'List all goals for an employee',
          operationId: 'listGoals',
          security: [{ userCookie: [] }],
          parameters: [
            { name: 'employeeId', in: 'query', schema: { type: 'string' }, description: 'Employee ID (defaults to current user)' },
          ],
          responses: {
            200: {
              description: 'Goals list retrieved',
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Goal' } } } } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
        post: {
          tags: ['Goals'],
          summary: 'Create a new goal',
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
            400: { description: 'Missing title' },
            401: { description: 'Unauthorized' },
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
