// Vercel Function: /api/health — gebruikt door de keep-alive workflow
import { health } from '../lib/handler.js';
import { ctx } from '../lib/context.js';

export const GET = (request) => health(ctx(), request);
