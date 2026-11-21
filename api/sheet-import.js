// Vercel Function: /api/sheet-import — formulier-invoer uit de Google Sheet inlezen
import { handleImport } from '../lib/handler.js';
import { ctx } from '../lib/context.js';

export const POST = (request) => handleImport(request, ctx());
