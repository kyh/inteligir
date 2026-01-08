import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'generated/prisma/client';

import { env } from '@/env';

import { pgPool } from './pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(pgPool),
  });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// biome-ignore lint/performance/noBarrelFile: re-export for convenience
export { pgPool as pool } from './pg';
