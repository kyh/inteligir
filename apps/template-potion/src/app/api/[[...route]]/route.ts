import { handle } from 'hono/vercel';

import { honoApp } from '@/server/hono';

const handleAny = handle as any;

export const GET = handleAny(honoApp);

export const POST = handleAny(honoApp);

export const PUT = handleAny(honoApp);

export const DELETE = handleAny(honoApp);

export const PATCH = handleAny(honoApp);
