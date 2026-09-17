import { Router } from "express";
import mediaController from "../controllers/media.controller.js";
import { uploadMiddleware } from "../middleware/upload.js";
import { uploadRateLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Chat media upload. `requireAuth` runs before multer so an anonymous caller is
// rejected at the header stage and never gets to write a 50MB file to disk —
// previously this endpoint was open to the internet.
router.post(
  "/media/upload",
  requireAuth,
  uploadRateLimiter,
  uploadMiddleware.single("file"),
  (req, res) => mediaController.uploadFile(req, res),
);

export default router;
