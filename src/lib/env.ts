import { z } from "zod";

export const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url().refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    "DATABASE_URL must be a PostgreSQL connection string",
  ),
});

export const sinchEnvSchema = z.object({
  SINCH_PROJECT_ID: z.string().min(1),
  SINCH_KEY_ID: z.string().min(1),
  SINCH_KEY_SECRET: z.string().min(1),
  SINCH_REGION: z.enum(["us", "eu", "br"]).default("us"),
});

export function getSupabaseEnv() {
  // Explicit references are required for Next.js browser env substitution.
  return supabaseEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
