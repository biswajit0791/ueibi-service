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
  // OpenAPI 3.0 has no way to describe a WebSocket surface, so the Socket.IO
  // contract is published as a vendor extension (`x-socket-events` on the root
  // document) rather than left undocumented. Every client->server payload is
  // validated with the same Zod schemas the REST controllers use.
  socketEvents: {
    transport: 'Socket.IO v4, same origin and port as the REST API',
    authentication:
      'The handshake requires a JWT, read from `auth.token`, the `Authorization: Bearer` header, or the `ueibi_session` cookie. ' +
      'An unauthenticated connection is refused with "Authentication error: Token required". ' +
      'The socket identity is authoritative: a senderId/userId inside any payload is ignored.',
    rooms:
      'On connect the socket joins `tenant_<tenantId>` and `tenant:<tenantId>:user:<userId>`. Chat events are delivered only to the two participants\' per-user rooms, never tenant-wide.',
    clientToServer: {
      'chat:send': {
        description: 'Send a message. Acknowledged with the stored message.',
        payload: { peerId: 'string (required)', text: 'string, max 4000', clientId: 'string, echoed back for optimistic reconciliation', mediaUrl: 'string|null', mediaType: 'string|null', fileName: 'string|null', fileSize: 'integer|null' },
        ack: '{ ok: true, message: ChatMessage, clientId } | { ok: false, error, details?, clientId }',
        validatedBy: 'sendMessageSchema',
      },
      'chat:read': {
        description: 'Mark every message from the peer as READ.',
        payload: { peerId: 'string (required)' },
        ack: '{ ok: true, conversationId, read } | { ok: false, error, details? }',
        validatedBy: 'peerIdBodySchema',
      },
      'chat:delete': {
        description: 'Hide a message for yourself, or retract it for both sides (sender only).',
        payload: { messageId: 'string (required)', scope: "'me' | 'everyone' (default 'me')" },
        ack: '{ ok: true, messageId } | { ok: false, error, details? }',
        validatedBy: 'socketDeleteSchema',
      },
      'chat:clear': {
        description: 'Clear one conversation for yourself; the peer keeps their copy.',
        payload: { peerId: 'string (required)' },
        ack: '{ ok: true, conversationId, cleared } | { ok: false, error, details? }',
        validatedBy: 'peerIdBodySchema',
      },
      'chat:typing': {
        description: 'Transient typing signal. Not persisted and not routed through Kafka. Fire-and-forget: an invalid payload is dropped silently.',
        payload: { peerId: 'string (required)', typing: 'boolean' },
        ack: 'none',
        validatedBy: 'socketTypingSchema',
      },
      'chat:presence_check': {
        description: 'Ask whether one peer is currently online.',
        payload: { peerId: 'string (required)' },
        ack: '{ online: boolean } | { ok: false, error, details? }',
        validatedBy: 'socketPresenceSchema',
      },
    },
    serverToClient: {
      'chat:message': 'A new message for this conversation (ChatMessage).',
      'chat:message_deleted': 'A message was retracted for everyone: { messageId, conversationId }.',
      'chat:message_deleted_for_me': 'Sent only to the user who hid it: { messageId, conversationId }.',
      'chat:conversation_cleared': 'Sent only to the user who cleared it: { conversationId }.',
      'chat:conversation_read': 'Read receipt: { conversationId, readerId, readAt }.',
      'chat:messages_delivered': 'Delivery receipt: { conversationId, messageIds, deliveredAt }.',
      'chat:typing': '{ conversationId, userId, typing }.',
      'chat:presence': 'A peer came online or went offline: { userId, online }.',
      'chat:presence_snapshot': 'Sent once on connect: { online: string[] }.',
    },
  },

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
      name: 'Reports',
      description: 'Performance Reports: appraisal-backed analytics, multi-cycle trend, report catalog and CSV exports. Restricted to HR, SUPER_ADMIN, CMD, ADMIN.',
    },
    {
      name: 'Disputes',
      description: 'Dispute Center: employee support/grievance tickets with a chat-style resolution log, supporting-evidence attachments, and HR/Admin assignment & status workflow',
    },
    {
      name: 'Sub-Logins',
      description:
        'Invite Recruiter / Manager. A sub-login is an ORDINARY TenantUser holding REGISTRY_* capabilities, not a separate account type \u2014 invites go through the same flow that creates any employee, so duplicate handling, the temp password and the invite email are shared. '
        + '"Recruiter" and "Viewer" are labels for capability sets; the stored role is always a real UserRole (EMPLOYEE or MANAGER). '
        + 'Registry data is background-check PII, so every grant and revoke is written to an audit trail.',
    },
    {
      name: 'Master Data',
      description:
        'Tenant-scoped master lists that feed dropdowns across the product. Reading is open to every authenticated role (the onboarding form needs the list before a new joiner has any elevated permission); creating and updating is SUPER_ADMIN / ADMIN / HR; archiving is SUPER_ADMIN / ADMIN. '
        + 'Deletes are soft: employee records store these values as strings, so a hard delete would orphan them.',
    },
    {
      name: 'CXO Connect',
      description:
        'Employee → leadership channel. A ticket with a reply thread: an employee writes to a named leader, leadership acknowledges, replies and closes. '
        + 'Leadership is a CAPABILITY granted on top of the user’s HR role (see the Capabilities endpoints), never a UserRole value — a Chief People Officer stays HR or EMPLOYEE in HR terms. '
        + 'Messages may be sent anonymously: the sender is stored so abuse is investigable and the employee can follow their own thread, but the API never exposes them to anyone else, including SUPER_ADMIN.',
    },
    {
      name: 'Dashboards',
      description:
        'Role-scoped aggregate dashboards. Each endpoint is gated by authorizeDashboard() and reads its scope entirely from the session — they take no query, path or body input. Every dashboard is exposed under two equivalent paths.',
    },
    {
      name: 'Chat',
      description:
        'Tenant-scoped 1:1 direct messaging. PostgreSQL is the source of truth; every write is fanned out through Apache Kafka, projected into MongoDB (the read model) and pushed to both participants over Socket.IO. ' +
        'Reads are served from MongoDB and fall back to PostgreSQL automatically — the `source` field on each response reports which store answered. ' +
        'Identity always comes from the verified session: a `senderId`/`userId` in a request body or socket payload is ignored. ' +
        'Live events are documented under the `x-socket-events` extension on this spec.',
    },
  ],

  schemas: {
    // ── Goal option schemas ──
    GoalOption: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        kind: { type: 'string', enum: ['CATEGORY', 'TYPE', 'PRIORITY'] },
        label: { type: 'string', description: 'Shown in the dropdown, e.g. "Medium".', example: 'Medium' },
        value: { type: 'string', description: 'Persisted on the Goal, e.g. "medium". Priority values are lowercased.', example: 'medium' },
        isActive: { type: 'boolean', description: 'False = archived. Leaves the dropdown; goals already using it keep the value.' },
        sortOrder: { type: 'integer', description: 'Display order. For PRIORITY this is also the SEMANTIC rank, so lists must never be sorted alphabetically.' },
        color: { type: 'string', nullable: true, example: '#f59e0b' },
        usageCount: { type: 'integer', description: 'Goals currently holding this value.' },
      },
    },

    // ── Sub-Login schemas ──
    SubLogin: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string', description: 'The real UserRole \u2014 EMPLOYEE or MANAGER.', example: 'EMPLOYEE' },
        status: { type: 'string', enum: ['INVITED', 'ACTIVE', 'EXITED'], description: 'INVITED shows as "Pending" until they first sign in.' },
        accessLabel: { type: 'string', enum: ['Edit & Verify', 'Search & Export', 'Read-only', 'No registry access'], description: 'What the credentials ALLOW. Deliberately avoids role names — a sub-login whose stored role is EMPLOYEE must never appear to be a MANAGER.' },
        invitedAs: { type: 'string', nullable: true, description: 'The preset used at invite time. May differ from what they hold now if credentials were edited afterwards.' },
        capabilities: { type: 'array', items: { type: 'string', enum: ['REGISTRY_SEARCH', 'REGISTRY_WRITE', 'REGISTRY_ANALYTICS', 'REGISTRY_EXPORT'] } },
        title: { type: 'string', nullable: true },
        grantedAt: { type: 'string', format: 'date-time' },
      },
    },
    InviteSubLoginRequest: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 80 },
        email: { type: 'string', format: 'email' },
        preset: { type: 'string', enum: ['RECRUITER', 'MANAGER', 'VIEWER'], description: 'Seeds the role and the default credentials. `capabilities` overrides it.' },
        capabilities: {
          type: 'array',
          description: 'Authoritative. At least one is required.',
          items: { type: 'string', enum: ['REGISTRY_SEARCH', 'REGISTRY_WRITE', 'REGISTRY_ANALYTICS', 'REGISTRY_EXPORT'] },
        },
        designation: { type: 'string', maxLength: 100 },
        department: { type: 'string', maxLength: 100 },
      },
    },
    CapabilityAuditEntry: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        action: { type: 'string', enum: ['GRANT', 'REVOKE'] },
        capability: { type: 'string' },
        at: { type: 'string', format: 'date-time' },
        actor: { type: 'object', properties: { id: { type: 'string', nullable: true }, name: { type: 'string' }, role: { type: 'string', nullable: true } } },
        target: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } },
      },
    },

    // ── Master Data schemas ──
    BloodGroup: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', example: 'O+', description: 'Not limited to the eight ABO/Rh groups — rare phenotypes such as "Bombay (hh)" are valid.' },
        isActive: { type: 'boolean', description: 'False = archived. Archived groups leave the dropdown but existing employee records keep the value.' },
        sortOrder: { type: 'integer', example: 0 },
        usageCount: { type: 'integer', example: 12, description: 'Active employees currently holding this value.' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateBloodGroupRequest: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', maxLength: 30, example: 'O+', description: 'Letters, numbers, spaces and + - ( ) / only.' },
        sortOrder: { type: 'integer', minimum: 0, maximum: 999 },
      },
    },

    // ── CXO Connect schemas ──
    CxoPerson: {
      type: 'object',
      description: 'The sender. On an anonymous message this is {id: null, name: "Anonymous"} for every viewer except the sender themselves.',
      properties: {
        id: { type: 'string', nullable: true, example: 'cmtk36qm80004uugc0pfwdr3n' },
        name: { type: 'string', example: 'Arjun Sharma' },
        designation: { type: 'string', nullable: true, example: 'Software Engineer' },
        department: { type: 'string', nullable: true, example: 'Engineering' },
      },
    },
    CxoReply: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        body: { type: 'string', example: 'Thank you! Glad it is working well for you.' },
        isLeadershipResponse: {
          type: 'boolean',
          description: 'True for an official response from leadership; false for the employee’s own follow-up. Only a leadership response moves the ticket to REPLIED.',
        },
        author: { $ref: '#/components/schemas/CxoPerson' },
        isMine: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    CxoMessage: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ticketNumber: { type: 'string', example: 'CXO-2026-0042' },
        subject: { type: 'string', example: 'Appreciation for WFH Policy Update' },
        body: { type: 'string' },
        category: { type: 'string', enum: ['APPRECIATION', 'SUGGESTION', 'CONCERN', 'QUESTION'] },
        status: { type: 'string', enum: ['PENDING', 'ACKNOWLEDGED', 'REPLIED', 'CLOSED'] },
        isAnonymous: { type: 'boolean' },
        isMine: { type: 'boolean', description: 'True when the viewer raised this message.' },
        from: { $ref: '#/components/schemas/CxoPerson' },
        targetLeader: { $ref: '#/components/schemas/CxoPerson' },
        assignedTo: { $ref: '#/components/schemas/CxoPerson' },
        dueAt: { type: 'string', format: 'date-time', nullable: true, description: 'SLA deadline, 5 business days from creation.' },
        isOverdue: { type: 'boolean', description: 'Past dueAt and still awaiting a response.' },
        closedAt: { type: 'string', format: 'date-time', nullable: true },
        lastReplyAt: { type: 'string', format: 'date-time', nullable: true },
        replyCount: { type: 'integer', example: 2 },
        replies: {
          type: 'array',
          description: 'Present on the single-message endpoint only.',
          items: { $ref: '#/components/schemas/CxoReply' },
        },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateCxoMessageRequest: {
      type: 'object',
      required: ['subject', 'body'],
      properties: {
        subject: { type: 'string', minLength: 3, maxLength: 150 },
        body: { type: 'string', minLength: 10, maxLength: 5000 },
        category: { type: 'string', enum: ['APPRECIATION', 'SUGGESTION', 'CONCERN', 'QUESTION'], default: 'SUGGESTION' },
        isAnonymous: { type: 'boolean', default: false, description: 'Hides the sender from leadership. The employee still sees and can follow their own thread.' },
        targetLeaderId: {
          type: 'string',
          nullable: true,
          description: 'Must hold the LEADERSHIP capability. Omit to address the whole panel.',
        },
      },
    },
    CxoLeader: {
      type: 'object',
      description: 'A holder of the LEADERSHIP capability, as shown in the employee’s recipient picker.',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', example: 'Kavitha Rao' },
        email: { type: 'string' },
        role: { type: 'string', description: 'Their unchanged HR role, e.g. HR or EMPLOYEE.', example: 'HR' },
        title: { type: 'string', nullable: true, description: 'Title on the grant, e.g. "Chief People Officer". Falls back to the HR designation.' },
        department: { type: 'string', nullable: true },
      },
    },

    // ── Chat schemas ──
    ChatMessage: {
      type: 'object',
      description: 'One direct message, in the shape both the REST and Socket.IO surfaces return.',
      properties: {
        id: { type: 'string', example: 'cmu57y5u60000uu5wbvt6jhf5' },
        tenantId: { type: 'string', example: 'cmtk36q8w0000uugcje3gk1pf' },
        conversationId: {
          type: 'string',
          description: 'Deterministic key for the pair: `<tenantId>:<sortedUserIdA>__<sortedUserIdB>`. Both participants derive the same value.',
          example: 'cmtk36q8w0000uugcje3gk1pf:cmtk36qg40002uugct2yczbge__cmtk36qm80004uugc0pfwdr3n',
        },
        senderId: { type: 'string', example: 'cmtk36qg40002uugct2yczbge' },
        receiverId: { type: 'string', nullable: true, example: 'cmtk36qm80004uugc0pfwdr3n' },
        text: { type: 'string', example: 'Can we move the 1:1 to 4pm?' },
        mediaUrl: { type: 'string', nullable: true, example: '/uploads/1758096000000-123456789.png' },
        mediaType: { type: 'string', nullable: true, example: 'image/png' },
        fileName: { type: 'string', nullable: true, example: 'sprint-board.png' },
        fileSize: { type: 'integer', nullable: true, example: 284913 },
        status: {
          type: 'string',
          enum: ['SENT', 'DELIVERED', 'READ'],
          description: 'Delivery receipt state. DELIVERED is set when the recipient opens the conversation; READ when they view it.',
          example: 'DELIVERED',
        },
        deliveredAt: { type: 'string', format: 'date-time', nullable: true },
        readAt: { type: 'string', format: 'date-time', nullable: true },
        isDeleted: {
          type: 'boolean',
          description: 'True when retracted for everyone. Text is replaced and media stripped.',
          example: false,
        },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    ChatPeer: {
      type: 'object',
      description: 'The other participant, resolved from the tenant user directory.',
      properties: {
        id: { type: 'string', example: 'cmtk36qm80004uugc0pfwdr3n' },
        name: { type: 'string', example: 'Ashish Parida' },
        designation: { type: 'string', nullable: true, example: 'Developer' },
        department: { type: 'string', nullable: true, example: 'Tech' },
        role: { type: 'string', example: 'EMPLOYEE' },
        profileSnaps: { type: 'array', items: { type: 'string' } },
      },
    },
    ChatConversationSummary: {
      type: 'object',
      description: 'One row of the Messages inbox.',
      properties: {
        conversationId: { type: 'string' },
        unread: { type: 'integer', description: 'Messages from the peer not yet marked READ', example: 2 },
        peer: { $ref: '#/components/schemas/ChatPeer' },
        lastMessage: { $ref: '#/components/schemas/ChatMessage' },
      },
    },
    SendChatMessageRequest: {
      type: 'object',
      required: ['peerId'],
      description: 'Text, media, or both — a message with neither is rejected.',
      properties: {
        peerId: {
          type: 'string',
          maxLength: 100,
          description: 'Recipient user id. Must be an active, non-deleted user in the SAME tenant, and not the caller.',
          example: 'cmtk36qm80004uugc0pfwdr3n',
        },
        text: { type: 'string', maxLength: 4000, example: 'Can we move the 1:1 to 4pm?' },
        mediaUrl: {
          type: 'string',
          nullable: true,
          maxLength: 2000,
          description: 'Must be an uploaded file path (`/uploads/...`, `/api/uploads/...`) or an http(s) URL.',
        },
        mediaType: { type: 'string', nullable: true, maxLength: 150, example: 'image/png' },
        fileName: { type: 'string', nullable: true, maxLength: 255 },
        fileSize: { type: 'integer', nullable: true, maximum: 52428800, description: 'Bytes; 50MB ceiling' },
      },
    },
    PeerIdRequest: {
      type: 'object',
      required: ['peerId'],
      properties: {
        peerId: { type: 'string', maxLength: 100, example: 'cmtk36qm80004uugc0pfwdr3n' },
      },
    },

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
    // Overrides the stale base-spec AnalyticsSummary, which documented
    // totalEmployees/activeGoals/completedTasks/averageAppraisalRating/
    // leaveApprovalRate — none of which this endpoint has ever returned.
    AnalyticsSummary: { $ref: '#/components/schemas/ReportsAnalytics' },
    ReportsAnalytics: {
      type: 'object',
      properties: {
        totalHeadcount: { type: 'integer', example: 11, description: 'Active, non-deleted employees' },
        averageGoalProgress: { type: 'integer', example: 61 },
        departmentPerformance: {
          type: 'array',
          description: 'Empty when the tenant has no reviews yet — never placeholder departments.',
          items: {
            type: 'object',
            properties: {
              dept: { type: 'string', example: 'Engineering' },
              score: { type: 'number', example: 4.2, description: 'Avg manager score, falling back to avg self score' },
              avgSelfScore: { type: 'number', nullable: true },
              avgManagerScore: { type: 'number', nullable: true },
              avgHrScore: { type: 'number', nullable: true },
              employees: { type: 'integer', description: 'Active headcount in the department' },
              completionRate: { type: 'number' },
            },
          },
        },
        cycle: { type: 'object', nullable: true, properties: { id: { type: 'string' }, name: { type: 'string' }, frequency: { type: 'string' }, status: { type: 'string' } } },
        reviewSummary: {
          type: 'object', nullable: true,
          properties: {
            totalReviews: { type: 'integer' },
            byStatus: { type: 'object', properties: { DRAFT: { type: 'integer' }, SUBMITTED: { type: 'integer' }, MANAGER_REVIEWED: { type: 'integer' }, COMPLETED: { type: 'integer' } } },
            completionRate: { type: 'number' },
            hikeSummary: { type: 'object', properties: { avgHikePercentage: { type: 'number', nullable: true }, pendingRelease: { type: 'integer' }, released: { type: 'integer' } } },
          },
        },
        goalSummary: {
          type: 'object',
          properties: { totalGoals: { type: 'integer' }, completedGoals: { type: 'integer' }, goalCompletionRate: { type: 'number' }, averageGoalProgress: { type: 'integer' } },
        },
      },
    },
    ReportsTrend: {
      type: 'object',
      properties: {
        sufficientData: { type: 'boolean', description: 'False when fewer than two cycles have reviews' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cycleId: { type: 'string' },
              quarter: { type: 'string', example: 'Q3 2026', description: 'Cycle name; also the chart X-axis key' },
              label: { type: 'string' },
              frequency: { type: 'string' },
              startDate: { type: 'string', format: 'date-time' },
              avg: { type: 'number', example: 4.1 },
              avgManagerScore: { type: 'number', nullable: true },
              avgSelfScore: { type: 'number', nullable: true },
              completionRate: { type: 'number' },
              totalReviews: { type: 'integer' },
            },
          },
        },
      },
    },
    ReportCatalog: {
      type: 'object',
      properties: {
        cycle: { type: 'object', nullable: true, properties: { id: { type: 'string' }, name: { type: 'string' } } },
        reports: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', example: 'appraisal-summary' },
              name: { type: 'string' },
              description: { type: 'string' },
              scope: { type: 'string', example: 'cycle' },
              scopeLabel: { type: 'string', example: 'FY 2026-2027' },
              format: { type: 'string', example: 'CSV' },
              rowCount: { type: 'integer', description: 'Live count of rows this report would produce now' },
            },
          },
        },
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
        subjectEmployee: { type: 'object', nullable: true, description: 'The primary subject. Retained for backward compatibility; prefer `subjects` for the full list.', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } },
        subjects: {
          type: 'array',
          description: 'Every employee this ticket is about, in the order they were selected. The first entry is the primary subject and also appears as `subjectEmployee`.',
          items: {
            type: 'object',
            properties: {
              employeeId: { type: 'string' },
              employee: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } },
            },
          },
        },
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
        subjectEmployeeId: { type: 'string', description: 'Elevated roles (HR/Admin/CMD/Super Admin) only — file on behalf of another tenant employee. Regular users always target themselves regardless of this field. Superseded by subjectEmployeeIds, but still accepted.' },
        subjectEmployeeIds: {
          type: 'array',
          maxItems: 25,
          items: { type: 'string' },
          description: 'Elevated roles only — every employee this ticket is about, when one issue covers more than one person. The first id becomes the primary subject. Over multipart/form-data, repeat the field once per id; a comma-separated string or a JSON array in a single field is also accepted. Ignored for regular users, who always file about themselves.',
        },
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
    // MASTER DATA — goal categories / types / priorities
    // ═══════════════════════════════════════════════════════════════════════════
    '/goal-options': {
      get: {
        tags: ['Master Data'],
        summary: 'List goal categories, types and priorities',
        description:
          'Backs the Category / Goal Type / Priority dropdowns on the goal form. Readable by every authenticated role, because any employee can create a goal for themselves. '
          + 'Seeded from the previous hardcoded constants on first read, so an existing tenant sees the same options until an admin edits them. '
          + 'NOTE: the legacy GET /goals/categories, /goals/types and /goals/priorities endpoints still exist and still return a plain array of strings \u2014 they now read this table.',
        operationId: 'listGoalOptions',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [
          { name: 'kind', in: 'query', schema: { type: 'string', enum: ['CATEGORY', 'TYPE', 'PRIORITY'] }, description: 'One list only. Omit for all three grouped by kind.' },
          { name: 'includeArchived', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Defaults to true for the admin screen.' },
        ],
        responses: {
          200: {
            description: 'Options, ordered by sortOrder',
            content: { 'application/json': { schema: { type: 'object', properties: { options: { oneOf: [{ type: 'array', items: { $ref: '#/components/schemas/GoalOption' } }, { type: 'object', properties: { CATEGORY: { type: 'array', items: { $ref: '#/components/schemas/GoalOption' } }, TYPE: { type: 'array', items: { $ref: '#/components/schemas/GoalOption' } }, PRIORITY: { type: 'array', items: { $ref: '#/components/schemas/GoalOption' } } } }] } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Master Data'],
        summary: 'Add a goal option',
        description:
          'SUPER_ADMIN / ADMIN / HR. Re-adding an archived value restores it instead of returning 409. '
          + 'Adding a PRIORITY is safe: goal validation checks the tenant\u2019s own active list rather than a fixed enum.',
        operationId: 'createGoalOption',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['kind', 'label'], properties: { kind: { type: 'string', enum: ['CATEGORY', 'TYPE', 'PRIORITY'] }, label: { type: 'string', maxLength: 100 }, value: { type: 'string', maxLength: 100, description: 'Defaults to the label. Lowercased for PRIORITY.' }, color: { type: 'string', nullable: true }, sortOrder: { type: 'integer' } } } } },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, option: { $ref: '#/components/schemas/GoalOption' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { description: 'That option already exists' },
        },
      },
    },

    '/goal-options/{id}': {
      patch: {
        tags: ['Master Data'],
        summary: 'Rename, recolour, reorder or restore a goal option',
        description:
          'SUPER_ADMIN / ADMIN / HR. Changing `value` CASCADES to every goal holding the old one \u2014 goals store these as plain strings, so without the cascade they would drop out of the dropdown and out of any filter built on it. '
          + 'For PRIORITY, `sortOrder` is the ranking, not just display order.',
        operationId: 'updateGoalOption',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { label: { type: 'string', maxLength: 100 }, value: { type: 'string', maxLength: 100 }, color: { type: 'string', nullable: true }, sortOrder: { type: 'integer' }, isActive: { type: 'boolean', description: 'true restores an archived option.' } } } } },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, option: { $ref: '#/components/schemas/GoalOption' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { description: 'Another option already uses that value' },
        },
      },
      delete: {
        tags: ['Master Data'],
        summary: 'Archive a goal option',
        description:
          'SUPER_ADMIN / ADMIN / HR. Soft-delete: the option leaves the dropdown but goals keep their value, and the response reports how many. '
          + 'Refused with 400 if it is the last active option for that list \u2014 a dropdown must never be empty.',
        operationId: 'archiveGoalOption',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Archived', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, option: { $ref: '#/components/schemas/GoalOption' }, usageCount: { type: 'integer' } } } } } },
          400: { description: 'Validation failed, or this is the last active option' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SUB-LOGINS — Invite Recruiter / Manager
    // ═══════════════════════════════════════════════════════════════════════════
    '/sublogins': {
      get: {
        tags: ['Sub-Logins'],
        summary: 'List sub-logins and seat counters',
        description: 'Everyone in the tenant holding at least one REGISTRY_* capability, collapsed to one row per person, plus the three stat-card counters.',
        operationId: 'listSubLogins',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'Seats and counters',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, subLogins: { type: 'array', items: { $ref: '#/components/schemas/SubLogin' } }, stats: { type: 'object', properties: { authorized: { type: 'integer' }, active: { type: 'integer' }, pending: { type: 'integer' } } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['Sub-Logins'],
        summary: 'Invite a recruiter / manager / viewer',
        description:
          'SUPER_ADMIN / ADMIN / HR. Delegates user creation to the existing employee invite flow rather than duplicating it, then attaches the chosen credentials. '
          + 'If the email already belongs to a team member, no new user is created \u2014 the credentials are granted to their existing account and the response sets alreadyExisted:true (200 instead of 201).',
        operationId: 'inviteSubLogin',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InviteSubLoginRequest' } } } },
        responses: {
          201: { description: 'Invited and credentials granted' },
          200: { description: 'Existing team member \u2014 credentials granted to their account' },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role cannot invite this person or grant one of these credentials' },
        },
      },
    },

    '/sublogins/{id}': {
      patch: {
        tags: ['Sub-Logins'],
        summary: 'Replace a credential set',
        description: 'Sends the full desired set: anything missing from it is revoked, anything new is granted. Both directions are audited.',
        operationId: 'updateSubLogin',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The TenantUser id.' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['capabilities'], properties: { capabilities: { type: 'array', items: { type: 'string', enum: ['REGISTRY_SEARCH', 'REGISTRY_WRITE', 'REGISTRY_ANALYTICS', 'REGISTRY_EXPORT'] } }, title: { type: 'string', nullable: true } } } } },
        },
        responses: {
          200: { description: 'Applied', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, added: { type: 'array', items: { type: 'string' } }, removed: { type: 'array', items: { type: 'string' } } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role cannot grant or revoke one of these credentials' },
        },
      },
      delete: {
        tags: ['Sub-Logins'],
        summary: 'Revoke all registry credentials',
        description: 'Removes every REGISTRY_* capability. The TenantUser is NOT deleted \u2014 they keep their account, their role and everything else. Takes effect on their next request, since capabilities are re-read per request rather than carried in the JWT.',
        operationId: 'revokeSubLogin',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Revoked' },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },

    '/sublogins/presets': {
      get: {
        tags: ['Sub-Logins'],
        summary: 'Platform role presets',
        description:
          'The three dropdown options. Each maps to a REAL UserRole plus a default capability set. Viewer differs from Recruiter by REGISTRY_EXPORT \u2014 a Viewer can look but cannot take the data away.',
        operationId: 'listSubLoginPresets',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'Presets',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, presets: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', enum: ['RECRUITER', 'MANAGER', 'VIEWER'] }, label: { type: 'string' }, role: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } } } } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },

    '/sublogins/audit': {
      get: {
        tags: ['Sub-Logins'],
        summary: 'Credential grant/revoke audit trail',
        description:
          'Who widened or removed access to registry data, and when. Kept even after the capability row is deleted, so a revoke does not erase the history of the grant.',
        operationId: 'listSubLoginAudit',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'string' }, description: 'Limit to one person.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: {
          200: { description: 'Audit entries, newest first', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, entries: { type: 'array', items: { $ref: '#/components/schemas/CapabilityAuditEntry' } } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // MASTER DATA — blood groups
    // ═══════════════════════════════════════════════════════════════════════════
    '/blood-groups': {
      get: {
        tags: ['Master Data'],
        summary: 'List blood groups',
        description:
          'Feeds the Blood Group dropdown on the onboarding form and employee records. Open to every authenticated role. '
          + 'The eight ABO/Rh groups are auto-seeded on first access so a new tenant never sees an empty dropdown.',
        operationId: 'listBloodGroups',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [
          { name: 'includeArchived', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Include archived groups (admin screen only).' },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 50 } },
        ],
        responses: {
          200: {
            description: 'Blood groups, ordered by sortOrder then name',
            content: { 'application/json': { schema: { type: 'object', properties: { bloodGroups: { type: 'array', items: { $ref: '#/components/schemas/BloodGroup' } } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Master Data'],
        summary: 'Create a blood group',
        description:
          'SUPER_ADMIN / ADMIN / HR. Re-adding a name that exists but is archived RESTORES it and returns 200 rather than colliding with the unique index.',
        operationId: 'createBloodGroup',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateBloodGroupRequest' } } } },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, bloodGroup: { $ref: '#/components/schemas/BloodGroup' } } } } } },
          200: { description: 'An archived group with that name was restored' },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { description: 'That blood group already exists' },
        },
      },
    },

    '/blood-groups/{id}': {
      patch: {
        tags: ['Master Data'],
        summary: 'Rename, reorder or restore a blood group',
        description:
          'SUPER_ADMIN / ADMIN / HR. A rename also rewrites every employee record holding the old value, because employee records store the group as a string rather than a foreign key. Pass isActive:true to restore an archived group.',
        operationId: 'updateBloodGroup',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', maxLength: 30 }, sortOrder: { type: 'integer' }, isActive: { type: 'boolean' } } } } },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, bloodGroup: { $ref: '#/components/schemas/BloodGroup' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { description: 'Another blood group already uses that name' },
        },
      },
      delete: {
        tags: ['Master Data'],
        summary: 'Archive a blood group',
        description:
          'SUPER_ADMIN / ADMIN only (not HR). Soft-delete: the group leaves the dropdown but employee records keep their value. The response reports how many records still hold it.',
        operationId: 'archiveBloodGroup',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Archived', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, bloodGroup: { $ref: '#/components/schemas/BloodGroup' }, usageCount: { type: 'integer' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // DASHBOARDS — role-scoped aggregates (no input; scope comes from the session)
    // ═══════════════════════════════════════════════════════════════════════════
    '/dashboard/super-admin': {
      get: {
        tags: ['Dashboards'],
        summary: 'SUPER_ADMIN dashboard',
        description: 'Platform-wide totals across every tenant: tenant count, user count, registrations and the most recent active tenants. The only dashboard that is NOT tenant-scoped. Access: SUPER_ADMIN only. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getSuperAdminDashboard',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'SUPER_ADMIN dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'SUPER_ADMIN' }, totalTenants: { type: 'integer' }, totalUsers: { type: 'integer' }, totalRegistrations: { type: 'integer' }, recentTenants: { type: 'array', items: { type: 'object' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/super-admin/dashboard': {
      get: {
        tags: ['Dashboards'],
        summary: 'SUPER_ADMIN dashboard',
        description: 'Platform-wide totals across every tenant: tenant count, user count, registrations and the most recent active tenants. The only dashboard that is NOT tenant-scoped. Access: SUPER_ADMIN only. Alias of GET /dashboard/super-admin; identical response. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getSuperAdminDashboardAlias',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'SUPER_ADMIN dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'SUPER_ADMIN' }, totalTenants: { type: 'integer' }, totalUsers: { type: 'integer' }, totalRegistrations: { type: 'integer' }, recentTenants: { type: 'array', items: { type: 'object' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/dashboard/admin': {
      get: {
        tags: ['Dashboards'],
        summary: 'ADMIN dashboard',
        description: 'Tenant headcount and the active appraisal cycle with its progress. Access: SUPER_ADMIN, ADMIN. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getAdminDashboard',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'ADMIN dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'ADMIN' }, tenantId: { type: 'string' }, totalHeadcount: { type: 'integer' }, activeCycle: { type: 'object', nullable: true } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/admin/dashboard': {
      get: {
        tags: ['Dashboards'],
        summary: 'ADMIN dashboard',
        description: 'Tenant headcount and the active appraisal cycle with its progress. Access: SUPER_ADMIN, ADMIN. Alias of GET /dashboard/admin; identical response. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getAdminDashboardAlias',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'ADMIN dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'ADMIN' }, tenantId: { type: 'string' }, totalHeadcount: { type: 'integer' }, activeCycle: { type: 'object', nullable: true } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/dashboard/hr': {
      get: {
        tags: ['Dashboards'],
        summary: 'HR dashboard',
        description: 'Employee totals, review summary and a department breakdown for the active cycle. Access: SUPER_ADMIN, ADMIN, HR. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getHrDashboard',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'HR dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'HR' }, tenantId: { type: 'string' }, totalEmployees: { type: 'integer' }, activeCycle: { type: 'object', nullable: true }, reviewsSummary: { type: 'object' }, departmentBreakdown: { type: 'array', items: { type: 'object' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/hr/dashboard': {
      get: {
        tags: ['Dashboards'],
        summary: 'HR dashboard',
        description: 'Employee totals, review summary and a department breakdown for the active cycle. Access: SUPER_ADMIN, ADMIN, HR. Alias of GET /dashboard/hr; identical response. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getHrDashboardAlias',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'HR dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'HR' }, tenantId: { type: 'string' }, totalEmployees: { type: 'integer' }, activeCycle: { type: 'object', nullable: true }, reviewsSummary: { type: 'object' }, departmentBreakdown: { type: 'array', items: { type: 'object' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/dashboard/finance': {
      get: {
        tags: ['Dashboards'],
        summary: 'FINANCE dashboard',
        description: 'Licence utilisation: seats purchased against seats active. Access: SUPER_ADMIN, ADMIN, HR, FINANCE. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getFinanceDashboard',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'FINANCE dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'FINANCE' }, tenantId: { type: 'string' }, companyName: { type: 'string' }, licenseLimit: { type: 'integer' }, activeSeats: { type: 'integer' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/finance/dashboard': {
      get: {
        tags: ['Dashboards'],
        summary: 'FINANCE dashboard',
        description: 'Licence utilisation: seats purchased against seats active. Access: SUPER_ADMIN, ADMIN, HR, FINANCE. Alias of GET /dashboard/finance; identical response. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getFinanceDashboardAlias',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'FINANCE dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'FINANCE' }, tenantId: { type: 'string' }, companyName: { type: 'string' }, licenseLimit: { type: 'integer' }, activeSeats: { type: 'integer' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/dashboard/manager': {
      get: {
        tags: ['Dashboards'],
        summary: 'MANAGER dashboard',
        description: 'The manager\u2019s direct reports with their goal and review progress. Access: SUPER_ADMIN, ADMIN, HR, FINANCE, MANAGER. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getManagerDashboard',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'MANAGER dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'MANAGER' }, tenantId: { type: 'string' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/manager/dashboard': {
      get: {
        tags: ['Dashboards'],
        summary: 'MANAGER dashboard',
        description: 'The manager\u2019s direct reports with their goal and review progress. Access: SUPER_ADMIN, ADMIN, HR, FINANCE, MANAGER. Alias of GET /dashboard/manager; identical response. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getManagerDashboardAlias',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'MANAGER dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'MANAGER' }, tenantId: { type: 'string' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/dashboard/employee': {
      get: {
        tags: ['Dashboards'],
        summary: 'EMPLOYEE dashboard',
        description: 'The signed-in employee\u2019s own goals, tasks and review status. Access: every authenticated tenant role. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getEmployeeDashboard',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'EMPLOYEE dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'EMPLOYEE' }, tenantId: { type: 'string' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },
    '/employee/dashboard': {
      get: {
        tags: ['Dashboards'],
        summary: 'EMPLOYEE dashboard',
        description: 'The signed-in employee\u2019s own goals, tasks and review status. Access: every authenticated tenant role. Alias of GET /dashboard/employee; identical response. Takes no query, path or body input \u2014 the scope comes entirely from the session.',
        operationId: 'getEmployeeDashboardAlias',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'EMPLOYEE dashboard payload',
            content: { 'application/json': { schema: { type: 'object', properties: { dashboard: { type: 'string', example: 'EMPLOYEE' }, tenantId: { type: 'string' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Your role may not view this dashboard' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // CXO CONNECT — employee ↔ leadership
    // ═══════════════════════════════════════════════════════════════════════════
    '/cxo/messages': {
      get: {
        tags: ['CXO Connect'],
        summary: 'List messages',
        description:
          'An employee sees the messages they raised. A leadership-capability holder sees their inbox: messages addressed to them, unaddressed messages, and anything assigned to them. '
          + 'A leader can pass scope=mine to see the messages they raised themselves instead. Anonymous senders are redacted for everyone but the sender.',
        operationId: 'listCxoMessages',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'ACKNOWLEDGED', 'REPLIED', 'CLOSED'] } },
          { name: 'category', in: 'query', schema: { type: 'string', enum: ['APPRECIATION', 'SUGGESTION', 'CONCERN', 'QUESTION'] } },
          { name: 'scope', in: 'query', schema: { type: 'string', enum: ['mine', 'leadership'] }, description: 'Leaders only: "mine" returns messages they raised rather than the inbox.' },
        ],
        responses: {
          200: {
            description: 'Messages visible to the caller',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, scope: { type: 'string', enum: ['mine', 'leadership'] }, onPanel: { type: 'boolean', description: 'True when the caller holds the LEADERSHIP capability. An elevated role (SUPER_ADMIN/ADMIN/HR/CMD) gets the leadership view so there is no bootstrapping dead end, but employees address a specific leader - so onPanel=false with an empty list means "nobody can write to you yet", not "no activity".' }, messages: { type: 'array', items: { $ref: '#/components/schemas/CxoMessage' } } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['CXO Connect'],
        summary: 'Raise a message to leadership',
        description: 'Creates a ticket, sets a 5-business-day SLA and notifies the addressed leader (or the whole panel) over Socket.IO.',
        operationId: 'createCxoMessage',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCxoMessageRequest' } } } },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/CxoMessage' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/cxo/messages/{id}': {
      get: {
        tags: ['CXO Connect'],
        summary: 'Read one message with its replies',
        description: 'Accessible to the employee who raised it and to leadership. Marks the thread read for whichever side is viewing.',
        operationId: 'getCxoMessage',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'The thread', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/CxoMessage' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Not the sender and not leadership' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['CXO Connect'],
        summary: 'Update status or reassign',
        description: 'Leadership only. Acknowledge, close, or hand the thread to another panel member.',
        operationId: 'updateCxoMessage',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['PENDING', 'ACKNOWLEDGED', 'REPLIED', 'CLOSED'] }, assignedToId: { type: 'string', description: 'Must hold the LEADERSHIP capability.' } } } } },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/CxoMessage' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Only leadership can update a message' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/cxo/messages/{id}/replies': {
      post: {
        tags: ['CXO Connect'],
        summary: 'Reply to a message',
        description:
          'Leadership replying produces an official response (isLeadershipResponse=true) and moves the ticket to REPLIED. '
          + 'The employee replying on their own thread is a follow-up and does not change the status. A follow-up on an anonymous thread stays anonymous.',
        operationId: 'replyToCxoMessage',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 5000 } } } } } },
        responses: {
          201: { description: 'Reply created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/CxoReply' } } } } } },
          400: { description: 'Validation failed, or the thread is closed' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Not a participant' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/cxo/leaders': {
      get: {
        tags: ['CXO Connect'],
        summary: 'Leaders an employee can write to',
        description: 'Holders of the LEADERSHIP capability in this tenant, excluding deleted and exited users. Empty until an admin grants it to someone.',
        operationId: 'listCxoLeaders',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: { description: 'The leadership panel', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, leaders: { type: 'array', items: { $ref: '#/components/schemas/CxoLeader' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/cxo/stats': {
      get: {
        tags: ['CXO Connect'],
        summary: 'Counts for the nav badge',
        description: 'Scope-aware: leadership gets open/overdue/unread across their inbox, an employee gets their own open threads and unread replies.',
        operationId: 'getCxoStats',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'Counts',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, scope: { type: 'string', enum: ['mine', 'leadership'] }, onPanel: { type: 'boolean' }, open: { type: 'integer' }, overdue: { type: 'integer' }, unread: { type: 'integer' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/cxo/capabilities': {
      get: {
        tags: ['CXO Connect'],
        summary: 'List LEADERSHIP capability holders',
        operationId: 'listCxoCapabilityHolders',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: { description: 'Holders', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, holders: { type: 'array', items: { $ref: '#/components/schemas/CxoLeader' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/cxo/capabilities/grant': {
      post: {
        tags: ['CXO Connect'],
        summary: 'Grant the LEADERSHIP capability',
        description:
          'SUPER_ADMIN / ADMIN only. Additive: the UserRole, reporting line and existing permissions are unchanged. '
          + 'Idempotent - re-granting updates the title rather than creating a second row. '
          + 'LEADERSHIP is deliberately not a UserRole value: normalizeRole() maps that string to SUPER_ADMIN, so making it a role would grant every leader super-admin dashboard visibility.',
        operationId: 'grantLeadershipCapability',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' }, capability: { type: 'string', enum: ['LEADERSHIP'], default: 'LEADERSHIP' }, title: { type: 'string', nullable: true, maxLength: 100, example: 'Chief People Officer' } } } } },
        },
        responses: {
          201: { description: 'Granted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { userId: { type: 'string' }, capability: { type: 'string' }, title: { type: 'string', nullable: true } } } } } } } },
          400: { description: 'Validation failed, or the user has exited' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Only an admin can grant capabilities' },
          404: { description: 'User not found in this organisation' },
        },
      },
    },

    '/cxo/capabilities/revoke': {
      post: {
        tags: ['CXO Connect'],
        summary: 'Revoke the LEADERSHIP capability',
        description: 'SUPER_ADMIN / ADMIN only. Takes effect on the next request - capabilities are re-read from the database on every authenticated call, not carried in the JWT.',
        operationId: 'revokeLeadershipCapability',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' }, capability: { type: 'string', enum: ['LEADERSHIP'], default: 'LEADERSHIP' } } } } } },
        responses: {
          200: { description: 'Revoked', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { userId: { type: 'string' }, capability: { type: 'string' } } } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Only an admin can revoke capabilities' },
          404: { description: 'That capability is not granted to this user' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // CHAT — 1:1 direct messaging
    // ═══════════════════════════════════════════════════════════════════════════
    '/messages': {
      get: {
        tags: ['Chat'],
        summary: 'Fetch a conversation',
        description:
          'Returns the message history with one peer, oldest-first, excluding anything the caller deleted for themselves. ' +
          'Served from MongoDB, falling back to PostgreSQL when Mongo is unreachable — `source` says which answered. ' +
          'As a side effect, any of the peer\'s messages still marked SENT are moved to DELIVERED.',
        operationId: 'getChatMessages',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [
          { name: 'peerId', in: 'query', required: true, schema: { type: 'string', maxLength: 100 }, description: 'The other participant. Must be an active user in the caller tenant.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 }, description: 'Newest N messages.' },
          { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Cursor for older pages: return messages created strictly before this timestamp.' },
        ],
        responses: {
          200: {
            description: 'Conversation history',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    conversationId: { type: 'string' },
                    source: { type: 'string', enum: ['mongodb', 'postgres'], description: 'Which store served this read' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { description: 'Recipient not found in this organisation' },
        },
      },
      post: {
        tags: ['Chat'],
        summary: 'Send a message (REST fallback)',
        description:
          'Persists to PostgreSQL, publishes a Kafka event keyed by `conversationId`, and the consumer projects it into MongoDB and pushes it to both participants. ' +
          'Clients normally send over Socket.IO (`chat:send`); this endpoint exists for when the socket is unavailable. ' +
          'The sender is always the authenticated user — a `senderId` in the body is ignored.',
        operationId: 'sendChatMessage',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendChatMessageRequest' } } } },
        responses: {
          201: {
            description: 'Message stored and dispatched',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/ChatMessage' } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { description: 'Recipient not found in this organisation' },
        },
      },
    },

    '/messages/conversations': {
      get: {
        tags: ['Chat'],
        summary: 'Inbox list',
        description:
          'Every conversation the caller takes part in, newest activity first, each resolved to the peer profile with the last message and an unread count. Backs the Messages page.',
        operationId: 'listChatConversations',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'Conversation list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    source: { type: 'string', enum: ['mongodb', 'postgres'] },
                    conversations: { type: 'array', items: { $ref: '#/components/schemas/ChatConversationSummary' } },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/messages/unread': {
      get: {
        tags: ['Chat'],
        summary: 'Unread counts per conversation',
        description: 'Lightweight counts for badges, without loading any message bodies.',
        operationId: 'getChatUnreadCounts',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        responses: {
          200: {
            description: 'Unread counts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    source: { type: 'string', enum: ['mongodb', 'postgres'] },
                    conversations: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          conversationId: { type: 'string' },
                          unread: { type: 'integer', example: 3 },
                          lastAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/messages/read': {
      post: {
        tags: ['Chat'],
        summary: 'Mark a conversation read',
        description: 'Marks every message from the peer as READ and emits `chat:conversation_read` so the sender sees the receipt.',
        operationId: 'markChatConversationRead',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PeerIdRequest' } } } },
        responses: {
          200: {
            description: 'Marked read',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, conversationId: { type: 'string' }, read: { type: 'integer', description: 'How many messages changed state' } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { description: 'Recipient not found in this organisation' },
        },
      },
    },

    '/messages/clear': {
      delete: {
        tags: ['Chat'],
        summary: 'Clear one conversation for yourself',
        description:
          'Hides every message in this conversation from the caller only — the peer keeps their copy and no rows are destroyed. ' +
          'There is deliberately no endpoint that wipes messages globally. `peerId` may be sent in the body or the query string.',
        operationId: 'clearChatConversation',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [
          { name: 'peerId', in: 'query', required: false, schema: { type: 'string', maxLength: 100 }, description: 'Alternative to sending peerId in the body.' },
        ],
        requestBody: { required: false, content: { 'application/json': { schema: { $ref: '#/components/schemas/PeerIdRequest' } } } },
        responses: {
          200: {
            description: 'Conversation cleared for the caller',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, conversationId: { type: 'string' }, cleared: { type: 'integer', description: 'Messages hidden' } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { description: 'Recipient not found in this organisation' },
        },
      },
    },

    '/messages/{id}/me': {
      delete: {
        tags: ['Chat'],
        summary: 'Delete a message for yourself',
        description: 'Hides one message from the caller only. Allowed for either participant.',
        operationId: 'deleteChatMessageForMe',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', maxLength: 100 } }],
        responses: {
          200: {
            description: 'Hidden for the caller',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { messageId: { type: 'string' } } } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Not a participant in this conversation' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/messages/{id}/everyone': {
      delete: {
        tags: ['Chat'],
        summary: 'Retract a message for everyone',
        description:
          'Replaces the text with a tombstone and strips any attachment for both participants. **Only the original sender may do this** — a recipient attempting it gets 403.',
        operationId: 'deleteChatMessageForEveryone',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', maxLength: 100 } }],
        responses: {
          200: {
            description: 'Retracted for both sides',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { messageId: { type: 'string' } } } } } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Only the sender can delete a message for everyone' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/media/upload': {
      post: {
        tags: ['Chat'],
        summary: 'Upload chat media',
        description:
          'Authenticated upload for chat attachments. Max 50MB; images, video, PDF and plain text only. Returns the URL to pass as `mediaUrl` when sending.',
        operationId: 'uploadChatMedia',
        security: [{ bearerAuth: [] }, { userCookie: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
            },
          },
        },
        responses: {
          200: {
            description: 'File stored',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { url: { type: 'string' }, fileName: { type: 'string' }, fileSize: { type: 'integer' }, mediaType: { type: 'string' } } } } } } },
          },
          400: { description: 'No file, unsupported type, or over the size limit' },
          401: { $ref: '#/components/responses/Unauthorized' },
          429: { description: 'Upload rate limit exceeded' },
        },
      },
    },

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
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Case-insensitive match on department name or description' },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Page number — only applied when `limit` is also supplied' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 }, description: 'Page size. Optional and with NO default: omit it to get every matching department, which is what the department dropdowns rely on. Supplying it switches the response to a single page.' },
        ],
        responses: {
          200: {
            description: 'List of departments (plus pagination metadata; when `limit` is omitted this is the complete list and totalPages is 1)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    departments: { type: 'array', items: { $ref: '#/components/schemas/Department' } },
                    pagination: {
                      type: 'object',
                      properties: {
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        total: { type: 'integer' },
                        totalPages: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/ValidationError' },
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
        description: 'PLATFORM_OWNER only. Returns company registration pipelines with status filtering and a count per stage. The richer onboarding queue, with age in stage and notification failures, is GET /platform/registrations.',
        operationId: 'listAdminRegistrations',
        security: [{ bearerAuth: [] }],
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
        description: 'PLATFORM_OWNER only. Returns an explicit field selection — notably NOT the signatory passwordHash, which a bare include had been returning to the browser.',
        operationId: 'getAdminRegistrationById',
        security: [{ bearerAuth: [] }],
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
      patch: {
        tags: ['Company Hub'],
        operationId: 'updateGalleryComment',
        summary: 'Edit a gallery comment',
        description: 'The comment author, or a privileged role (HR, CMD, ADMIN, SUPER_ADMIN) — exactly the same rule as DELETE. Sets `editedAt`, which stays null on a comment that has never been edited so the UI can show an "(edited)" marker accurately. An edit that does not change the text is a no-op and does not set `editedAt`. Propagates to the Mongo read model via Kafka, with a direct write as fallback, and broadcasts `gallery_comment_updated` over Socket.IO.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['text'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } },
        } } } },
        responses: {
          200: { description: 'Updated comment', content: { 'application/json': { schema: { type: 'object', properties: { comment: {
            type: 'object',
            properties: {
              id: { type: 'string' }, postId: { type: 'string' },
              author: { type: 'string' }, authorId: { type: 'string' },
              text: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              editedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          } } } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Not the author and not a privileged role' },
          404: { description: 'Comment not found in this tenant' },
        },
      },
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

    '/platform/tenants/{id}/suspend': {
      post: {
        tags: ['Platform'],
        operationId: 'suspendTenant',
        summary: 'Suspend a customer company',
        description: 'PLATFORM_OWNER only. Freezes a tenant: its users are refused at login AND on every subsequent request with an existing token, receiving code TENANT_SUSPENDED rather than a generic 401. The change and its audit row are written in one transaction. The platform tenant itself can never be suspended.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['reason'],
          properties: { reason: { type: 'string', minLength: 5, maxLength: 500, description: 'Required — recorded on the audit row.' } },
        } } } },
        responses: {
          200: { description: 'Suspended', content: { 'application/json': { schema: { type: 'object', properties: { tenant: { type: 'object' } } } } } },
          400: { description: 'Validation failed, or the platform tenant was targeted' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Company not found' },
          409: { description: 'Already suspended' },
        },
      },
    },
    '/platform/tenants/{id}/restore': {
      post: {
        tags: ['Platform'],
        operationId: 'restoreTenant',
        summary: 'Restore a suspended company',
        description: 'PLATFORM_OWNER only. Returns the tenant to ACTIVE and clears suspendedAt/suspendedReason. Writes an audit row.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Restored', content: { 'application/json': { schema: { type: 'object', properties: { tenant: { type: 'object' } } } } } },
          403: { description: 'Not a platform owner' },
          404: { description: 'Company not found' },
          409: { description: 'Not currently suspended' },
        },
      },
    },
    // ═══════════════════════════════════════════════════════════════════════
    // BILLING
    // ═══════════════════════════════════════════════════════════════════════
    '/platform/packages': {
      get: {
        tags: ['Billing'],
        operationId: 'listPackages',
        summary: 'What you sell',
        description: 'PLATFORM_OWNER only. A package is a template — price per seat, seat count and term length — not a contract. Each row is quoted with GST at the configured rate, and reports how many terms have been sold from it.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 } },
        ],
        responses: {
          200: { description: 'Packages', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } } } } } },
          403: { description: 'Not a platform owner' },
        },
      },
      post: {
        tags: ['Billing'],
        operationId: 'createPackage',
        summary: 'Create a package',
        description: 'PLATFORM_OWNER only. `unitPrice` is PER SEAT, so lib/pricing.js is reused unchanged for every quote, invoice and renewal. A package with a billing interval needs a term length; ONE_TIME means perpetual and its term length is cleared. Audited.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name', 'seatCount', 'unitPrice'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120 },
            description: { type: 'string', maxLength: 2000, nullable: true },
            seatCount: { type: 'integer', minimum: 1, maximum: 100000 },
            interval: { type: 'string', enum: ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL'], default: 'ANNUAL' },
            termMonths: { type: 'integer', minimum: 1, maximum: 120, nullable: true },
            unitPrice: { type: 'number', exclusiveMinimum: 0 },
            sortOrder: { type: 'integer', minimum: 0 },
          },
        } } } },
        responses: {
          201: { description: 'Created' },
          400: { description: 'Validation failed, or a recurring interval carried no term length' },
          403: { description: 'Not a platform owner' },
        },
      },
    },
    '/platform/packages/{id}': {
      get: {
        tags: ['Billing'], operationId: 'getPackage', summary: 'One package',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Package' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' } },
      },
      patch: {
        tags: ['Billing'],
        operationId: 'updatePackage',
        summary: 'Edit a package',
        description: 'PLATFORM_OWNER only. Editing a package does NOT touch any subscription or invoice already sold from it — those carry their own snapshot of name, seats and price. The response reports `existingTerms` and a note saying so, because "I changed the price" and "I changed what my customers pay" are different things. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { package: { type: 'object' }, existingTerms: { type: 'integer' }, note: { type: 'string', nullable: true } } } } } },
          400: { description: 'Validation failed' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Billing'],
        operationId: 'deletePackage',
        summary: 'Delete a package permanently',
        description: 'PLATFORM_OWNER only. Refused with 409 (PACKAGE_IN_USE) once anything has been sold from it: Subscription.packageId is an optional relation, so deleting would silently null the link on real contracts. A sold package is retired via PATCH { active: false } instead. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Deleted' }, 403: { description: 'Not a platform owner' },
          404: { description: 'Not found' }, 409: { description: 'Already sold — retire it instead' },
        },
      },
    },

    '/platform/subscriptions': {
      get: {
        tags: ['Billing'],
        operationId: 'listSubscriptions',
        summary: 'The terms companies are on',
        description: 'PLATFORM_OWNER only. `expiringInDays` is the renewal queue, ordered soonest-first. Perpetual terms have no end date and are deliberately excluded from it — they were bought outright and never renew.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'state', in: 'query', schema: { type: 'string', enum: ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'] } },
          { name: 'tenantId', in: 'query', schema: { type: 'string' } },
          { name: 'expiringInDays', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365 }, description: 'Beyond a year is refused rather than clamped — a queue reaching further is not a queue.' },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: { 200: { description: 'Terms' }, 400: { description: 'Validation failed' }, 403: { description: 'Not a platform owner' } },
      },
    },
    '/platform/subscriptions/{id}': {
      get: {
        tags: ['Billing'],
        operationId: 'getSubscription',
        summary: 'One term, with its renewal chain and invoices',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Term' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' } },
      },
    },
    '/platform/tenants/{id}/subscription': {
      post: {
        tags: ['Billing'],
        operationId: 'startSubscription',
        summary: 'Sell a company a term',
        description: 'PLATFORM_OWNER only. Copies the package\'s name, seats and price onto the subscription so the sale survives the package being renamed, repriced or retired. This is the one place billing reaches into the product: it sets Tenant.licenseLimit from the seats sold (which license.service.js then enforces) and mirrors the end date onto Tenant.planEndsAt. Refused if a live term already exists, if the seats are below the company\'s active headcount, or for the platform tenant. Raises and issues an invoice unless createInvoice is false. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['packageId'],
          properties: {
            packageId: { type: 'string' },
            startsAt: { type: 'string', format: 'date-time' },
            seatCount: { type: 'integer', nullable: true, description: 'Overrides the package for a negotiated deal.' },
            unitPrice: { type: 'number', nullable: true },
            couponCode: { type: 'string', nullable: true },
            createInvoice: { type: 'boolean', default: true },
          },
        } } } },
        responses: {
          201: { description: 'Term sold' },
          400: { description: 'Validation failed, or the platform tenant was targeted (PLATFORM_TENANT)' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Company or package not found' },
          409: { description: 'A live term already exists (SUBSCRIPTION_EXISTS), the package is retired, or the seats are below headcount (SEATS_BELOW_HEADCOUNT)' },
        },
      },
    },
    '/platform/subscriptions/{id}/renew': {
      post: {
        tags: ['Billing'],
        operationId: 'renewSubscription',
        summary: 'Renew a term',
        description: 'PLATFORM_OWNER only. Creates a NEW subscription linked by renewedFromId and leaves the old row completely untouched — the chain IS the history. renewedFromId is unique, so a term renews exactly once (409 ALREADY_RENEWED otherwise). The new term starts the day the old one ends, so there is no gap; a renewal booked ahead stays PENDING and does not cut the current term short. Renewing onto a different package takes that package\'s seats. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          packageId: { type: 'string', nullable: true }, seatCount: { type: 'integer', nullable: true },
          unitPrice: { type: 'number', nullable: true }, couponCode: { type: 'string', nullable: true },
          startsAt: { type: 'string', format: 'date-time', nullable: true }, createInvoice: { type: 'boolean', default: true },
        } } } } },
        responses: {
          201: { description: 'Renewed' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Already renewed, cancelled, or the seats are below headcount' },
        },
      },
    },
    '/platform/subscriptions/{id}/cancel': {
      post: {
        tags: ['Billing'],
        operationId: 'cancelSubscription',
        summary: 'Cancel a term',
        description: 'PLATFORM_OWNER only. By default the term runs to its end date — a customer who has paid for the year keeps the year — and `immediate: true` ends it today, which the operator must choose explicitly. Cancelling does NOT suspend the company or remove its users: access is a lifecycle decision and lives on the company page. A reason is always required. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['reason'],
          properties: { reason: { type: 'string', minLength: 5, maxLength: 500 }, immediate: { type: 'boolean', default: false } },
        } } } },
        responses: {
          200: { description: 'Cancelled' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' }, 409: { description: 'Already cancelled' },
        },
      },
    },

    '/platform/invoices': {
      get: {
        tags: ['Billing'],
        operationId: 'listInvoices',
        summary: 'Invoices',
        description: 'PLATFORM_OWNER only. Totals cover the whole filtered set rather than the current page, and exclude VOID invoices — a page total that disagrees with the filter is worse than no total.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'state', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] } },
          { name: 'tenantId', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: { 200: { description: 'Invoices with summary totals' }, 400: { description: 'Validation failed' }, 403: { description: 'Not a platform owner' } },
      },
      post: {
        tags: ['Billing'],
        operationId: 'createInvoice',
        summary: 'Raise a draft invoice',
        description: 'PLATFORM_OWNER only. Priced ONCE here through computePricing() and stored; nothing downstream recomputes, so repricing a package tomorrow cannot move an invoice raised today. Bill-to name, GSTIN and email are snapshot for the same reason. No invoice number is allocated until the invoice is issued, so an abandoned draft leaves no gap in the GST series. Audited.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['tenantId', 'quantity', 'unitPrice'],
          properties: {
            tenantId: { type: 'string' }, subscriptionId: { type: 'string', nullable: true },
            quantity: { type: 'integer', minimum: 1 }, unitPrice: { type: 'number', exclusiveMinimum: 0 },
            couponCode: { type: 'string', nullable: true }, dueAt: { type: 'string', format: 'date-time', nullable: true },
            notes: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          201: { description: 'Draft created' },
          400: { description: 'Validation failed, an invalid coupon (COUPON_INVALID), the platform tenant (PLATFORM_TENANT), or no billing contact (NO_BILLING_CONTACT)' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Company not found' },
        },
      },
    },
    '/platform/invoices/{id}': {
      get: {
        tags: ['Billing'],
        operationId: 'getInvoice',
        summary: 'One invoice, with its payments and refunds',
        description: 'PLATFORM_OWNER only. Each payment and refund names who recorded it, resolved by id rather than by relation so the record outlives the operator\'s account. Rows written by the migration report "Migrated from signup" rather than being attributed to a person.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Invoice' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' } },
      },
    },
    '/platform/invoices/{id}/issue': {
      post: {
        tags: ['Billing'],
        operationId: 'issueInvoice',
        summary: 'Issue a draft and allocate its number',
        description: 'PLATFORM_OWNER only. Allocates UEIBI/YYYY-YY/NNNN, sequential per Indian financial year and global rather than per tenant, because a GST series must be unbroken per issuer. The read-then-write that picks the next number can lose a race, so the unique index guarantees it and the call retries on P2002. Issuing is also when a coupon is recorded as redeemed — a draft that is never issued must not consume a limited coupon. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Issued' }, 403: { description: 'Not a platform owner' },
          404: { description: 'Not found' }, 409: { description: 'Already issued, or void' },
        },
      },
    },
    '/platform/invoices/{id}/void': {
      post: {
        tags: ['Billing'],
        operationId: 'voidInvoice',
        summary: 'Void an invoice raised in error',
        description: 'PLATFORM_OWNER only. Refused with 409 (INVOICE_HAS_PAYMENTS) once any payment exists: money that arrived is refunded, not voided, and voiding a paid invoice would quietly remove a payment from the revenue figures. The number is NOT released — a voided invoice keeps it and is marked VOID, which is what an auditor expects to find in the series. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 5, maxLength: 500 } } } } } },
        responses: {
          200: { description: 'Voided' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Already void, or payments exist' },
        },
      },
    },
    '/platform/invoices/{id}/send': {
      post: {
        tags: ['Billing'],
        operationId: 'sendInvoice',
        summary: 'Email an invoice to its billing contact',
        description: 'PLATFORM_OWNER only. Reuses sendMail + renderEmailWrapper, so delivery lands in NotificationLog like every other email and a bounce is visible. Refused for a draft or a voided invoice. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Send attempted; deliveryStatus says what happened' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Still a draft, or void' },
        },
      },
    },
    '/platform/invoices/{id}/payments': {
      post: {
        tags: ['Billing'],
        operationId: 'recordPayment',
        summary: 'Record money that has arrived',
        description: 'PLATFORM_OWNER only. Nothing is CHARGED: the platform is a book of record, not a till. An operator writes down a bank transfer, cheque or UPI payment that has already landed. amountPaid is re-summed from the invoice\'s payment rows in the same transaction, so the summary cannot drift from the detail, and the invoice state follows the money rather than being set by hand. Overpayment beyond the outstanding balance is refused (OVERPAYMENT). A reference is required for bank, UPI, cheque and online payments — without one a payment cannot be reconciled against a statement. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['amount', 'method'],
          properties: {
            amount: { type: 'number', exclusiveMinimum: 0 },
            method: { type: 'string', enum: ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'ONLINE', 'ADJUSTMENT'] },
            reference: { type: 'string', nullable: true },
            receivedAt: { type: 'string', format: 'date-time' },
            notes: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          201: { description: 'Recorded' }, 400: { description: 'Validation failed, or a reference was required and missing' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Still a draft, void, or more than is outstanding (OVERPAYMENT)' },
        },
      },
    },
    '/platform/invoices/{id}/refunds': {
      post: {
        tags: ['Billing'],
        operationId: 'recordRefund',
        summary: 'Record money returned',
        description: 'PLATFORM_OWNER only. RECORDED, not executed — there is no gateway to call, so this is the note that a refund was sent and the money must be transferred separately. Capped at what has actually been received net of earlier refunds (OVERREFUND), because refunding more than was paid is not a refund. A reason is always required. The invoice stays PAID: a refund is its own event, reflected in the net figure rather than by rewriting the payment. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['amount', 'method', 'reason'],
          properties: {
            amount: { type: 'number', exclusiveMinimum: 0 },
            method: { type: 'string', enum: ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'ONLINE', 'ADJUSTMENT'] },
            reason: { type: 'string', minLength: 5, maxLength: 2000 },
            reference: { type: 'string', nullable: true },
            paymentId: { type: 'string', nullable: true },
            refundedAt: { type: 'string', format: 'date-time' },
          },
        } } } },
        responses: {
          201: { description: 'Recorded' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Nothing received, or more than can be refunded (OVERREFUND)' },
        },
      },
    },

    '/platform/revenue': {
      get: {
        tags: ['Billing'],
        operationId: 'getRevenue',
        summary: 'Invoiced, collected and outstanding',
        description: 'PLATFORM_OWNER only. Every figure comes from Invoice, Payment and Refund rows; VOID invoices are excluded throughout. Deliberately NOT reported: MRR — nothing recurs automatically, so a monthly recurring figure would be invented — and churn or LTV, which need a longer history than exists. `contracts.annualisedContractValue` is what live FIXED-TERM contracts are worth over a year, computed from what each was actually invoiced rather than from a package price that may since have moved; perpetual licences are excluded. `unverified` separates out the LEGACY payments carried forward from the pre-billing flow, which are counted but unproven.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'months', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 36, default: 12 }, description: 'Length of the monthly series, inclusive of the current month.' }],
        responses: { 200: { description: 'Revenue' }, 400: { description: 'Validation failed' }, 403: { description: 'Not a platform owner' } },
      },
    },
    '/platform/coupons/performance': {
      get: {
        tags: ['Billing'],
        operationId: 'getCouponPerformance',
        summary: 'What each coupon actually cost and earned',
        description: 'PLATFORM_OWNER only. Coupon.timesUsed is a counter and cannot answer "how much discount did this give away" or "which companies used it"; CouponRedemption rows can. `counterDrift` is surfaced rather than hidden — timesUsed predates redemption rows, so the two legitimately disagree on coupons used before this existed.',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Per-coupon performance' }, 403: { description: 'Not a platform owner' } },
      },
    },
    '/platform/invoice-settings': {
      get: {
        tags: ['Billing'],
        operationId: 'getInvoiceSettings',
        summary: 'Invoicing configuration',
        description: "PLATFORM_OWNER only. Numbering, currency, tax defaults, issuer identity and the uploaded seal/signature. These used to live in .env, so changing a tax rate or a registered address needed a deploy. Values are read with the env vars as fallback, and `settings.isDefault` is true when nothing has been saved yet. The `numbering` block reports what the next invoice number will ACTUALLY be, computed by the same code that allocates it, so the screen cannot disagree with reality.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Settings and numbering state', content: { 'application/json': { schema: { type: 'object', properties: {
            settings: { type: 'object' },
            numbering: { type: 'object', properties: {
              nextInvoiceNumber: { type: 'string' },
              prefix: { type: 'string' },
              highestIssued: { type: 'string', nullable: true },
              issuedCount: { type: 'integer' },
              floorNote: { type: 'string' },
            } },
          } } } } },
          403: { description: 'Not a platform owner' },
        },
      },
      put: {
        tags: ['Billing'],
        operationId: 'updateInvoiceSettings',
        summary: 'Save invoicing configuration',
        description: "PLATFORM_OWNER only. `nextNumber` is a FLOOR, never an override: allocation takes the higher of it and one past the highest already issued, so a value below what exists cannot reissue an invoice number. Changing the prefix or the financial-year flag starts a visibly different series and the response says so in `notes`; a tax change likewise notes that issued invoices keep the rate they were raised at, because their money is a snapshot. Signature and seal URLs must be an uploaded /uploads/ path or https — javascript: and data: are refused. Audited.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['numberPrefix', 'nextNumber', 'currencyCode', 'currencySymbol', 'taxName', 'taxPercent', 'issuerName'],
          properties: {
            numberPrefix: { type: 'string', maxLength: 20, description: 'Letters, numbers and hyphens only — it appears in a tax invoice number.' },
            includeFinancialYear: { type: 'boolean', default: true },
            nextNumber: { type: 'integer', minimum: 1, description: 'A floor, not an override.' },
            currencyCode: { type: 'string', minLength: 3, maxLength: 3 },
            currencySymbol: { type: 'string', maxLength: 4 },
            symbolPosition: { type: 'string', enum: ['BEFORE', 'AFTER'] },
            dateFormat: { type: 'string', enum: ['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MMM DD, YYYY'] },
            defaultPaymentTerms: { type: 'string', nullable: true },
            taxName: { type: 'string', maxLength: 30 },
            taxPercent: { type: 'number', minimum: 0, maximum: 100 },
            issuerName: { type: 'string', maxLength: 160 },
            issuerGstin: { type: 'string', nullable: true },
            issuerAddress: { type: 'string', nullable: true },
            signatureUrl: { type: 'string', nullable: true },
            sealUrl: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          200: { description: 'Saved, with any consequences reported in notes' },
          400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' },
        },
      },
    },
    // ═══════════════════════════════════════════════════════════════════════
    // LEGAL DOCUMENTS
    // ═══════════════════════════════════════════════════════════════════════
    '/legal': {
      get: {
        tags: ['Legal'],
        operationId: 'listPublicLegalDocuments',
        summary: 'Published legal documents (public)',
        description: 'Deliberately UNAUTHENTICATED. Somebody deciding whether to sign up has no account yet, and terms they cannot read before agreeing are not terms. Only documents with a published version appear; a draft is never reachable.',
        responses: { 200: { description: 'Published documents' } },
      },
    },
    '/legal/{slug}': {
      get: {
        tags: ['Legal'],
        operationId: 'getPublicLegalDocument',
        summary: 'A published legal document (public)',
        description: 'Unauthenticated. Returns the highest-numbered PUBLISHED version. A document that exists but has never been published returns 404 with code NOT_PUBLISHED, which is more useful than implying the URL is wrong. The HTML was sanitised when it was stored.',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'The document' },
          404: { description: 'Not found, or drafted but never published (NOT_PUBLISHED)' },
        },
      },
    },
    '/platform/legal': {
      get: {
        tags: ['Legal'],
        operationId: 'listLegalDocuments',
        summary: 'All legal documents, with draft and acceptance counts',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Documents' }, 403: { description: 'Not a platform owner' } },
      },
      post: {
        tags: ['Legal'],
        operationId: 'createLegalDocument',
        summary: 'Create a legal document',
        description: 'PLATFORM_OWNER only. The slug is the primary key AND the public URL, so it is lowercase and hyphenated and cannot be changed later. Audited.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['slug', 'title'],
          properties: {
            slug: { type: 'string', description: 'Lowercase letters, numbers and hyphens.' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          201: { description: 'Created' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 409: { description: 'Slug already taken (SLUG_TAKEN)' },
        },
      },
    },
    '/platform/legal/{slug}': {
      get: {
        tags: ['Legal'],
        operationId: 'getLegalDocument',
        summary: 'A document and every version of it',
        description: 'PLATFORM_OWNER only. Each version reports its author, how many companies accepted it, and whether it is immutable.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Document and versions' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' } },
      },
      patch: {
        tags: ['Legal'],
        operationId: 'updateLegalDocument',
        summary: 'Rename a document',
        description: 'PLATFORM_OWNER only. Title and description only — the slug is the public URL that links and past agreements point at, so it never changes. The CONTENT lives on versions. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' } },
      },
      delete: {
        tags: ['Legal'],
        operationId: 'deleteLegalDocument',
        summary: 'Delete a document and all its versions',
        description: 'PLATFORM_OWNER only. Refused with 409 (DOCUMENT_ACCEPTED) the moment anybody has accepted any version: that acceptance is the evidence of what a company agreed to, and deleting the document destroys it. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Deleted' }, 403: { description: 'Not a platform owner' },
          404: { description: 'Not found' }, 409: { description: 'Accepted by a company (DOCUMENT_ACCEPTED)' },
        },
      },
    },
    '/platform/legal/{slug}/acceptances': {
      get: {
        tags: ['Legal'],
        operationId: 'listLegalAcceptances',
        summary: 'Who accepted which version, and when',
        description: 'PLATFORM_OWNER only. Each row carries the version, timestamp and IP address — the evidence that makes the agreement provable.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }],
        responses: { 200: { description: 'Acceptances' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' } },
      },
    },
    '/platform/legal/{slug}/versions': {
      post: {
        tags: ['Legal'],
        operationId: 'createLegalVersion',
        summary: 'Start a new draft version',
        description: 'PLATFORM_OWNER only. Only one draft may be open at a time (409 DRAFT_EXISTS), so the operator is never editing two competing futures of the same document. The HTML is sanitised on write against a narrow allowlist — no script, style, iframe, event handlers, javascript: or data: URLs.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['title', 'bodyHtml'],
          properties: { title: { type: 'string' }, bodyHtml: { type: 'string' }, changeNote: { type: 'string', nullable: true } },
        } } } },
        responses: {
          201: { description: 'Draft created' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Document not found' },
          409: { description: 'A draft is already open (DRAFT_EXISTS)' },
        },
      },
    },
    '/platform/legal/{slug}/versions/{versionId}': {
      patch: {
        tags: ['Legal'],
        operationId: 'updateLegalVersion',
        summary: 'Edit a draft version',
        description: 'PLATFORM_OWNER only. Refused once published (409 VERSION_PUBLISHED). That refusal is the point of versioning: if a published version could be edited, the record of what a customer agreed to would change underneath them.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          200: { description: 'Updated' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Published and immutable (VERSION_PUBLISHED)' },
        },
      },
      delete: {
        tags: ['Legal'],
        operationId: 'deleteLegalVersion',
        summary: 'Discard a draft version',
        description: 'PLATFORM_OWNER only. A published version is evidence and is never deletable, whether or not anybody has accepted it yet (409 VERSION_PUBLISHED).',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Discarded' }, 403: { description: 'Not a platform owner' },
          404: { description: 'Not found' }, 409: { description: 'Published (VERSION_PUBLISHED)' },
        },
      },
    },
    '/platform/legal/{slug}/versions/{versionId}/publish': {
      post: {
        tags: ['Legal'],
        operationId: 'publishLegalVersion',
        summary: 'Make a version the live one',
        description: 'PLATFORM_OWNER only. Earlier versions stay exactly as they were and remain on record for everyone who accepted them; only new acceptances use the new one. A nearly empty version is refused (400 BODY_TOO_SHORT) so publishing cannot silently replace live terms with a blank page. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Published' }, 400: { description: 'Body too short (BODY_TOO_SHORT)' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Already published' },
        },
      },
    },

    // ── Invoice template detail and versions ────────────────────────────────
    '/platform/invoice-templates/{slug}': {
      get: {
        tags: ['Billing'],
        operationId: 'getInvoiceTemplate',
        summary: 'A template and every version of it',
        description: 'PLATFORM_OWNER only. Each version reports its author, how many invoices were printed with it, whether it is immutable, and `settings` — present when it was built in the designer, null when it was authored as raw HTML.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Template and versions' }, 403: { description: 'Not a platform owner' }, 404: { description: 'Not found' } },
      },
      patch: {
        tags: ['Billing'],
        operationId: 'updateInvoiceTemplate',
        summary: 'Rename a template, or make it the default',
        description: 'PLATFORM_OWNER only. Setting `isDefault` stands the previous default down in the same transaction, so exactly one template is ever the default. A template with no published version cannot be the default (409 TEMPLATE_NOT_PUBLISHED) — new invoices would silently fall back to the built-in layout while the console claimed otherwise. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          title: { type: 'string' }, description: { type: 'string', nullable: true }, isDefault: { type: 'boolean' },
        } } } } },
        responses: {
          200: { description: 'Updated' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Not published, so it cannot be the default (TEMPLATE_NOT_PUBLISHED)' },
        },
      },
      delete: {
        tags: ['Billing'],
        operationId: 'deleteInvoiceTemplate',
        summary: 'Delete a template and all its versions',
        description: 'PLATFORM_OWNER only. Refused once any invoice has been printed with it (409 TEMPLATE_IN_USE), because a reprint must reproduce the customer\'s copy and deleting the template would change how those look. The current default is also refused while other templates exist (409 TEMPLATE_IS_DEFAULT). Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Deleted' }, 403: { description: 'Not a platform owner' },
          404: { description: 'Not found' }, 409: { description: 'In use, or is the default' },
        },
      },
    },
    '/platform/invoice-templates/{slug}/versions': {
      post: {
        tags: ['Billing'],
        operationId: 'createInvoiceTemplateVersion',
        summary: 'Start a new draft version',
        description: 'PLATFORM_OWNER only. Send `settings` and the markup is generated from them; a raw `bodyHtml` is still accepted so templates authored before the designer keep working. Locked sections are refused (400 LOCKED_SECTION_DISABLED) and forced on in the generator regardless. Only one draft may be open at a time (409 DRAFT_EXISTS).',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['title'],
          properties: {
            title: { type: 'string' },
            settings: { type: 'object', description: 'Designer settings. Preferred over bodyHtml.' },
            bodyHtml: { type: 'string', description: 'Raw Mustache template, for pre-designer templates.' },
            changeNote: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          201: { description: 'Draft created' },
          400: { description: 'Validation failed, or a legally required section was switched off (LOCKED_SECTION_DISABLED)' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Template not found' },
          409: { description: 'A draft is already open (DRAFT_EXISTS)' },
        },
      },
    },
    '/platform/invoice-templates/{slug}/versions/{versionId}': {
      patch: {
        tags: ['Billing'],
        operationId: 'updateInvoiceTemplateVersion',
        summary: 'Edit a draft version',
        description: 'PLATFORM_OWNER only. Refused once published (409 VERSION_PUBLISHED) — an invoice already sent to a customer must keep looking the way their copy looks.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          200: { description: 'Updated' },
          400: { description: 'Validation failed, or a locked section was switched off (LOCKED_SECTION_DISABLED)' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Published and immutable (VERSION_PUBLISHED)' },
        },
      },
      delete: {
        tags: ['Billing'],
        operationId: 'deleteInvoiceTemplateVersion',
        summary: 'Discard a draft version',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Discarded' }, 403: { description: 'Not a platform owner' },
          404: { description: 'Not found' }, 409: { description: 'Published (VERSION_PUBLISHED)' },
        },
      },
    },
    '/platform/invoice-templates/{slug}/versions/{versionId}/publish': {
      post: {
        tags: ['Billing'],
        operationId: 'publishInvoiceTemplateVersion',
        summary: 'Make a template version live',
        description: 'PLATFORM_OWNER only. The compliance guard runs here: a template missing a field a GST invoice must legally carry is refused (400 MISSING_REQUIRED_TOKENS) naming each one and why it is needed, and a template that throws at render time is refused (400 TEMPLATE_INVALID) rather than being allowed to break every invoice. Invoices already printed with an earlier version keep printing that way. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Published' },
          400: { description: 'Missing required fields, or the template does not render' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Not found' },
          409: { description: 'Already published' },
        },
      },
    },
    '/platform/invoice-templates': {
      get: {
        tags: ['Billing'],
        operationId: 'listInvoiceTemplates',
        summary: 'Invoice templates',
        description: "PLATFORM_OWNER only. Each row reports its live and draft versions, whether it is the default that renders new invoices, and how many invoices were printed with it.",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Templates' }, 403: { description: 'Not a platform owner' } },
      },
      post: {
        tags: ['Billing'],
        operationId: 'createInvoiceTemplate',
        summary: 'Create an invoice template',
        description: "PLATFORM_OWNER only. The first template created becomes the default, because a system with templates and no default would silently keep using the built-in layout. Audited.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['slug', 'title'],
          properties: {
            slug: { type: 'string', description: 'Lowercase letters, numbers and hyphens.' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          201: { description: 'Created' }, 400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' }, 409: { description: 'Identifier already taken (SLUG_TAKEN)' },
        },
      },
    },
    '/platform/invoice-templates/tokens': {
      get: {
        tags: ['Billing'],
        operationId: 'getInvoiceTemplateVocabulary',
        summary: 'What the designer can switch, and what it cannot',
        description: "PLATFORM_OWNER only. Returns the designer's default settings, the sections that are LOCKED ON with the reason each is legally required, and the Mustache token reference for templates still authored as raw HTML.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Designer vocabulary', content: { 'application/json': { schema: { type: 'object', properties: {
            defaults: { type: 'object' },
            locked: { type: 'array', items: { type: 'object', properties: { section: { type: 'string' }, why: { type: 'string' } } } },
            groups: { type: 'array', items: { type: 'object' } },
            required: { type: 'array', items: { type: 'object' } },
          } } } } },
          403: { description: 'Not a platform owner' },
        },
      },
    },
    '/platform/invoice-templates/preview': {
      post: {
        tags: ['Billing'],
        operationId: 'previewInvoiceTemplate',
        summary: 'Render a template without saving it',
        description: "PLATFORM_OWNER only. Send `settings` (the designer) or `bodyHtml` (raw). With `invoiceId` it renders against that real invoice so the author sees their own data; without one it uses sample figures and says so via `usingSampleData`. Nothing is stored. A locked section switched off is refused with 400 LOCKED_SECTION_DISABLED and the `blocked` array naming each one.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          properties: {
            settings: { type: 'object', description: 'Designer settings. Preferred over bodyHtml.' },
            bodyHtml: { type: 'string' },
            css: { type: 'string', nullable: true },
            invoiceId: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          200: { description: 'Rendered HTML and CSS' },
          400: { description: 'Validation failed, or a locked section was switched off (LOCKED_SECTION_DISABLED)' },
          403: { description: 'Not a platform owner' }, 404: { description: 'Invoice not found' },
        },
      },
    },
    '/finance/registrations/{token}/create-order': {
      post: {
        tags: ['Registration'],
        operationId: 'createRazorpayOrder',
        summary: 'Open a Razorpay order for an online payment',
        description: "Authenticated by the emailed Finance action token in the path, not by a session. Returns 503 with code ONLINE_PAYMENT_UNAVAILABLE when RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are not configured — selling offline only is a supported configuration, not a fault, and the signup page hides the card option and offers cheque instead when it sees that. Direct ONLINE approval through /approve is refused precisely so payment cannot bypass this.",
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['licenseQuantity', 'gstin'],
          properties: {
            licenseQuantity: { type: 'integer', minimum: 1 },
            gstin: { type: 'string', minLength: 1 },
            couponCode: { type: 'string' },
          },
        } } } },
        responses: {
          200: { description: 'Order created', content: { 'application/json': { schema: { type: 'object', properties: {
            orderId: { type: 'string' }, amount: { type: 'integer', description: 'In paise.' },
            currency: { type: 'string' }, keyId: { type: 'string', description: 'Publishable key for checkout.' },
          } } } } },
          400: { description: 'Validation failed, or the coupon is invalid' },
          404: { description: 'Invalid link' },
          409: { description: 'The registration is not pending Finance review' },
          410: { description: 'The link has expired' },
          503: { description: 'Online payment is not configured (ONLINE_PAYMENT_UNAVAILABLE)' },
        },
      },
    },
    '/finance/registrations/{token}/verify-payment': {
      post: {
        tags: ['Registration'],
        operationId: 'verifyRazorpayPayment',
        summary: 'Verify a completed Razorpay payment and advance to HR',
        description: "Authenticated by the emailed Finance action token. Verifies the Razorpay signature server-side before anything is written — a client claiming success is never trusted. On success the registration moves to PENDING_HR_ACTIVATION, the coupon is committed, and the HR action link is issued and emailed. Returns 503 ONLINE_PAYMENT_UNAVAILABLE when the gateway is not configured.",
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['licenseQuantity', 'gstin', 'razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature'],
          properties: {
            licenseQuantity: { type: 'integer', minimum: 1 },
            gstin: { type: 'string' },
            couponCode: { type: 'string' },
            razorpay_order_id: { type: 'string' },
            razorpay_payment_id: { type: 'string' },
            razorpay_signature: { type: 'string' },
          },
        } } } },
        responses: {
          200: { description: 'Payment verified; registration advanced to HR activation' },
          400: { description: 'Validation failed, or the signature did not verify' },
          404: { description: 'Invalid link' },
          409: { description: 'The registration is not pending Finance review' },
          410: { description: 'The link has expired' },
          503: { description: 'Online payment is not configured (ONLINE_PAYMENT_UNAVAILABLE)' },
        },
      },
    },
    '/tasks/{id}/subtasks': {
      get: {
        tags: ['Tasks'],
        operationId: 'listSubTasks',
        summary: 'Checklist under a task',
        description: "A sub-task is a full record of a piece of work inside a task: title, description, assignee, planned dates and actual dates. It carries NO WEIGHT: ticking one NEVER changes the parent task's percentage or the goal's 100% weight total. `checklistPercent` in the response is for display only and is not written anywhere. Access is inherited from the parent task.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'The checklist and its counts', content: { 'application/json': { schema: { type: 'object', properties: {
              items: { type: 'array', items: { type: 'object', properties: {
                id: { type: 'string' }, taskId: { type: 'string' }, title: { type: 'string' },
                description: { type: 'string', nullable: true },
                isDone: { type: 'boolean' }, position: { type: 'integer' },
                assigneeId: { type: 'string', nullable: true },
                startDate: { type: 'string', format: 'date-time', nullable: true },
                dueDate: { type: 'string', format: 'date-time', nullable: true },
                actualStartDate: { type: 'string', format: 'date-time', nullable: true },
                actualCompletionDate: { type: 'string', format: 'date-time', nullable: true, description: 'Stamped when the sub-task is ticked, unless one was supplied.' },
                completedById: { type: 'string', nullable: true },
                timing: { type: 'object', nullable: true, description: 'Delay and overdue figures, from the same helper tasks use.' },
                assignee: { type: 'object', nullable: true },
                completedBy: { type: 'object', nullable: true },
              } } },
              total: { type: 'integer' }, done: { type: 'integer' },
              checklistPercent: { type: 'integer', description: 'Display only. Never written to the task.' },
            } } } } },
          403: { description: 'You cannot act on this task' },
          404: { description: 'Task not found' },
        },
      },
      post: {
        tags: ['Tasks'],
        operationId: 'createSubTask',
        summary: 'Add a checklist item',
        description: "A sub-task is a full record of a piece of work inside a task: title, description, assignee, planned dates and actual dates. It carries NO WEIGHT: ticking one NEVER changes the parent task's percentage or the goal's 100% weight total. `checklistPercent` in the response is for display only and is not written anywhere. `assigneeId` hands the piece to a specific colleague in the same tenant; null means whoever owns the parent task.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 300 },
            description: { type: 'string', maxLength: 5000, nullable: true },
            assigneeId: { type: 'string', nullable: true, description: 'Must pass the SAME role-hierarchy check as task assignment. Null means whoever owns the parent task.' },
            startDate: { type: 'string', format: 'date-time', nullable: true },
            dueDate: { type: 'string', format: 'date-time', nullable: true },
            actualStartDate: { type: 'string', format: 'date-time', nullable: true, description: 'May be back-dated, never set in the future.' },
            actualCompletionDate: { type: 'string', format: 'date-time', nullable: true, description: 'Never in the future, never before the actual start.' },
            isDone: { type: 'boolean' },
            position: { type: 'integer', minimum: 0, maximum: 9999 },
          },
        } } } },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: {
              items: { type: 'array', items: { type: 'object', properties: {
                id: { type: 'string' }, taskId: { type: 'string' }, title: { type: 'string' },
                description: { type: 'string', nullable: true },
                isDone: { type: 'boolean' }, position: { type: 'integer' },
                assigneeId: { type: 'string', nullable: true },
                startDate: { type: 'string', format: 'date-time', nullable: true },
                dueDate: { type: 'string', format: 'date-time', nullable: true },
                actualStartDate: { type: 'string', format: 'date-time', nullable: true },
                actualCompletionDate: { type: 'string', format: 'date-time', nullable: true, description: 'Stamped when the sub-task is ticked, unless one was supplied.' },
                completedById: { type: 'string', nullable: true },
                timing: { type: 'object', nullable: true, description: 'Delay and overdue figures, from the same helper tasks use.' },
                assignee: { type: 'object', nullable: true },
                completedBy: { type: 'object', nullable: true },
              } } },
              total: { type: 'integer' }, done: { type: 'integer' },
              checklistPercent: { type: 'integer', description: 'Display only. Never written to the task.' },
            } } } } },
          400: { description: 'Validation failed, or the assignee is not in your organisation' },
          403: { description: 'You cannot act on this task' },
        },
      },
    },
    '/tasks/{id}/subtasks-order': {
      patch: {
        tags: ['Tasks'],
        operationId: 'reorderSubTasks',
        summary: 'Reorder the checklist',
        description: "Every id supplied must already belong to this task; a stray one is rejected rather than silently ignored. A sub-task is a full record of a piece of work inside a task: title, description, assignee, planned dates and actual dates. It carries NO WEIGHT: ticking one NEVER changes the parent task's percentage or the goal's 100% weight total. `checklistPercent` in the response is for display only and is not written anywhere.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['order'],
          properties: { order: { type: 'array', maxItems: 200, items: { type: 'string' } } },
        } } } },
        responses: {
          200: { description: 'Reordered', content: { 'application/json': { schema: { type: 'object', properties: {
              items: { type: 'array', items: { type: 'object', properties: {
                id: { type: 'string' }, taskId: { type: 'string' }, title: { type: 'string' },
                description: { type: 'string', nullable: true },
                isDone: { type: 'boolean' }, position: { type: 'integer' },
                assigneeId: { type: 'string', nullable: true },
                startDate: { type: 'string', format: 'date-time', nullable: true },
                dueDate: { type: 'string', format: 'date-time', nullable: true },
                actualStartDate: { type: 'string', format: 'date-time', nullable: true },
                actualCompletionDate: { type: 'string', format: 'date-time', nullable: true, description: 'Stamped when the sub-task is ticked, unless one was supplied.' },
                completedById: { type: 'string', nullable: true },
                timing: { type: 'object', nullable: true, description: 'Delay and overdue figures, from the same helper tasks use.' },
                assignee: { type: 'object', nullable: true },
                completedBy: { type: 'object', nullable: true },
              } } },
              total: { type: 'integer' }, done: { type: 'integer' },
              checklistPercent: { type: 'integer', description: 'Display only. Never written to the task.' },
            } } } } },
          400: { description: 'An id does not belong to this task' },
          403: { description: 'You cannot act on this task' },
        },
      },
    },
    '/tasks/{id}/subtasks/{sid}': {
      patch: {
        tags: ['Tasks'],
        operationId: 'updateSubTask',
        summary: 'Tick, rename or reassign a checklist item',
        description: "Ticking records who completed it and when — that timestamp is the point of the feature. Un-ticking clears both, because an item that is open again was not completed. A sub-task is a full record of a piece of work inside a task: title, description, assignee, planned dates and actual dates. It carries NO WEIGHT: ticking one NEVER changes the parent task's percentage or the goal's 100% weight total. `checklistPercent` in the response is for display only and is not written anywhere.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'sid', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 300 },
            description: { type: 'string', maxLength: 5000, nullable: true },
            assigneeId: { type: 'string', nullable: true, description: 'Must pass the SAME role-hierarchy check as task assignment. Null means whoever owns the parent task.' },
            startDate: { type: 'string', format: 'date-time', nullable: true },
            dueDate: { type: 'string', format: 'date-time', nullable: true },
            actualStartDate: { type: 'string', format: 'date-time', nullable: true, description: 'May be back-dated, never set in the future.' },
            actualCompletionDate: { type: 'string', format: 'date-time', nullable: true, description: 'Never in the future, never before the actual start.' },
            isDone: { type: 'boolean' },
            position: { type: 'integer', minimum: 0, maximum: 9999 },
          },
        } } } },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: {
              items: { type: 'array', items: { type: 'object', properties: {
                id: { type: 'string' }, taskId: { type: 'string' }, title: { type: 'string' },
                description: { type: 'string', nullable: true },
                isDone: { type: 'boolean' }, position: { type: 'integer' },
                assigneeId: { type: 'string', nullable: true },
                startDate: { type: 'string', format: 'date-time', nullable: true },
                dueDate: { type: 'string', format: 'date-time', nullable: true },
                actualStartDate: { type: 'string', format: 'date-time', nullable: true },
                actualCompletionDate: { type: 'string', format: 'date-time', nullable: true, description: 'Stamped when the sub-task is ticked, unless one was supplied.' },
                completedById: { type: 'string', nullable: true },
                timing: { type: 'object', nullable: true, description: 'Delay and overdue figures, from the same helper tasks use.' },
                assignee: { type: 'object', nullable: true },
                completedBy: { type: 'object', nullable: true },
              } } },
              total: { type: 'integer' }, done: { type: 'integer' },
              checklistPercent: { type: 'integer', description: 'Display only. Never written to the task.' },
            } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'You cannot act on this task' },
          404: { description: 'Sub-task not found on this task' },
        },
      },
      delete: {
        tags: ['Tasks'],
        operationId: 'deleteSubTask',
        summary: 'Remove a checklist item',
        description: "A sub-task is a full record of a piece of work inside a task: title, description, assignee, planned dates and actual dates. It carries NO WEIGHT: ticking one NEVER changes the parent task's percentage or the goal's 100% weight total. `checklistPercent` in the response is for display only and is not written anywhere.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'sid', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Removed', content: { 'application/json': { schema: { type: 'object', properties: {
              items: { type: 'array', items: { type: 'object', properties: {
                id: { type: 'string' }, taskId: { type: 'string' }, title: { type: 'string' },
                description: { type: 'string', nullable: true },
                isDone: { type: 'boolean' }, position: { type: 'integer' },
                assigneeId: { type: 'string', nullable: true },
                startDate: { type: 'string', format: 'date-time', nullable: true },
                dueDate: { type: 'string', format: 'date-time', nullable: true },
                actualStartDate: { type: 'string', format: 'date-time', nullable: true },
                actualCompletionDate: { type: 'string', format: 'date-time', nullable: true, description: 'Stamped when the sub-task is ticked, unless one was supplied.' },
                completedById: { type: 'string', nullable: true },
                timing: { type: 'object', nullable: true, description: 'Delay and overdue figures, from the same helper tasks use.' },
                assignee: { type: 'object', nullable: true },
                completedBy: { type: 'object', nullable: true },
              } } },
              total: { type: 'integer' }, done: { type: 'integer' },
              checklistPercent: { type: 'integer', description: 'Display only. Never written to the task.' },
            } } } } },
          403: { description: 'You cannot act on this task' },
          404: { description: 'Sub-task not found on this task' },
        },
      },
    },
    '/platform/alerts': {
      get: {
        tags: ['Platform'],
        operationId: 'getPlatformAlerts',
        summary: 'What needs the operator\'s attention right now',
        description: 'PLATFORM_OWNER only. Computed on every request and never stored. Nothing in this product expires or escalates on its own — there is no scheduler — so an alert is a prompt to act, not a record that something happened, and there is nothing to dismiss: fix the underlying thing and it disappears. Covers companies over or at their seat limit, a seat limit of 0 (which blocks all creation rather than meaning unlimited), plans past or nearing their end date, companies with no active administrator, registrations stalled for 3 days or more, and emails that failed to send in the last 30 days. Every alert carries a tenantId or registrationId so the UI can link to where it is fixed.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Alerts, most severe first', content: { 'application/json': { schema: { type: 'object', properties: {
            alerts: { type: 'array', items: { type: 'object', properties: {
              severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
              kind: { type: 'string', enum: ['OVER_LICENCE', 'LICENCE_FULL', 'LICENCE_ZERO', 'PLAN_OVERDUE', 'PLAN_ENDING', 'NO_ADMIN', 'ONBOARDING_STALLED', 'EMAIL_FAILED'] },
              tenantId: { type: 'string', nullable: true },
              registrationId: { type: 'string', nullable: true },
              title: { type: 'string' },
              detail: { type: 'string' },
            } } },
            summary: { type: 'object', properties: { total: { type: 'integer' }, critical: { type: 'integer' }, warning: { type: 'integer' }, info: { type: 'integer' } } },
            thresholds: { type: 'object', properties: { expiryWarningDays: { type: 'integer' }, stuckRegistrationDays: { type: 'integer' } } },
          } } } } },
          403: { description: 'Not a platform owner' },
        },
      },
    },
    '/platform/tenants/{id}': {
      get: {
        tags: ['Platform'],
        operationId: 'getPlatformTenant',
        summary: 'Everything the platform knows about one company',
        description: 'PLATFORM_OWNER only. Company metadata, lifecycle state, its SUPER_ADMIN/ADMIN/HR contacts, the invoice trail already stored on CompanyRegistration, licence usage, per-module record COUNTS and the company\'s audit rows. Deliberately counts rather than records: no goal, task, message or employee row crosses the platform boundary.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Company detail', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              tenant: { type: 'object' },
              licences: { type: 'object', properties: {
                limit: { type: 'integer' }, used: { type: 'integer' }, available: { type: 'integer' },
                blocksAllCreation: { type: 'boolean', description: 'True when limit is 0, which blocks every invitation rather than meaning unlimited.' },
                overLimit: { type: 'boolean' },
              } },
              invoice: { type: 'object', nullable: true, description: 'Null for companies created without a registration record.' },
              admins: { type: 'array', items: { type: 'object' } },
              usage: { type: 'object', description: 'Counts only.' },
              audit: { type: 'array', items: { type: 'object' } },
            },
          } } } },
          400: { description: 'Invalid parameters' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Company not found' },
        },
      },
    },
    '/platform/tenants/{id}/lifecycle': {
      post: {
        tags: ['Platform'],
        operationId: 'setTenantLifecycle',
        summary: 'Move a company between commercial states',
        description: 'PLATFORM_OWNER only. Covers ACTIVE, TRIAL, GRACE_PERIOD, EXPIRED and CANCELLED; suspend and restore keep their own endpoints because they carry extra semantics. EXPIRED and CANCELLED deny access exactly as SUSPENDED does, while TRIAL and GRACE_PERIOD still allow it. Leaving SUSPENDED through this endpoint clears the suspension metadata. Nothing is ever hard-deleted.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['status'],
          properties: {
            status: { type: 'string', enum: ['ACTIVE', 'TRIAL', 'GRACE_PERIOD', 'EXPIRED', 'CANCELLED'] },
            reason: { type: 'string', maxLength: 500, description: 'Required when cancelling.' },
            planEndsAt: { type: 'string', format: 'date-time', nullable: true },
          },
        } } } },
        responses: {
          200: { description: 'Lifecycle changed', content: { 'application/json': { schema: { type: 'object', properties: { tenant: { type: 'object' } } } } } },
          400: { description: 'Validation failed, the platform tenant was targeted, or a cancellation had no reason' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Company not found' },
          409: { description: 'Already in that state' },
        },
      },
    },
    '/platform/tenants/{id}/licences': {
      patch: {
        tags: ['Platform'],
        operationId: 'updateTenantLicences',
        summary: 'Grant or reduce a company\'s seats',
        description: 'PLATFORM_OWNER only. Sets Tenant.licenseLimit, which license.service.js enforces atomically on every user creation. A limit of 0 is refused: the enforcement reads activeCount >= limit, so 0 would block all creation rather than mean unlimited. Reducing below current headcount is also refused, since it silently blocks the next invitation. The platform tenant is refused entirely (code PLATFORM_TENANT) — its limit of 0 is what stops users being created inside the operator tenant. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['licenseLimit'],
          properties: {
            licenseLimit: { type: 'integer', minimum: 0 },
            reason: { type: 'string', maxLength: 500 },
          },
        } } } },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { tenant: { type: 'object' }, activeUsers: { type: 'integer' } } } } } },
          400: { description: 'Validation failed, a limit of 0 was requested (code ZERO_LICENCE_LIMIT), or the platform tenant was targeted (code PLATFORM_TENANT)' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Company not found' },
          409: { description: 'The limit is below the current active headcount' },
        },
      },
    },
    '/platform/users': {
      get: {
        tags: ['Platform'],
        operationId: 'listPlatformUsers',
        summary: 'Search every user account across every company',
        description: 'PLATFORM_OWNER only. The one query in the product that crosses tenant boundaries. Returns identity and account state only — name, email, role, status, designation, department, last login, company — and never a goal, task, message or employee record. PLATFORM_OWNER accounts are excluded from the results, since listing them here would invite managing them here.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Matches name or email, case-insensitive.' },
          { name: 'tenantId', in: 'query', schema: { type: 'string' } },
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE', 'STUDENT', 'MENTOR'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['INVITED', 'ACTIVE', 'EXITED'] } },
          { name: 'includeDeleted', in: 'query', schema: { type: 'boolean', default: false } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: {
          200: { description: 'Users', content: { 'application/json': { schema: { type: 'object', properties: {
            items: { type: 'array', items: { type: 'object' } },
            pagination: { type: 'object' },
          } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' },
        },
      },
    },
    '/platform/users/{id}': {
      get: {
        tags: ['Platform'],
        operationId: 'getPlatformUser',
        summary: 'One user account, with capability grants',
        description: 'PLATFORM_OWNER only. The list payload plus the user\'s UserCapability grants and a count of their direct reports — the latter because deactivating a manager leaves their reports without an approver.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'User detail', content: { 'application/json': { schema: { type: 'object', properties: {
            user: { type: 'object' },
            capabilities: { type: 'array', items: { type: 'object' } },
            directReports: { type: 'integer' },
          } } } } },
          400: { description: 'Invalid parameters' },
          403: { description: 'Not a platform owner' },
          404: { description: 'User not found' },
        },
      },
    },
    '/platform/users/{id}/deactivate': {
      post: {
        tags: ['Platform'],
        operationId: 'deactivatePlatformUser',
        summary: 'Cut off a user account in any company',
        description: 'PLATFORM_OWNER only. Sets TenantUser.status to EXITED, which requireAuth already refuses, so access stops on the user\'s very next request rather than when their token expires. Their records inside the company are untouched and no other user is affected. A PLATFORM_OWNER target is refused (code PLATFORM_OWNER_PROTECTED) so the console cannot lock out its own operators. Audited with before and after.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', properties: { reason: { type: 'string', maxLength: 500, description: 'Recorded on the audit row.' } },
        } } } },
        responses: {
          200: { description: 'Deactivated', content: { 'application/json': { schema: { type: 'object', properties: { user: { type: 'object' } } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner, or a PLATFORM_OWNER was targeted' },
          404: { description: 'User not found' },
          409: { description: 'Already deactivated' },
        },
      },
    },
    '/platform/users/{id}/reactivate': {
      post: {
        tags: ['Platform'],
        operationId: 'reactivatePlatformUser',
        summary: 'Restore a deactivated user account',
        description: 'PLATFORM_OWNER only. Returns status to ACTIVE; the user logs in again with their existing password. Refused for a soft-deleted account, which must be handled inside the company. A PLATFORM_OWNER target is refused. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', properties: { reason: { type: 'string', maxLength: 500 } },
        } } } },
        responses: {
          200: { description: 'Reactivated', content: { 'application/json': { schema: { type: 'object', properties: { user: { type: 'object' } } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner, or a PLATFORM_OWNER was targeted' },
          404: { description: 'User not found' },
          409: { description: 'Not deactivated, or the account was deleted' },
        },
      },
    },
    '/platform/users/{id}/force-reset': {
      post: {
        tags: ['Platform'],
        operationId: 'forceResetPlatformUser',
        summary: 'Email a password reset to a user',
        description: 'PLATFORM_OWNER only. For the locked-out-admin support call. Issues the same PasswordResetToken the public forgot-password flow does, so there is one reset mechanism rather than an operator back door: the operator never sets or sees the password. Any reset token the user already holds is invalidated first, so only one can be live. The token is issued inside the transaction and remains valid even if the email fails to send. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', properties: { reason: { type: 'string', maxLength: 500 } },
        } } } },
        responses: {
          200: { description: 'Reset link sent', content: { 'application/json': { schema: { type: 'object', properties: {
            sent: { type: 'boolean' }, email: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' },
          } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner, or a PLATFORM_OWNER was targeted' },
          404: { description: 'User not found' },
          409: { description: 'The account is deactivated or deleted' },
        },
      },
    },
    '/platform/registrations': {
      get: {
        tags: ['Platform'],
        operationId: 'listOnboarding',
        summary: 'The company onboarding queue',
        description: 'PLATFORM_OWNER only. Every CompanyRegistration with how long it has sat in its current stage, who it is waiting on, how many of its notification emails failed to send, and the current verification verdict. Ordered oldest-waiting first, because this is a work queue rather than a list. ACTIVE registrations are never flagged stuck — they are finished.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING_FINANCE_REVIEW', 'PENDING_CHEQUE_CONFIRMATION', 'PENDING_HR_ACTIVATION', 'ACTIVE'] } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Company name, contact name, email, domain or company code.' },
          { name: 'stuckOnly', in: 'query', schema: { type: 'boolean', default: false }, description: 'Unfinished registrations untouched for 3 days or more. Applied as a query predicate, so the totals match the rows.' },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: {
          200: { description: 'Queue', content: { 'application/json': { schema: { type: 'object', properties: {
            items: { type: 'array', items: { type: 'object', properties: {
              stageLabel: { type: 'string' }, waitingOn: { type: 'string', nullable: true },
              ageInStage: { type: 'integer' }, ageOverall: { type: 'integer' },
              stuck: { type: 'boolean' }, failedNotifications: { type: 'integer' },
              verification: { type: 'string', enum: ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'] },
            } } },
            summary: { type: 'object', properties: { total: { type: 'integer' }, byStatus: { type: 'object' }, stuckThresholdDays: { type: 'integer' } } },
            pagination: { type: 'object' },
          } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' },
        },
      },
    },
    '/platform/registrations/{id}': {
      get: {
        tags: ['Platform'],
        operationId: 'getOnboarding',
        summary: 'One registration, with its action links and email history',
        description: 'PLATFORM_OWNER only. The submitted details, the invoice, every action link issued (with whether it was used or has expired) and every notification sent, including failures. Never returns the CMD\'s passwordHash and never returns a token hash — those are credentials, not status.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Registration detail', content: { 'application/json': { schema: { type: 'object', properties: {
            registration: { type: 'object' },
            tokens: { type: 'array', items: { type: 'object', properties: {
              role: { type: 'string', enum: ['FINANCE', 'HR'] },
              expired: { type: 'boolean' }, used: { type: 'boolean' },
            } } },
            notifications: { type: 'array', items: { type: 'object' } },
            failedNotifications: { type: 'integer' },
          } } } } },
          400: { description: 'Invalid parameters' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Registration not found' },
        },
      },
    },
    '/platform/registrations/{id}/resend': {
      post: {
        tags: ['Platform'],
        operationId: 'resendOnboardingLink',
        summary: 'Re-issue the current stage\'s action link',
        description: 'PLATFORM_OWNER only. Mints a FRESH RegistrationActionToken for whichever stage the registration is in and emails it to the person who has to act — Finance or HR, not all four stakeholders, because a chase that copies everyone trains everyone to ignore it. Tokens are stored hashed, so the original link is unrecoverable and resending necessarily means reissuing. CompanyRegistration.status is never changed: this chases a stalled step, it does not advance one. The token is valid whether or not the email sends, and deliveryStatus says which happened.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', properties: { reason: { type: 'string', maxLength: 500 } },
        } } } },
        responses: {
          200: { description: 'Link issued', content: { 'application/json': { schema: { type: 'object', properties: {
            sent: { type: 'boolean' }, recipient: { type: 'string' },
            role: { type: 'string', enum: ['FINANCE', 'HR'] }, stage: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
            deliveryStatus: { type: 'string', enum: ['SENT', 'FAILED', 'DEV_LOGGED'] },
            deliveryError: { type: 'string', nullable: true },
          } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Registration not found' },
          409: { description: 'Already ACTIVE, so there is no pending step (code NOTHING_TO_RESEND), or no email is recorded for that role' },
        },
      },
    },
    '/platform/registrations/{id}/verify': {
      post: {
        tags: ['Platform'],
        operationId: 'verifyRegistration',
        summary: 'Record a verification decision',
        description: 'PLATFORM_OWNER only. APPENDS a RegistrationVerification row rather than updating one, so an earlier decision is never silently overwritten and the history is a by-product of how it is stored. The newest row is the current status. A rejection requires a note. This records a judgement and does NOT gate onboarding — to stop a company using the product, suspend the tenant. Audited.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['status'],
          properties: {
            status: { type: 'string', enum: ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'] },
            notes: { type: 'string', maxLength: 2000, description: 'Required when rejecting.' },
          },
        } } } },
        responses: {
          200: { description: 'Decision recorded', content: { 'application/json': { schema: { type: 'object', properties: { verification: { type: 'object' } } } } } },
          400: { description: 'Validation failed, or a rejection carried no note' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Registration not found' },
          409: { description: 'Already marked with that status' },
        },
      },
    },
    '/platform/registrations/{id}/verification': {
      get: {
        tags: ['Platform'],
        operationId: 'getRegistrationVerification',
        summary: 'Every verification decision for a registration',
        description: 'PLATFORM_OWNER only. Newest first, with the reviewer resolved by id rather than by relation — reviewerId is not a foreign key, so a decision outlives the account that made it and still renders (as "Deleted account").',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'History', content: { 'application/json': { schema: { type: 'object', properties: {
            current: { type: 'string', enum: ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'] },
            history: { type: 'array', items: { type: 'object' } },
          } } } } },
          400: { description: 'Invalid parameters' },
          403: { description: 'Not a platform owner' },
          404: { description: 'Registration not found' },
        },
      },
    },
    '/platform/audit': {
      get: {
        tags: ['Platform'],
        operationId: 'getPlatformAudit',
        summary: 'What the platform operator has done',
        description: 'PLATFORM_OWNER only. The five existing audit models are tenant-scoped and record what happens inside a company; this records what the operator does TO a company. Mutations are logged, reads are not. actorId is not a foreign key, so a row outlives the account that created it and still renders (as "Deleted account").',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'action', in: 'query', schema: { type: 'string', maxLength: 60 }, description: 'e.g. TENANT_SUSPENDED' },
          { name: 'tenantId', in: 'query', schema: { type: 'string', maxLength: 60 } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: {
          200: { description: 'Audit rows, newest first', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object', properties: {
                id: { type: 'string' }, actorId: { type: 'string' },
                actor: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', nullable: true } } },
                action: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string', nullable: true },
                tenantId: { type: 'string', nullable: true },
                beforeValue: { type: 'object', nullable: true }, afterValue: { type: 'object', nullable: true },
                reason: { type: 'string', nullable: true }, ipAddress: { type: 'string', nullable: true },
                createdAt: { type: 'string', format: 'date-time' },
              } } },
              pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
            },
          } } } },
          403: { description: 'Not a platform owner' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // COMMON DASHBOARD SUMMARY
    // ═══════════════════════════════════════════════════════════════════════════
    '/dashboard/summary': {
      get: {
        tags: ['Reports & Analytics'],
        operationId: 'getDashboardSummary',
        summary: 'Everything the Common Dashboard renders, in one request',
        description: 'Backs /uer/dashboard for every corporate role. The response is scoped to an audience resolved from the caller: SELF (employee - own records), TEAM (manager - self plus direct reports) or TENANT (SUPER_ADMIN/ADMIN/CMD/HR - whole company). An employee never receives tenant-wide figures. Other people’s private tasks are excluded from team and tenant aggregates. Ratings are null rather than defaulted when no rated review exists.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Dashboard summary',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                audience: { type: 'string', enum: ['SELF', 'TEAM', 'TENANT'] },
                hero: { type: 'object', properties: {
                  rating: { type: 'number', nullable: true, description: 'The caller’s latest rated review. Null when they have none - never defaulted to a sample value.' },
                  ratingSource: { type: 'string', nullable: true, enum: ['manager', 'self', null] },
                  goalSync: { type: 'integer', description: 'Average goal progress across the scope, 0-100' },
                } },
                goals: { type: 'object', properties: {
                  total: { type: 'integer' }, completed: { type: 'integer' },
                  averageProgress: { type: 'integer' }, completionRate: { type: 'number' },
                  dueThisQuarter: { type: 'integer' }, onTrack: { type: 'integer' }, behind: { type: 'integer' },
                } },
                tasks: { type: 'object', properties: {
                  total: { type: 'integer' }, done: { type: 'integer' }, percent: { type: 'integer' },
                  highPriority: { type: 'integer', description: 'Not done, priority high or critical' },
                  dueThisWeek: { type: 'integer', description: 'Not done, due within 7 days' },
                } },
                trend: { type: 'array', description: 'One point per appraisal cycle that actually carries ratings; cycles without any are omitted, matching /reports/trend.', items: { type: 'object', properties: {
                  quarter: { type: 'string' }, label: { type: 'string' },
                  avgSelfScore: { type: 'number', nullable: true }, avgManagerScore: { type: 'number', nullable: true },
                } } },
                attention: { type: 'array', items: { type: 'object', properties: {
                  type: { type: 'string', example: 'POLICY' }, id: { type: 'string' },
                  title: { type: 'string' }, dueAt: { type: 'string', format: 'date-time', nullable: true },
                } } },
                hub: { type: 'object', properties: {
                  birthdays: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, date: { type: 'string' }, daysAway: { type: 'integer' } } } },
                  events: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' } } } },
                } },
                team: { type: 'array', description: 'Empty for the SELF audience.', items: { type: 'object', properties: {
                  id: { type: 'string' }, name: { type: 'string' }, initials: { type: 'string' },
                  designation: { type: 'string' }, department: { type: 'string' },
                  rating: { type: 'number', nullable: true }, goalsTotal: { type: 'integer' }, goalsCompleted: { type: 'integer' },
                } } },
                departments: { type: 'array', description: 'Empty for the SELF audience. Derived from the newest cycle with reviews via the shared Reports rollup.', items: { type: 'object', properties: {
                  dept: { type: 'string' }, score: { type: 'number' }, employees: { type: 'integer' }, completionRate: { type: 'integer' },
                } } },
              },
            } } },
          },
          401: { description: 'Authentication required' },
          403: { description: 'No tenant context (for example the platform owner, who belongs to no company)' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 1:1 MEETINGS
    // ═══════════════════════════════════════════════════════════════════════════
    '/team/{employeeId}/one-on-ones': {
      get: {
        tags: ['Employees'],
        operationId: 'listOneOnOnes',
        summary: 'List 1:1 meetings with a colleague',
        description: 'Access reuses the same gate as the member profile itself (self, their manager, or an elevated role). Elevated roles see every 1:1 that person has; everyone else sees only meetings they are part of.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Meetings, newest first', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, organiserId: { type: 'string' }, participantId: { type: 'string' }, organiser: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } }, participant: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } }, scheduledAt: { type: 'string', format: 'date-time' }, durationMins: { type: 'integer' }, agenda: { type: 'string', nullable: true }, location: { type: 'string', nullable: true }, status: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] }, outcomeNotes: { type: 'string', nullable: true }, cancelledReason: { type: 'string', nullable: true } } } } } } } } },
          403: { description: 'Not permitted to view this employee' },
          404: { description: 'Employee not found in this tenant' },
        },
      },
      post: {
        tags: ['Employees'],
        operationId: 'createOneOnOne',
        summary: 'Schedule a 1:1 with a colleague',
        description: 'Creates the meeting and notifies the participant. A time in the past is rejected, as is scheduling with yourself. Broadcasts `one_on_one_scheduled` over Socket.IO.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['scheduledAt'],
          properties: {
            scheduledAt: { type: 'string', format: 'date-time', description: 'Must be in the future' },
            durationMins: { type: 'integer', minimum: 5, maximum: 480, default: 30 },
            agenda: { type: 'string', maxLength: 2000 },
            location: { type: 'string', maxLength: 300, description: 'Room name or video link' },
          },
        } } } },
        responses: {
          201: { description: 'Scheduled', content: { 'application/json': { schema: { type: 'object', properties: { meeting: { type: 'object', properties: { id: { type: 'string' }, organiserId: { type: 'string' }, participantId: { type: 'string' }, organiser: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } }, participant: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } }, scheduledAt: { type: 'string', format: 'date-time' }, durationMins: { type: 'integer' }, agenda: { type: 'string', nullable: true }, location: { type: 'string', nullable: true }, status: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] }, outcomeNotes: { type: 'string', nullable: true }, cancelledReason: { type: 'string', nullable: true } } } } } } } },
          400: { description: 'Validation failed, a past time, or scheduling with yourself' },
          403: { description: 'Not permitted to view this employee' },
          404: { description: 'Employee not found in this tenant' },
        },
      },
    },
    '/one-on-ones/{id}': {
      patch: {
        tags: ['Employees'],
        operationId: 'updateOneOnOne',
        summary: 'Reschedule, complete or cancel a 1:1',
        description: 'Either participant, or an elevated role, may change a meeting. The other party is notified of the change. Broadcasts `one_on_one_updated`.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          description: 'At least one field is required.',
          properties: {
            scheduledAt: { type: 'string', format: 'date-time' },
            durationMins: { type: 'integer', minimum: 5, maximum: 480 },
            agenda: { type: 'string', maxLength: 2000 },
            location: { type: 'string', maxLength: 300 },
            outcomeNotes: { type: 'string', maxLength: 4000 },
            status: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] },
            cancelledReason: { type: 'string', maxLength: 500 },
          },
        } } } },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { meeting: { type: 'object', properties: { id: { type: 'string' }, organiserId: { type: 'string' }, participantId: { type: 'string' }, organiser: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } }, participant: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, designation: { type: 'string', nullable: true } } }, scheduledAt: { type: 'string', format: 'date-time' }, durationMins: { type: 'integer' }, agenda: { type: 'string', nullable: true }, location: { type: 'string', nullable: true }, status: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] }, outcomeNotes: { type: 'string', nullable: true }, cancelledReason: { type: 'string', nullable: true } } } } } } } },
          400: { description: 'Validation failed' },
          403: { description: 'Not a participant and not elevated' },
          404: { description: '1:1 not found in this tenant' },
        },
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // PLATFORM OPERATOR (PLATFORM_OWNER ONLY)
    // ═══════════════════════════════════════════════════════════════════════════
    '/platform/overview': {
      get: {
        tags: ['Platform'],
        operationId: 'getPlatformOverview',
        summary: 'Platform-wide headline counts',
        description: 'PLATFORM_OWNER only. Returns aggregate counts across every company. No company role reaches this endpoint, however elevated it is inside its own tenant — SUPER_ADMIN receives 403. Returns counts only; no tenant-owned record is exposed.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Platform counts',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: { overview: {
                type: 'object',
                properties: {
                  companies: { type: 'integer', description: 'Customer tenants, excluding the internal platform tenant' },
                  activeUsers: { type: 'integer' },
                  pendingRegistrations: { type: 'integer', description: 'Company registrations not yet ACTIVE' },
                  licencesPurchased: { type: 'integer' },
                  licencesUsed: { type: 'integer' },
                  licenceUtilisation: { type: 'integer', description: 'Percentage, 0 when no licences are purchased' },
                  contractedValue: { type: 'number', description: 'Sum of licence fees invoiced across ACTIVE registrations. A one-time contracted amount, NOT recurring revenue — the schema has no subscription or plan model.' },
                  currency: { type: 'string', example: 'INR' },
                },
              } },
            } } },
          },
          401: { description: 'Authentication required' },
          403: { description: 'Not a platform owner' },
        },
      },
    },
    '/platform/tenants': {
      get: {
        tags: ['Platform'],
        operationId: 'listPlatformTenants',
        summary: 'List customer companies',
        description: 'PLATFORM_OWNER only. Company metadata and seat counts. Deliberately exposes no goals, employees, messages or any other tenant-owned data.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Matches company name, tenant code or domain' },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: {
            description: 'Companies',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                items: { type: 'array', items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    companyName: { type: 'string' },
                    tenantCode: { type: 'string' },
                    domainName: { type: 'string' },
                    licenseLimit: { type: 'integer', description: 'Seats purchased. Compare against userCount to spot over-licence tenants.' },
                    userCount: { type: 'integer', description: 'Non-deleted users in this tenant' },
                    createdAt: { type: 'string', format: 'date-time' },
                    companyType: { type: 'string', nullable: true, description: 'Legal entity type from the registration (e.g. "Private Limited"). NOT an industry — industry is not stored. Null for tenants predating the registration flow.' },
                    status: { type: 'string', enum: ['ACTIVE', 'PENDING_FINANCE_REVIEW', 'PENDING_CHEQUE_CONFIRMATION', 'PENDING_HR_ACTIVATION'], description: 'Onboarding status. Defaults to ACTIVE for tenants with no registration record.' },
                    contractedValue: { type: 'number', nullable: true, description: 'Licence fee invoiced for this company, in INR. Null when there is no registration record.' },
                  },
                } },
                pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
              },
            } } },
          },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          401: { description: 'Authentication required' },
          403: { description: 'Not a platform owner' },
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
        description: 'Any authenticated tenant user may file a ticket. Regular users always file about themselves; HR/Admin/CMD/Super Admin may file on behalf of one or several employees via subjectEmployeeIds. Accepts an optional multipart evidence file (field name "file"; PDF/JPEG/PNG, 10MB max) alongside JSON fields, or JSON-only with no file.',
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
          400: { description: 'Validation failed, disallowed MIME type, or one or more selected employees are not valid in this tenant', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
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
    // REPORTS: ANALYTICS, TREND, CATALOG, CSV EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════
    '/reports/analytics': {
      get: {
        tags: ['Reports'],
        summary: 'Appraisal-backed analytics for one cycle',
        description: 'Headcount, per-department average appraisal scores, review status breakdown, hike sign-off progress and goal completion for the selected cycle (defaults to the tenant\'s most recent cycle). Department averages come from real PerformanceReview/ReviewScore data and reuse the same computation as GET /appraisal-cycles/{id}/summary. Returns an empty departmentPerformance array when no reviews exist — it never substitutes placeholder departments. Restricted to HR, SUPER_ADMIN, CMD, ADMIN.',
        operationId: 'getReportsAnalytics',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'cycleId', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Appraisal cycle to report on. Omit for the most recent cycle.' },
          { name: 'department', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Optional department filter' },
        ],
        responses: {
          200: { description: 'Analytics summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportsAnalytics' } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — HR/SUPER_ADMIN/CMD/ADMIN only' },
          404: { description: 'Appraisal cycle not found' },
        },
      },
    },
    '/reports/trend': {
      get: {
        tags: ['Reports'],
        summary: 'Organisation performance trend across real appraisal cycles',
        description: 'One data point per actual appraisal cycle that has reviews, ordered oldest first. Cycles with no reviews are omitted rather than plotted as zero. `sufficientData` is false when fewer than two points exist, so the UI can say so instead of drawing a misleading line.',
        operationId: 'getReportsTrend',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['ANNUAL', 'QUARTERLY', 'MONTHLY'] }, description: 'Restrict the trend to one cycle cadence' },
          { name: 'department', in: 'query', schema: { type: 'string', maxLength: 200 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 2, maximum: 24, default: 8 }, description: 'How many recent cycles to consider' },
        ],
        responses: {
          200: { description: 'Trend points', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportsTrend' } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — HR/SUPER_ADMIN/CMD/ADMIN only' },
        },
      },
    },
    '/reports/catalog': {
      get: {
        tags: ['Reports'],
        summary: 'Available reports with live row counts',
        description: 'Lists the downloadable reports and how many rows each would currently produce for the selected scope. All are CSV — no PDF/XLSX generation exists in this service.',
        operationId: 'getReportCatalog',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'cycleId', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'department', in: 'query', schema: { type: 'string', maxLength: 200 } },
        ],
        responses: {
          200: { description: 'Report catalog', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportCatalog' } } } },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — HR/SUPER_ADMIN/CMD/ADMIN only' },
          404: { description: 'Appraisal cycle not found' },
        },
      },
    },
    '/reports/export/{reportKey}': {
      get: {
        tags: ['Reports'],
        summary: 'Download one report as CSV',
        description: 'Streams a UTF-8 CSV (with BOM, so Excel renders non-ASCII names correctly) as an attachment. `performance-goal-matrix` replaces the former 9-box grid: it plots manager appraisal rating against real goal completion, because no "potential" rating exists in this schema.',
        operationId: 'exportReport',
        security: [{ userCookie: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'reportKey', in: 'path', required: true, schema: { type: 'string', enum: ['appraisal-summary', 'department-summary', 'goal-completion', 'peer-feedback-audit', 'performance-goal-matrix'] } },
          { name: 'cycleId', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'department', in: 'query', schema: { type: 'string', maxLength: 200 } },
          { name: 'financialYear', in: 'query', schema: { type: 'string', maxLength: 100 }, description: '4-digit appraisal form, e.g. "FY 2026-2027". Converted to the Goal/Task 2-digit form at the query boundary.' },
        ],
        responses: {
          200: { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          400: { description: 'Invalid report key or query', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
          403: { description: 'Forbidden — HR/SUPER_ADMIN/CMD/ADMIN only' },
          404: { description: 'Appraisal cycle not found' },
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
