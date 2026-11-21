// Vercel Function: /api/places — jullie plekken op de buurtkaart (adressen blijven geheim)
import { handlePlaces } from '../lib/handler.js';
import { ctx } from '../lib/context.js';

export const GET = (request) => handlePlaces(request, ctx());
