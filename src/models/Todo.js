import mongoose from 'mongoose';
import { commonSchema, assignId } from './base.js';

const schema = commonSchema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  note: { type: String, trim: true, maxlength: 5000, default: '' },
  oilTypeId: { type: Number, default: null, index: true },
  oilName: { type: String, trim: true, default: '' },
  dueAt: { type: Date, default: null, index: true },
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', index: true },
  closedAt: { type: Date, default: null },
  createdBy: { type: Number, default: null },
  updatedBy: { type: Number, default: null },
});
schema.index({ status: 1, createdAt: -1 });
assignId(schema, 'todo');
export default mongoose.model('Todo', schema);
