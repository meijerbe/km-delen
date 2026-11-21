// Gedeelde context voor de Vercel Functions.
import { pgStore } from './pg-store.js';
import { sheetConfig } from './sheet.js';

let store;
export const ctx = () => ({
  code: process.env.GROUP_CODE,
  // Supabase-integratie: POSTGRES_URL (pooler). Anders een eigen DATABASE_URL.
  store: () => (store ||= pgStore(process.env.POSTGRES_URL || process.env.DATABASE_URL)),
  sheet: sheetConfig(),
});
