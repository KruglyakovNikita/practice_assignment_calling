import { z } from 'zod';

export const analysisResultSchema = z.object({
  summary: z.string(),
  objections: z.array(z.string()),
  next_step: z.enum(['call_back', 'send_proposal', 'disqualify', 'escalate']),
  lead_score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1)
}).strict();

export type analysisResult = z.infer<typeof analysisResultSchema>;

export const analysisStatuses = [
  'queued',
  'streaming',
  'completed',
  'partial',
  'error',
  'cancelled'
] as const;

export const analysisStatusSchema = z.enum(analysisStatuses);
export type analysisStatus = z.infer<typeof analysisStatusSchema>;

export const analysisPartialResultSchema = z.record(z.string(), z.string());
export type analysisPartialResult = z.infer<typeof analysisPartialResultSchema>;

export const analysisChunkPayloadSchema = z.object({
  id: z.string().min(1),
  field: z.string().min(1),
  delta: z.string()
}).strict();
export type analysisChunkPayload = z.infer<typeof analysisChunkPayloadSchema>;

export const analysisDonePayloadSchema = z.object({
  result: analysisResultSchema
}).strict();
export type analysisDonePayload = z.infer<typeof analysisDonePayloadSchema>;

export const analysisErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  status: z.enum(['partial', 'error', 'cancelled'])
}).strict();
export type analysisErrorPayload = z.infer<typeof analysisErrorPayloadSchema>;
