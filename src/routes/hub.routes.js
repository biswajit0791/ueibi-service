import { Router } from "express";
import { 
  getTeam, 
  updateMyHubProfile, 
  getHubEvents, 
  createHubEvent, 
  deleteHubEvent,
  updateHubEvent
} from "../controllers/hub.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenantScope.js";

const router = Router();

// Team directory & user hub profile
router.get("/hub/team", requireAuth, requireTenant, getTeam);
router.patch("/hub/me", requireAuth, requireTenant, updateMyHubProfile);

// Corporate News & Events
router.get("/hub/events", requireAuth, requireTenant, getHubEvents);
router.post("/hub/events", requireAuth, requireTenant, createHubEvent);
router.patch("/hub/events/:id", requireAuth, requireTenant, updateHubEvent);
router.delete("/hub/events/:id", requireAuth, requireTenant, deleteHubEvent);

export default router;

