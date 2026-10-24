import { z } from "zod";

export const greetingSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(10_000).default(""),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
