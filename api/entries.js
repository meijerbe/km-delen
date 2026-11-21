// Vercel Function: /api/entries
import { handle } from '../lib/handler.js';
import { ctx } from '../lib/context.js';

export const GET = (request) => handle(request, ctx());
export const POST = (request) => handle(request, ctx());
