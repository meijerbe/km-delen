// Vercel Function: /api/costs — kosten uit het tabblad Overige kosten
import { handleCosts } from '../lib/handler.js';
import { ctx } from '../lib/context.js';

export const GET = (request) => handleCosts(request, ctx());
