import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { weightReportSchema, todoSchema } from '../validators/weightTodoSchemas.js';
import * as w from '../controllers/weightReportController.js';
import * as t from '../controllers/todoController.js';

const router = Router();
const idParam = z.object({ params: z.object({ id: z.coerce.number().int().positive() }) });
const statusBody = z.object({ body: z.object({ status: z.enum(['OPEN', 'CLOSED']) }).strict() });

router.get('/weight-reports/dashboard', w.weightReportDashboard);
router.post('/weight-reports', validate(z.object({ body: weightReportSchema })), w.createWeightReport);
router.get('/weight-reports', w.listWeightReports);
router.get('/weight-reports/:id', validate(idParam), w.getWeightReport);
router.put('/weight-reports/:id', validate(z.object({ params: idParam.shape.params, body: weightReportSchema })), w.updateWeightReport);
router.post('/weight-reports/bulk-delete', w.bulkDeleteWeightReports);
router.delete('/weight-reports/:id', validate(idParam), w.deleteWeightReport);

router.post('/todos', validate(z.object({ body: todoSchema })), t.createTodo);
router.get('/todos', t.listTodos);
router.get('/todos/:id', validate(idParam), t.getTodo);
router.put('/todos/:id', validate(z.object({ params: idParam.shape.params, body: todoSchema.partial() })), t.updateTodo);
router.patch('/todos/:id/status', validate(z.object({ params: idParam.shape.params, body: statusBody.shape.body })), t.setTodoStatus);
router.post('/todos/bulk-delete', t.bulkDeleteTodos);
router.delete('/todos/:id', validate(idParam), t.deleteTodo);

export default router;
