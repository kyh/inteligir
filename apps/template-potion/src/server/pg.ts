import pg from 'pg';

import { env } from '@/env';

export const pgPool = new pg.Pool({ connectionString: env.DATABASE_URL });
