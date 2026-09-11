/**
 * @file swaggerExtensions.js
 * @description Comprehensive OpenAPI specifications for endpoints added across recent releases:
 *   - Department Master List & RBAC (/departments)
 *   - Employee Capacity, Exits, Reactivation, Ex-Employees & Non-Joiner Offers (/employees/*)
 *   - Corporate Gallery & Social Reactions (/gallery/*)
 *   - National Registry Cross-Tenant Candidate Search (/registry/*)
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
      description: 'Cross-tenant background check and employment verification registry',
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
        skills: { type: 'string', example: 'Engineering, Performance, Registry Verified' },
        linkedin: { type: 'string', example: 'linkedin.com/in/vikram' },
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
        summary: 'Universal candidate background and verification search',
        description: 'Cross-tenant background search queries verified ex-employees, candidate non-joiners, and historical employer reference reviews by PAN, email, phone, designation, or rating thresholds.',
        operationId: 'searchRegistryCandidates',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'query', in: 'query', schema: { type: 'string' }, description: 'Universal search term: PAN or email' },
          { name: 'name', in: 'query', schema: { type: 'string' }, description: 'Candidate first or last name' },
          { name: 'designation', in: 'query', schema: { type: 'string' }, description: 'Role or designation title' },
          { name: 'birthYear', in: 'query', schema: { type: 'string' }, description: 'Birth year YYYY' },
          { name: 'phone', in: 'query', schema: { type: 'string' }, description: 'Phone number' },
          { name: 'minTech', in: 'query', schema: { type: 'integer' }, description: 'Minimum technical rating filter (1-10)' },
          { name: 'minAttitude', in: 'query', schema: { type: 'integer' }, description: 'Minimum attitude rating filter (1-10)' },
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
        },
      },
    },
  },
};
