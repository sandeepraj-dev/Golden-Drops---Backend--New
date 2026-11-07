import { asyncHandler, ok, AppError } from '../utils/errors.js';
import { paginated } from '../utils/pagination.js';
import Todo from '../models/Todo.js';

export const createTodo = asyncHandler(async (req, res) => {
  const doc = await Todo.create({ ...req.body, createdBy: req.user?.id, status: req.body.status || 'OPEN', closedAt: req.body.status === 'CLOSED' ? new Date() : null });
  ok(res, doc, 'Todo created successfully', 201);
});
export const listTodos = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status && req.query.status !== 'ALL') filter.status = req.query.status;
  if (req.query.search) filter.$or = [
    { title: { $regex: String(req.query.search), $options: 'i' } },
    { note: { $regex: String(req.query.search), $options: 'i' } },
    { oilName: { $regex: String(req.query.search), $options: 'i' } },
  ];
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00.000+05:30`);
    if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999+05:30`);
  }
  const result = await paginated(Todo, filter, req.query, { createdAt: -1 });
  ok(res, result);
});
export const getTodo = asyncHandler(async (req, res) => {
  const doc = await Todo.findOne({ id: Number(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404);
  ok(res, doc);
});
export const updateTodo = asyncHandler(async (req, res) => {
  const doc = await Todo.findOne({ id: Number(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404);
  Object.assign(doc, req.body, { updatedBy: req.user?.id });
  if (req.body.status === 'CLOSED' && doc.status !== 'CLOSED') doc.closedAt = new Date();
  if (req.body.status === 'OPEN') doc.closedAt = null;
  await doc.save();
  ok(res, doc, 'Todo updated successfully');
});
export const setTodoStatus = asyncHandler(async (req, res) => {
  const doc = await Todo.findOne({ id: Number(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404);
  doc.status = req.body.status;
  doc.closedAt = req.body.status === 'CLOSED' ? new Date() : null;
  doc.updatedBy = req.user?.id;
  await doc.save();
  ok(res, doc, `Todo moved to ${doc.status}`);
});
export const deleteTodo = asyncHandler(async (req, res) => {
  const doc = await Todo.findOneAndDelete({ id: Number(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404);
  ok(res, { id: doc.id }, 'Todo deleted successfully');
});
