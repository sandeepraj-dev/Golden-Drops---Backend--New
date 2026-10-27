import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { connectDB } from '../src/config/db.js';
import Manufacturer from '../src/models/Manufacturer.js';
import Supplier from '../src/models/Supplier.js';
import OilType from '../src/models/OilType.js';
import BusinessSettings from '../src/models/BusinessSettings.js';
import User from '../src/models/User.js';
import Counter from '../src/models/Counter.js';

// Documents created by older seed scripts with findOneAndUpdate(upsert) can bypass
// Mongoose's pre-validate ID hook. Repair those records before creating new data.
const idModels = [
  ['manufacturer', Manufacturer], ['supplier', Supplier], ['oilType', OilType],
  ['user', User], ['purchase', (await import('../src/models/Purchase.js')).default],
  ['sale', (await import('../src/models/Sale.js')).default],
  ['payment', (await import('../src/models/Payment.js')).default],
  ['stockLedger', (await import('../src/models/StockLedger.js')).default],
  ['auditLog', (await import('../src/models/AuditLog.js')).default],
];

async function repairAndSyncCounters() {
  for (const [counterName, Model] of idModels) {
    const missing = await Model.collection.find({ $or: [{ id: null }, { id: { $exists: false } }] }).toArray();
    let maxId = 100;
    for (const doc of await Model.collection.find({ id: { $type: 'number' } }, { projection: { id: 1 } }).toArray()) {
      if (Number.isFinite(doc.id)) maxId = Math.max(maxId, doc.id);
    }
    const existingCounter = await Counter.findById(counterName).lean();
    let seq = Math.max(maxId, existingCounter?.seq ?? 100);
    for (const doc of missing) {
      seq += 1;
      await Model.collection.updateOne({ _id: doc._id, $or: [{ id: null }, { id: { $exists: false } }] }, { $set: { id: seq } });
      console.log(`[SEED] Repaired missing numeric ID for ${Model.modelName} document ${doc._id}: ${seq}`);
    }
    await Counter.updateOne({ _id: counterName }, { $max: { seq } }, { upsert: true });
  }
}

async function findOrCreate(Model, filter, values) {
  const found = await Model.findOne(filter);
  return found || Model.create(values);
}

try {
  await connectDB(env.MONGODB_URI);
  await repairAndSyncCounters();

  const adminName = env.ADMIN_USERNAME.toLowerCase();
  if (!await User.exists({ username: adminName })) {
    await User.create({ username: adminName, passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 12) });
  }

  const manufacturer = await findOrCreate(
    Manufacturer,
    { name: 'ABC Oil Mills', phone: '9876500001' },
    { name: 'ABC Oil Mills', phone: '9876500001', address: 'Demo address' },
  );

  for (const [name, code] of [['Groundnut Oil', 'GNO'], ['Coconut Oil', 'CO'], ['Sesame Oil', 'SO']]) {
    await findOrCreate(OilType, { code }, {
      name, code, unit: 'KG', defaultPurchasePricePerKg: 0, sellingPricePerKg: 0,
    });
  }

  let supplier = await Supplier.findOne({ name: 'Default Oil Supplier' });
  if (!supplier) {
    supplier = await Supplier.create({ name: 'Default Oil Supplier', phone: '9876500002', gpayNumber: '9876500002', isDefault: true });
  }
  await Supplier.updateMany({ _id: { $ne: supplier._id }, isDefault: true }, { $set: { isDefault: false } });
  if (!supplier.isDefault) {
    supplier.isDefault = true;
    await supplier.save();
  }

  let settings = await BusinessSettings.findOne({ key: 'main' });
  if (!settings) {
    settings = await BusinessSettings.create({
      key: 'main', businessName: env.BUSINESS_NAME, timezone: env.BUSINESS_TIMEZONE,
      currency: env.CURRENCY, defaultProfitPerKg: env.DEFAULT_PROFIT_PER_KG,
      defaultSupplierId: supplier.id,
    });
  } else if (settings.defaultSupplierId !== supplier.id) {
    settings.defaultSupplierId = supplier.id;
    await settings.save();
  }

  console.log(`[SEED] Complete. Admin=${adminName}; Manufacturer ID=${manufacturer.id}; default supplier ID=${supplier.id}; oil types seeded idempotently.`);
  await mongoose.disconnect();
} catch (e) {
  console.error('[SEED ERROR]', e.stack || e.message);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
}
