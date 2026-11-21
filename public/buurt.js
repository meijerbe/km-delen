// Het Polo-diorama: de buurt als speelgoedblok met de geparkeerde Polo erop.
// Wordt pas geladen als iemand het tabblad opent (Three.js is ± 200 kB).
import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Fog, HemisphereLight, DirectionalLight, AmbientLight,
  Group, Mesh, InstancedMesh, Object3D, BoxGeometry, CylinderGeometry, ConeGeometry, IcosahedronGeometry, SphereGeometry,
  CircleGeometry, PlaneGeometry, ExtrudeGeometry, ShapeGeometry, Shape, BufferGeometry, Float32BufferAttribute,
  MeshLambertMaterial, MeshStandardMaterial, MeshBasicMaterial, Raycaster, Vector2, Vector3, MathUtils, PCFSoftShadowMap,
  SRGBColorSpace, DoubleSide, OrbitControls, mergeGeometries,
} from './vendor/three-bundle.js';

const PAL = {
  ground: '#EFE7D6', grass: '#BFE3A2', field: '#A8D98A', play: '#F6D9A8', water: '#8CCBEB', waterEdge: '#6FB3DA',
  road: '#CDD2D9', foot: '#E4DCCB', bike: '#E9B7A9', rail: '#8B8F96',
  layers: [['#D9CDB6', 0.8, 'straat'], ['#A08A6B', 3.2, 'klei'], ['#6B4F38', 3.0, 'veen'], ['#E2C98E', 3.0, 'zand']],
  houses: ['#F7E3C8', '#F4CDBB', '#E8D5EE', '#D9E7F5', '#F2E6B0', '#CFE5D3', '#F6D4D9', '#EAE0D3'],
  roofs: ['#D98A6C', '#B9746A', '#8FA1B8', '#A7B59A', '#C9A27A'],
};

const mat = (c, extra = {}) => new MeshLambertMaterial({ color: new Color(c), ...extra });
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const shapeOf = (pts) => { const s = new Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return s; };

/** Platte vlakken (gras, water) op hoogte y */
function flat(polys, y) {
  const geos = polys.map((p) => { const g = new ShapeGeometry(shapeOf(p)); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g; });
  return geos.length ? mergeGeometries(geos) : null;
}

/** Lijnen als linten met rondjes op de knikken */
function ribbons(lines, y) {
  const pos = [];
  const push = (...pts) => pts.forEach(([x, z]) => pos.push(x, y, z));
  for (const { l, w } of lines) {
    const h = w / 2;
    for (let i = 0; i < l.length - 1; i++) {
      const [x0, y0] = l[i], [x1, y1] = l[i + 1];
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * h, ny = (dx / len) * h;
      const a = [x0 + nx, -(y0 + ny)], b = [x0 - nx, -(y0 - ny)], c = [x1 + nx, -(y1 + ny)], d = [x1 - nx, -(y1 - ny)];
      push(a, b, c, c, b, d);
    }
    for (const [x, yy] of l) {                      // rondje op elke knik voor nette hoeken
      for (let k = 0; k < 8; k++) {
        const t0 = (k / 8) * Math.PI * 2, t1 = ((k + 1) / 8) * Math.PI * 2;
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

/** Het speelgoed-Polootje (± 3× vergroot, zodat je hem ziet) */
function polo() {
  const g = new Group();
  const blue = mat('#A8D4F0'), darker = mat('#86BEE2'), glass = mat('#E4F3FC'), tyre = mat('#2C2F33'), rim = mat('#D9E0E6');
  const body = new Mesh(new BoxGeometry(3.9, 1.0, 1.7), blue); body.position.y = 0.75;
  const skirt = new Mesh(new BoxGeometry(3.95, 0.35, 1.72), darker); skirt.position.y = 0.42;
  const cabin = new Mesh(new BoxGeometry(2.3, 0.85, 1.55), blue); cabin.position.set(-0.25, 1.6, 0);
  const win = new Mesh(new BoxGeometry(2.1, 0.62, 1.58), glass); win.position.set(-0.25, 1.62, 0);
  const wind = new Mesh(new BoxGeometry(0.08, 0.6, 1.45), glass); wind.position.set(0.93, 1.6, 0); wind.rotation.z = -0.5;
  const light = new Mesh(new BoxGeometry(0.06, 0.22, 0.4), mat('#FFF3C4', { emissive: new Color('#FFE58A'), emissiveIntensity: 0 }));
  const light2 = light.clone(); light.position.set(1.96, 0.85, 0.55); light2.position.set(1.96, 0.85, -0.55);
  const tail = new Mesh(new BoxGeometry(0.06, 0.3, 0.25), mat('#F06B5E')); tail.position.set(-1.96, 0.95, 0.6);
  const tail2 = tail.clone(); tail2.position.z = -0.6;
  g.add(body, skirt, cabin, win, wind, light, light2, tail, tail2);
  for (const [x, z] of [[1.25, 0.86], [1.25, -0.86], [-1.25, 0.86], [-1.25, -0.86]]) {
    const w = new Mesh(new CylinderGeometry(0.42, 0.42, 0.3, 16), tyre); w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z);
    const r = new Mesh(new CylinderGeometry(0.22, 0.22, 0.32, 12), rim); r.rotation.x = Math.PI / 2; r.position.set(x, 0.42, z);
    g.add(w, r);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.lights = [light.material];
  g.scale.setScalar(3);
  return g;
}

/** Wiebelende pin boven de auto */
function pin() {
  const g = new Group();
  const red = new MeshStandardMaterial({ color: '#EE6C4D', roughness: 0.5 });
  const head = new Mesh(new SphereGeometry(3.2, 24, 16), red); head.position.y = 7;
  const tip = new Mesh(new ConeGeometry(2.1, 5, 24), red); tip.rotation.x = Math.PI; tip.position.y = 3.6;
  const dot = new Mesh(new SphereGeometry(1.2, 16, 12), new MeshBasicMaterial({ color: '#FFFFFF' })); dot.position.set(0, 7.4, 2.6);
  g.add(head, tip, dot);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Bomen als instanced meshes (stam + kruin) */
function trees(points, scene) {
  if (!points.length) return;
  const trunks = new InstancedMesh(new CylinderGeometry(0.35, 0.5, 4, 6), mat('#A07B55'), points.length);
  const crowns = new InstancedMesh(new IcosahedronGeometry(3.2, 0), mat('#8CCB7A', { flatShading: true }), points.length);
  const o = new Object3D(), greens = ['#8CCB7A', '#9AD488', '#7DBF6C', '#A6D98F'];
  points.forEach(([x, y], i) => {
    const s = 0.75 + (hash(`${x},${y}`) % 50) / 100;
    o.position.set(x, 2 * s, -y); o.scale.set(s, s, s); o.rotation.set(0, 0, 0); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix);
    o.position.set(x, 5.2 * s, -y); o.rotation.set(0, (hash(`${y}${x}`) % 628) / 100, 0); o.updateMatrix(); crowns.setMatrixAt(i, o.matrix);
    crowns.setColorAt(i, new Color(greens[hash(`${x}${y}`) % greens.length]));
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);
}

/** Extra boompjes in parken waar OSM er weinig heeft */
function scatterTrees(green, existing) {
  const out = [];
  const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  for (const g of green) {
    if (g.k !== 'gras') continue;
    const xs = g.p.map((p) => p[0]), ys = g.p.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const areaApprox = (x1 - x0) * (y1 - y0);
    const n = Math.min(40, Math.floor(areaApprox / 400));
    for (let i = 0; i < n * 3 && out.length < existing + 600; i++) {
      const h = hash(`${g.p[0]}${i}`);
      const x = x0 + ((h % 1000) / 1000) * (x1 - x0), y = y0 + (((h >>> 10) % 1000) / 1000) * (y1 - y0);
      if (inPoly(x, y, g.p)) out.push([x, y]);
      if (out.length >= n + existing) break;
    }
  }
  return out;
}

export async function createDiorama(container, { onHonk } = {}) {
  const data = await (await fetch('buurt.json', { cache: 'force-cache' })).json();
  const H = data.half, D = H * 2;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.fog = new Fog('#F3EBDD', 900, 2200);
  const camera = new PerspectiveCamera(40, 1, 1, 5000);

  // licht
  const hemi = new HemisphereLight('#FFFFFF', '#D9C8A8', 1.25);
  const amb = new AmbientLight('#FFFFFF', 0.25);
  const sun = new DirectionalLight('#FFF4E0', 1.6);
  sun.position.set(-260, 420, 200);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -H - 40, right: H + 40, top: H + 40, bottom: -H - 40, near: 50, far: 1200 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
  scene.add(hemi, amb, sun);

  // ondergrond: plak taart met lagen
  let depth = 0;
  for (const [color, t] of PAL.layers) {
    const m = new Mesh(new BoxGeometry(D, t, D), mat(color));
    m.position.y = -depth - t / 2; depth += t;
    m.receiveShadow = true; scene.add(m);
  }
  const top = new Mesh(new PlaneGeometry(D, D), mat(PAL.ground));
  top.rotation.x = -Math.PI / 2; top.position.y = 0.01; top.receiveShadow = true; scene.add(top);

  // groen, water, wegen
  const add = (geo, color, opts = {}) => { if (!geo) return null; const m = new Mesh(geo, mat(color, { side: DoubleSide, ...opts })); m.receiveShadow = true; scene.add(m); return m; };
  add(flat(data.green.filter((g) => g.k === 'gras').map((g) => g.p), 0.05), PAL.grass);
  add(flat(data.green.filter((g) => g.k === 'veld').map((g) => g.p), 0.07), PAL.field);
  add(flat(data.green.filter((g) => g.k === 'speel').map((g) => g.p), 0.07), PAL.play);
  add(ribbons(data.water.filter((w) => w.line).map((w) => ({ l: w.line, w: w.w })), 0.09), PAL.water);
  add(flat(data.water.filter((w) => w.p).map((w) => w.p), 0.09), PAL.water);
  add(ribbons(data.roads.filter((r) => r.k === 'weg'), 0.12), PAL.road);
  add(ribbons(data.roads.filter((r) => r.k === 'voet'), 0.14), PAL.foot);
  add(ribbons(data.roads.filter((r) => r.k === 'fiets'), 0.15), PAL.bike);
  add(ribbons(data.rails.map((r) => ({ l: r.l, w: 1.6 })), 0.17), PAL.rail);

  // gebouwen: geëxtrudeerd, pastel, samengevoegd per kleur
  const byColor = new Map();
  for (const b of data.buildings) {
    const key = hash(b.p.flat().slice(0, 6).join(','));
    const color = PAL.houses[key % PAL.houses.length];
    const geo = new ExtrudeGeometry(shapeOf(b.p), { depth: b.h, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(geo);
  }
  for (const [color, geos] of byColor) {
    for (let i = 0; i < geos.length; i += 400) {
      const m = new Mesh(mergeGeometries(geos.slice(i, i + 400)), mat(color));
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
    }
  }

  trees([...data.trees, ...scatterTrees(data.green, data.trees.length)], scene);

  // Polo + pin
  const car = polo(); scene.add(car);
  const marker = pin(); scene.add(marker);
  const setCar = (x, y, heading = 0) => {
    car.position.set(x, 0.12, -y); car.rotation.y = heading;
    marker.position.set(x, 8, -y);
  };
  setCar(0, 0);

  // camera + besturing
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 40; controls.maxDistance = 1100;
  controls.maxPolarAngle = MathUtils.degToRad(78);
  controls.target.set(0, 0, 0);
  controls.enablePan = true; controls.screenSpacePanning = false;

  // vlucht naar de auto
  let fly = { t: 0, from: new Vector3(520, 760, 820), to: new Vector3(120, 150, 190) };
  camera.position.copy(fly.from);

  // tik op de Polo = toeter
  const ray = new Raycaster(), ndc = new Vector2();
  let hop = 0, down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObjects([car, marker], true).length) { hop = 1; onHonk?.(); }
  });

  // dag/nacht naar de echte tijd
  function daylight() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const night = h < 6.5 || h > 19.5 ? 1 : h < 8 ? (8 - h) / 1.5 : h > 18 ? (h - 18) / 1.5 : 0;
    sun.intensity = 1.6 * (1 - night * 0.75);
    hemi.intensity = 1.25 * (1 - night * 0.55);
    hemi.color.set(night > 0.5 ? '#9FB4E8' : '#FFFFFF');
    car.userData.lights.forEach((m) => { m.emissiveIntensity = night > 0.5 ? 1.2 : 0; });
    container.classList.toggle('night', night > 0.5);
  }
  daylight();

  // label boven de pin volgen
  const label = container.querySelector('.polo-label');
  const tmp = new Vector3();
  function placeLabel() {
    if (!label) return;
    tmp.copy(marker.position); tmp.y += 14; tmp.project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    label.style.transform = `translate(-50%, -100%) translate(${(tmp.x * 0.5 + 0.5) * r.width}px, ${(-tmp.y * 0.5 + 0.5) * r.height}px)`;
    label.style.opacity = tmp.z < 1 ? 1 : 0;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();

  let running = true, last = performance.now(), clock = 0;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 2.2);
      const k = 1 - (1 - fly.t) ** 3;
      camera.position.lerpVectors(fly.from, fly.to.clone().add(controls.target), k);
      if (fly.t >= 1) fly = null;
    }
    marker.position.y = 8 + Math.sin(clock * 2.4) * 1.2;
    marker.rotation.y += dt * 0.8;
    if (hop > 0) { hop = Math.max(0, hop - dt * 2.5); car.position.y = 0.12 + Math.sin(hop * Math.PI) * 2.5; }
    controls.update();
    renderer.render(scene, camera);
    placeLabel();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setCar(x, y, heading) {
      setCar(x, y, heading); controls.target.set(x, 0, -y);
      fly = { t: 0, from: camera.position.clone(), to: new Vector3(120, 150, 190) };
    },
    pause() { running = false; },
    resume() { if (!running) { running = true; last = performance.now(); daylight(); requestAnimationFrame(frame); } },
    data,
  };
}
