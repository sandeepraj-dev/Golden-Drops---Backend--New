import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import OilType from '../models/OilType.js';

async function backfillOilTypeSequence() {
  await connectDB(env.MONGODB_URI);

  const oils = await OilType.find({})
    .sort({ createdAt: 1, id: 1, _id: 1 })
    .select('_id id sequence')
    .lean();

  if (!oils.length) {
    console.log('No Oil Types found; nothing to sequence.');
    return;
  }

  const operations = oils.map((oil, index) => ({
    updateOne: {
      filter: { _id: oil._id },
      update: { $set: { sequence: index + 1 } },
    },
  }));

  const result = await OilType.bulkWrite(operations, { ordered: true });
  console.log(
    `Assigned sequence 1..${oils.length} to Oil Types. Modified: ${result.modifiedCount}`,
  );
}

backfillOilTypeSequence()
  .catch(error => {
    console.error('Oil Type sequence migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
