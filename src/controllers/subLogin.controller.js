import subLoginService from '../services/subLogin.service.js';
import { inviteEmployee } from './employee.controller.js';
import { SUBLOGIN_PRESETS, canManageCapabilities } from '../lib/capabilities.js';
import { prisma } from '../lib/prisma.js';
import {
  inviteSubLoginSchema,
  updateSubLoginSchema,
  subLoginIdParamSchema,
  auditQuerySchema,
} from '../validations/subLogin.schema.js';

function fail(res, err) {
  const status = err?.status || 500;
  res.status(status).json({ success: false, error: status === 500 ? 'Internal Server Error' : err.message });
  if (status === 500) console.error('[SubLogin]', err);
}

function invalid(res, error) {
  res.status(400).json({
    success: false,
    error: 'Validation failed',
    details: (error?.issues || []).map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

export class SubLoginController {
  async listPresets(req, res) {
    try {
      res.status(200).json({ success: true, presets: subLoginService.listPresets() });
    } catch (err) { fail(res, err); }
  }

  async list(req, res) {
    try {
      const result = await subLoginService.list({ tenantId: req.user.tenantId });
      res.status(200).json({ success: true, ...result });
    } catch (err) { fail(res, err); }
  }

  /**
   * Invite a recruiter / manager / viewer.
   *
   * Deliberately DELEGATES user creation to the existing inviteEmployee
   * controller rather than re-implementing it: that flow owns role-hierarchy
   * enforcement, duplicate and re-invite handling, the temp password and the
   * invite email. Duplicating it would mean two ways to create a user that
   * drift apart. Here we only decide the role, then attach capabilities.
   */
  async invite(req, res) {
    try {
      const parsed = inviteSubLoginSchema.safeParse(req.body || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const { name, email, preset, capabilities, designation, department } = parsed.data;
      const presetDef = preset ? SUBLOGIN_PRESETS[preset] : null;

      // The preset only seeds the checkboxes; whatever the client actually sent
      // in `capabilities` is authoritative.
      const finalCapabilities = capabilities ?? presetDef?.capabilities ?? [];
      if (finalCapabilities.length === 0) {
        return invalid(res, { issues: [{ path: ['capabilities'], message: 'Select at least one registry credential' }] });
      }

      const tenantId = req.user.tenantId;
      const existingUser = await prisma.tenantUser.findFirst({
        where: { email, tenantId, isDeleted: false },
        select: { id: true },
      });

      let userId = existingUser?.id ?? null;
      let inviteResult = null;

      if (!userId) {
        // Hand off to the real invite flow. It writes the response itself, so we
        // capture it and only continue when the user was actually created.
        const captured = { status: 200, body: null };
        const shim = {
          status(code) { captured.status = code; return this; },
          json(payload) { captured.body = payload; return this; },
        };

        req.body = {
          name,
          email,
          role: presetDef?.role ?? 'EMPLOYEE',
          ...(designation ? { designation } : {}),
          ...(department ? { department } : {}),
        };

        let handoffError = null;
        await inviteEmployee(req, shim, (e) => { handoffError = e; });
        if (handoffError) throw handoffError;

        if (captured.status >= 400) {
          return res.status(captured.status).json({ success: false, ...(captured.body || {}) });
        }

        inviteResult = captured.body;
        userId =
          inviteResult?.employee?.id ??
          inviteResult?.user?.id ??
          (await prisma.tenantUser.findFirst({ where: { email, tenantId }, select: { id: true } }))?.id;

        if (!userId) {
          throw Object.assign(new Error('Invite succeeded but the user could not be resolved'), { status: 500 });
        }
      }

      const applied = await subLoginService.applyCapabilities({
        tenantId,
        actor: req.user,
        userId,
        capabilities: finalCapabilities,
        title: presetDef?.label ?? null,
      });

      res.status(existingUser ? 200 : 201).json({
        success: true,
        message: existingUser
          ? 'Registry credentials granted to the existing team member'
          : 'Invitation sent',
        userId,
        alreadyExisted: Boolean(existingUser),
        ...applied,
        invite: inviteResult ? { message: inviteResult.message ?? undefined } : undefined,
      });
    } catch (err) { fail(res, err); }
  }

  /** Change someone's credential set. Unticked boxes are revoked. */
  async update(req, res) {
    try {
      const params = subLoginIdParamSchema.safeParse(req.params || {});
      if (!params.success) return invalid(res, params.error);
      const body = updateSubLoginSchema.safeParse(req.body || {});
      if (!body.success) return invalid(res, body.error);

      const applied = await subLoginService.applyCapabilities({
        tenantId: req.user.tenantId,
        actor: req.user,
        userId: params.data.id,
        capabilities: body.data.capabilities,
        title: body.data.title ?? null,
      });
      res.status(200).json({ success: true, ...applied });
    } catch (err) { fail(res, err); }
  }

  /** Revoke all registry credentials. The person and their account remain. */
  async revoke(req, res) {
    try {
      const params = subLoginIdParamSchema.safeParse(req.params || {});
      if (!params.success) return invalid(res, params.error);

      const applied = await subLoginService.revokeAll({
        tenantId: req.user.tenantId,
        actor: req.user,
        userId: params.data.id,
      });
      res.status(200).json({
        success: true,
        message: 'Registry credentials revoked. The team member keeps their account.',
        ...applied,
      });
    } catch (err) { fail(res, err); }
  }

  async audit(req, res) {
    try {
      if (!canManageCapabilities(req.user)) {
        return fail(res, Object.assign(new Error('Not permitted to view the credential audit trail'), { status: 403 }));
      }
      const parsed = auditQuerySchema.safeParse(req.query || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const entries = await subLoginService.listAudit({ tenantId: req.user.tenantId, ...parsed.data });
      res.status(200).json({ success: true, entries });
    } catch (err) { fail(res, err); }
  }
}

export default new SubLoginController();
