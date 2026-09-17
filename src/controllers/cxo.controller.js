import cxoService from '../services/cxo.service.js';
import {
  grantCapability,
  revokeCapability,
  canManageCapabilities,
  listCapabilityHolders,
} from '../lib/capabilities.js';
import { formatIssues } from '../validations/message.schema.js';
import {
  createCxoMessageSchema,
  listCxoQuerySchema,
  cxoIdParamSchema,
  addCxoReplySchema,
  updateCxoMessageSchema,
  grantCapabilitySchema,
  revokeCapabilitySchema,
} from '../validations/cxo.schema.js';

// Identity always comes from req.user (requireAuth), never the payload.
function fail(res, err) {
  const status = err?.status || 500;
  res.status(status).json({ success: false, error: status === 500 ? 'Internal Server Error' : err.message });
  if (status === 500) console.error('[CXO]', err);
}

function invalid(res, error) {
  res.status(400).json({ success: false, error: 'Validation failed', details: formatIssues(error) });
}

export class CxoController {
  async listLeaders(req, res) {
    try {
      const leaders = await cxoService.listLeaders(req.user.tenantId);
      res.status(200).json({ success: true, leaders });
    } catch (err) { fail(res, err); }
  }

  async createMessage(req, res) {
    try {
      const parsed = createCxoMessageSchema.safeParse(req.body || {});
      if (!parsed.success) return invalid(res, parsed.error);
      const message = await cxoService.createMessage({
        tenantId: req.user.tenantId,
        raisedById: req.user.id,
        ...parsed.data,
      });
      res.status(201).json({ success: true, data: message });
    } catch (err) { fail(res, err); }
  }

  async listMessages(req, res) {
    try {
      const parsed = listCxoQuerySchema.safeParse(req.query || {});
      if (!parsed.success) return invalid(res, parsed.error);
      const result = await cxoService.listMessages({
        tenantId: req.user.tenantId,
        user: req.user,
        ...parsed.data,
      });
      res.status(200).json({ success: true, ...result });
    } catch (err) { fail(res, err); }
  }

  async getMessage(req, res) {
    try {
      const parsed = cxoIdParamSchema.safeParse(req.params || {});
      if (!parsed.success) return invalid(res, parsed.error);
      const data = await cxoService.getMessage({ tenantId: req.user.tenantId, user: req.user, id: parsed.data.id });
      res.status(200).json({ success: true, data });
    } catch (err) { fail(res, err); }
  }

  async addReply(req, res) {
    try {
      const params = cxoIdParamSchema.safeParse(req.params || {});
      if (!params.success) return invalid(res, params.error);
      const body = addCxoReplySchema.safeParse(req.body || {});
      if (!body.success) return invalid(res, body.error);

      const data = await cxoService.addReply({
        tenantId: req.user.tenantId,
        user: req.user,
        id: params.data.id,
        body: body.data.body,
      });
      res.status(201).json({ success: true, data });
    } catch (err) { fail(res, err); }
  }

  async updateMessage(req, res) {
    try {
      const params = cxoIdParamSchema.safeParse(req.params || {});
      if (!params.success) return invalid(res, params.error);
      const body = updateCxoMessageSchema.safeParse(req.body || {});
      if (!body.success) return invalid(res, body.error);

      const data = await cxoService.updateMessage({
        tenantId: req.user.tenantId,
        user: req.user,
        id: params.data.id,
        ...body.data,
      });
      res.status(200).json({ success: true, data });
    } catch (err) { fail(res, err); }
  }

  async getStats(req, res) {
    try {
      const stats = await cxoService.getStats({ tenantId: req.user.tenantId, user: req.user });
      res.status(200).json({ success: true, ...stats });
    } catch (err) { fail(res, err); }
  }

  // ── Capability administration (SUPER_ADMIN / ADMIN) ──
  async listCapabilityHolders(req, res) {
    try {
      const holders = await listCapabilityHolders(req.user.tenantId, 'LEADERSHIP');
      res.status(200).json({ success: true, holders });
    } catch (err) { fail(res, err); }
  }

  async grant(req, res) {
    try {
      if (!canManageCapabilities(req.user)) {
        return fail(res, Object.assign(new Error('Only an admin can grant capabilities'), { status: 403 }));
      }
      const parsed = grantCapabilitySchema.safeParse(req.body || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const granted = await grantCapability({
        tenantId: req.user.tenantId,
        grantedById: req.user.id,
        ...parsed.data,
      });
      res.status(201).json({ success: true, data: { userId: granted.userId, capability: granted.capability, title: granted.title } });
    } catch (err) { fail(res, err); }
  }

  async revoke(req, res) {
    try {
      if (!canManageCapabilities(req.user)) {
        return fail(res, Object.assign(new Error('Only an admin can revoke capabilities'), { status: 403 }));
      }
      const parsed = revokeCapabilitySchema.safeParse(req.body || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const data = await revokeCapability({ tenantId: req.user.tenantId, ...parsed.data });
      res.status(200).json({ success: true, data });
    } catch (err) { fail(res, err); }
  }
}

export default new CxoController();
