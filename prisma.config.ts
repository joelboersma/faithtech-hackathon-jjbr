import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Keep client generation and the app build independent of credentials.
  // Database commands require DIRECT_URL (or DATABASE_URL) in .env.
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "" },
});
