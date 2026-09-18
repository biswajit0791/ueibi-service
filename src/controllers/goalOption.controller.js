import goalOptionService from '../services/goalOption.service.js';
import {
  listGoalOptionsQuerySchema,
  createGoalOptionSchema,
  updateGoalOptionSchema,
  goalOptionIdParamSchema,
} from '../validations/goalOption.schema.js';

function fail(res, err) {
  const status = err?.status || 500;
  res.status(status).json({ error: status === 500 ? 'Internal Server Error' : err.message });
  if (status === 500) console.error('[GoalOption]', err);
}

function invalid(res, error) {
  res.status(400).json({
    error: 'Validation failed',
    details: (error?.issues || []).map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

/** GET /api/goal-options — all three lists with usage counts, or one via ?kind= */
export async function listGoalOptions(req, res) {
  try {
    const parsed = listGoalOptionsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return invalid(res, parsed.error);

    const { kind } = parsed.data;
    const includeArchived = parsed.data.includeArchived !== 'false';

    if (kind) {
      const options = await goalOptionService.list({ tenantId: req.tenantId, kind, includeArchived });
      return res.json({ options });
    }
    const options = await goalOptionService.listAllWithUsage({ tenantId: req.tenantId, includeArchived });
    res.json({ options });
  } catch (err) { fail(res, err); }
}

/** POST /api/goal-options — SUPER_ADMIN, ADMIN, HR */
export async function createGoalOption(req, res) {
  try {
    const parsed = createGoalOptionSchema.safeParse(req.body || {});
    if (!parsed.success) return invalid(res, parsed.error);

    const option = await goalOptionService.create({
      tenantId: req.tenantId,
      createdBy: req.user?.id ?? null,
      ...parsed.data,
    });
    res.status(201).json({ message: 'Option created', option });
  } catch (err) { fail(res, err); }
}

/** PATCH /api/goal-options/:id — renaming the value cascades to existing goals */
export async function updateGoalOption(req, res) {
  try {
    const params = goalOptionIdParamSchema.safeParse(req.params || {});
    if (!params.success) return invalid(res, params.error);
    const body = updateGoalOptionSchema.safeParse(req.body || {});
    if (!body.success) return invalid(res, body.error);

    const option = await goalOptionService.update({
      tenantId: req.tenantId,
      id: params.data.id,
      ...body.data,
    });
    res.json({ message: 'Option updated', option });
  } catch (err) { fail(res, err); }
}

/** DELETE /api/goal-options/:id — archive; existing goals keep their value */
export async function archiveGoalOption(req, res) {
  try {
    const params = goalOptionIdParamSchema.safeParse(req.params || {});
    if (!params.success) return invalid(res, params.error);

    const { option, usageCount } = await goalOptionService.archive({
      tenantId: req.tenantId,
      id: params.data.id,
    });
    res.json({
      message: usageCount > 0
        ? `Option archived. ${usageCount} goal${usageCount === 1 ? ' keeps' : 's keep'} this value.`
        : 'Option archived',
      option,
      usageCount,
    });
  } catch (err) { fail(res, err); }
}
