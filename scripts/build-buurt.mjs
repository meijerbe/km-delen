// Maakt public/buurt.json: de buurt rond Bergselaan × Bergpolderstraat (Rotterdam) als lichte 2,5D-data.
// Gebouwen met echte hoogte uit 3D BAG, straten/water/groen/bomen uit OpenStreetMap.
// Draait in GitHub Actions (workflow "Buurt bijwerken"); lokaal: node scripts/build-buurt.mjs
import { writeFileSync } from 'node:fs';

const HALF = 250;                         // m, halve zijde van het vierkant
const STREETS = ['Bergselaan', 'Bergpolderstraat'];
const FALLBACK_CENTER = { lat: 51.934131, lon: 4.466438 };   // gevonden kruising (nov 2026)
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = { 'User-Agent': 'km-delen diorama (github.com/meijerbe/km-delen)' };

// ---------- coördinaten ----------
/** WGS84 → Rijksdriehoek (benadering, ~1 m nauwkeurig) */
function toRD(lat, lon) {
  const dp = 0.36 * (lat - 52.15517440), dl = 0.36 * (lon - 5.38720621);
  const R = [[0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705], [3, 1, -2.340], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148]];
  const S = [[1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788], [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054]];
  let x = 155000, y = 463000;
  for (const [p, q, r] of R) x += r * dp ** p * dl ** q;
  for (const [p, q, s] of S) y += s * dp ** p * dl ** q;
  return [x, y];
}

// ---------- knippen ----------
const inside = (p, edge) => [p[0] >= -HALF, p[0] <= HALF, p[1] >= -HALF, p[1] <= HALF][edge];
function intersect(a, b, edge) {
  const v = [-HALF, HALF, -HALF, HALF][edge], axis = edge < 2 ? 0 : 1;
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
/** Sutherland–Hodgman tegen het vierkant */
function clipPoly(poly) {
  let out = poly;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur, e)) { if (!inside(prev, e)) out.push(intersect(prev, cur, e)); out.push(cur); }
      else if (inside(prev, e)) out.push(intersect(prev, cur, e));
    }
  }
  return out.length >= 3 ? out : null;
}
/** Lijn knippen (Liang–Barsky per segment), aaneengesloten stukken samenvoegen */
function clipLine(line) {
  const pieces = []; let cur = null;
  for (let i = 0; i < line.length - 1; i++) {
    let [x0, y0] = line[i], [x1, y1] = line[i + 1], t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0; let ok = true;
    for (const [p, q] of [[-dx, x0 + HALF], [dx, HALF - x0], [-dy, y0 + HALF], [dy, HALF - y0]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy];
    if (cur && t0 === 0) cur.push(b); else { cur = [a, b]; pieces.push(cur); }
    if (t1 < 1) cur = null;
  }
  return pieces;
}
const r1 = (v) => Math.round(v * 10) / 10;
const ring = (pts) => pts.map(([x, y]) => [r1(x), r1(y)]);
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2);

// ---------- ophalen ----------
async function overpass(q) {
  let last;
  for (let round = 0; round < 3; round++) {
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(90000) });
        if (!res.ok) throw new Error(`${url} → ${res.status}`);
        const json = await res.json();
        console.log(`overpass ok via ${url}`);
        return json;
      } catch (e) { last = e; console.warn('overpass', url, e.message); }
    }
    console.warn(`ronde ${round + 1} mislukt, even wachten…`);
    await new Promise((r) => setTimeout(r, 20000));
  }
  throw last;
}

async function findCenter() {
  const q = `[out:json][timeout:60];
area["name"="Rotterdam"]["boundary"="administrative"]->.r;
way(area.r)["highway"]["name"="${STREETS[0]}"]->.a;
way(area.r)["highway"]["name"="${STREETS[1]}"]->.b;
node(w.a)->.na; node(w.b)->.nb;
node.na.nb; out;`;
  try {
    const d = await overpass(q);
    if (d.elements?.length) {
      const lat = d.elements.reduce((s, n) => s + n.lat, 0) / d.elements.length;
      const lon = d.elements.reduce((s, n) => s + n.lon, 0) / d.elements.length;
      console.log(`Kruising gevonden: ${d.elements.length} knoop/knopen, ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
      return { lat, lon };
    }
    console.warn('Geen gedeelde knoop gevonden, val terug op vaste coördinaten');
  } catch (e) { console.warn('center', e.message); }
  return FALLBACK_CENTER;
}

/** 3D BAG via WFS (LoD 1.2, voetafdruk + hoogtes in RD). Probeert een paar varianten. */
async function bag3d(cx, cy) {
  const bbox = [cx - HALF - 30, cy - HALF - 30, cx + HALF + 30, cy + HALF + 30].map(Math.round).join(',');
  const urls = [
    `https://data.3dbag.nl/api/BAG3D/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BAG3D:lod12&OUTPUTFORMAT=application/json&SRSNAME=EPSG:28992&BBOX=${bbox},EPSG:28992&COUNT=10000`,
    `https://data.3dbag.nl/api/BAG3D/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BAG3D:pand&OUTPUTFORMAT=application/json&SRSNAME=EPSG:28992&BBOX=${bbox},EPSG:28992&COUNT=10000`,
    `https://data.3dbag.nl/api/BAG3D_v2/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BAG3D_v2:lod12&OUTPUTFORMAT=application/json&SRSNAME=EPSG:28992&BBOX=${bbox},EPSG:28992&COUNT=10000`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith('{')) { console.warn('3dbag', res.status, text.slice(0, 160)); continue; }
      const fc = JSON.parse(text);
      if (fc.features?.length) {
        console.log(`3D BAG: ${fc.features.length} panden via ${url.split('?')[0]} (${url.match(/TYPENAMES=([^&]+)/)[1]})`);
        console.log('Attribuutnamen:', Object.keys(fc.features[0].properties).join(', '));
        const p0 = fc.features[0].properties;
        console.log('Hoogte-attributen:', JSON.stringify(Object.fromEntries(Object.entries(p0).filter(([k]) => /h_|maaiveld|ground/i.test(k)))));
        return fc.features;
      }
      console.warn('3dbag leeg', url.slice(0, 120));
    } catch (e) { console.warn('3dbag', e.message); }
  }
  return null;
}

const GROUND_NAP = -1.5;   // maaiveld in Bergpolder ligt rond NAP −1 à −2 m (terugval)
function heightOf(props) {
  const p = props || {};
  const roof = p.b3_h_70p ?? p.b3_h_dak_70p ?? p.h_dak_70p ?? p.b3_h_50p ?? p.b3_h_dak_50p ?? p.b3_h_max ?? p.h_dak_max;
  const ground = p.b3_h_maaiveld ?? p.h_maaiveld ?? p.b3_maaiveld ?? GROUND_NAP;
  const h = Number(roof) - Number(ground);
  return Number.isFinite(h) && h > 1 && h < 250 ? h : null;
}

// ---------- hoofdprogramma ----------
const center = await findCenter();
const [cx, cy] = toRD(center.lat, center.lon);
const local = (lat, lon) => { const [x, y] = toRD(lat, lon); return [x - cx, y - cy]; };
const dLat = (HALF + 60) / 111320, dLon = (HALF + 60) / (111320 * Math.cos(center.lat * Math.PI / 180));
const bb = [center.lat - dLat, center.lon - dLon, center.lat + dLat, center.lon + dLon].map((v) => v.toFixed(6)).join(',');

const osm = await overpass(`[out:json][timeout:80][bbox:${bb}];
(
  way["highway"];
  way["building"]; relation["building"];
  way["natural"="water"]; relation["natural"="water"]; way["waterway"~"canal|river|stream|ditch"];
  way["leisure"~"park|garden|playground|pitch|common"]; relation["leisure"="park"];
  way["landuse"~"grass|recreation_ground|village_green|meadow|forest|allotments|cemetery"];
  way["natural"~"wood|scrub|grassland"];
  node["natural"="tree"];
  way["railway"~"rail|tram|light_rail|subway"];
);
out geom;`);
console.log(`OSM: ${osm.elements.length} elementen`);

const out = {
  center, half: HALF, rd: [Math.round(cx), Math.round(cy)],
  buildings: [], roads: [], water: [], green: [], trees: [], rails: [],
  attribution: '© OpenStreetMap-bijdragers (ODbL) · 3D BAG (TU Delft, CC BY 4.0)',
  built: new Date().toISOString(),
};

const ROAD_W = { motorway: 14, trunk: 12, primary: 11, secondary: 9, tertiary: 8, unclassified: 6, residential: 6, living_street: 5, service: 3.5, pedestrian: 4, footway: 2, path: 2, cycleway: 2.5, steps: 2, track: 3 };
const polysOf = (el) => {
  if (el.type === 'way' && el.geometry?.length > 3) return [el.geometry.map((g) => local(g.lat, g.lon))];
  if (el.type === 'relation') return (el.members || []).filter((m) => m.role === 'outer' && m.geometry?.length > 3 && m.geometry[0].lat === m.geometry.at(-1).lat && m.geometry[0].lon === m.geometry.at(-1).lon).map((m) => m.geometry.map((g) => local(g.lat, g.lon)));
  return [];
};

for (const el of osm.elements) {
  const t = el.tags || {};
  if (el.type === 'node' && t.natural === 'tree') {
    const [x, y] = local(el.lat, el.lon);
    if (Math.abs(x) < HALF - 1 && Math.abs(y) < HALF - 1) out.trees.push([r1(x), r1(y)]);
    continue;
  }
  if (t.highway && el.type === 'way' && t.tunnel !== 'yes' && t.area !== 'yes') {
    const w = ROAD_W[t.highway] ?? (t.highway.endsWith('_link') ? 6 : null);
    if (!w) continue;
    for (const piece of clipLine(el.geometry.map((g) => local(g.lat, g.lon)))) {
      out.roads.push({ l: ring(piece), w, k: ['footway', 'path', 'cycleway', 'steps', 'pedestrian'].includes(t.highway) ? (t.highway === 'cycleway' ? 'fiets' : 'voet') : 'weg' });
    }
    continue;
  }
  if (t.railway && el.type === 'way' && t.tunnel !== 'yes') {
    for (const piece of clipLine(el.geometry.map((g) => local(g.lat, g.lon)))) out.rails.push({ l: ring(piece), k: t.railway });
    continue;
  }
  if (t.waterway && el.type === 'way' && !t.natural) {
    for (const piece of clipLine(el.geometry.map((g) => local(g.lat, g.lon)))) out.water.push({ line: ring(piece), w: t.waterway === 'canal' || t.waterway === 'river' ? 12 : 4 });
    continue;
  }
  const isWater = t.natural === 'water';
  const isGreen = /park|garden|playground|pitch|common/.test(t.leisure || '') || /grass|recreation_ground|village_green|meadow|forest|allotments|cemetery/.test(t.landuse || '') || /wood|scrub|grassland/.test(t.natural || '');
  const isBuilding = !!t.building && t.building !== 'no';
  if (!isWater && !isGreen && !isBuilding) continue;
  for (const poly of polysOf(el)) {
    const c = clipPoly(poly.slice(0, -1));
    if (!c || area(c) < 4) continue;
    if (isWater) out.water.push({ p: ring(c) });
    else if (isGreen) out.green.push({ p: ring(c), k: t.leisure === 'pitch' ? 'veld' : t.leisure === 'playground' ? 'speel' : 'gras' });
    else out.buildings.push({ p: ring(c), h: Number(t['building:levels']) > 0 ? Number(t['building:levels']) * 3.1 + 1 : null, src: 'osm', bag: t['ref:bag'] || null });
  }
}

// Gebouwen: 3D BAG heeft voorrang (echte hoogte); OSM alleen als terugval
const bag = await bag3d(cx, cy);
if (bag) {
  const fromBag = [];
  for (const f of bag) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    const h = heightOf(f.properties);
    for (const pg of polys) {
      const outer = pg[0].slice(0, -1).map(([x, y]) => [x - cx, y - cy]);
      const c = clipPoly(outer);
      if (!c || area(c) < 4) continue;
      fromBag.push({ p: ring(c), h: h ? Math.round(h * 10) / 10 : null, src: 'bag' });
    }
  }
  if (fromBag.length > 20) {
    console.log(`Gebouwen uit 3D BAG: ${fromBag.length} (met hoogte: ${fromBag.filter((b) => b.h).length})`);
    out.buildings = fromBag;
  }
}
for (const b of out.buildings) {
  if (!b.h) b.h = 10;                     // terugval: ± 3 bouwlagen
  delete b.bag;
}
console.log(`Resultaat: ${out.buildings.length} gebouwen (${out.buildings.filter((b) => b.src === 'bag').length} uit 3D BAG), ${out.roads.length} wegdelen, ${out.water.length} water, ${out.green.length} groen, ${out.trees.length} bomen, ${out.rails.length} spoor`);
writeFileSync(new URL('../public/buurt.json', import.meta.url), JSON.stringify(out));
console.log('Geschreven: public/buurt.json');
