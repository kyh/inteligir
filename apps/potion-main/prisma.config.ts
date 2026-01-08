import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun with-env tsx prisma/seed.ts',
  },
  datasource: {
    // Use process.env to allow generate without DATABASE_URL
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/prisma',
  },
});
