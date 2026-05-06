import { z } from "zod";

export const EdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  weight: z.number().optional(),
});

export const DfsRequestSchema = z.object({
  directed: z.boolean(),
  vertices: z.array(z.string().min(1)),
  edges: z.array(EdgeSchema),
  startVertex: z.string().optional(),
});

export const DfsResponseSchema = z.object({
  edgeStepsFromStart: z.array(EdgeSchema),
  vertexStepsFromStart: z.array(z.string()),
  vertexTraces: z.record(z.string(), z.array(z.string())),
  edgeTraces: z.record(z.string(), z.array(EdgeSchema)),
  visitOrder: z.array(z.string()),
});

export type Edge = z.infer<typeof EdgeSchema>;
export type DfsRequest = z.infer<typeof DfsRequestSchema>;
export type DfsResponse = z.infer<typeof DfsResponseSchema>;
