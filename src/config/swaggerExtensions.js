/**
 * @file swaggerExtensions.js
 * @description Comprehensive OpenAPI specifications for endpoints added across recent releases:
 *   - Department Master List & RBAC (/departments)
 *   - Employee Capacity, Exits, Reactivation, Ex-Employees & Non-Joiner Offers (/employees/*)
 *   - Corporate Gallery & Social Reactions (/gallery/*)
 *   - Tenant-Scoped Registry Candidate Search (/registry/*)
 *   - Admin Registrations Overview (/admin/registrations/*)
 *   - Reference Reviews & Public Verification (/ex-employer-reviews, /public/ex-employer-review/*)
 *   - Leave Request Workflow Approval Aliases (/leaves/:id/approve, /leaves/:id/reject)
 *   - Policy Assignment & Reminders (/policies/:id/assign, /policies/:id/remind)
 */

export const swaggerExtensions = {
  tags: [
    {
      name: 'Departments',
      description: 'Tenant-scoped Department master list with RBAC control (SUPER_ADMIN, ADMIN, HR)',
    },
    {
      name: 'Gallery',
      description: 'Corporate social gallery: photos, categories, likes, and employee comments',
    },
    {
      name: 'Registry',
      description: 'Tenant-scoped background check and employment verification registry: search your own company\'s ex-employees, non-joiners, and current employees\' completed reference reviews',
    },
    {
      name: 'Team',
      description: 'Team Directory and Employee Detail: server-side filtered team listing, per-employee projects, 360 feedback, appraisal audit, training/certifications (with file attachments), and the achievements/incidents journal',
    },
    {
      name: 'Disputes',
      description: 'Dispute Center: employee support/grievance tickets with a chat-style resolution log, supporting-evidence attachments, and HR/Admin assignment & status workflow',
    },
  ],

  schemas: {
    // ── Department schemas ──
    Department: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'dept_cmtwpesv80000uu902egb2ed2' },
        tenantId: { type: 'string', example: 'tenant_cmtwm7r310019pzratm94ecfk' },
        name: { type: 'string', example: 'Engineering' },
        description: { type: 'string', nullable: true, example: 'Software development & architecture' },
        color: { type: 'string', nullable: true, example: '#6366f1' },
        isActive: { type: 'boolean', example: true },
        sortOrder: { type: 'integer', example: 0 },
        usageCount: { type: 'integer', example: 8, description: 'Number of active employees currently assigned' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateDepartmentRequest: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80, example: 'Product Engineering' },
        description: { type: 'string', maxLength: 200, example: 'Core product team' },
        color: { type: 'string', example: '#6366f1', pattern: '^#[0-9a-fA-F]{6}$' },
        sortOrder: { type: 'integer', minimum: 0, example: 0 },
      },
    },
    UpdateDepartmentRequest: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80, example: 'Product Strategy' },
        description: { type: 'string', maxLength: 200 },
        color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', example: '#f59e0b' },
        sortOrder: { type: 'integer', minimum: 0, example: 1 },
        isActive: { type: 'boolean', example: true },
      },
    },

    // ── Employee Capacity & Exit schemas ──
    EmployeeStats: {
      type: 'object',
      properties: {
        capacity: { type: 'integer', example: 50, description: 'Total licensed seat limit' },
        active: { type: 'integer', example: 12, description: 'Current active employees consuming licenses' },
        available: { type: 'integer', example: 38, description: 'Remaining available license slots' },
        ex: { type: 'integer', example: 4, description: 'Total ex-employee historical records' },
        offers: { type: 'integer', example: 3, description: 'Total non-joiner offer records' },
        total: { type: 'integer', example: 19, description: 'Combined total records across organization' },
      },
    },
    ExitEmployeeRequest: {
      type: 'object',
      required: ['serviceStart', 'serviceEnd', 'exitReason'],
      properties: {
        serviceStart: { type: 'string', format: 'date', example: '2023-01-15' },
        serviceEnd: { type: 'string', format: 'date', example: '2026-09-11' },
        exitReason: {
          type: 'string',
          enum: ['Resigned', 'Terminated', 'Contract Ended', 'Retired', 'Absconded', 'Other'],
          example: 'Resigned',
        },
        techRating: { type: 'integer', minimum: 1, maximum: 10, example: 8 },
        attitudeRating: { type: 'integer', minimum: 1, maximum: 10, example: 9 },
        conductValue: {
          type: 'string',
          enum: ['Excellent', 'Good', 'Average', 'Poor'],
          example: 'Good',
        },
        feedback: { type: 'string', example: 'Smooth offboarding with knowledge transfer completed.' },
      },
    },

    // ── Ex-Employee Records ──
    ExEmployeeRecord: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'ex_clxyz123' },
        tenantId: { type: 'string', example: 'tenant_abc' },
        firstName: { type: 'string', example: 'Vikram' },
        lastName: { type: 'string', example: 'Seth' },
        email: { type: 'string', format: 'email', example: 'vikram@example.com' },
        phone: { type: 'string', example: '+919876543210' },
        pan: { type: 'string', example: 'ABCDE1234F' },
        dob: { type: 'string', nullable: true, example: '1990' },
        designation: { type: 'string', example: 'Staff Designer' },
        department: { type: 'string', example: 'Design' },
        serviceStart: { type: 'string', format: 'date-time' },
        serviceEnd: { type: 'string', format: 'date-time' },
        exitReason: { type: 'string', example: 'Resigned' },
        techRating: { type: 'integer', example: 9 },
        attitudeRating: { type: 'integer', example: 9 },
        conductValue: { type: 'string', example: 'Excellent' },
        feedback: { type: 'string', example: 'Highly cooperative during handoffs.' },
        submittedBy: { type: 'string', example: 'HR Operations' },
        status: { type: 'string', example: 'Published' },
        docs: { type: 'array', items: { type: 'object' } },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateExEmployeeRequest: {
      type: 'object',
      required: ['firstName', 'lastName', 'email', 'pan', 'designation', 'department', 'serviceStart', 'serviceEnd', 'exitReason'],
      properties: {
        firstName: { type: 'string', example: 'Vikram' },
        lastName: { type: 'string', example: 'Seth' },
        email: { type: 'string', format: 'email', example: 'vikram@example.com' },
        phone: { type: 'string', example: '+919876543210' },
        pan: { type: 'string', example: 'ABCDE1234F' },
        dob: { type: 'string', example: '1990' },
        designation: { type: 'string', example: 'Staff Designer' },
        department: { type: 'string', example: 'Design' },
        serviceStart: { type: 'string', format: 'date', example: '2020-04-10' },
        serviceEnd: { type: 'string', format: 'date', example: '2025-02-15' },
        exitReason: { type: 'string', example: 'Resigned' },
        techRating: { type: 'integer', minimum: 1, maximum: 10, example: 9 },
        attitudeRating: { type: 'integer', minimum: 1, maximum: 10, example: 9 },
        conductValue: { type: 'string', enum: ['Excellent', 'Good', 'Average', 'Poor'], example: 'Excellent' },
        feedback: { type: 'string', example: 'Outstanding performance.' },
        docs: { type: 'array', items: { type: 'object' } },
      },
    },

    // ── Non-Joiner / Offer Records ──
    NonJoinerRecord: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'nj_clxyz456' },
        tenantId: { type: 'string', example: 'tenant_abc' },
        firstName: { type: 'string', example: 'Kabir' },
        lastName: { type: 'string', example: 'Khan' },
        email: { type: 'string', format: 'email', example: 'kabir@example.com' },
        phone: { type: 'string', example: '+919876543212' },
        pan: { type: 'string', example: 'FGHIJ5678K' },
        dob: { type: 'string', nullable: true, example: '1994' },
        designation: { type: 'string', example: 'Security Lead' },
        department: { type: 'string', example: 'IT' },
        offerReleaseDate: { type: 'string', format: 'date-time' },
        dateOfJoining: { type: 'string', format: 'date-time' },
        salary: { type: 'string', example: '16' },
        offerAccepted: { type: 'string', example: 'No' },
        submittedBy: { type: 'string', example: 'Direct' },
        status: { type: 'string', example: 'Published' },
        feedback: { type: 'string', example: 'Candidate accepted offer but failed to report.' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateNonJoinerRequest: {
      type: 'object',
      required: ['firstName', 'lastName', 'email', 'pan', 'designation', 'department', 'offerReleaseDate', 'dateOfJoining'],
      properties: {
        firstName: { type: 'string', example: 'Kabir' },
        lastName: { type: 'string', example: 'Khan' },
        email: { type: 'string', format: 'email', example: 'kabir@example.com' },
        phone: { type: 'string', example: '+919876543212' },
        pan: { type: 'string', example: 'FGHIJ5678K' },
        dob: { type: 'string', example: '1994' },
        designation: { type: 'string', example: 'Security Lead' },
        department: { type: 'string', example: 'IT' },
        offerReleaseDate: { type: 'string', format: 'date', example: '2026-05-10' },
        dateOfJoining: { type: 'string', format: 'date', example: '2026-06-15' },
        salary: { type: 'string', example: '16' },
        offerAccepted: { type: 'string', enum: ['Yes', 'No', 'Sent'], example: 'No' },
        feedback: { type: 'string', example: 'Did not join on confirmed date.' },
        docs: { type: 'array', items: { type: 'object' } },
      },
    },

    // ── Gallery Schemas ──
    GalleryPost: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'gp_123456789' },
        title: { type: 'string', example: 'Team Offsite 2026' },
        category: { type: 'string', example: 'Socials' },
        imageUrl: { type: 'string', example: '/uploads/gallery-172589000-photo.jpg' },
        likeCount: { type: 'integer', example: 12 },
        commentCount: { type: 'integer', example: 4 },
        isLikedByMe: { type: 'boolean', example: true },
        uploadedBy: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', example: 'Priya Sharma' },
            designation: { type: 'string', example: 'HR Lead' },
            department: { type: 'string', example: 'HR' },
          },
        },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    GalleryComment: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'gc_123456789' },
        postId: { type: 'string', example: 'gp_123456789' },
        text: { type: 'string', example: 'Amazing memories!' },
        createdAt: { type: 'string', format: 'date-time' },
        author: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', example: 'Arjun Das' },
            designation: { type: 'string', example: 'Frontend Dev' },
          },
        },
      },
    },

    // ── Registry Search Candidate ──
    RegistryCandidate: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'cand_ABCDE1234F' },
        fname: { type: 'string', example: 'Vikram' },
        lname: { type: 'string', example: 'Seth' },
        email: { type: 'string', example: 'vikram@example.com' },
        pan: { type: 'string', example: 'ABCDE1234F' },
        phone: { type: 'string', example: '+919876543210' },
        dob: { type: 'string', example: '1990' },
        industry: { type: 'string', example: 'Technology' },
        skills: { type: 'string', example: '', description: 'No skills field exists in the underlying data model — currently always an empty string, not a real filterable attribute.' },
        linkedin: { type: 'string', nullable: true, example: null, description: 'No LinkedIn field exists in the underlying data model — currently always null.' },
        reviews: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              company_name: { type: 'string', example: 'Autoliv Private Ltd' },
              employee_designation: { type: 'string', example: 'Staff Designer' },
              service_start: { type: 'string', nullable: true },
              service_end: { type: 'string', nullable: true },
              date_of_joining: { type: 'string', nullable: true, description: 'Present only on non-joiner (declined/withdrew offer) reviews' },
              feedback: { type: 'string' },
              technical_rating: { type: 'integer', nullable: true, example: 9 },
              professional_rating: { type: 'integer', nullable: true, example: 9 },
              conduct_value: { type: 'string', example: 'Excellent' },
              conduct_level_name: { type: 'string', example: 'Excellent Conduct' },
              offer_letter: { type: 'boolean', example: false },
              hrContacts: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },

    // ── Team Directory & Employee Detail schemas ──
    TeamDirectoryItem: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string', example: 'EMPLOYEE' },
        status: { type: 'string', enum: ['INVITED', 'ACTIVE', 'EXITED'] },
        department: { type: 'string', nullable: true },
        designation: { type: 'string', nullable: true },
        band: { type: 'string', nullable: true, example: 'L4' },
        empType: { type: 'string', example: 'PERMANENT' },
        managerId: { type: 'string', nullable: true },
        joinDate: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    TeamDirectoryResponse: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/TeamDirectoryItem' } },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 42 },
            totalPages: { type: 'integer', example: 3 },
          },
        },
      },
    },
    TeamMemberDetailResponse: {
      type: 'object',
      description: 'Aggregate payload powering the Team Member Detail drilldown for one financial year.',
      properties: {
        employee: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string', nullable: true },
            role: { type: 'string' },
            status: { type: 'string' },
            department: { type: 'string', nullable: true },
            designation: { type: 'string', nullable: true },
            band: { type: 'string', nullable: true },
            managerId: { type: 'string', nullable: true },
            joinDate: { type: 'string', format: 'date-time', nullable: true },
            manager: { type: 'object', nullable: true, properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } },
          },
        },
        financialYear: { type: 'string', example: 'FY 2026-2027' },
        projects: { type: 'array', items: { type: 'object' }, description: 'Derived from the employee\'s Goal/GoalAssignment records for this financial year (not a separate manually-entered project log).' },
        feedback: {
          type: 'object',
          properties: { count: { type: 'integer' }, averageRating: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } },
        },
        appraisal: { type: 'object', nullable: true },
        training: { type: 'array', items: { $ref: '#/components/schemas/TrainingRecord' } },
        journal: { type: 'array', items: { type: 'object' }, description: 'Merged achievement + incident entries, sorted newest first' },
        advancement: { type: 'object', properties: { available: { type: 'boolean', example: false } }, description: 'Not implemented yet — always { available: false }' },
      },
    },
    TrainingRecord: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', example: 'AWS Certified Solutions Architect' },
        source: { type: 'string', enum: ['SELF_SUBMITTED', 'COMPANY_MANDATED'] },
        mandatedBy: { type: 'string', nullable: true },
        status: { type: 'string', enum: ['IN_PROGRESS', 'COMPLETED'] },
        approvalStatus: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        score: { type: 'string', nullable: true, example: '92%' },
        durationHours: { type: 'integer', nullable: true },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
        attachments: { type: 'array', items: { $ref: '#/components/schemas/EntityAttachment' } },
      },
    },
    CreateTrainingRecordRequest: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        mandatedBy: { type: 'string', maxLength: 100 },
        status: { type: 'string', enum: ['IN_PROGRESS', 'COMPLETED'] },
        score: { type: 'string', maxLength: 50 },
        durationHours: { type: 'integer', minimum: 0, maximum: 10000 },
        startedAt: { type: 'string', format: 'date' },
        completedAt: { type: 'string', format: 'date' },
        financialYear: { type: 'string', maxLength: 20, example: 'FY 2026-2027' },
      },
    },
    UpdateTrainingRecordRequest: {
      type: 'object',
      description: 'At least one field required. approvalStatus may only be set by HR/Admin/Super Admin/CMD.',
      properties: {
        name: { type: 'string', maxLength: 200 },
        status: { type: 'string', enum: ['IN_PROGRESS', 'COMPLETED'] },
        approvalStatus: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        score: { type: 'string', maxLength: 50 },
        durationHours: { type: 'integer', minimum: 0, maximum: 10000 },
        startedAt: { type: 'string', format: 'date' },
        completedAt: { type: 'string', format: 'date' },
      },
    },
    Achievement: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', nullable: true },
        occurredOn: { type: 'string', format: 'date-time' },
        financialYear: { type: 'string', nullable: true },
        createdById: { type: 'string' },
      },
    },
    CreateAchievementRequest: {
      type: 'object',
      required: ['title', 'description', 'occurredOn'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', minLength: 1, maxLength: 5000 },
        category: { type: 'string', maxLength: 100, example: 'Technical' },
        occurredOn: { type: 'string', format: 'date' },
        financialYear: { type: 'string', maxLength: 20 },
      },
    },
    Incident: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'ESCALATED'] },
        occurredOn: { type: 'string', format: 'date-time' },
        resolutionNotes: { type: 'string', nullable: true },
        reportedById: { type: 'string' },
      },
    },
    CreateIncidentRequest: {
      type: 'object',
      required: ['title', 'description', 'occurredOn'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', minLength: 1, maxLength: 5000 },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
        occurredOn: { type: 'string', format: 'date' },
        financialYear: { type: 'string', maxLength: 20 },
      },
    },
    UpdateIncidentRequest: {
      type: 'object',
      description: 'At least one field required.',
      properties: {
        title: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 5000 },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'ESCALATED'] },
        resolutionNotes: { type: 'string', maxLength: 5000 },
      },
    },
    EntityAttachment: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        originalName: { type: 'string', example: 'certificate.pdf' },
        mimeType: { type: 'string', example: 'application/pdf' },
        size: { type: 'integer', example: 245678 },
      },
    },
    Dispute: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ticketNumber: { type: 'string', example: 'TKT-1002' },
        subject: { type: 'string', example: 'Notice Period Discrepancy' },
        description: { type: 'string' },
        category: { type: 'string', example: 'Review Dispute' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] },
        raisedBy: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } },
        subjectEmployee: { type: 'object', nullable: true, properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } },
        assignedTo: { type: 'object', nullable: true, properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } },
        resolvedAt: { type: 'string', format: 'date-time', nullable: true },
        resolutionNotes: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    DisputeMessage: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        disputeId: { type: 'string' },
        body: { type: 'string' },
        sender: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateDisputeRequest: {
      type: 'object',
      required: ['subject', 'description'],
      properties: {
        subject: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', minLength: 1, maxLength: 5000 },
        category: { type: 'string', maxLength: 100, example: 'Review Dispute' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
        subjectEmployeeId: { type: 'string', description: 'Elevated roles (HR/Admin/CMD/Super Admin) only — file on behalf of another tenant employee. Regular users always target themselves regardless of this field.' },
      },
    },
    UpdateDisputeRequest: {
      type: 'object',
      description: 'At least one field required. HR/Admin/CMD/Super Admin only.',
      properties: {
        status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        assignedToId: { type: 'string', nullable: true },
        resolutionNotes: { type: 'string', maxLength: 5000 },
      },
    },
    CreateDisputeMessageRequest: {
      type: 'object',
      required: ['body'],
      properties: {
        body: { type: 'string', minLength: 1, maxLength: 5000 },
      },
    },
  },

  paths: {
    // ═══════════════════════════════════════════════════════════════════════════
    // DEPARTMENTS
    // ═══════════════════════════════════════════════════════════════════════════
    '/departments': {
      get: {
        tags: ['Departments'],
        summary: 'List all departments for tenant',
        description: 'Returns all active departments for the authenticated user tenant. Auto-seeds defaults on first access. Includes active employee usageCount.',
        operationId: 'listDepartments',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'includeArchived', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include inactive/archived departments' },
        ],
        responses: {
          200: {
            description: 'List of departments',
            content: { 'application/json': { schema: { type: 'object', properties: { departments: { type: 'array', items: { $ref: '#/components/schemas/Department' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Departments'],
        summary: 'Create a new department',
        description: 'Creates a new department within the tenant. Restricted to SUPER_ADMIN, ADMIN, HR.',
        operationId: 'createDepartment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateDepartmentRequest' } } } },
        responses: {
          201: {
            description: 'Department created successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, department: { $ref: '#/components/schemas/Department' } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { description: 'Duplicate department name in tenant' },
        },
      },
    },
    '/departments/{id}': {
      patch: {
        tags: ['Departments'],
        summary: 'Update department details',
        description: 'Updates department name, description, color, or sort order. Restricted to SUPER_ADMIN, ADMIN, HR.',
        operationId: 'updateDepartment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateDepartmentRequest' } } } },
        responses: {
          200: {
            description: 'Department updated successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, department: { $ref: '#/components/schemas/Department' } } } } },
          },
          404: { description: 'Department not found' },
          409: { description: 'Name already exists' },
        },
      },
      delete: {
        tags: ['Departments'],
        summary: 'Archive department (soft-delete)',
        description: 'Soft-deletes a department (isActive: false). Preserves historical employee records. Restricted to SUPER_ADMIN, ADMIN.',
        operationId: 'deactivateDepartment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Department archived successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, warning: { type: 'string', nullable: true } } } } },
          },
          404: { description: 'Department not found' },
          409: { description: 'Department already archived' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // EMPLOYEES: STATS, EXIT, REACTIVATE, EX-EMPLOYEES & OFFERS
    // ═══════════════════════════════════════════════════════════════════════════
    '/employees/stats': {
      get: {
        tags: ['Employees'],
        summary: 'Get employee license capacity and record counts',
        description: 'Returns real-time license statistics: total limit, active count, available slots, and historical records.',
        operationId: 'getEmployeeStats',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: 'License and employee counts',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EmployeeStats' } } },
          },
        },
      },
    },
    '/employees/{id}/exit': {
      post: {
        tags: ['Employees'],
        summary: 'Offboard an employee and create exit record',
        description: 'Deactivates employee account, frees up 1 license seat, and creates an archived ExEmployeeRecord.',
        operationId: 'exitEmployee',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ExitEmployeeRequest' } } } },
        responses: {
          200: {
            description: 'Employee exited successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, exRecordId: { type: 'string' } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          404: { description: 'Employee not found' },
        },
      },
    },
    '/employees/{id}/reactivate': {
      post: {
        tags: ['Employees'],
        summary: 'Reactivate an exited employee',
        description: 'Asserts license seat availability and reactivates an EXITED employee back to ACTIVE status.',
        operationId: 'reactivateEmployee',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Employee reactivated successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, user: { $ref: '#/components/schemas/Employee' } } } } },
          },
          409: { description: 'License capacity exceeded' },
        },
      },
    },
    '/employees/ex': {
      get: {
        tags: ['Employees'],
        summary: 'List ex-employee records',
        operationId: 'listExEmployees',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: {
            description: 'List of ex-employees',
            content: { 'application/json': { schema: { type: 'object', properties: { records: { type: 'array', items: { $ref: '#/components/schemas/ExEmployeeRecord' } }, total: { type: 'integer' } } } } },
          },
        },
      },
      post: {
        tags: ['Employees'],
        summary: 'Add an ex-employee record manually',
        operationId: 'addExEmployee',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateExEmployeeRequest' } } } },
        responses: {
          201: {
            description: 'Ex-employee record created',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, record: { $ref: '#/components/schemas/ExEmployeeRecord' } } } } },
          },
        },
      },
    },
    '/employees/ex/bulk': {
      post: {
        tags: ['Employees'],
        summary: 'Bulk import ex-employee records',
        operationId: 'bulkAddExEmployees',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['records'], properties: { records: { type: 'array', items: { $ref: '#/components/schemas/CreateExEmployeeRequest' } } } } } },
        },
        responses: {
          201: {
            description: 'Records imported successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, count: { type: 'integer' } } } } },
          },
        },
      },
    },
    '/employees/offers': {
      get: {
        tags: ['Employees'],
        summary: 'List non-joiner / offer candidate records',
        operationId: 'listNonJoiners',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: {
            description: 'List of non-joiner records',
            content: { 'application/json': { schema: { type: 'object', properties: { records: { type: 'array', items: { $ref: '#/components/schemas/NonJoinerRecord' } }, total: { type: 'integer' } } } } },
          },
        },
      },
      post: {
        tags: ['Employees'],
        summary: 'Add a non-joiner / offer record manually',
        operationId: 'addNonJoiner',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateNonJoinerRequest' } } } },
        responses: {
          201: {
            description: 'Non-joiner record created',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, record: { $ref: '#/components/schemas/NonJoinerRecord' } } } } },
          },
        },
      },
    },
    '/employees/offers/bulk': {
      post: {
        tags: ['Employees'],
        summary: 'Bulk import non-joiner records',
        operationId: 'bulkAddNonJoiners',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['records'], properties: { records: { type: 'array', items: { $ref: '#/components/schemas/CreateNonJoinerRequest' } } } } } },
        },
        responses: {
          201: {
            description: 'Non-joiner records imported successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, count: { type: 'integer' } } } } },
          },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN REGISTRATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    '/admin/registrations': {
      get: {
        tags: ['Registration'],
        summary: 'List company registrations (Admin view)',
        description: 'Returns list of company registration pipelines with status filtering. Requires admin session cookie.',
        operationId: 'listAdminRegistrations',
        security: [{ adminSession: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by pipeline status' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by company or domain name' },
        ],
        responses: {
          200: {
            description: 'List of company registrations',
            content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } },
          },
        },
      },
    },
    '/admin/registrations/{id}': {
      get: {
        tags: ['Registration'],
        summary: 'Get single company registration detail (Admin view)',
        operationId: 'getAdminRegistrationById',
        security: [{ adminSession: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Registration detail', content: { 'application/json': { schema: { type: 'object' } } } },
          404: { description: 'Registration not found' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTERNAL EX-EMPLOYER REVIEWS
    // ═══════════════════════════════════════════════════════════════════════════
    '/ex-employer-reviews': {
      post: {
        tags: ['External Reviews'],
        summary: 'Request an external ex-employer reference review',
        operationId: 'requestExEmployerReview',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['exCompany', 'exManagerName', 'exManagerEmail'],
                properties: {
                  exCompany: { type: 'string', example: 'Google Inc' },
                  exManagerName: { type: 'string', example: 'Sundar P' },
                  exManagerEmail: { type: 'string', format: 'email', example: 'sundar@example.com' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Review request sent successfully' },
        },
      },
    },
    '/public/ex-employer-review/{token}': {
      get: {
        tags: ['External Reviews'],
        summary: 'Public lookup of an ex-employer review request by secure token',
        operationId: 'getPublicExEmployerReview',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Review invitation metadata' },
          404: { description: 'Token invalid or expired' },
        },
      },
      post: {
        tags: ['External Reviews'],
        summary: 'Submit evaluation feedback for an ex-employee (Public)',
        operationId: 'submitPublicExEmployerReview',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['rating', 'feedback'],
                properties: {
                  rating: { type: 'number', minimum: 1, maximum: 5, example: 4.5 },
                  feedback: { type: 'string', example: 'Demonstrated deep technical expertise and strong leadership.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Feedback submitted successfully' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // GALLERY
    // ═══════════════════════════════════════════════════════════════════════════
    '/gallery/categories': {
      get: {
        tags: ['Gallery'],
        summary: 'List gallery photo categories',
        operationId: 'getGalleryCategories',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: 'Array of category names',
            content: { 'application/json': { schema: { type: 'array', items: { type: 'string' }, example: ['Socials', 'Hackathon', 'Retreat', 'Awards', 'Townhall', 'Onboarding'] } } },
          },
        },
      },
    },
    '/gallery/posts': {
      get: {
        tags: ['Gallery'],
        summary: 'List corporate gallery posts',
        operationId: 'listGalleryPosts',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 12 } },
        ],
        responses: {
          200: {
            description: 'List of gallery posts with like counts',
            content: { 'application/json': { schema: { type: 'object', properties: { posts: { type: 'array', items: { $ref: '#/components/schemas/GalleryPost' } }, total: { type: 'integer' } } } } },
          },
        },
      },
      post: {
        tags: ['Gallery'],
        summary: 'Upload and share a gallery photo',
        operationId: 'createGalleryPost',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['image', 'title'],
                properties: {
                  image: { type: 'string', format: 'binary', description: 'Photo file (max 10MB)' },
                  title: { type: 'string', example: 'Annual Hackathon Winners' },
                  category: { type: 'string', example: 'Hackathon' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Post uploaded successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, post: { $ref: '#/components/schemas/GalleryPost' } } } } },
          },
        },
      },
    },
    '/gallery/posts/{id}': {
      put: {
        tags: ['Gallery'],
        summary: 'Update a gallery post (title, category, or replace photo)',
        operationId: 'updateGalleryPost',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', minLength: 2, maxLength: 120, description: 'Post caption or title' },
                  category: {
                    type: 'string',
                    enum: ['Socials', 'Hackathon', 'Retreat', 'Awards', 'Townhall', 'Onboarding', 'Other'],
                  },
                  image: { type: 'string', format: 'binary', description: 'Optional replacement photo file' },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', minLength: 2, maxLength: 120 },
                  category: {
                    type: 'string',
                    enum: ['Socials', 'Hackathon', 'Retreat', 'Awards', 'Townhall', 'Onboarding', 'Other'],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Gallery post updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    post: { type: 'object' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation failed' },
          403: { description: 'Forbidden - only author or HR/Admin can update' },
          404: { description: 'Post not found' },
        },
      },
      patch: {
        tags: ['Gallery'],
        summary: 'Partially update a gallery post',
        operationId: 'patchGalleryPost',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  category: { type: 'string' },
                  image: { type: 'string', format: 'binary' },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  category: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Gallery post updated' },
          400: { description: 'Validation failed' },
          403: { description: 'Forbidden' },
          404: { description: 'Post not found' },
        },
      },
      delete: {
        tags: ['Gallery'],
        summary: 'Delete a gallery post',
        operationId: 'deleteGalleryPost',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Post deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    id: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid post ID' },
          403: { description: 'Forbidden - only author or HR/Admin can delete' },
          404: { description: 'Post not found' },
        },
      },
    },
    '/gallery/posts/{id}/like': {
      post: {
        tags: ['Gallery'],
        summary: 'Toggle like reaction on a gallery post',
        operationId: 'toggleGalleryLike',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Like toggled',
            content: { 'application/json': { schema: { type: 'object', properties: { isLiked: { type: 'boolean' }, likeCount: { type: 'integer' } } } } },
          },
        },
      },
    },
    '/gallery/posts/{id}/comments': {
      get: {
        tags: ['Gallery'],
        summary: 'Get comments on a gallery post',
        operationId: 'getGalleryComments',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'List of comments',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/GalleryComment' } } } },
          },
        },
      },
      post: {
        tags: ['Gallery'],
        summary: 'Add a comment to a gallery post',
        operationId: 'addGalleryComment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 500, example: 'Congrats to the team!' } } } } },
        },
        responses: {
          201: {
            description: 'Comment created',
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, comment: { $ref: '#/components/schemas/GalleryComment' } } } } },
          },
        },
      },
    },
    '/gallery/comments/{id}': {
      delete: {
        tags: ['Gallery'],
        summary: 'Delete a gallery comment',
        operationId: 'deleteGalleryComment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Comment removed' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // LEAVES WORKFLOW ALIASES
    // ═══════════════════════════════════════════════════════════════════════════
    '/leaves/{id}/approve': {
      patch: {
        tags: ['Leaves & WFH'],
        summary: 'Direct manager/lead approval of leave request',
        operationId: 'approveLeaveRequestLegacy',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { comment: { type: 'string', example: 'Approved for coverage' } } } } } },
        responses: {
          200: { description: 'Leave approved successfully' },
        },
      },
    },
    '/leaves/{id}/reject': {
      patch: {
        tags: ['Leaves & WFH'],
        summary: 'Direct manager/lead rejection of leave request',
        operationId: 'rejectLeaveRequestLegacy',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string', example: 'Critical sprint delivery window' } } } } } },
        responses: {
          200: { description: 'Leave rejected' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // POLICIES: ASSIGN & REMIND
    // ═══════════════════════════════════════════════════════════════════════════
    '/policies/{id}/assign': {
      post: {
        tags: ['Policies & Compliance'],
        summary: 'Assign corporate policy to specific employees',
        operationId: 'assignPolicyUsers',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userIds'],
                properties: {
                  userIds: { type: 'array', items: { type: 'string' }, example: ['usr_123', 'usr_456'] },
                  dueAt: { type: 'string', format: 'date-time', example: '2026-10-01T00:00:00.000Z' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Policy assigned successfully' },
        },
      },
    },
    '/policies/{id}/remind': {
      post: {
        tags: ['Policies & Compliance'],
        summary: 'Trigger compliance reminder emails to pending assignees',
        operationId: 'remindPolicyPendingUsers',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  userIds: { type: 'array', items: { type: 'string' }, description: 'Optional subset of user IDs to remind' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Reminders dispatched successfully' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // REGISTRY: CROSS-TENANT CANDIDATE VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════
    '/registry/search': {
      get: {
        tags: ['Registry'],
        summary: 'Tenant-scoped candidate background and verification search',
        description: 'Searches the caller\'s own tenant only: verified (Published, non-deleted) ex-employees, non-joiners, and current employees\' completed reference reviews, by PAN, email, phone, designation, or rating thresholds. Restricted to SUPER_ADMIN, ADMIN, CMD, HR, and FINANCE — matches the sidebar link visibility.',
        operationId: 'searchRegistryCandidates',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'query', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Universal search term: PAN or email' },
          { name: 'name', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Candidate first or last name' },
          { name: 'designation', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Role or designation title' },
          { name: 'birthYear', in: 'query', schema: { type: 'string', pattern: '^\\d{4}$' }, description: 'Birth year YYYY' },
          { name: 'phone', in: 'query', schema: { type: 'string', maxLength: 50 }, description: 'Phone number' },
          { name: 'linkedin', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Accepted but currently unused — no LinkedIn field exists in the data model to filter against' },
          { name: 'minTech', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 10 }, description: 'Minimum technical rating filter (0-10)' },
          { name: 'minAttitude', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 10 }, description: 'Minimum attitude rating filter (0-10)' },
        ],
        responses: {
          200: {
            description: 'Matching candidates with compiled employment history and ratings',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/RegistryCandidate' },
                },
              },
            },
          },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — SUPER_ADMIN, ADMIN, CMD, HR, or FINANCE only' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // TEAM: DIRECTORY, EMPLOYEE DETAIL, TRAINING/CERTIFICATIONS, JOURNAL
    // ═══════════════════════════════════════════════════════════════════════════
    '/employees/{id}': {
      get: {
        tags: ['Employees'],
        summary: 'Get a single employee\'s full profile',
        description: 'Tenant-scoped single-employee lookup. Privileged roles (SUPER_ADMIN/ADMIN/HR) receive the full PII field set (phone, PAN, Aadhaar, bank details, work history); all other authenticated roles receive a reduced public-safe field set.',
        operationId: 'getEmployee',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Employee profile', content: { 'application/json': { schema: { type: 'object', properties: { employee: { $ref: '#/components/schemas/Employee' } } } } } },
          400: { description: 'Invalid employee ID parameter', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          404: { description: 'Employee not found' },
        },
      },
    },
    '/team/directory': {
      get: {
        tags: ['Team'],
        summary: 'Server-side filtered, paginated team listing',
        description: 'HR/Admin/Super Admin/CMD see every active/invited employee in the tenant; a MANAGER sees their reporting scope (explicit reports, or a broader same-tenant fallback if none are assigned). Excludes the requester themselves.',
        operationId: 'getTeamDirectory',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Matches name, email, or designation' },
          { name: 'department', in: 'query', schema: { type: 'string', maxLength: 200 } },
          { name: 'band', in: 'query', schema: { type: 'string', maxLength: 50 } },
          { name: 'financialYear', in: 'query', schema: { type: 'string', maxLength: 20 }, description: 'e.g. "FY 2026-2027" — excludes employees who joined after this fiscal year ends' },
          { name: 'includeSelf', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include the requester themselves in results. Default false (browsing "my team"); set true when reusing this endpoint as a general employee picker, e.g. Dispute Center\'s "Assign to" field, where self-assignment must be possible.' },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: { description: 'Paginated team list', content: { 'application/json': { schema: { $ref: '#/components/schemas/TeamDirectoryResponse' } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
        },
      },
    },
    '/team/{employeeId}/detail': {
      get: {
        tags: ['Team'],
        summary: 'Get one employee\'s full performance detail for a financial year',
        description: 'Powers the Team Member Detail drilldown: profile header, projects, 360 feedback, appraisal audit, training/certifications, and the achievements/incidents journal. Viewable by the employee themselves or anyone with manager/HR standing over them (elevated role, direct manager, or anywhere up the reporting chain).',
        operationId: 'getTeamMemberDetail',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'financialYear', in: 'query', schema: { type: 'string', maxLength: 20 }, description: 'Defaults to the current real-world fiscal year, e.g. "FY 2026-2027"' },
        ],
        responses: {
          200: { description: 'Employee detail payload', content: { 'application/json': { schema: { $ref: '#/components/schemas/TeamMemberDetailResponse' } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Employee is outside your reporting scope' },
          404: { description: 'Employee not found' },
        },
      },
    },
    '/team/{employeeId}/projects': {
      get: {
        tags: ['Team'],
        summary: 'Standalone project engagements list for one employee/year',
        description: 'Derived from the employee\'s Goal/GoalAssignment records for this financial year, mapped into a project-engagement shape (title→name, status/progress, owner vs. assignee).',
        operationId: 'getTeamMemberProjects',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'financialYear', in: 'query', schema: { type: 'string', maxLength: 20 } },
        ],
        responses: {
          200: { description: 'Project list for the resolved financial year', content: { 'application/json': { schema: { type: 'object', properties: { financialYear: { type: 'string' }, projects: { type: 'array', items: { type: 'object' } } } } } } },
          403: { description: 'Employee is outside your reporting scope' },
          404: { description: 'Employee not found' },
        },
      },
    },
    '/team/{employeeId}/training': {
      post: {
        tags: ['Team'],
        summary: 'Submit a training/certification record',
        description: 'Self-service when employeeId is the caller\'s own ID (source becomes SELF_SUBMITTED, approvalStatus PENDING pending HR review). A manager/HR submitting on someone else\'s behalf is recorded as COMPANY_MANDATED and pre-approved.',
        operationId: 'createTrainingRecord',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTrainingRecordRequest' } } } },
        responses: {
          201: { description: 'Training record created', content: { 'application/json': { schema: { type: 'object', properties: { trainingRecord: { $ref: '#/components/schemas/TrainingRecord' } } } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Employee is outside your reporting scope' },
        },
      },
    },
    '/team/{employeeId}/training/{id}': {
      patch: {
        tags: ['Team'],
        summary: 'Update a training/certification record',
        description: 'The owner (or their manager) may edit non-approval fields. Only HR/Admin/Super Admin/CMD may set approvalStatus (approve/reject a self-submitted certification).',
        operationId: 'updateTrainingRecord',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateTrainingRecordRequest' } } } },
        responses: {
          200: { description: 'Updated training record', content: { 'application/json': { schema: { type: 'object', properties: { trainingRecord: { $ref: '#/components/schemas/TrainingRecord' } } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Forbidden — not the owner/manager, or attempted to set approvalStatus without HR standing' },
          404: { description: 'Training record not found' },
        },
      },
      delete: {
        tags: ['Team'],
        summary: 'Delete a training/certification record and its attachments',
        operationId: 'deleteTrainingRecord',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          403: { description: 'Employee is outside your reporting scope' },
          404: { description: 'Training record not found' },
        },
      },
    },
    '/team/{employeeId}/achievements': {
      post: {
        tags: ['Team'],
        summary: 'Log an achievement',
        description: 'Self-service (an employee logging their own achievement) or a manager/HR logging one for a report — unlike incidents, achievements are explicitly self-submittable per the employee self-service spec.',
        operationId: 'createAchievement',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateAchievementRequest' } } } },
        responses: {
          201: { description: 'Achievement logged', content: { 'application/json': { schema: { type: 'object', properties: { achievement: { $ref: '#/components/schemas/Achievement' } } } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Employee is outside your reporting scope' },
        },
      },
    },
    '/team/{employeeId}/incidents': {
      post: {
        tags: ['Team'],
        summary: 'Log an incident',
        description: 'Manager/HR only — not self-service. An employee cannot log an incident against themselves.',
        operationId: 'createIncident',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateIncidentRequest' } } } },
        responses: {
          201: { description: 'Incident logged', content: { 'application/json': { schema: { type: 'object', properties: { incident: { $ref: '#/components/schemas/Incident' } } } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — incidents cannot be self-logged, and this employee may be outside your reporting scope' },
        },
      },
    },
    '/team/{employeeId}/incidents/{id}': {
      patch: {
        tags: ['Team'],
        summary: 'Update an incident (status, severity, resolution notes)',
        operationId: 'updateIncident',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateIncidentRequest' } } } },
        responses: {
          200: { description: 'Updated incident', content: { 'application/json': { schema: { type: 'object', properties: { incident: { $ref: '#/components/schemas/Incident' } } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Forbidden' },
          404: { description: 'Incident not found' },
        },
      },
    },
    '/team/{entityKind}/{id}/attachment': {
      post: {
        tags: ['Team'],
        summary: 'Attach a supporting file to a training/achievement/incident record',
        description: 'multipart/form-data upload (field name "file"). PDF, JPEG, or PNG only, 10MB max. entityKind must be one of training | achievements | incidents.',
        operationId: 'uploadEntityAttachment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'entityKind', in: 'path', required: true, schema: { type: 'string', enum: ['training', 'achievements', 'incidents'] } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The training record / achievement / incident ID' },
        ],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } } },
        },
        responses: {
          201: { description: 'Attachment stored', content: { 'application/json': { schema: { type: 'object', properties: { attachment: { $ref: '#/components/schemas/EntityAttachment' } } } } } },
          400: { description: 'Missing file, disallowed MIME type, or invalid entityKind' },
          403: { description: 'Forbidden' },
          404: { description: 'Record not found' },
        },
      },
    },
    '/team/{entityKind}/{id}/attachment/{attachmentId}': {
      get: {
        tags: ['Team'],
        summary: 'Download/stream a protected attachment',
        description: 'Streams the file inline with correct Content-Type/Content-Disposition. Requires the same access as the parent record (owner, manager, or elevated role).',
        operationId: 'downloadEntityAttachment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'entityKind', in: 'path', required: true, schema: { type: 'string', enum: ['training', 'achievements', 'incidents'] } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'attachmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'File stream', content: { 'application/pdf': {}, 'image/jpeg': {}, 'image/png': {} } },
          403: { description: 'Forbidden' },
          404: { description: 'Record or attachment not found' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // DISPUTES: TICKETS, CHAT LOG, ATTACHMENTS
    // ═══════════════════════════════════════════════════════════════════════════
    '/disputes': {
      get: {
        tags: ['Disputes'],
        summary: 'List dispute tickets',
        description: 'Regular users see only tickets they raised, that are about them, or that are assigned to them; HR/Admin/CMD/Super Admin see every ticket in the tenant.',
        operationId: 'listDisputes',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] } },
          { name: 'category', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Matches subject, description, or ticket number' },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: {
            description: 'Paginated dispute list',
            content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Dispute' } }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } } } },
          },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
        },
      },
      post: {
        tags: ['Disputes'],
        summary: 'Raise a new dispute ticket',
        description: 'Any authenticated tenant user may file a ticket. Regular users can only target themselves as subjectEmployeeId; HR/Admin/CMD/Super Admin may file on behalf of another employee. Accepts an optional multipart evidence file (field name "file"; PDF/JPEG/PNG, 10MB max) alongside JSON fields, or JSON-only with no file.',
        operationId: 'createDispute',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateDisputeRequest' } },
            'multipart/form-data': { schema: { allOf: [{ $ref: '#/components/schemas/CreateDisputeRequest' }, { type: 'object', properties: { file: { type: 'string', format: 'binary' } } }] } },
          },
        },
        responses: {
          201: { description: 'Ticket created', content: { 'application/json': { schema: { type: 'object', properties: { dispute: { $ref: '#/components/schemas/Dispute' } } } } } },
          400: { description: 'Validation failed, disallowed MIME type, or invalid subjectEmployeeId', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
        },
      },
    },
    '/disputes/{id}': {
      get: {
        tags: ['Disputes'],
        summary: 'Get one dispute ticket with its chat log and attachments',
        operationId: 'getDisputeDetail',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Dispute detail',
            content: { 'application/json': { schema: { type: 'object', properties: { dispute: { $ref: '#/components/schemas/Dispute' }, messages: { type: 'array', items: { $ref: '#/components/schemas/DisputeMessage' } }, attachments: { type: 'array', items: { $ref: '#/components/schemas/EntityAttachment' } } } } } },
          },
          400: { description: 'Invalid parameters', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          404: { description: 'Dispute not found, or not visible to the caller' },
        },
      },
      patch: {
        tags: ['Disputes'],
        summary: 'Update status, priority, assignment, or resolution notes',
        description: 'HR/Admin/CMD/Super Admin only — the raiser can view and reply, but cannot close or reassign their own ticket.',
        operationId: 'updateDispute',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateDisputeRequest' } } } },
        responses: {
          200: { description: 'Updated dispute', content: { 'application/json': { schema: { type: 'object', properties: { dispute: { $ref: '#/components/schemas/Dispute' } } } } } },
          400: { description: 'Validation failed, or invalid assignedToId', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — HR/Admin/CMD/Super Admin only' },
          404: { description: 'Dispute not found' },
        },
      },
    },
    '/disputes/{id}/messages': {
      post: {
        tags: ['Disputes'],
        summary: 'Reply to a dispute ticket',
        description: 'Available to the raiser, the subject employee, the assignee, or any elevated user — matches ticket visibility.',
        operationId: 'createDisputeMessage',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateDisputeMessageRequest' } } } },
        responses: {
          201: { description: 'Reply posted', content: { 'application/json': { schema: { type: 'object', properties: { message: { $ref: '#/components/schemas/DisputeMessage' } } } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          404: { description: 'Dispute not found, or not visible to the caller' },
        },
      },
    },
    '/disputes/{id}/attachment': {
      post: {
        tags: ['Disputes'],
        summary: 'Attach supporting evidence to a dispute ticket',
        description: 'multipart/form-data upload (field name "file"). PDF, JPEG, or PNG only, 10MB max.',
        operationId: 'uploadDisputeAttachment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } } },
        },
        responses: {
          201: { description: 'Attachment stored', content: { 'application/json': { schema: { type: 'object', properties: { attachment: { $ref: '#/components/schemas/EntityAttachment' } } } } } },
          400: { description: 'Missing file or disallowed MIME type' },
          404: { description: 'Dispute not found, or not visible to the caller' },
        },
      },
    },
    // ═══════════════════════════════════════════════════════════════════════════
    // GOALS / APPRAISAL — previously undocumented endpoints
    // ═══════════════════════════════════════════════════════════════════════════
    '/goals/{id}/activate-approve': {
      post: {
        tags: ['Goals'],
        summary: 'Employee activates a PENDING_APPROVAL goal into ACTIVE',
        description: 'First step of the goal lifecycle: PENDING_APPROVAL → ACTIVE (via this endpoint) → PENDING_MANAGER_REVIEW (via /submit) → PENDING_HR_REVIEW (via /approve) → COMPLETED (via /hr-approve).',
        operationId: 'activateApproveGoal',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { comment: { type: 'string', maxLength: 500 } } } } },
        },
        responses: {
          200: { description: 'Goal activated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden' },
          404: { description: 'Goal not found' },
        },
      },
    },
    '/appraisal-cycles/{id}/summary': {
      get: {
        tags: ['Appraisals'],
        summary: 'Org-wide roll-up summary for one appraisal cycle',
        description: 'Headcount vs. review status, per-department completion and average scores, and hike sign-off progress for one cycle. Tenant-scoped. Restricted to HR, SUPER_ADMIN, CMD, ADMIN.',
        operationId: 'getAppraisalCycleSummary',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'department', in: 'query', schema: { type: 'string' }, description: 'Optional department filter' },
        ],
        responses: {
          200: { description: 'Cycle summary' },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — HR/SUPER_ADMIN/CMD/ADMIN only' },
          404: { description: 'Cycle not found' },
        },
      },
    },

    '/disputes/{id}/attachment/{attachmentId}': {
      get: {
        tags: ['Disputes'],
        summary: 'Download/stream a protected dispute attachment',
        operationId: 'downloadDisputeAttachment',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'attachmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'File stream', content: { 'application/pdf': {}, 'image/jpeg': {}, 'image/png': {} } },
          404: { description: 'Dispute or attachment not found, or not visible to the caller' },
        },
      },
    },
  },
};
