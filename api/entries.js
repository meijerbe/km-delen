// Vercel Function: /api/entries
import { handle } from '../lib/handler.js';
import { neonStore } from '../lib/neon-store.js';

let store;
const ctx = () => ({
  code: process.env.GROUP_CODE,
  store: () => (store ||= neonStore(process.env.DATABASE_URL || process.env.POSTGRES_URL)),
});

export function GET(request) {
  return handle(request, ctx());
}

export function POST(request) {
  return handle(request, ctx());
}
