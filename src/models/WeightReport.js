import mongoose from 'mongoose';
import { commonSchema, assignId } from './base.js';

const itemSchema = new mongoose.Schema({
  oilTypeId: { type: Number, required: true, index: true },
  oilName: { type: String, required: true, trim: true },
  containerSize: { type: Number, enum: [20, 50], required: true },
  canCount: { type: Number, required: true, min: 1 },
  grossWeightKg: { type: Number, required: true, min: 0.001 },
  tareDeductionKg: { type: Number, required: true, min: 0 },
  netWeightKg: { type: Number, required: true, min: 0.001 },
  sellingPricePerKg: { type: Number, required: true, min: 0 },
  lineAmount: { type: Number, required: true, min: 0 },
  profitPerKg: { type: Number, required: true, min: 0 },
  profitAmount: { type: Number, required: true, min: 0 },
}, { _id: true });

const schema = commonSchema({
  reportDate: { type: Date, required: true, index: true },
  items: { type: [itemSchema], required: true, validate: v => v.length > 0 },
  totalGrossWeightKg: { type: Number, required: true, min: 0 },
  totalTareDeductionKg: { type: Number, required: true, min: 0 },
  totalNetWeightKg: { type: Number, required: true, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  profitPerKg: { type: Number, required: true, min: 0 },
  totalProfit: { type: Number, required: true, min: 0 },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  status: { type: String, enum: ['COMPLETED', 'VOID'], default: 'COMPLETED', index: true },
  createdBy: { type: Number, default: null },
  updatedBy: { type: Number, default: null },
});
schema.index({ reportDate: -1, createdAt: -1 });
assignId(schema, 'weightReport');
export default mongoose.model('WeightReport', schema);
