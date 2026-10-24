import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { databaseEnvSchema } from "../lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    const env = databaseEnvSchema.parse(process.env);
    globalForPrisma.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    });
  }
  return globalForPrisma.prisma;
}
