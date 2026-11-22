// Lokale server: serveert public/ en /api/entries met opslag in het geheugen.
//   GROUP_CODE=test PORT=4173 node scripts/dev-server.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, handleImport, handleCosts, handlePlaces, health } from '../lib/handler.js';
import { readFileSync } from 'node:fs';
import { sheetConfig } from '../lib/sheet.js';
import { memoryStore } from '../lib/store.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const code = process.env.GROUP_CODE || 'test';
const store = memoryStore();
const sheet = sheetConfig();   // optioneel: SHEET_WEBHOOK_URL en SHEET_TOKEN
// Lokaal: kosten uit een JSON-bestand (COSTS_FIXTURE) in plaats van Google Sheets
// Lokaal: plekken met vaste RD-coördinaten (PLACES_RD='{"adres":[x,y]}') in plaats van PDOK
const placesFetch = process.env.PLACES_RD ? async (url) => {
  const q = decodeURIComponent(new URL(url).searchParams.get('q')), rd = JSON.parse(process.env.PLACES_RD)[q];
  return new Response(JSON.stringify({ response: { docs: rd ? [{ centroide_rd: `POINT(${rd[0]} ${rd[1]})` }] : [] } }));
} : undefined;
const sheetCosts = process.env.COSTS_FIXTURE ? async () => JSON.parse(readFileSync(process.env.COSTS_FIXTURE, 'utf8')) : async () => [];
const sheetRides = process.env.RIDES_FIXTURE ? async () => JSON.parse(readFileSync(process.env.RIDES_FIXTURE, 'utf8')) : async () => null;
const sheetPayments = process.env.PAYMENTS_FIXTURE ? async () => JSON.parse(readFileSync(process.env.PAYMENTS_FIXTURE, 'utf8')) : async () => [];
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    const routes = {
      '/api/entries': (r, c) => handle(r, c),
      '/api/sheet-import': (r, c) => handleImport(r, c),
      '/api/health': (_r, c) => health(c),
      '/api/costs': (r, c) => handleCosts(r, c),
      '/api/places': (r, c) => handlePlaces(r, c),
    };
    if (routes[url.pathname]) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method, headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await routes[url.pathname](request, { code, store: () => store, sheet, sheetCosts, sheetPayments, sheetRides, sheetId: process.env.SPREADSHEET_ID, places: process.env.PLACES, fetch: placesFetch });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const rel = normalize(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (rel.startsWith('..')) throw Object.assign(new Error('forbidden'), { code: 'ENOENT' });
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': types[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(err.code === 'ENOENT' ? 'Niet gevonden' : 'Serverfout');
  }
}).listen(port, () => console.log(`km-delen op http://localhost:${port} (groepscode: ${code})`));
