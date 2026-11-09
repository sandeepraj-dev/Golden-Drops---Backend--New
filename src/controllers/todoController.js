import { asyncHandler, ok, AppError } from '../utils/errors.js';
import { paginated } from '../utils/pagination.js';
import Todo from '../models/Todo.js';

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Invalid todo ID', 400, 'INVALID_ID');
  return id;
}
function dateBoundary(value, end = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new AppError('Date filters must use YYYY-MM-DD format', 400, 'INVALID_DATE_FILTER');
  }
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`);
  if (Number.isNaN(date.getTime())) throw new AppError('Invalid date filter', 400, 'INVALID_DATE_FILTER');
  return date;
}

export const createTodo = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (payload.dueAt === '') payload.dueAt = null;
  const status = payload.status || 'OPEN';
  const doc = await Todo.create({
    ...payload, status, createdBy: req.user?.id,
    closedAt: status === 'CLOSED' ? new Date() : null,
  });
  ok(res, doc, 'Todo created successfully', 201);
});

export const listTodos = asyncHandler(async (req, res) => {
  const filter = {};
  const status = String(req.query.status || 'OPEN').toUpperCase();
  if (!['OPEN', 'CLOSED', 'ALL'].includes(status)) throw new AppError('status must be OPEN, CLOSED or ALL', 400, 'INVALID_STATUS');
  if (status !== 'ALL') filter.status = status;
  if (req.query.search) {
    const search = escapeRegex(String(req.query.search).trim());
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { note: { $regex: search, $options: 'i' } },
      { oilName: { $regex: search, $options: 'i' } },
    ];
  }
  if (req.query.from || req.query.to) {
    const from = dateBoundary(req.query.from);
    const to = dateBoundary(req.query.to, true);
    if (from && to && from > to) throw new AppError('From date must be on or before to date', 400, 'INVALID_DATE_RANGE');
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  const result = await paginated(Todo, filter, req.query, { createdAt: -1, id: -1 });
  ok(res, result);
});

export const getTodo = asyncHandler(async (req, res) => {
  const doc = await Todo.findOne({ id: parseId(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404, 'TODO_NOT_FOUND');
  ok(res, doc);
});

export const updateTodo = asyncHandler(async (req, res) => {
  const doc = await Todo.findOne({ id: parseId(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404, 'TODO_NOT_FOUND');
  const payload = { ...req.body };
  if (payload.dueAt === '') payload.dueAt = null;
  const oldStatus = doc.status;
  if (payload.status === 'CLOSED' && oldStatus !== 'CLOSED') doc.closedAt = new Date();
  if (payload.status === 'OPEN') doc.closedAt = null;
  Object.assign(doc, payload, { updatedBy: req.user?.id });
  await doc.save();
  ok(res, doc, 'Todo updated successfully');
});

export const setTodoStatus = asyncHandler(async (req, res) => {
  const doc = await Todo.findOne({ id: parseId(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404, 'TODO_NOT_FOUND');
  const status = String(req.body.status || '').toUpperCase();
  if (!['OPEN', 'CLOSED'].includes(status)) throw new AppError('status must be OPEN or CLOSED', 400, 'INVALID_STATUS');
  if (doc.status !== status) {
    doc.status = status;
    doc.closedAt = status === 'CLOSED' ? new Date() : null;
    doc.updatedBy = req.user?.id;
    await doc.save();
  }
  ok(res, doc, status === 'CLOSED' ? 'Todo marked as closed' : 'Todo reopened');
});

export const deleteTodo = asyncHandler(async (req, res) => {
  const doc = await Todo.findOneAndDelete({ id: parseId(req.params.id) });
  if (!doc) throw new AppError('Todo not found', 404, 'TODO_NOT_FOUND');
  ok(res, { id: doc.id }, 'Todo deleted successfully');
});

export const bulkDeleteTodos=asyncHandler(async(req,res)=>{const ids=[...new Set((req.body?.ids||[]).map(Number))];if(!ids.length||ids.length>100||ids.some(x=>!Number.isSafeInteger(x)||x<=0))throw new AppError("Provide between 1 and 100 valid record IDs",400,"INVALID_BULK_IDS");const docs=await Todo.find({id:{$in:ids}}).select("id").lean();if(docs.length!==ids.length)throw new AppError("One or more selected notes no longer exist. Refresh and try again.",404,"RECORDS_NOT_FOUND");await Todo.deleteMany({id:{$in:ids}});ok(res,{requested:ids.length,deletedCount:ids.length,deletedIds:ids},"Selected notes deleted successfully");});
