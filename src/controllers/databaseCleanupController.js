import mongoose from 'mongoose';
import { asyncHandler, ok, AppError } from '../utils/errors.js';
import Purchase from '../models/Purchase.js';
import Sale from '../models/Sale.js';
import Payment from '../models/Payment.js';
import StockLedger from '../models/StockLedger.js';
import WeightReport from '../models/WeightReport.js';
import Todo from '../models/Todo.js';
import AuditLog from '../models/AuditLog.js';

// Related invoice, payment and stock-ledger records are always cleared together.
const CLEANUP_GROUPS = {
  transactions: {
    label: 'Business transactions',
    description: 'Purchases, sales, payments and stock ledger entries',
    models: { purchases: Purchase, sales: Sale, payments: Payment, stockLedger: StockLedger },
  },
  weightReports: {
    label: 'Weight reports',
    description: 'Saved oil weight report transactions',
    models: { weightReports: WeightReport },
  },
  todos: {
    label: 'Notes and todo',
    description: 'Business notes and todo records',
    models: { todos: Todo },
  },
};
const CONFIRMATION_PHRASE = 'CLEAR GOLDEN DROPS';

function validateGroups(groups) {
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 3) {
    throw new AppError('Select one or more valid data groups.', 400, 'INVALID_CLEANUP_SELECTION');
  }
  const unique = [...new Set(groups)];
  if (unique.length !== groups.length || unique.some(key => !CLEANUP_GROUPS[key])) {
    throw new AppError('One or more cleanup groups are invalid.', 400, 'INVALID_CLEANUP_SELECTION');
  }
  return unique;
}

async function collectCounts(groups, session = null) {
  const counts = {};
  for (const key of groups) {
    const group = CLEANUP_GROUPS[key];
    counts[key] = { label: group.label, description: group.description, collections: {}, total: 0 };
    for (const [collectionKey, Model] of Object.entries(group.models)) {
      const countQuery = Model.countDocuments({});
      if (session) countQuery.session(session);
      const count = await countQuery;
      counts[key].collections[collectionKey] = count;
      counts[key].total += count;
    }
  }
  return counts;
}

export const previewDatabaseCleanup = asyncHandler(async (req, res) => {
  const groups = validateGroups(req.body?.groups);
  const counts = await collectCounts(groups);
  return ok(res, {
    groups: counts,
    selectedGroups: groups,
    confirmationPhrase: CONFIRMATION_PHRASE,
    protectedData: [
      'Users and login accounts',
      'Manufacturers and suppliers',
      'Oil types and oil sequence',
      'Business settings',
      'Database counters / numeric ID sequences',
      'Cleanup audit history',
    ],
  }, 'Cleanup preview generated successfully');
});

export const executeDatabaseCleanup = asyncHandler(async (req, res) => {
  const groups = validateGroups(req.body?.groups);
  if (req.body?.confirmation !== CONFIRMATION_PHRASE) {
    throw new AppError(`Type "${CONFIRMATION_PHRASE}" exactly to confirm this operation.`, 400, 'CLEANUP_CONFIRMATION_REQUIRED');
  }

  const session = await mongoose.startSession();
  let deleted = {};
  let deletedTotal = 0;
  try {
    // The deletes and audit event commit together. A standalone MongoDB server
    // without transaction support fails safely instead of partially deleting data.
    await session.withTransaction(async () => {
      deleted = {};
      deletedTotal = 0;
      const freshCounts = await collectCounts(groups, session);
      for (const key of groups) {
        const group = CLEANUP_GROUPS[key];
        deleted[key] = { label: group.label, collections: {}, total: 0 };
        for (const [collectionKey, Model] of Object.entries(group.models)) {
          const result = await Model.deleteMany({}, { session });
          const count = Number(result.deletedCount || 0);
          deleted[key].collections[collectionKey] = count;
          deleted[key].total += count;
          deletedTotal += count;
        }
      }
      await AuditLog.create([{
        action: 'DATABASE_CLEANUP',
        entityType: 'DATABASE',
        details: {
          groups,
          previewCounts: freshCounts,
          deleted,
          deletedTotal,
          performedBy: req.user?.id ?? null,
          performedAt: new Date().toISOString(),
        },
        requestId: req.get('x-request-id') || '',
      }], { session });
    });

    return ok(res, {
      deleted,
      deletedTotal,
      preserved: [
        'Users and login accounts',
        'Manufacturers and suppliers',
        'Oil types and oil sequence',
        'Business settings',
        'Database counters / numeric ID sequences',
        'Cleanup audit history',
      ],
    }, 'Selected database records were cleared successfully');
  } finally {
    await session.endSession();
  }
});
