import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { AppError } from '../utils/errors.js';
import { previewDatabaseCleanup, executeDatabaseCleanup } from '../controllers/databaseCleanupController.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return next(new AppError('Administrator access is required.', 403, 'ADMIN_REQUIRED'));
  }
  return next();
}

const previewSchema = z.object({
  body: z.object({
    groups: z.array(z.enum(['transactions', 'weightReports', 'todos'])).min(1).max(3),
  }).strict(),
});
const executeSchema = z.object({
  body: z.object({
    groups: z.array(z.enum(['transactions', 'weightReports', 'todos'])).min(1).max(3),
    confirmation: z.string().min(1).max(80),
  }).strict(),
});

router.post('/database-cleanup/preview', requireAdmin, validate(previewSchema), previewDatabaseCleanup);
router.post('/database-cleanup/execute', requireAdmin, validate(executeSchema), executeDatabaseCleanup);

export default router;
