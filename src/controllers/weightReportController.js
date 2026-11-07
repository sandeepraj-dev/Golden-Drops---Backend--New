import { asyncHandler, ok, AppError } from '../utils/errors.js';
import { paginated } from '../utils/pagination.js';
import WeightReport from '../models/WeightReport.js';
import OilType from '../models/OilType.js';
import { env } from '../config/env.js';

const round3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dateBoundary(value, end = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new AppError('Date filters must use YYYY-MM-DD format', 400, 'INVALID_DATE_FILTER');
  }
  const parsed = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`);
  if (Number.isNaN(parsed.getTime())) throw new AppError('Invalid date filter', 400, 'INVALID_DATE_FILTER');
  return parsed;
}

const dateFilter = q => {
  const filter = { status: q.status || 'COMPLETED' };
  if (q.from || q.to) {
    filter.reportDate = {};
    if (q.from) filter.reportDate.$gte = dateBoundary(q.from);
    if (q.to) filter.reportDate.$lte = dateBoundary(q.to, true);
    if (filter.reportDate.$gte && filter.reportDate.$lte &&
        filter.reportDate.$gte > filter.reportDate.$lte) {
      throw new AppError('From date must be on or before to date', 400, 'INVALID_DATE_RANGE');
    }
  }
  if (q.oilTypeId !== undefined && q.oilTypeId !== '') {
    const oilTypeId = Number(q.oilTypeId);
    if (!Number.isInteger(oilTypeId) || oilTypeId <= 0) throw new AppError('oilTypeId must be a positive integer', 400, 'INVALID_OIL_TYPE_ID');
    filter['items.oilTypeId'] = oilTypeId;
  }
  if (q.search) {
    const search = escapeRegex(q.search.trim());
    filter.$or = [
      { 'items.oilName': { $regex: search, $options: 'i' } },
      { notes: { $regex: search, $options: 'i' } },
    ];
  }
  return filter;
};

async function calculate(payload, existing = null, userId = null) {
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new AppError('Add at least one oil item', 400, 'ITEMS_REQUIRED');
  }
  const ids = [...new Set(payload.items.map(x => Number(x.oilTypeId)))];
  const oils = await OilType.find({ id: { $in: ids } }).lean();
  const oilMap = new Map(oils.map(o => [Number(o.id), o]));
  const profitPerKg = Number(env.DEFAULT_PROFIT_PER_KG ?? 20);
  const items = payload.items.map(x => {
    const oil = oilMap.get(Number(x.oilTypeId));
    if (!oil) throw new AppError(`Oil type ${x.oilTypeId} was not found`, 404, 'OIL_TYPE_NOT_FOUND');
    const gross = Number(x.grossWeightKg);
    const tare = Number(x.tareDeductionKg);
    const price = Number(x.sellingPricePerKg);
    const netWeightKg = round3(gross - tare);
    if (![gross, tare, price].every(Number.isFinite) || gross <= 0 || tare < 0 || tare >= gross || price < 0 || netWeightKg <= 0) {
      throw new AppError(`Invalid weight or price for ${x.oilName || oil.name}`, 400, 'INVALID_WEIGHT_ITEM');
    }
    return {
      oilTypeId: Number(x.oilTypeId),
      oilName: String(x.oilName || oil.name).trim(),
      containerSize: Number(x.containerSize),
      canCount: Number(x.canCount),
      grossWeightKg: round3(gross),
      tareDeductionKg: round3(tare),
      netWeightKg,
      sellingPricePerKg: round2(price),
      lineAmount: round2(netWeightKg * price),
      profitPerKg,
      profitAmount: round2(netWeightKg * profitPerKg),
    };
  });
  const totals = items.reduce((a, x) => ({
    gross: a.gross + x.grossWeightKg, tare: a.tare + x.tareDeductionKg,
    net: a.net + x.netWeightKg, amount: a.amount + x.lineAmount,
    profit: a.profit + x.profitAmount,
  }), { gross: 0, tare: 0, net: 0, amount: 0, profit: 0 });
  return {
    reportDate: payload.reportDate || existing?.reportDate || new Date(),
    items,
    totalGrossWeightKg: round3(totals.gross),
    totalTareDeductionKg: round3(totals.tare),
    totalNetWeightKg: round3(totals.net),
    totalAmount: round2(totals.amount),
    profitPerKg,
    totalProfit: round2(totals.profit),
    notes: payload.notes ?? existing?.notes ?? '',
    updatedBy: userId,
  };
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Invalid transaction ID', 400, 'INVALID_ID');
  return id;
}

export const createWeightReport = asyncHandler(async (req, res) => {
  const calculated = await calculate(req.body, null, req.user?.id);
  const doc = await WeightReport.create({ ...calculated, createdBy: req.user?.id });
  ok(res, doc, 'Weight report saved successfully', 201);
});

export const listWeightReports = asyncHandler(async (req, res) => {
  const result = await paginated(WeightReport, dateFilter(req.query), req.query, { reportDate: -1, createdAt: -1 });
  ok(res, result);
});

export const getWeightReport = asyncHandler(async (req, res) => {
  const doc = await WeightReport.findOne({ id: parseId(req.params.id) });
  if (!doc) throw new AppError('Weight report not found', 404, 'WEIGHT_REPORT_NOT_FOUND');
  ok(res, doc);
});

export const updateWeightReport = asyncHandler(async (req, res) => {
  const doc = await WeightReport.findOne({ id: parseId(req.params.id) });
  if (!doc) throw new AppError('Weight report not found', 404, 'WEIGHT_REPORT_NOT_FOUND');
  const calculated = await calculate(req.body, doc, req.user?.id);
  Object.assign(doc, calculated);
  await doc.save();
  ok(res, doc, 'Weight report updated successfully');
});

export const deleteWeightReport = asyncHandler(async (req, res) => {
  const doc = await WeightReport.findOneAndDelete({ id: parseId(req.params.id) });
  if (!doc) throw new AppError('Weight report not found', 404, 'WEIGHT_REPORT_NOT_FOUND');
  ok(res, { id: doc.id }, 'Weight report deleted successfully');
});

export const weightReportDashboard = asyncHandler(async (req, res) => {
  const from = dateBoundary(req.query.from);
  const to = dateBoundary(req.query.to, true);
  if (from && to && from > to) throw new AppError('From date must be on or before to date', 400, 'INVALID_DATE_RANGE');
  const match = { status: 'COMPLETED' };
  if (from || to) {
    match.reportDate = {};
    if (from) match.reportDate.$gte = from;
    if (to) match.reportDate.$lte = to;
  }
  const [summary, byOil, recent] = await Promise.all([
    WeightReport.aggregate([{ $match: match }, { $group: {
      _id: null, transactions: { $sum: 1 }, entries: { $sum: { $size: '$items' } },
      totalNetWeightKg: { $sum: '$totalNetWeightKg' }, totalAmount: { $sum: '$totalAmount' },
      totalProfit: { $sum: '$totalProfit' },
    }}]),
    WeightReport.aggregate([{ $match: match }, { $unwind: '$items' }, { $group: {
      _id: { oilTypeId: '$items.oilTypeId', oilName: '$items.oilName' },
      netKg: { $sum: '$items.netWeightKg' }, amount: { $sum: '$items.lineAmount' },
      profit: { $sum: '$items.profitAmount' },
    }}, { $sort: { netKg: -1 }}]),
    WeightReport.find(match).sort({ reportDate: -1, createdAt: -1 }).limit(5).lean(),
  ]);
  const s = summary[0] || { transactions: 0, entries: 0, totalNetWeightKg: 0, totalAmount: 0, totalProfit: 0 };
  ok(res, {
    dateRange: { from: req.query.from || null, to: req.query.to || null },
    transactions: s.transactions, entries: s.entries,
    totalNetWeightKg: round3(s.totalNetWeightKg), totalAmount: round2(s.totalAmount),
    totalProfit: round2(s.totalProfit), profitPerKg: Number(env.DEFAULT_PROFIT_PER_KG ?? 20),
    averageProfitPerTransaction: s.transactions ? round2(s.totalProfit / s.transactions) : 0,
    byOilType: byOil.map(x => ({
      oilTypeId: x._id.oilTypeId, oilName: x._id.oilName,
      netKg: round3(x.netKg), amount: round2(x.amount), profit: round2(x.profit),
    })),
    recentTransactions: recent,
  });
});
