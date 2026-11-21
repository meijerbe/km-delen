// Vercel Function: /api/health — gebruikt door de keep-alive workflow
import { health } from '../lib/handler.js';
import { pgStore } from '../lib/pg-store.js';

let store;
export function GET() {
  return health({ store: () => (store ||= pgStore(process.env.POSTGRES_URL || process.env.DATABASE_URL)) });
}
