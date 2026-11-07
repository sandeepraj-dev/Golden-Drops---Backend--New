import { z } from 'zod';

const positiveId = z.number().int().positive();
const nonNegative = z.number().finite().min(0);
const item = z.object({
  oilTypeId: positiveId,
  oilName: z.string().trim().min(1).max(100),
  containerSize: z.union([z.literal(20), z.literal(50)]),
  canCount: z.number().int().positive(),
  grossWeightKg: z.number().finite().positive(),
  tareDeductionKg: nonNegative,
  sellingPricePerKg: nonNegative,
}).strict().refine(x => x.tareDeductionKg < x.grossWeightKg, {
  message: 'Tare deduction must be lower than gross weight',
  path: ['tareDeductionKg'],
});
export const weightReportSchema = z.object({
  reportDate: z.coerce.date().optional(),
  items: z.array(item).min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
}).strict();
export const todoSchema = z.object({
  title: z.string().trim().min(1).max(160),
  note: z.string().trim().max(5000).optional(),
  oilTypeId: positiveId.nullable().optional(),
  oilName: z.string().trim().max(100).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
}).strict();
