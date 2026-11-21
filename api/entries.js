// Vercel Function: /api/entries
import { handle } from '../lib/handler.js';
import { pgStore } from '../lib/pg-store.js';

let store;
const ctx = () => ({
  code: process.env.GROUP_CODE,
  // Supabase-integratie: POSTGRES_URL (pooler). Anders een eigen DATABASE_URL.
  store: () => (store ||= pgStore(process.env.POSTGRES_URL || process.env.DATABASE_URL)),
});

export function GET(request) {
  return handle(request, ctx());
}

export function POST(request) {
  return handle(request, ctx());
}
