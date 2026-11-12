import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import OilType from '../models/OilType.js';

// Run once after deploying: node src/scripts/backfillOilTypeSequence.js
// Coconut Crude is always placed first. The remaining records retain their
// existing sequence order; legacy ties fall back to creation date and ID.
async function backfillOilTypeSequence() {
  await connectDB(env.MONGODB_URI);

  const oils = await OilType.find({})
    .select('_id id name sequence createdAt')
    .lean();

  if (!oils.length) {
    console.log('No Oil Types found; nothing to sequence.');
    return;
  }

  oils.sort((a, b) => {
    const aIsCoconutCrude = String(a.name || '').trim().toLowerCase() === 'coconut crude';
    const bIsCoconutCrude = String(b.name || '').trim().toLowerCase() === 'coconut crude';
    if (aIsCoconutCrude !== bIsCoconutCrude) return aIsCoconutCrude ? -1 : 1;

    const aSequence = Number(a.sequence) || 0;
    const bSequence = Number(b.sequence) || 0;
    if (aSequence !== bSequence) return aSequence - bSequence;

    const aCreated = new Date(a.createdAt || 0).getTime();
    const bCreated = new Date(b.createdAt || 0).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  const operations = oils.map((oil, index) => ({
    updateOne: {
      filter: { _id: oil._id },
      update: { $set: { sequence: index + 1 } },
    },
  }));

  const result = await OilType.bulkWrite(operations, { ordered: true });
  console.log(`Oil Type sequence updated. Coconut Crude first. Assigned 1..${oils.length}; modified: ${result.modifiedCount}`);
  console.table(oils.map((oil, index) => ({ sequence: index + 1, id: oil.id, name: oil.name })));
}

backfillOilTypeSequence()
  .catch(error => {
    console.error('Oil Type sequence migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
