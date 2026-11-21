// Lokale server: serveert public/ en /api/entries met opslag in het geheugen.
//   GROUP_CODE=test PORT=4173 node scripts/dev-server.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../lib/handler.js';
import { memoryStore } from '../lib/store.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const code = process.env.GROUP_CODE || 'test';
const store = memoryStore();
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname === '/api/entries') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method, headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await handle(request, { code, store: () => store });
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
