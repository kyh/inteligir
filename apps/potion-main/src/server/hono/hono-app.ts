import { Hono } from 'hono';

import { aiRoutes } from './routes/ai';
import { exportRoutes } from './routes/export';

export const app = new Hono()
  .basePath('/api')
  .route('/ai', aiRoutes)
  .route('/export', exportRoutes);
