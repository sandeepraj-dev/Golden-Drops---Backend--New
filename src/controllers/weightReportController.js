import { asyncHandler, ok, AppError } from '../utils/errors.js';
import { paginated } from '../utils/pagination.js';
import WeightReport from '../models/WeightReport.js';
import OilType from '../models/OilType.js';
import { env } from '../config/env.js';

const round3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dateFilter = q => {
  const f = {};
  if (q.from || q.to) {
    f.reportDate = {};
    if (q.from) f.reportDate.$gte = new Date(`${q.from}T00:00:00.000+05:30`);
    if (q.to) f.reportDate.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
  }
  if (q.status) f.status = q.status;
  if (q.oilTypeId) f['items.oilTypeId'] = Number(q.oilTypeId);
  if (q.search) f.$or = [
    { 'items.oilName': { $regex: String(q.search), $options: 'i' } },
    { notes: { $regex: String(q.search), $options: 'i' } },
  ];
  return f;
};

async function calculate(payload, existing = null, userId = null) {
  const ids = [...new Set(payload.items.map(x => x.oilTypeId))];
  const oils = await OilType.find({ id: { $in: ids } }).lean();
  const oilMap = new Map(oils.map(o => [o.id, o]));
  const profitPerKg = Number(env.DEFAULT_PROFIT_PER_KG ?? 20);
  const items = payload.items.map(x => {
    const oil = oilMap.get(x.oilTypeId);
    if (!oil) throw new AppError(`Oil type ${x.oilTypeId} was not found`, 404, 'OIL_TYPE_NOT_FOUND');
    const netWeightKg = round3(x.grossWeightKg - x.tareDeductionKg);
    if (netWeightKg <= 0) throw new AppError('Net weight must be greater than zero', 400, 'INVALID_NET_WEIGHT');
    return {
      oilTypeId: x.oilTypeId,
      oilName: x.oilName || oil.name,
      containerSize: x.containerSize,
      canCount: x.canCount,
      grossWeightKg: round3(x.grossWeightKg),
      tareDeductionKg: round3(x.tareDeductionKg),
      netWeightKg,
      sellingPricePerKg: round2(x.sellingPricePerKg),
      lineAmount: round2(netWeightKg * x.sellingPricePerKg),
      profitPerKg,
      profitAmount: round2(netWeightKg * profitPerKg),
    };
  });
  const totals = items.reduce((a, x) => ({
    gross: a.gross + x.grossWeightKg,
    tare: a.tare + x.tareDeductionKg,
    net: a.net + x.netWeightKg,
    amount: a.amount + x.lineAmount,
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
  const doc = await WeightReport.findOne({ id: Number(req.params.id) });
  if (!doc) throw new AppError('Weight report not found', 404);
  ok(res, doc);
});

export const updateWeightReport = asyncHandler(async (req, res) => {
  const doc = await WeightReport.findOne({ id: Number(req.params.id) });
  if (!doc) throw new AppError('Weight report not found', 404);
  const calculated = await calculate(req.body, doc, req.user?.id);
  Object.assign(doc, calculated);
  await doc.save();
  ok(res, doc, 'Weight report updated successfully');
});

export const deleteWeightReport = asyncHandler(async (req, res) => {
  const doc = await WeightReport.findOneAndDelete({ id: Number(req.params.id) });
  if (!doc) throw new AppError('Weight report not found', 404);
  ok(res, { id: doc.id }, 'Weight report deleted successfully');
});

export const weightReportDashboard = asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000+05:30`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999+05:30`) : null;
  const match = { status: 'COMPLETED' };
  if (from || to) {
    match.reportDate = {};
    if (from) match.reportDate.$gte = from;
    if (to) match.reportDate.$lte = to;
  }
  const [summary, byOil, recent] = await Promise.all([
    WeightReport.aggregate([
      { $match: match },
      { $group: { _id: null, transactions: { $sum: 1 }, entries: { $sum: { $size: '$items' } }, totalNetWeightKg: { $sum: '$totalNetWeightKg' }, totalAmount: { $sum: '$totalAmount' }, totalProfit: { $sum: '$totalProfit' } } },
    ]),
    WeightReport.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: { oilTypeId: '$items.oilTypeId', oilName: '$items.oilName' }, netKg: { $sum: '$items.netWeightKg' }, amount: { $sum: '$items.lineAmount' }, profit: { $sum: '$items.profitAmount' } } },
      { $sort: { netKg: -1 } },
    ]),
    WeightReport.find(match).sort({ reportDate: -1, createdAt: -1 }).limit(5).lean(),
  ]);
  const s = summary[0] || { transactions: 0, entries: 0, totalNetWeightKg: 0, totalAmount: 0, totalProfit: 0 };
  ok(res, {
    dateRange: { from: req.query.from || null, to: req.query.to || null },
    transactions: s.transactions,
    entries: s.entries,
    totalNetWeightKg: round3(s.totalNetWeightKg),
    totalAmount: round2(s.totalAmount),
    totalProfit: round2(s.totalProfit),
    profitPerKg: Number(env.DEFAULT_PROFIT_PER_KG ?? 20),
    averageProfitPerTransaction: s.transactions ? round2(s.totalProfit / s.transactions) : 0,
    byOilType: byOil.map(x => ({ oilTypeId: x._id.oilTypeId, oilName: x._id.oilName, netKg: round3(x.netKg), amount: round2(x.amount), profit: round2(x.profit) })),
    recentTransactions: recent,
  });
});
