import { FollowerService } from '../services/follower.service.js';

export async function getFollowers(req, res, next) {
  try {
    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId query parameters are required' });
    }
    const followers = await FollowerService.listFollowers({
      tenantId: req.tenantId,
      entityType,
      entityId,
    });
    res.json({ followers });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function addFollower(req, res, next) {
  try {
    const { entityType, entityId, userId } = req.body;
    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' });
    }
    const targetUserId = userId || req.user.id;
    const follower = await FollowerService.addFollower({
      tenantId: req.tenantId,
      entityType,
      entityId,
      userId: targetUserId,
      addedById: req.user.id,
    });
    res.status(201).json(follower);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function removeFollower(req, res, next) {
  try {
    const { entityType, entityId, userId } = req.body;
    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' });
    }
    const targetUserId = userId || req.user.id;
    await FollowerService.removeFollower({
      tenantId: req.tenantId,
      entityType,
      entityId,
      userId: targetUserId,
    });
    res.json({ success: true, message: 'Follower removed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
