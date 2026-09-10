import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma Client singleton.
 *
 * Next.js dev mode hot-reloads server modules, which would otherwise spin
 * up a fresh PrismaClient (and a fresh DB connection pool) on every edit.
 * Stashing it on `globalThis` outside production avoids that.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
