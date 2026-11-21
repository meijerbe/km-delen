// Het Polo-diorama: de buurt als vrolijk speelgoedblok (poppenhuis-game-stijl) met de geparkeerde Polo erop.
// Wordt pas geladen als iemand het tabblad opent.
import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Fog, HemisphereLight, DirectionalLight, AmbientLight,
  Group, Mesh, InstancedMesh, Object3D, BoxGeometry, CylinderGeometry, ConeGeometry, IcosahedronGeometry, SphereGeometry,
  PlaneGeometry, ExtrudeGeometry, ShapeGeometry, Shape, BufferGeometry, Float32BufferAttribute,
  MeshLambertMaterial, MeshStandardMaterial, MeshBasicMaterial, Raycaster, Vector2, Vector3, MathUtils, PCFSoftShadowMap,
  SRGBColorSpace, DoubleSide, OrbitControls, mergeGeometries,
} from './vendor/three-bundle.js';

const PAL = {
  grass: '#8ED36B', field: '#74C455', play: '#F7D78E',
  pave: '#EFE6D5', curb: '#CFC3AC', asphalt: '#646A74', dash: '#FFFFFF', bike: '#DB7A6C', foot: '#F3EBDC', rail: '#8C9096',
  water: '#5CC6EE',
  layers: [['#7CC65A', 0.9], ['#A9805C', 3.0], ['#6B4B33', 3.1], ['#E8C987', 3.0]],
  walls: ['#EC8E6F', '#F7E5B6', '#A8DEC6', '#AACDEE', '#F7D877', '#CDB8EA', '#F5A493', '#FBF4E6', '#EBBB8C', '#9FD5DD'],
  roofs: ['#5D7FA3', '#C9644F', '#4E9285', '#8172A8', '#D4824A', '#6E7380'],
  frame: '#FFFFFF', glass: '#7EC6F2', glassNight: '#FFD36E', glassDark: '#2E3A5C',
  flowers: ['#FF6F96', '#FFD34D', '#FF9F45', '#B07BFF', '#FF5757', '#FFFFFF'],
  leaves: ['#56BA45', '#6BCB4E', '#4AA83B', '#7BD65C', '#5FC24A'], trunk: '#8A5A3B',
  cars: ['#E94F4F', '#F2C230', '#3FA7E0', '#FFFFFF', '#33343B', '#6CC36A', '#F08A3C', '#B05FD9', '#E87AB0'],
  people: ['#FF6B6B', '#4DA3FF', '#FFD24D', '#6CD48A', '#B987FF', '#FF9F5A', '#3DC6C0'], skin: ['#F6CDAE', '#E2A985', '#B97C56', '#F1D3B9'],
  lampPost: '#3B3F47', lampDay: '#F4F1E8', lampNight: '#FFE39A',
};

const mat = (c, extra = {}) => new MeshLambertMaterial({ color: new Color(c), ...extra });
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const rnd = (seed) => (hash(seed) % 10000) / 10000;
const shapeOf = (pts) => { const s = new Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return s; };
const pick = (arr, seed) => arr[hash(seed) % arr.length];

function flat(polys, y) {
  const geos = polys.map((p) => { const g = new ShapeGeometry(shapeOf(p)); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g; });
  return geos.length ? mergeGeometries(geos) : null;
}

/** Lijnen als linten met rondjes op de knikken (kaart-y → three -z) */
function ribbons(lines, y) {
  const pos = [];
  const push = (...pts) => pts.forEach(([x, z]) => pos.push(x, y, z));
  for (const { l, w } of lines) {
    const h = w / 2;
    for (let i = 0; i < l.length - 1; i++) {
      const [x0, y0] = l[i], [x1, y1] = l[i + 1];
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * h, ny = (dx / len) * h;
      push([x0 + nx, -(y0 + ny)], [x0 - nx, -(y0 - ny)], [x1 + nx, -(y1 + ny)], [x1 + nx, -(y1 + ny)], [x0 - nx, -(y0 - ny)], [x1 - nx, -(y1 - ny)]);
    }
    for (const [x, yy] of l) {
      for (let k = 0; k < 10; k++) {
        const t0 = (k / 10) * Math.PI * 2, t1 = ((k + 1) / 10) * Math.PI * 2;
        push([x, -yy], [x + Math.cos(t1) * h, -yy - Math.sin(t1) * h], [x + Math.cos(t0) * h, -yy - Math.sin(t0) * h]);
      }
    }
  }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Punten langs een lijn om de `step` m, met zijwaartse verschuiving `side` (+ = links). */
function along(line, step, side, seed = '') {
  const out = [];
  let carry = step * rnd(`${seed}c`);
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0); if (!L) continue;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    let d = carry;
    for (; d < L; d += step) out.push({ x: x0 + ux * d - uy * side, y: y0 + uy * d + ux * side, ang: Math.atan2(uy, ux) });
    carry = d - L;
  }
  return out;
}

const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

/** Snelle "staat dit punt in een gebouw?"-check met een rooster */
function buildingIndex(buildings) {
  const cell = 25, grid = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  buildings.forEach((b, i) => {
    const xs = b.p.map((p) => p[0]), ys = b.p.map((p) => p[1]);
    for (let cx = Math.floor(Math.min(...xs) / cell); cx <= Math.floor(Math.max(...xs) / cell); cx++)
      for (let cy = Math.floor(Math.min(...ys) / cell); cy <= Math.floor(Math.max(...ys) / cell); cy++) {
        const k = key(cx, cy); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
  });
  return (x, y) => (grid.get(key(Math.floor(x / cell), Math.floor(y / cell))) || []).some((i) => inPoly(x, y, buildings[i].p));
}

/** Het Polootje */
function polo() {
  const g = new Group();
  const blue = mat('#A8D4F0'), darker = mat('#86BEE2'), glass = mat('#E4F3FC'), tyre = mat('#2C2F33'), rim = mat('#D9E0E6');
  const body = new Mesh(new BoxGeometry(3.9, 1.0, 1.7), blue); body.position.y = 0.75;
  const skirt = new Mesh(new BoxGeometry(3.95, 0.35, 1.72), darker); skirt.position.y = 0.42;
  const cabin = new Mesh(new BoxGeometry(2.3, 0.85, 1.55), blue); cabin.position.set(-0.25, 1.6, 0);
  const win = new Mesh(new BoxGeometry(2.1, 0.62, 1.58), glass); win.position.set(-0.25, 1.62, 0);
  const light = new Mesh(new BoxGeometry(0.06, 0.22, 0.4), mat('#FFF3C4', { emissive: new Color('#FFE58A'), emissiveIntensity: 0 }));
  const light2 = light.clone(); light.position.set(1.96, 0.85, 0.55); light2.position.set(1.96, 0.85, -0.55);
  const tail = new Mesh(new BoxGeometry(0.06, 0.3, 0.25), mat('#F06B5E')); tail.position.set(-1.96, 0.95, 0.6);
  const tail2 = tail.clone(); tail2.position.z = -0.6;
  g.add(body, skirt, cabin, win, light, light2, tail, tail2);
  for (const [x, z] of [[1.25, 0.86], [1.25, -0.86], [-1.25, 0.86], [-1.25, -0.86]]) {
    const w = new Mesh(new CylinderGeometry(0.42, 0.42, 0.3, 16), tyre); w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z);
    const r = new Mesh(new CylinderGeometry(0.22, 0.22, 0.32, 12), rim); r.rotation.x = Math.PI / 2; r.position.set(x, 0.42, z);
    g.add(w, r);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.lights = [light.material];
  g.scale.setScalar(2.2);
  return g;
}

/** Wiebelende pin boven de auto (eigen ontwerp: rode druppel met witte stip) */
function pin() {
  const g = new Group();
  const red = new MeshStandardMaterial({ color: '#EE6C4D', roughness: 0.45 });
  const head = new Mesh(new SphereGeometry(2.8, 24, 16), red); head.position.y = 6.2;
  const tip = new Mesh(new ConeGeometry(1.85, 4.4, 24), red); tip.rotation.x = Math.PI; tip.position.y = 3.2;
  const dot = new Mesh(new SphereGeometry(1.05, 16, 12), new MeshBasicMaterial({ color: '#FFFFFF' })); dot.position.set(0, 6.6, 2.3);
  g.add(head, tip, dot);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Instanced mesh: transformaties + kleuren in één keer */
function instanced(geo, material, items, place, colorOf) {
  if (!items.length) return null;
  const m = new InstancedMesh(geo, material, items.length);
  const o = new Object3D();
  items.forEach((it, i) => {
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    place(o, it, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (colorOf) m.setColorAt(i, new Color(colorOf(it, i)));
  });
  return m;
}

export async function createDiorama(container, { onHonk } = {}) {
  const data = await (await fetch('buurt.json', { cache: 'force-cache' })).json();
  const H = data.half, D = H * 2;
  const inBuilding = buildingIndex(data.buildings);
  const inside = (x, y, m = 2) => Math.abs(x) < H - m && Math.abs(y) < H - m;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.fog = new Fog('#DDEFF8', 1400, 3200);
  const camera = new PerspectiveCamera(50, 1, 1, 6000);

  // ---------- licht ----------
  const hemi = new HemisphereLight('#FFFFFF', '#B5D69A', 1.15);
  const amb = new AmbientLight('#FFF4E6', 0.55);
  const sun = new DirectionalLight('#FFF1D6', 1.9);
  sun.position.set(-260, 420, 200);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -H - 40, right: H + 40, top: H + 40, bottom: -H - 40, near: 50, far: 1200 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
  scene.add(hemi, amb, sun);

  // ---------- kavel met ondergrond ----------
  let depth = 0;
  for (const [color, t] of PAL.layers) {
    const m = new Mesh(new BoxGeometry(D, t, D), mat(color));
    m.position.y = -depth - t / 2; depth += t; m.receiveShadow = true; scene.add(m);
  }
  const top = new Mesh(new PlaneGeometry(D, D), mat(PAL.grass));
  top.rotation.x = -Math.PI / 2; top.position.y = 0.01; top.receiveShadow = true; scene.add(top);

  // ---------- groen, water, straten ----------
  const add = (geo, color, opts = {}) => { if (!geo) return null; const m = new Mesh(geo, mat(color, { side: DoubleSide, ...opts })); m.receiveShadow = true; scene.add(m); return m; };
  add(flat(data.green.filter((g) => g.k === 'veld').map((g) => g.p), 0.06), PAL.field);
  add(flat(data.green.filter((g) => g.k === 'speel').map((g) => g.p), 0.06), PAL.play);
  add(ribbons(data.water.filter((w) => w.line).map((w) => ({ l: w.line, w: w.w })), 0.08), PAL.water);
  add(flat(data.water.filter((w) => w.p).map((w) => w.p), 0.08), PAL.water);
  const streets = data.roads.filter((r) => r.k === 'weg');
  add(ribbons(streets.map((r) => ({ l: r.l, w: r.w + 6.2 })), 0.16), PAL.curb);         // stoeprand
  add(ribbons(streets.map((r) => ({ l: r.l, w: r.w + 5.6 })), 0.22), PAL.pave);          // stoep
  add(ribbons(data.roads.filter((r) => r.k === 'voet').map((r) => ({ l: r.l, w: r.w + 0.6 })), 0.22), PAL.foot);
  add(ribbons(streets, 0.26), PAL.asphalt);
  add(ribbons(data.roads.filter((r) => r.k === 'fiets'), 0.28), PAL.bike);
  add(ribbons(data.rails.map((r) => ({ l: r.l, w: 1.8 })), 0.3), PAL.rail);

  // middenstrepen op bredere straten
  const dashes = streets.filter((r) => r.w >= 6).flatMap((r, i) => along(r.l, 7, 0, `d${i}`));
  const dashMesh = instanced(new PlaneGeometry(2.8, 0.28), mat(PAL.dash), dashes,
    (o, d) => { o.position.set(d.x, 0.3, -d.y); o.rotation.set(-Math.PI / 2, 0, d.ang); });
  if (dashMesh) { dashMesh.receiveShadow = true; scene.add(dashMesh); }

  // ---------- huizen ----------
  const houseGeos = [], wins = [], boxes = [], chimneys = [];
  const wallC = new Color(), roofC = new Color();
  const paint = (geo, c) => {
    const n = geo.attributes.position.count, cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new Float32BufferAttribute(cols, 3));
    return geo;
  };
  data.buildings.forEach((b, bi) => {
    const key = hash(b.p.flat().slice(0, 6).join(','));
    wallC.set(PAL.walls[key % PAL.walls.length]); roofC.set(PAL.roofs[(key >>> 5) % PAL.roofs.length]);
    const shape = shapeOf(b.p);
    const wall = new ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
    wall.rotateX(-Math.PI / 2); houseGeos.push(paint(wall, wallC));
    // dik, overstekend dak
    const roof = new ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.85, bevelSegments: 2 });
    roof.rotateX(-Math.PI / 2); roof.translate(0, b.h, 0); houseGeos.push(paint(roof, roofC));

    if (b.h < 3) return;
    const pts = b.p, ccw = pts.reduce((a, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return a + (x * y2 - x2 * y); }, 0) > 0;
    const floors = Math.max(1, Math.floor((b.h - 1.2) / 3));
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      const L = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(L / 3.4);
      if (n < 1) continue;
      let nx = (y1 - y0) / L, ny = -(x1 - x0) / L;
      if (!ccw) { nx = -nx; ny = -ny; }
      for (let c = 0; c < n; c++) {
        const t = (c + 0.5) / n, x = x0 + (x1 - x0) * t + nx * 0.06, y = y0 + (y1 - y0) * t + ny * 0.06;
        for (let f = 0; f < floors; f++) {
          wins.push({ x, y, yy: 1.8 + f * 3, nx, ny, lit: hash(`${bi}w${i}.${c}.${f}`) % 3 !== 0 });
          if (f >= 1 && hash(`${bi}b${i}.${c}.${f}`) % 3 === 0) boxes.push({ x: x + nx * 0.3, y: y + ny * 0.3, yy: 0.7 + f * 3, nx, ny, c: pick(PAL.flowers, `${bi}${i}${c}${f}`) });
        }
      }
    }
    if (key % 3 === 0 && b.h > 5) {
      const [cx, cy] = b.p.reduce(([a, c], [x, y]) => [a + x / b.p.length, c + y / b.p.length], [0, 0]);
      chimneys.push({ x: cx + ((key >>> 8) % 5) - 2, y: cy + ((key >>> 12) % 5) - 2, h: b.h + 1.05 });
    }
  });
  for (let i = 0; i < houseGeos.length; i += 400) {
    const m = new Mesh(mergeGeometries(houseGeos.slice(i, i + 400)), new MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
  }
  const face = (o, w) => { o.position.set(w.x, w.yy, -w.y); o.lookAt(w.x + w.nx, w.yy, -(w.y + w.ny)); };
  const frames = instanced(new PlaneGeometry(1.75, 2.15), mat(PAL.frame), wins, face);
  const glass = instanced(new PlaneGeometry(1.3, 1.7), new MeshBasicMaterial({ color: '#FFFFFF' }), wins,
    (o, w) => { face(o, w); o.position.x += w.nx * 0.04; o.position.z -= w.ny * 0.04; }, () => PAL.glass);
  const flowerBoxes = instanced(new BoxGeometry(1.8, 0.5, 0.55), mat('#FFFFFF'), boxes, (o, b) => face(o, b), (b) => b.c);
  const chim = instanced(new BoxGeometry(1.5, 2.4, 1.5), mat('#B8705E'), chimneys, (o, c) => o.position.set(c.x, c.h + 1.2, -c.y));
  [frames, glass, flowerBoxes, chim].forEach((m) => m && scene.add(m));
  if (chim) chim.castShadow = true;
  if (flowerBoxes) flowerBoxes.castShadow = true;

  // ---------- bomen, struiken, bloemetjes ----------
  const treePts = data.trees.map(([x, y]) => ({ x, y }));
  const near = (p, list, d) => list.some((q) => Math.abs(q.x - p.x) < d && Math.abs(q.y - p.y) < d);
  streets.filter((r) => r.w >= 6).forEach((r, i) => {
    for (const side of [1, -1]) {
      for (const p of along(r.l, 12 + (i % 4), side * (r.w / 2 + 1.6), `t${i}${side}`)) {
        if (treePts.length > 900) break;
        if (inside(p.x, p.y, 3) && !inBuilding(p.x, p.y) && !near(p, treePts, 5)) treePts.push(p);
      }
    }
  });
  const greenPolys = data.green.filter((g) => g.k === 'gras');
  const scatter = (count, seed) => {
    const out = [];
    for (const g of greenPolys) {
      const xs = g.p.map((q) => q[0]), ys = g.p.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const n = Math.min(count, Math.floor(((x1 - x0) * (y1 - y0)) / 60));
      for (let i = 0; i < n * 2 && out.length < 1500; i++) {
        const x = x0 + rnd(`${seed}${g.p[0]}${i}x`) * (x1 - x0), y = y0 + rnd(`${seed}${g.p[0]}${i}y`) * (y1 - y0);
        if (inPoly(x, y, g.p) && !inBuilding(x, y)) out.push({ x, y });
      }
    }
    return out;
  };
  for (const p of scatter(12, 'park')) if (treePts.length < 1100 && !near(p, treePts, 6)) treePts.push(p);
  const treeScale = (p) => 0.85 + rnd(`${p.x}s${p.y}`) * 0.5;
  const trunks = instanced(new CylinderGeometry(0.35, 0.5, 3.2, 6), mat(PAL.trunk), treePts,
    (o, p) => { const s = treeScale(p); o.position.set(p.x, 1.6 * s, -p.y); o.scale.setScalar(s); });
  const crowns = instanced(new SphereGeometry(2.6, 12, 9), mat('#FFFFFF'), treePts,
    (o, p) => { const s = treeScale(p); o.position.set(p.x, 5.2 * s, -p.y); o.scale.set(s, s * 1.05, s); },
    (p) => pick(PAL.leaves, `${p.x}${p.y}`));
  const bushes = instanced(new IcosahedronGeometry(1.1, 1), mat('#FFFFFF', { flatShading: true }), scatter(10, 'bush'),
    (o, p) => { o.position.set(p.x, 0.7, -p.y); o.scale.set(1.3, 0.8, 1.3); }, (p) => pick(PAL.leaves, `b${p.x}`));
  const flowers = instanced(new SphereGeometry(0.42, 6, 4), mat('#FFFFFF'), scatter(30, 'flower'),
    (o, p) => o.position.set(p.x, 0.35, -p.y), (p) => pick(PAL.flowers, `f${p.x}${p.y}`));
  [trunks, crowns, bushes].forEach((m) => { if (m) { m.castShadow = true; scene.add(m); } });
  if (flowers) scene.add(flowers);

  // ---------- lantaarnpalen ----------
  const lamps = streets.filter((r) => r.w >= 6).flatMap((r, i) => along(r.l, 30, (r.w / 2 + 2.3) * (i % 2 ? 1 : -1), `l${i}`))
    .filter((p) => inside(p.x, p.y, 3) && !inBuilding(p.x, p.y)).slice(0, 250);
  const posts = instanced(new CylinderGeometry(0.18, 0.25, 6, 6), mat(PAL.lampPost), lamps, (o, p) => o.position.set(p.x, 3, -p.y));
  const lampMat = new MeshBasicMaterial({ color: PAL.lampDay });
  const heads = instanced(new SphereGeometry(0.75, 10, 8), lampMat, lamps, (o, p) => o.position.set(p.x, 6.2, -p.y));
  if (posts) { posts.castShadow = true; scene.add(posts, heads); }

  // ---------- geparkeerde autootjes ----------
  const parked = streets.filter((r) => r.w >= 6).flatMap((r, i) => [1, -1].flatMap((side) => along(r.l, 6.8, side * (r.w / 2 - 1.1), `c${i}${side}`)
    .filter((p, j) => hash(`${i}${side}${j}`) % 5 < 2 && inside(p.x, p.y, 4) && !inBuilding(p.x, p.y))
    .map((p) => ({ ...p, ang: side > 0 ? p.ang : p.ang + Math.PI }))))
    .slice(0, 260);
  const carBody = new BoxGeometry(4.0, 1.1, 1.8); carBody.translate(0, 0.8, 0);
  const carTop = new BoxGeometry(2.2, 0.85, 1.6); carTop.translate(-0.2, 1.75, 0);
  const placeCar = (o, p) => { o.position.set(p.x, 0.26, -p.y); o.rotation.y = p.ang; o.scale.setScalar(1.6); };
  const cars = instanced(mergeGeometries([carBody, carTop]), mat('#FFFFFF'), parked, placeCar, (p, i) => pick(PAL.cars, `car${i}`));
  const carGlass = new BoxGeometry(2.0, 0.6, 1.64); carGlass.translate(-0.2, 1.78, 0);
  const glassCars = instanced(carGlass, mat('#CFE8F6'), parked, placeCar);
  if (cars) { cars.castShadow = true; scene.add(cars, glassCars); }

  // ---------- wandelaars ----------
  const paths = streets.filter((r) => r.w >= 6).map((r, i) => along(r.l, 2, (r.w / 2 + 1.4) * (i % 2 ? 1 : -1), `p${i}`).filter((p) => inside(p.x, p.y, 3)))
    .filter((pts) => pts.length > 20);
  const walkers = paths.length ? Array.from({ length: Math.min(45, paths.length * 2) }, (_, i) => ({
    path: paths[i % paths.length], s: rnd(`w${i}`) * 1000, v: (0.9 + rnd(`v${i}`) * 0.7) * (i % 2 ? 1 : -1), i,
  })) : [];
  const bodyGeo = new CylinderGeometry(0.5, 0.65, 1.6, 8); bodyGeo.translate(0, 1.1, 0);
  const headGeo = new SphereGeometry(0.48, 10, 8); headGeo.translate(0, 2.3, 0);
  const people = instanced(bodyGeo, mat('#FFFFFF'), walkers, () => {}, (w) => pick(PAL.people, `pc${w.i}`));
  const peopleHeads = instanced(headGeo, mat('#FFFFFF'), walkers, () => {}, (w) => pick(PAL.skin, `ps${w.i}`));
  if (people) { people.castShadow = true; scene.add(people, peopleHeads); }
  const wo = new Object3D();
  const moveWalkers = (t) => {
    if (!people) return;
    walkers.forEach((w, i) => {
      const n = w.path.length, f = (((w.s + t * w.v) % n) + n) % n, k = Math.floor(f), a = w.path[k], b = w.path[(k + 1) % n], u = f - k;
      wo.position.set(a.x + (b.x - a.x) * u, 0.22 + Math.abs(Math.sin((t + i) * 6)) * 0.15, -(a.y + (b.y - a.y) * u));
      wo.rotation.set(0, 0, 0); wo.scale.setScalar(1.3); wo.updateMatrix();
      people.setMatrixAt(i, wo.matrix); peopleHeads.setMatrixAt(i, wo.matrix);
    });
    people.instanceMatrix.needsUpdate = true; peopleHeads.instanceMatrix.needsUpdate = true;
  };

  // ---------- wolkjes ----------
  const cloudGeo = mergeGeometries([[0, 0, 0, 9], [8, 1, 2, 7], [-8, -1, 1, 6.5], [3, 4, -2, 6], [-3, 2, 3, 5.5]]
    .map(([x, y, z, r]) => { const g = new SphereGeometry(r, 12, 9); g.translate(x, y, z); return g; }));
  const clouds = Array.from({ length: 7 }, (_, i) => ({ x: -H + rnd(`cx${i}`) * D, z: -H + rnd(`cz${i}`) * D, y: 240 + rnd(`cy${i}`) * 60, s: 1 + rnd(`cs${i}`) * 0.8 }));
  const cloudMat = new MeshLambertMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.92 });
  const cloudMesh = instanced(cloudGeo, cloudMat, clouds, () => {});
  scene.add(cloudMesh);
  const co = new Object3D();
  const moveClouds = (t) => {
    clouds.forEach((c, i) => {
      const x = ((c.x + t * 4 + H + 200) % (D + 400)) - H - 200;
      co.position.set(x, c.y, c.z); co.scale.set(c.s, c.s * 0.7, c.s); co.updateMatrix(); cloudMesh.setMatrixAt(i, co.matrix);
    });
    cloudMesh.instanceMatrix.needsUpdate = true;
  };

  // ---------- Polo + pin ----------
  const car = polo(); scene.add(car);
  const marker = pin(); scene.add(marker);
  car.visible = marker.visible = false;
  const roadHeading = (x, y) => {
    let best = Infinity, ang = 0;
    for (const r of streets) {
      for (let i = 0; i < r.l.length - 1; i++) {
        const [x0, y0] = r.l[i], [x1, y1] = r.l[i + 1], dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
        const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
        if (d < best) { best = d; ang = Math.atan2(dy, dx); }
      }
    }
    return best < 40 ? ang : 0;
  };
  const setCar = (x, y) => {
    car.visible = marker.visible = true;
    car.position.set(x, 0.26, -y); car.rotation.y = roadHeading(x, y);
    marker.position.set(x, 9, -y);
  };

  // ---------- camera ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 25; controls.maxDistance = 1500;
  controls.maxPolarAngle = MathUtils.degToRad(78);
  controls.target.set(0, 0, 0);
  controls.screenSpacePanning = false;

  const overview = () => {
    const aspect = Math.max(0.3, camera.aspect || 0.5);
    const hfov = 2 * Math.atan(Math.tan(MathUtils.degToRad(camera.fov / 2)) * aspect);
    const dist = Math.max((H * 1.3) / Math.tan(hfov / 2), (H * 1.2) / Math.tan(MathUtils.degToRad(camera.fov / 2)));
    return new Vector3(Math.sin(0.5) * dist * 0.72, dist * 0.68, Math.cos(0.5) * dist * 0.72);
  };
  let fly = null;
  const flyTo = (target, offset, sec = 1.8) => {
    fly = { t: 0, sec, from: camera.position.clone(), fromT: controls.target.clone(), toT: target.clone(), to: target.clone().add(offset) };
  };

  // ---------- tikken ----------
  const ray = new Raycaster(), ndc = new Vector2();
  let hop = 0, down = null, pickCb = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (pickCb) {
      const hit = ray.intersectObject(top)[0];
      if (hit && Math.abs(hit.point.x) <= H && Math.abs(hit.point.z) <= H) { const cb = pickCb; pickCb = null; cb(hit.point.x, -hit.point.z); }
      return;
    }
    if (car.visible && ray.intersectObjects([car, marker], true).length) { hop = 1; onHonk?.(); }
  });

  // ---------- dag en nacht ----------
  function daylight() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const night = h < 6.5 || h > 19.5 ? 1 : h < 8 ? (8 - h) / 1.5 : h > 18 ? (h - 18) / 1.5 : 0;
    const n = night > 0.5;
    sun.intensity = 1.9 * (1 - night * 0.6);
    hemi.intensity = 1.15 * (1 - night * 0.3);
    hemi.color.set(n ? '#C3CFF2' : '#FFFFFF');
    amb.intensity = n ? 0.4 : 0.55;
    car.userData.lights.forEach((m) => { m.emissiveIntensity = n ? 1.2 : 0; });
    lampMat.color.set(n ? PAL.lampNight : PAL.lampDay);
    if (glass) {
      wins.forEach((w, i) => glass.setColorAt(i, new Color(n ? (w.lit ? PAL.glassNight : PAL.glassDark) : PAL.glass)));
      glass.instanceColor.needsUpdate = true;
    }
    cloudMat.color.set(n ? '#8E9BC0' : '#FFFFFF');
    scene.fog.color.set(n ? '#2A3358' : '#DDEFF8');
    container.classList.toggle('night', n);
  }
  daylight();

  // ---------- label boven de pin ----------
  const label = container.querySelector('.polo-label');
  const tmp = new Vector3();
  function placeLabel() {
    if (!label) return;
    tmp.copy(marker.position); tmp.y += 12; tmp.project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    label.style.transform = `translate(-50%, -100%) translate(${(tmp.x * 0.5 + 0.5) * r.width}px, ${(-tmp.y * 0.5 + 0.5) * r.height}px)`;
    label.style.opacity = tmp.z < 1 && marker.visible ? 1 : 0;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();
  camera.position.copy(overview().multiplyScalar(1.6));
  flyTo(new Vector3(0, 0, 0), overview(), 2.2);

  let running = true, last = performance.now(), clock = 0;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / fly.sec);
      const k = 1 - (1 - fly.t) ** 3;
      camera.position.lerpVectors(fly.from, fly.to, k);
      controls.target.lerpVectors(fly.fromT, fly.toT, k);
      if (fly.t >= 1) fly = null;
    }
    marker.position.y = 9 + Math.sin(clock * 2.4) * 1.1;
    marker.rotation.y += dt * 0.8;
    if (hop > 0) { hop = Math.max(0, hop - dt * 2.5); car.position.y = 0.26 + Math.sin(hop * Math.PI) * 2.2; }
    moveWalkers(clock);
    moveClouds(clock);
    controls.update();
    renderer.render(scene, camera);
    placeLabel();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setCar(pos) {
      if (!pos) { car.visible = marker.visible = false; if (label) label.style.display = 'none'; return; }
      setCar(pos[0], pos[1]); if (label) label.style.display = '';
    },
    flyToCar() { if (car.visible) flyTo(car.position.clone().setY(0), new Vector3(30, 36, 46)); },
    flyOverview() { flyTo(new Vector3(0, 0, 0), overview()); },
    pick() { return new Promise((resolve) => { pickCb = (x, y) => resolve([x, y]); }); },
    cancelPick() { pickCb = null; },
    pause() { running = false; },
    resume() { if (!running) { running = true; last = performance.now(); daylight(); requestAnimationFrame(frame); } },
    data,
  };
}
