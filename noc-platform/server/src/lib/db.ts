import { PrismaClient } from '@prisma/client';

// One client per process (Next dev reloads modules; keep it on globalThis there).
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = db;
