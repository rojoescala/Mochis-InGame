// Mochis: Ruta Robada — juego de mundo abierto en tercera persona sobre las calles reales de Los Mochis.
(() => {
'use strict';
const MAP = window.MOCHIS_MAP;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const wrapAng = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

// ====================================================================
// MAPA: nodos, segmentos, grafo y rejillas espaciales
// ====================================================================
const NN = MAP.nodes.length / 2;
const NX = new Float32Array(NN), NY = new Float32Array(NN);
for (let i = 0; i < NN; i++) { NX[i] = MAP.nodes[2 * i]; NY[i] = MAP.nodes[2 * i + 1]; }
const HALF_W = MAP.halfW;
const ROADS = MAP.roads.map(r => ({ t: r[0], name: MAP.names[r[1]], ow: r[2], hw: HALF_W[r[0]] * (r[2] ? 0.6 : 1), ids: r.slice(3) }));

const segA = [], segB = [], segR = [];
const adj = Array.from({ length: NN }, () => []);    // dirigido (respeta sentido)
const adjAll = Array.from({ length: NN }, () => []); // para patrullas (ignoran sentido)
ROADS.forEach((r, ri) => {
  for (let k = 0; k < r.ids.length - 1; k++) {
    const a = r.ids[k], b = r.ids[k + 1];
    if (a === b) continue;
    const s = segA.length;
    segA.push(a); segB.push(b); segR.push(ri);
    const len = Math.hypot(NX[b] - NX[a], NY[b] - NY[a]);
    adjAll[a].push({ n: b, s, len }); adjAll[b].push({ n: a, s, len });
    if (r.t === 8) continue; // el tráfico no usa calles de servicio
    if (r.ow >= 0) adj[a].push({ n: b, s, len });
    if (r.ow <= 0) adj[b].push({ n: a, s, len });
  }
});
const NSEG = segA.length;

class Grid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  key(gx, gy) { return (gx + 32768) * 65536 + (gy + 32768); }
  add(id, x0, y0, x1, y1) {
    const c = this.cell;
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gy = Math.floor(y0 / c); gy <= Math.floor(y1 / c); gy++) {
        const k = this.key(gx, gy); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(id);
      }
  }
  query(x0, y0, x1, y1, fn) {
    const c = this.cell;
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gy = Math.floor(y0 / c); gy <= Math.floor(y1 / c); gy++) {
        const a = this.m.get(this.key(gx, gy)); if (a) for (let i = 0; i < a.length; i++) fn(a[i]);
      }
  }
}
const segGrid = new Grid(64);
for (let s = 0; s < NSEG; s++) {
  const a = segA[s], b = segB[s];
  segGrid.add(s, Math.min(NX[a], NX[b]), Math.min(NY[a], NY[b]), Math.max(NX[a], NX[b]), Math.max(NY[a], NY[b]));
}

// Edificios
const BD = MAP.buildings, NB = BD.length / 7;
const B = { x: new Float32Array(NB), y: new Float32Array(NB), hw: new Float32Array(NB), hd: new Float32Array(NB),
  c: new Float32Array(NB), s: new Float32Array(NB), h: new Float32Array(NB), col: new Uint8Array(NB), r: new Float32Array(NB) };
const bGrid = new Grid(48);
for (let i = 0; i < NB; i++) {
  const o = i * 7;
  B.x[i] = BD[o]; B.y[i] = BD[o + 1]; B.hw[i] = BD[o + 2] / 2; B.hd[i] = BD[o + 3] / 2;
  B.c[i] = Math.cos(BD[o + 4]); B.s[i] = Math.sin(BD[o + 4]); B.h[i] = BD[o + 5]; B.col[i] = BD[o + 6];
  B.r[i] = Math.hypot(B.hw[i], B.hd[i]);
  bGrid.add(i, B.x[i] - B.r[i], B.y[i] - B.r[i], B.x[i] + B.r[i], B.y[i] + B.r[i]);
}

// Áreas (parques, etc.) y agua
const AREAS = MAP.areas.map(a => {
  const pts = a.slice(2); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, cx = 0, cy = 0;
  const p = new Path2D();
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    i ? p.lineTo(x, y) : p.moveTo(x, y);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); cx += x; cy += y;
  }
  p.closePath();
  const n = pts.length / 2;
  return { kind: a[0], name: a[1], path: p, x0, y0, x1, y1, cx: cx / n, cy: cy / n, size: (x1 - x0) * (y1 - y0) };
});
const WATER = MAP.water.map(w => {
  const pts = w.slice(1); const p = new Path2D(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < pts.length; i += 2) {
    i ? p.lineTo(pts[i], pts[i + 1]) : p.moveTo(pts[i], pts[i + 1]);
    x0 = Math.min(x0, pts[i]); y0 = Math.min(y0, pts[i + 1]); x1 = Math.max(x1, pts[i]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { w: w[0], path: p, x0, y0, x1, y1 };
});

const BOUNDS = MAP.bounds;

// Punto más cercano sobre una calle
function nearestRoad(x, y, maxD = 40, filter) {
  let best = null, bd = maxD * maxD;
  segGrid.query(x - maxD, y - maxD, x + maxD, y + maxD, s => {
    if (filter && !filter(s)) return;
    const a = segA[s], b = segB[s];
    const ax = NX[a], ay = NY[a], dx = NX[b] - ax, dy = NY[b] - ay;
    const L2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
    const px = ax + dx * t, py = ay + dy * t;
    const d = dist2(x, y, px, py);
    if (d < bd) { bd = d; best = { s, t, px, py, d: Math.sqrt(d) }; }
  });
  return best;
}
function nearestNode(x, y, maxD = 120, all = true) {
  const r = nearestRoad(x, y, maxD, all ? null : s => ROADS[segR[s]].t !== 8);
  if (!r) return -1;
  return r.t < 0.5 ? segA[r.s] : segB[r.s];
}
function onRoad(x, y) {
  const r = nearestRoad(x, y, 12);
  return r && r.d < ROADS[segR[r.s]].hw + 0.5 ? r : null;
}

// A* sobre el grafo de calles
function astar(start, goal, maxExp = 5000) {
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [goal];
  const g = new Map(), came = new Map(), open = [];
  const h = n => Math.hypot(NX[n] - NX[goal], NY[n] - NY[goal]);
  const push = (n, f) => { open.push([f, n]); let i = open.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0], last = open.pop();
    if (open.length) { open[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < open.length && open[l][0] < open[m][0]) m = l;
        if (r < open.length && open[r][0] < open[m][0]) m = r;
        if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } }
    return top; };
  g.set(start, 0); push(start, h(start));
  let exp = 0;
  while (open.length && exp++ < maxExp) {
    const [, n] = pop();
    if (n === goal) {
      const path = [n]; let c = n; while (came.has(c)) { c = came.get(c); path.push(c); }
      return path.reverse();
    }
    const gn = g.get(n);
    for (const e of adjAll[n]) {
      const ng = gn + e.len;
      if (ng < (g.has(e.n) ? g.get(e.n) : Infinity)) { g.set(e.n, ng); came.set(e.n, n); push(e.n, ng + h(e.n)); }
    }
  }
  return null;
}

// ====================================================================
// LUGARES ESPECIALES
// ====================================================================
function spotNear(x, y) {
  const r = nearestRoad(x, y, 2000, s => { const t = ROADS[segR[s]].t; return t >= 2 && t <= 6; });
  return r ? { x: r.px, y: r.py } : { x, y };
}
// usa lugares reales cuando existen
function realSpot(re, fx, fy) {
  const p = (MAP.pois || []).find(q => re.test(q[3]));
  return p ? spotNear(p[0], p[1]) : spotNear(fx, fy);
}
const SPOTS = {
  start: spotNear(0, 0),
  garage: Object.assign(spotNear(1500, 900), { name: 'Taller "El Chuy"', color: '#ffb000', icon: '🔧' }),
  paint: Object.assign(spotNear(-1700, -300), { name: 'Pinta Rápido', color: '#d05cff', icon: '🎨' }),
  hospital: Object.assign(realSpot(/^hospital general/i, 400, -900), { name: 'Hospital', color: '#ff4d4d', icon: '✚' }),
  police: Object.assign(spotNear(-600, 900), { name: 'Comandancia', color: '#3c8dff', icon: '★' }),
};
// Pickups repartidos por la ciudad (semilla fija)
let seed = 7;
const srand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const PICKUPS = [];
for (let i = 0; i < 45; i++) {
  const s = (srand() * NSEG) | 0; const a = segA[s];
  const t = ROADS[segR[s]].t; if (t === 8 || t === 0) { i--; continue; }
  PICKUPS.push({ x: NX[a], y: NY[a], type: i % 3 === 0 ? 'health' : i % 3 === 1 ? 'ammo' : 'cash', respawn: 0 });
}

// ====================================================================
// VEHÍCULOS
// ====================================================================
const CAR_TYPES = {
  sedan: { name: 'Sedán', len: 4.5, wid: 1.9, accel: 10, max: 44, grip: 7, turn: 2.5, hp: 100, value: 900,
    colors: ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#2980b9', '#16a085', '#8e44ad', '#d35400', '#111'] },
  vocho: { name: 'Vocho', len: 4.0, wid: 1.65, accel: 7, max: 33, grip: 6.5, turn: 2.8, hp: 80, value: 450,
    colors: ['#f1c40f', '#27ae60', '#e74c3c', '#3498db', '#ecf0f1', '#e67e22'], round: true },
  troca: { name: 'Troca', len: 5.5, wid: 2.1, accel: 9, max: 42, grip: 6, turn: 2.1, hp: 160, value: 1600,
    colors: ['#ecf0f1', '#111', '#7b241c', '#5d6d7e', '#a04000', '#1b4f72'], bed: true },
  deportivo: { name: 'Deportivo', len: 4.4, wid: 1.95, accel: 15, max: 64, grip: 8, turn: 2.7, hp: 90, value: 4200,
    colors: ['#e74c3c', '#f39c12', '#f1c40f', '#1abc9c', '#111', '#ecf0f1'], sport: true },
  taxi: { name: 'Taxi', len: 4.5, wid: 1.9, accel: 10, max: 42, grip: 7, turn: 2.5, hp: 100, value: 700,
    colors: ['#f4d03f'], taxi: true },
  camion: { name: 'Camión Urbano', len: 11, wid: 2.6, accel: 4.5, max: 26, grip: 5, turn: 1.4, hp: 320, value: 2600,
    colors: ['#1e8449', '#ecf0f1', '#2471a3'], bus: true },
  patrulla: { name: 'Patrulla', len: 4.8, wid: 1.95, accel: 12, max: 52, grip: 7.5, turn: 2.6, hp: 160, value: 2200,
    colors: ['#f4f6f7'], police: true },
};
const TRAFFIC_MIX = ['sedan', 'sedan', 'sedan', 'vocho', 'vocho', 'troca', 'troca', 'troca', 'taxi', 'taxi', 'deportivo', 'camion'];

let cars = [], peds = [], effects = [], tracers = [], skids = [];
let carId = 1;

function makeCar(type, x, y, ang, color) {
  const T = CAR_TYPES[type];
  return { id: carId++, type, T, x, y, ang, vx: 0, vy: 0, av: 0, color: color || pick(T.colors), hp: T.hp,
    driver: null, ai: null, throttle: 0, steer: 0, brake: 0, hb: false, fire: 0, wreck: false,
    siren: !!T.police, stuck: 0, horn: 0, lastHit: 0 };
}
function carFwd(c) { return { fx: Math.cos(c.ang), fy: Math.sin(c.ang) }; }
function carSpeed(c) { return Math.hypot(c.vx, c.vy); }
function carCircles(c) {
  const r = c.T.wid / 2, n = c.T.len > 7 ? 4 : 3;
  const out = [], fx = Math.cos(c.ang), fy = Math.sin(c.ang), span = c.T.len / 2 - r;
  for (let i = 0; i < n; i++) { const k = -span + (2 * span) * i / (n - 1); out.push([c.x + fx * k, c.y + fy * k, r]); }
  return out;
}

function physicsCar(c, dt) {
  const T = c.T;
  const fx = Math.cos(c.ang), fy = Math.sin(c.ang);
  let vf = c.vx * fx + c.vy * fy, vr = -c.vx * fy + c.vy * fx;
  const road = c.roadCheck === undefined || (c.roadCheckT -= dt) <= 0 ? (c.roadCheckT = 0.2, c.roadCheck = !!onRoad(c.x, c.y)) : c.roadCheck;
  const maxS = (road ? T.max : T.max * 0.45) * (c.wreck ? 0 : 1) * (c.hp < T.hp * 0.25 ? 0.6 : 1);
  if (c.wreck) c.throttle = 0;
  // aceleración
  if (c.throttle > 0) {
    if (vf < -0.5) vf += 18 * c.throttle * dt; // frenar en reversa
    else { const k = clamp(vf / maxS, 0, 1); vf += T.accel * 1.35 * c.throttle * (1 - k * k) * dt; }
  } else if (c.throttle < 0) {
    if (vf > 0.5) vf += 20 * c.throttle * dt; // frenar
    else vf += T.accel * 0.6 * c.throttle * (1 - clamp(-vf / (maxS * 0.35), 0, 1)) * dt;
  }
  // arrastre
  vf -= vf * (road ? 0.12 : 0.9) * dt;
  if (c.throttle === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
  if (c.hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
  // agarre lateral
  const grip = c.hb ? 1.2 : T.grip * (road ? 1 : 0.6);
  const before = vr;
  vr *= Math.exp(-grip * dt);
  if (Math.abs(before) > 4 && c.isPlayer && Math.random() < 0.6) addSkid(c);
  // dirección
  const sp = clamp(vf / 6, -1, 1);
  const turnScale = T.turn * (1 - clamp(Math.abs(vf) / (T.max * 1.6), 0, 0.5)) * (c.hb ? 1.35 : 1);
  c.ang = wrapAng(c.ang + c.steer * turnScale * sp * dt);
  const nfx = Math.cos(c.ang), nfy = Math.sin(c.ang);
  c.vx = nfx * vf - nfy * vr;
  c.vy = nfy * vf + nfx * vr;
  c.x += c.vx * dt; c.y += c.vy * dt;
  c.x = clamp(c.x, BOUNDS[0] - 200, BOUNDS[2] + 200); c.y = clamp(c.y, BOUNDS[1] - 200, BOUNDS[3] + 200);
}

function addSkid(c) {
  const fx = Math.cos(c.ang), fy = Math.sin(c.ang), rx = -fy, ry = fx, b = -c.T.len * 0.35, w = c.T.wid * 0.4;
  skids.push({ x: c.x + fx * b + rx * w, y: c.y + fy * b + ry * w, a: 1 }, { x: c.x + fx * b - rx * w, y: c.y + fy * b - ry * w, a: 1 });
  if (skids.length > 1500) skids.splice(0, 200);
}

// colisión círculo vs edificio (OBB). Devuelve normal y penetración
function circleVsBuildings(x, y, r, cb) {
  bGrid.query(x - r, y - r, x + r, y + r, i => {
    const dx = x - B.x[i], dy = y - B.y[i];
    if (dx * dx + dy * dy > (B.r[i] + r) ** 2) return;
    const lx = dx * B.c[i] + dy * B.s[i], ly = -dx * B.s[i] + dy * B.c[i];
    const cx = clamp(lx, -B.hw[i], B.hw[i]), cy = clamp(ly, -B.hd[i], B.hd[i]);
    let nx = lx - cx, ny = ly - cy, d = Math.hypot(nx, ny), pen;
    if (d === 0) { // dentro: salir por el lado más cercano
      const px = B.hw[i] - Math.abs(lx), py = B.hd[i] - Math.abs(ly);
      if (px < py) { nx = Math.sign(lx) || 1; ny = 0; pen = px + r; } else { nx = 0; ny = Math.sign(ly) || 1; pen = py + r; }
    } else { if (d >= r) return; nx /= d; ny /= d; pen = r - d; }
    cb(nx * B.c[i] - ny * B.s[i], nx * B.s[i] + ny * B.c[i], pen);
  });
}
function pointInBuilding(x, y) {
  let hit = false;
  bGrid.query(x, y, x, y, i => {
    if (hit) return;
    const dx = x - B.x[i], dy = y - B.y[i];
    const lx = dx * B.c[i] + dy * B.s[i], ly = -dx * B.s[i] + dy * B.c[i];
    if (Math.abs(lx) <= B.hw[i] && Math.abs(ly) <= B.hd[i]) hit = true;
  });
  return hit;
}

function collideCarWorld(c) {
  for (const [x, y, r] of carCircles(c)) {
    circleVsBuildings(x, y, r, (nx, ny, pen) => {
      c.x += nx * pen; c.y += ny * pen;
      const vn = c.vx * nx + c.vy * ny;
      if (vn < 0) {
        c.vx -= 1.35 * vn * nx; c.vy -= 1.35 * vn * ny;
        c.vx *= 0.85; c.vy *= 0.85;
        if (-vn > 5) damageCar(c, (-vn - 4) * 3.2, null);
        if (-vn > 6) { sfx.crash(Math.min(1, -vn / 25), c); spark(x + nx * -r, y + ny * -r); }
      }
    });
  }
}

function collideCars() {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const md = (a.T.len + b.T.len) / 2;
      if (Math.abs(a.x - b.x) > md || Math.abs(a.y - b.y) > md) continue;
      const ca = carCircles(a), cb = carCircles(b);
      for (const [ax, ay, ar] of ca) for (const [bx, by, br] of cb) {
        const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy), rr = ar + br;
        if (d >= rr || d === 0) continue;
        const nx = dx / d, ny = dy / d, pen = rr - d;
        const ma = a.T.len * a.T.wid, mb = b.T.len * b.T.wid, tot = ma + mb;
        a.x -= nx * pen * mb / tot; a.y -= ny * pen * mb / tot;
        b.x += nx * pen * ma / tot; b.y += ny * pen * ma / tot;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const jimp = -(1.3) * rv / (1 / ma + 1 / mb);
          a.vx -= jimp / ma * nx; a.vy -= jimp / ma * ny;
          b.vx += jimp / mb * nx; b.vy += jimp / mb * ny;
          if (-rv > 4) {
            const dmg = (-rv - 3) * 3;
            const culprit = a.isPlayer ? a : b.isPlayer ? b : null;
            damageCar(a, dmg * mb / tot * 2, culprit); damageCar(b, dmg * ma / tot * 2, culprit);
            if (-rv > 6) { sfx.crash(Math.min(1, -rv / 25), a); spark((ax + bx) / 2, (ay + by) / 2); }
            if (culprit) {
              const other = culprit === a ? b : a;
              if (other.T.police && !other.wreck) crime(25, 'choque con patrulla');
              else if (other.driver && -rv > 8) crime(4);
            }
          }
        }
      }
    }
  }
}

function damageCar(c, amt, by) {
  if (c.wreck || amt <= 0) return;
  c.hp -= amt;
  if (c.hp <= 0 && !c.fire) { c.fire = 4.5; c.hp = 0; if (by && by.isPlayer && c !== by && c.T.police) crime(60, 'patrulla destruida'); }
}

function explodeCar(c) {
  c.wreck = true; c.fire = 0; c.color = '#2b2b2b';
  effects.push({ type: 'boom', x: c.x, y: c.y, t: 0, life: 0.9 });
  for (let i = 0; i < 25; i++) effects.push({ type: 'debris', x: c.x, y: c.y, vx: rand(-14, 14), vy: rand(-14, 14), t: 0, life: rand(0.5, 1.4) });
  sfx.boom(c);
  shake = Math.max(shake, 1.2 - Math.min(1, Math.hypot(c.x - player.x, c.y - player.y) / 80));
  // daño en área
  for (const p of peds) if (!p.dead && dist2(p.x, p.y, c.x, c.y) < 64) killPed(p, c.driver === 'player' || c.lastPlayerTouch ? 'player' : null);
  if (!player.car && dist2(player.x, player.y, c.x, c.y) < 64) hurtPlayer(60);
  if (player.car === c) { hurtPlayer(100); }
  for (const o of cars) if (o !== c && dist2(o.x, o.y, c.x, c.y) < 81) damageCar(o, 60, null);
  if (c.driver && c.driver !== 'player') c.driver = null;
}

// ====================================================================
// PEATONES
// ====================================================================
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#ecf0f1', '#e67e22', '#1abc9c', '#34495e', '#ff7eb6'];
const SKIN = ['#8d5524', '#c68642', '#e0ac69', '#a1665e', '#6b4226'];
function makePed(x, y, opts = {}) {
  return Object.assign({ x, y, ang: rand(0, TAU), vx: 0, vy: 0, speed: rand(1.1, 1.7), shirt: pick(SHIRTS), skin: pick(SKIN),
    hp: 30, dead: false, flee: 0, fleeX: 0, fleeY: 0, seg: -1, segT: 0, segDir: 1, side: 1, walk: rand(0, 10),
    cop: false, target: null, shootT: 0, deadT: 0 }, opts);
}

function pedSidewalkTarget(p) {
  const s = p.seg, a = segA[s], b = segB[s];
  const dx = NX[b] - NX[a], dy = NY[b] - NY[a], L = Math.hypot(dx, dy) || 1;
  const off = ROADS[segR[s]].hw + 1.8;
  const nx = -dy / L, ny = dx / L;
  return { x: NX[a] + dx * p.segT + nx * off * p.side, y: NY[a] + dy * p.segT + ny * off * p.side, L, dx: dx / L, dy: dy / L };
}

function updatePed(p, dt) {
  if (p.dead) { p.deadT += dt; return; }
  let mx = 0, my = 0, spd = p.speed;
  if (p.cop) {
    // policía a pie: persigue al jugador
    const tx = player.car ? player.car.x : player.x, ty = player.car ? player.car.y : player.y;
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (wanted.stars === 0 || d > 160) { p.cop = false; p.flee = 0; p.seg = -1; return updatePed(p, dt); }
    mx = dx / d; my = dy / d; spd = 4.6;
    if (d < 2.2) {
      bustTimer += dt * (player.car ? (carSpeed(player.car) < 2 ? 1 : 0) : 1);
      spd = 0;
    }
    if (wanted.stars >= 3 && d < 30 && d > 2) {
      p.shootT -= dt;
      if (p.shootT <= 0) {
        p.shootT = rand(0.9, 1.6);
        const hit = Math.random() < (player.car ? 0.35 : 0.5) && hasLOS(p.x, p.y, tx, ty);
        tracers.push({ x0: p.x, y0: p.y, x1: tx + rand(-1.5, 1.5), y1: ty + rand(-1.5, 1.5), t: 0.08 });
        sfx.shot(p);
        if (hit) { if (player.car) damageCar(player.car, 6, null); else hurtPlayer(7); }
      }
      if (d < 12) spd = 0.5;
    }
  } else if (p.flee > 0) {
    p.flee -= dt;
    let dx = p.x - p.fleeX, dy = p.y - p.fleeY; const d = Math.hypot(dx, dy) || 1;
    mx = dx / d; my = dy / d; spd = 4.2;
    if (p.flee <= 0) p.seg = -1;
  } else {
    if (p.seg < 0) {
      const r = nearestRoad(p.x, p.y, 60);
      if (!r) { p.dead = true; p.remove = true; return; }
      p.seg = r.s; p.segT = r.t; p.segDir = Math.random() < 0.5 ? 1 : -1;
      const a = segA[r.s], b = segB[r.s];
      const cr = (NX[b] - NX[a]) * (p.y - NY[a]) - (NY[b] - NY[a]) * (p.x - NX[a]);
      p.side = cr >= 0 ? 1 : -1;
    }
    const tg = pedSidewalkTarget(p);
    p.segT += p.segDir * spd * dt / tg.L;
    if (p.segT > 1 || p.segT < 0) {
      const node = p.segT > 1 ? segB[p.seg] : segA[p.seg];
      const opts = adjAll[node].filter(e => e.s !== p.seg);
      const e = opts.length ? pick(opts) : adjAll[node][0];
      p.seg = e.s;
      if (segA[e.s] === node) { p.segT = 0; p.segDir = 1; } else { p.segT = 1; p.segDir = -1; }
    }
    const t2 = pedSidewalkTarget(p);
    const dx = t2.x - p.x, dy = t2.y - p.y, d = Math.hypot(dx, dy);
    if (d > 0.05) { mx = dx / d; my = dy / d; spd = Math.min(spd * (d > 3 ? 1.5 : 1), d / dt); }
  }
  p.vx = mx * spd; p.vy = my * spd;
  p.x += p.vx * dt; p.y += p.vy * dt;
  if (spd > 0.1 && (mx || my)) p.ang = Math.atan2(my, mx);
  p.walk += spd * dt * 3;
  circleVsBuildings(p.x, p.y, 0.45, (nx, ny, pen) => { p.x += nx * pen; p.y += ny * pen; });
}

function killPed(p, by) {
  if (p.dead) return;
  p.dead = true; p.deadT = 0;
  effects.push({ type: 'blood', x: p.x, y: p.y, t: 0, life: 40, r: rand(0.8, 1.4) });
  if (by === 'player') {
    if (p.cop) crime(150, 'policía caído'); else crime(70);
    if (Math.random() < 0.4) dropCash(p.x, p.y, (rand(5, 60)) | 0);
  }
  scare(p.x, p.y, 30);
}
function scare(x, y, r) {
  for (const q of peds) if (!q.dead && !q.cop && dist2(q.x, q.y, x, y) < r * r) { q.flee = rand(4, 8); q.fleeX = x; q.fleeY = y; }
}
function dropCash(x, y, amt) { effects.push({ type: 'cash', x, y, amt, t: 0, life: 30 }); }

function hasLOS(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 2);
  for (let i = 1; i < n; i++) { const t = i / n; if (pointInBuilding(lerp(x0, x1, t), lerp(y0, y1, t))) return false; }
  return true;
}

// ====================================================================
// JUGADOR, BÚSQUEDA POLICIAL Y MISIONES
// ====================================================================
const player = { x: SPOTS.start.x, y: SPOTS.start.y, ang: 0, hp: 100, car: null, ammo: 60, walk: 0, dead: false, shootT: 0, aimAng: 0, money: 0 };
try { player.money = +localStorage.getItem('mochis_money') || 0; } catch (e) {}
const wanted = { heat: 0, stars: 0, unseen: 0 };
const STAR_HEAT = [0, 100, 260, 520, 900, 1400];
let bustTimer = 0, state = 'title', stateT = 0, shake = 0, gameTime = 0;
let mission = null, delivered = 0;
try { delivered = +localStorage.getItem('mochis_delivered') || 0; } catch (e) {}

function crime(pts, why) {
  if (state !== 'play') return;
  const before = wanted.stars;
  wanted.heat = Math.min(STAR_HEAT[5] + 200, wanted.heat + pts);
  wanted.stars = STAR_HEAT.reduce((s, h, i) => wanted.heat >= h ? i : s, 0);
  wanted.unseen = 0;
  if (wanted.stars > before) { toast(why ? `¡${why}!` : '¡Te buscan!'); }
}
function copSees() {
  const px = player.car ? player.car.x : player.x, py = player.car ? player.car.y : player.y;
  for (const c of cars) if (c.T.police && c.driver === 'cop' && dist2(c.x, c.y, px, py) < 70 * 70) return true;
  for (const p of peds) if (p.cop && !p.dead && dist2(p.x, p.y, px, py) < 40 * 40) return true;
  return false;
}
function copNearby(r) {
  const px = player.car ? player.car.x : player.x, py = player.car ? player.car.y : player.y;
  return cars.some(c => c.T.police && c.driver === 'cop' && dist2(c.x, c.y, px, py) < r * r);
}

function hurtPlayer(d) {
  if (player.dead || state !== 'play') return;
  player.hp -= d; flashRed = 0.3;
  if (player.hp <= 0) { player.hp = 0; die('wasted'); }
}
function die(kind) {
  state = kind; stateT = 0;
  if (player.car) { const c = player.car; c.driver = null; c.isPlayer = false; player.x = c.x; player.y = c.y; player.car = null; }
  player.dead = true;
  sfx.stopEngine();
}
function respawn() {
  const sp = state === 'busted' ? SPOTS.police : SPOTS.hospital;
  const lose = state === 'busted' ? Math.floor(player.money * 0.15) : Math.min(player.money, 100 + Math.floor(player.money * 0.05));
  player.money -= lose;
  if (state === 'busted') player.ammo = 20;
  player.x = sp.x + 6; player.y = sp.y + 6; player.hp = 100; player.dead = false;
  wanted.heat = 0; wanted.stars = 0; bustTimer = 0;
  // limpia el mundo alrededor
  cars = cars.filter(c => false); peds = [];
  state = 'play';
  toast(lose ? `-$${lose}` : '');
  saveProgress();
}
function saveProgress() { try { localStorage.setItem('mochis_money', player.money); localStorage.setItem('mochis_delivered', delivered); } catch (e) {} }

const MISSION_TYPES = ['sedan', 'vocho', 'troca', 'deportivo', 'taxi', 'camion'];
function newMission() {
  const type = pick(MISSION_TYPES);
  mission = { type, reward: Math.round(CAR_TYPES[type].value * 2.5 / 50) * 50 };
}
newMission();

function deliverCar() {
  const c = player.car;
  const cond = clamp(c.hp / c.T.hp, 0.1, 1);
  let pay = Math.round(c.T.value * (0.4 + 0.6 * cond) / 10) * 10;
  let msg = `${c.T.name} entregado: +$${pay}`;
  if (mission && mission.type === c.type) {
    pay += mission.reward; msg = `¡ENCARGO CUMPLIDO! ${c.T.name}: +$${pay}`; newMission();
  }
  if (c.T.police) { pay += 1000; msg = `¡Patrulla desmantelada! +$${pay}`; }
  player.money += pay; delivered++;
  exitCar(true);
  cars.splice(cars.indexOf(c), 1);
  toast(msg); sfx.cash();
  saveProgress();
}
function paintCar() {
  const c = player.car;
  if (wanted.stars === 0) { toast('No te buscan. ¡Vuelve cuando haya calor!'); return; }
  const cost = 100 + wanted.stars * 100;
  if (player.money < cost) { toast(`Pintura cuesta $${cost}`); return; }
  player.money -= cost; wanted.heat = 0; wanted.stars = 0;
  if (!c.T.police && !c.T.taxi) c.color = pick(c.T.colors.length > 1 ? c.T.colors : CAR_TYPES.sedan.colors);
  c.hp = Math.max(c.hp, c.T.hp * 0.75);
  toast(`Carro pintado y reparado: -$${cost}. ¡Limpio!`); sfx.cash();
  saveProgress();
}
let spotCooldown = 0;

function enterOrExit() {
  if (state !== 'play') return;
  if (player.car) { if (carSpeed(player.car) < 8) exitCar(false); return; }
  let best = null, bd = 30;
  for (const c of cars) {
    if (c.wreck || c.fire) continue;
    const d = dist2(c.x, c.y, player.x, player.y) - (c.T.len / 2) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  const c = best;
  if (c.driver && c.driver !== 'player') {
    // robo con violencia: el conductor sale corriendo
    const fx = Math.cos(c.ang), fy = Math.sin(c.ang);
    const ex = c.x - fy * -(c.T.wid / 2 + 0.8), ey = c.y + fx * -(c.T.wid / 2 + 0.8);
    const wasCop = c.driver === 'cop';
    const p = makePed(ex, ey, { flee: rand(5, 9), fleeX: c.x, fleeY: c.y, shirt: wasCop ? '#1f3a93' : pick(SHIRTS) });
    if (wasCop && wanted.stars > 0) { p.cop = true; p.flee = 0; }
    peds.push(p);
    crime(wasCop ? 140 : (copNearby(80) ? 110 : 35), wasCop ? 'robo de patrulla' : 'robo de vehículo');
    scare(c.x, c.y, 20);
  } else if (copNearby(45)) crime(70, 'robo de vehículo');
  c.driver = 'player'; c.ai = null; c.isPlayer = true; c.lastPlayerTouch = true;
  player.car = c;
  c.vx *= 0.3; c.vy *= 0.3;
  const name = c.T.name + (mission && mission.type === c.type ? ' — ¡el del encargo!' : '');
  toast(name);
  sfx.door();
}
function exitCar(silent) {
  const c = player.car;
  const fx = Math.cos(c.ang), fy = Math.sin(c.ang);
  let ex = c.x + fy * (c.T.wid / 2 + 0.9), ey = c.y - fx * (c.T.wid / 2 + 0.9);
  if (pointInBuilding(ex, ey)) { ex = c.x - fy * (c.T.wid / 2 + 0.9); ey = c.y + fx * (c.T.wid / 2 + 0.9); }
  player.x = ex; player.y = ey; player.ang = c.ang;
  c.driver = null; c.isPlayer = false; c.throttle = 0; c.steer = 0; c.hb = true;
  player.car = null;
  if (!silent) sfx.door();
  sfx.stopEngine();
}

function shoot() {
  if (player.car || player.dead || player.shootT > 0) return;
  if (player.ammo <= 0) { toast('Sin balas'); player.shootT = 0.4; return; }
  player.ammo--; player.shootT = 0.22;
  const a = player.aimAng + rand(-0.03, 0.03);
  const dx = Math.cos(a), dy = Math.sin(a);
  let hitT = 70, hitObj = null;
  for (let t = 1; t < 70; t += 0.8) if (pointInBuilding(player.x + dx * t, player.y + dy * t)) { hitT = t; break; }
  for (const p of peds) {
    if (p.dead) continue;
    const px = p.x - player.x, py = p.y - player.y, t = px * dx + py * dy;
    if (t < 0 || t > hitT) continue;
    if (Math.abs(px * dy - py * dx) < 0.6) { hitT = t; hitObj = p; }
  }
  for (const c of cars) {
    const px = c.x - player.x, py = c.y - player.y, t = px * dx + py * dy;
    if (t < 0 || t > hitT) continue;
    if (Math.abs(px * dy - py * dx) < c.T.wid * 0.6 + 0.5) { hitT = t; hitObj = c; }
  }
  const ex = player.x + dx * hitT, ey = player.y + dy * hitT;
  tracers.push({ x0: player.x + dx * 0.8, y0: player.y + dy * 0.8, x1: ex, y1: ey, t: 0.07 });
  sfx.shot(player);
  scare(player.x, player.y, 35);
  if (copNearby(60)) crime(25, 'disparos');
  if (hitObj && hitObj.T) { damageCar(hitObj, 12, { isPlayer: true }); spark(ex, ey); if (hitObj.T.police) crime(30, 'ataque a patrulla'); }
  else if (hitObj) { hitObj.hp -= 20; if (hitObj.hp <= 0) killPed(hitObj, 'player'); else { hitObj.flee = 6; hitObj.fleeX = player.x; hitObj.fleeY = player.y; crime(30); } }
  else spark(ex, ey);
}
function spark(x, y) { for (let i = 0; i < 6; i++) effects.push({ type: 'spark', x, y, vx: rand(-8, 8), vy: rand(-8, 8), t: 0, life: rand(0.15, 0.35) }); }

// ====================================================================
// IA: TRÁFICO Y PATRULLAS
// ====================================================================
function laneTarget(a, b, ow) {
  const dx = NX[b] - NX[a], dy = NY[b] - NY[a], L = Math.hypot(dx, dy) || 1;
  const off = ow ? 0 : 1.9;
  return { x: NX[b] - dy / L * off, y: NY[b] + dx / L * off, L };
}
function chooseNext(prev, node) {
  const opts = adj[node].filter(e => e.n !== prev);
  if (!opts.length) return adj[node].length ? adj[node][0] : null;
  // preferir calles grandes y seguir más o menos derecho
  const ix = NX[node] - NX[prev], iy = NY[node] - NY[prev], il = Math.hypot(ix, iy) || 1;
  let tot = 0;
  const w = opts.map(e => {
    const ox = NX[e.n] - NX[node], oy = NY[e.n] - NY[node], ol = Math.hypot(ox, oy) || 1;
    const dot = (ix * ox + iy * oy) / (il * ol);
    const t = ROADS[segR[e.s]].t;
    const v = (1.2 + dot) * (t <= 4 ? 2.2 : 1);
    tot += v; return v;
  });
  let r = Math.random() * tot;
  for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
  return opts[opts.length - 1];
}

function obstacleAhead(c, look) {
  const fx = Math.cos(c.ang), fy = Math.sin(c.ang);
  let best = look;
  const test = (x, y, rad) => {
    const dx = x - c.x, dy = y - c.y, f = dx * fx + dy * fy;
    if (f <= 0 || f > look + c.T.len) return;
    const l = Math.abs(-dx * fy + dy * fx);
    if (l < c.T.wid / 2 + rad + 0.3) best = Math.min(best, f - c.T.len / 2 - rad);
  };
  for (const o of cars) if (o !== c && Math.abs(o.x - c.x) < look + 12 && Math.abs(o.y - c.y) < look + 12) test(o.x, o.y, o.T.wid / 2 + (o.T.len > 7 ? 2 : 0.6));
  for (const p of peds) if (!p.dead && Math.abs(p.x - c.x) < look + 5 && Math.abs(p.y - c.y) < look + 5) test(p.x, p.y, 0.5);
  if (!player.car && !player.dead) test(player.x, player.y, 0.5);
  return best;
}

function driveTo(c, tx, ty, desired, dt) {
  const da = wrapAng(Math.atan2(ty - c.y, tx - c.x) - c.ang);
  const fv = c.vx * Math.cos(c.ang) + c.vy * Math.sin(c.ang);
  c.steer = clamp(da * 2.2, -1, 1);
  if (Math.abs(da) > 1.6 && fv < 3) { // objetivo detrás: vuelta en tres movimientos
    c.revT = (c.revT || 0) + dt;
    if (c.revT < 1.6) { c.steer = -c.steer; c.throttle = -0.7; c.hb = false; return; }
    if (c.revT > 2.8) c.revT = 0;
    c.throttle = 0.6; c.hb = false; return;
  }
  c.revT = Math.max(0, (c.revT || 0) - dt);
  const target = desired * (Math.abs(da) > 0.6 ? 0.45 : 1);
  c.throttle = fv < target ? clamp((target - fv) / 3, 0.15, 1) : (fv > target + 2 ? -0.6 : 0);
  c.hb = false;
}

function updateTraffic(c, dt) {
  const ai = c.ai;
  if (!ai) return;
  if (ai.mode === 'flee') {
    ai.t -= dt;
    if (ai.t <= 0) ai.mode = 'road';
  }
  const tg = laneTarget(ai.from, ai.to, ROADS[segR[ai.seg]].ow);
  const d = Math.hypot(tg.x - c.x, tg.y - c.y);
  if (d < 5) {
    const nxt = chooseNext(ai.from, ai.to);
    if (!nxt) { ai.from = ai.to; ai.to = ai.from; } else { ai.from = ai.to; ai.to = nxt.n; ai.seg = nxt.s; }
  }
  const roadT = ROADS[segR[ai.seg]].t;
  let desired = (roadT <= 3 ? 15 : roadT <= 5 ? 12 : 9) * ai.temper;
  // orillarse cuando se acerca una patrulla con sirena
  if (wanted.stars > 0 && !c.T.police && (c.copCheck = (c.copCheck || 0) - 1) <= 0) {
    c.copCheck = 15; c.yield = cars.some(o => o.T.police && o.driver === 'cop' && dist2(o.x, o.y, c.x, c.y) < 900);
  }
  if (c.yield && !c.T.police) {
    const fx = Math.cos(c.ang), fy = Math.sin(c.ang);
    driveTo(c, c.x + fx * 8 - fy * 2.5, c.y + fy * 8 + fx * 2.5, 2, dt);
    return;
  }
  if (ai.mode === 'flee') desired *= 1.8;
  // frenar antes de curvas
  const nn = laneTarget(ai.from, ai.to, 0);
  const sp = carSpeed(c);
  const free = obstacleAhead(c, 4 + sp * 1.1);
  if (free < 4 + sp * 1.1) desired = Math.min(desired, Math.max(0, (free - 1.5) * 1.1));
  driveTo(c, tg.x, tg.y, desired, dt);
  if (desired < 0.5 && sp < 1) { c.throttle = 0; c.hb = true; c.horn -= dt; if (c.horn < 0 && free < 3) { c.horn = rand(3, 8); if (player.car && dist2(c.x, c.y, player.car.x, player.car.y) < 400) sfx.horn(c); } }
  // atascado
  if (sp < 0.5 && desired > 2) c.stuck += dt; else c.stuck = Math.max(0, c.stuck - dt);
  if (c.stuck > 6) c.despawn = true;
}

function updateCop(c, dt) {
  const ai = c.ai;
  const tx = player.car ? player.car.x : player.x, ty = player.car ? player.car.y : player.y;
  const d = Math.hypot(tx - c.x, ty - c.y);
  if (wanted.stars === 0) {
    // patrulla normal
    if (!ai.patrol) { const n = nearestNode(c.x, c.y, 80, false); if (n < 0) { c.despawn = true; return; } const e = adj[n][0]; if (!e) { c.despawn = true; return; } Object.assign(ai, { patrol: true, from: n, to: e.n, seg: e.s, temper: 1 }); }
    updateTraffic(c, dt); return;
  }
  ai.patrol = false;
  ai.repath -= dt;
  const sp = carSpeed(c);
  if (d < 45 && hasLOSCheap(c, tx, ty)) {
    // embestir
    const pv = player.car ? { x: player.car.vx, y: player.car.vy } : { x: 0, y: 0 };
    driveTo(c, tx + pv.x * 0.5, ty + pv.y * 0.5, player.car ? (d < 12 ? 30 : 40) : clamp((d - 9) * 0.9, 2, 24), dt);
    // salir del carro si el jugador va a pie o está detenido
    if (d < 16 && sp < 4 && (!player.car || carSpeed(player.car) < 3)) {
      c.driver = null; c.ai = null; c.siren = true;
      const fx = Math.cos(c.ang), fy = Math.sin(c.ang);
      peds.push(makePed(c.x + fy * 1.6, c.y - fx * 1.6, { cop: true, shirt: '#1f3a93', speed: 4.6, hp: 50 }));
      return;
    }
  } else {
    if (ai.repath <= 0 || !ai.path || ai.pi >= ai.path.length) {
      ai.repath = 1.5;
      ai.path = astar(nearestNode(c.x, c.y), nearestNode(tx, ty), 4000);
      ai.pi = 1;
      if (!ai.path) { ai.path = null; driveTo(c, tx, ty, 25, dt); return; }
    }
    const n = ai.path[Math.min(ai.pi, ai.path.length - 1)];
    const nx = NX[n], ny = NY[n];
    if (Math.hypot(nx - c.x, ny - c.y) < 7) ai.pi++;
    const free = obstacleAhead(c, 8 + sp * 0.6);
    if (free < 8 + sp * 0.3) {
      // esquivar por un lado (alterna si se atora)
      const fx = Math.cos(c.ang), fy = Math.sin(c.ang), sd = ai.side || 1;
      driveTo(c, c.x + fx * 10 - fy * 3.5 * sd, c.y + fy * 10 + fx * 3.5 * sd, 12, dt);
    } else driveTo(c, nx, ny, 34, dt);
  }
  if (sp < 1 && Math.abs(c.throttle) > 0.1) c.stuck += dt; else c.stuck = Math.max(0, c.stuck - dt * 0.5);
  if (c.stuck > 1.6) { ai.reverse = 1.2; ai.revDir = c.throttle > 0 ? -1 : 1; c.stuck = 0; ai.side = -(ai.side || 1); ai.stuckN = (ai.stuckN || 0) + 1; }
  if (sp > 6) ai.stuckN = 0;
  if (ai.stuckN > 4) c.despawn = true; // atorada sin remedio: desaparece fuera de cámara
  ai.slowT = sp < 2.5 && d > 20 ? (ai.slowT || 0) + dt : 0;
  if (ai.slowT > 4) c.despawn = true;
  if (ai.reverse > 0) { ai.reverse -= dt; c.throttle = ai.revDir; c.steer = -c.steer || 1; c.hb = false; }
}
function hasLOSCheap(c, tx, ty) {
  c.losT = (c.losT || 0) - 1;
  if (c.losT <= 0) { c.losT = 10; c.los = hasLOS(c.x, c.y, tx, ty); }
  return c.los;
}

// Generación de tráfico, peatones y patrullas
function spawnPoint(minD, maxD, cx, cy, filter) {
  for (let tries = 0; tries < 20; tries++) {
    const a = rand(0, TAU), r = rand(minD, maxD);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const rd = nearestRoad(x, y, 40, filter);
    if (rd) return rd;
  }
  return null;
}
function spawnTraffic(cx, cy, minD, maxD, police) {
  const rd = spawnPoint(minD, maxD, cx, cy, s => ROADS[segR[s]].t !== 8);
  if (!rd) return;
  const s = rd.s, r = ROADS[segR[s]];
  let from = segA[s], to = segB[s];
  if (r.ow === -1 || (r.ow === 0 && Math.random() < 0.5)) [from, to] = [to, from];
  const ang = Math.atan2(NY[to] - NY[from], NX[to] - NX[from]);
  const off = r.ow ? 0 : 1.9;
  const x = rd.px - Math.sin(ang) * off, y = rd.py + Math.cos(ang) * off;
  for (const c of cars) if (dist2(c.x, c.y, x, y) < 100) return;
  const type = police ? 'patrulla' : pick(TRAFFIC_MIX);
  const c = makeCar(type, x, y, ang);
  c.driver = police ? 'cop' : 'ai';
  c.ai = { mode: 'road', from, to, seg: s, temper: rand(0.8, 1.15), repath: 0, pi: 0 };
  const sp = police ? 10 : 8; c.vx = Math.cos(ang) * sp; c.vy = Math.sin(ang) * sp;
  cars.push(c);
}
function spawnParked(cx, cy, minD, maxD) {
  const rd = spawnPoint(minD, maxD, cx, cy, s => { const t = ROADS[segR[s]].t; return t >= 4 && t <= 7; });
  if (!rd) return;
  const s = rd.s, a = segA[s], b = segB[s];
  const dx = NX[b] - NX[a], dy = NY[b] - NY[a], L = Math.hypot(dx, dy) || 1;
  const side = Math.random() < 0.5 ? 1 : -1, off = ROADS[segR[s]].hw - 1.1;
  const x = rd.px - dy / L * off * side, y = rd.py + dx / L * off * side;
  for (const c of cars) if (dist2(c.x, c.y, x, y) < 49) return;
  const type = Math.random() < 0.08 ? 'deportivo' : pick(['sedan', 'vocho', 'troca', 'troca', 'sedan', 'taxi']);
  cars.push(makeCar(type, x, y, Math.atan2(dy, dx) + (side < 0 ? Math.PI : 0)));
}
function spawnPed(cx, cy, minD, maxD) {
  const rd = spawnPoint(minD, maxD, cx, cy, s => ROADS[segR[s]].t >= 3);
  if (!rd) return;
  const p = makePed(rd.px, rd.py);
  p.seg = rd.s; p.segT = rd.t; p.segDir = Math.random() < 0.5 ? 1 : -1; p.side = Math.random() < 0.5 ? 1 : -1;
  const tg = pedSidewalkTarget(p); p.x = tg.x; p.y = tg.y;
  if (pointInBuilding(p.x, p.y)) return;
  peds.push(p);
}

function manageWorld(dt) {
  const cx = player.car ? player.car.x : player.x, cy = player.car ? player.car.y : player.y;
  const viewR = 140;
  // eliminar lejanos
  cars = cars.filter(c => {
    if (c === player.car) return true;
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d > 420 || (c.despawn && d > viewR)) return false;
    if (c.despawn && d <= viewR) c.despawn = false;
    return true;
  });
  peds = peds.filter(p => !p.remove && Math.hypot(p.x - cx, p.y - cy) < 200 && !(p.dead && p.deadT > 30));
  const nTraffic = cars.filter(c => c.driver === 'ai').length;
  const nParked = cars.filter(c => !c.driver && !c.wreck).length;
  const nCops = cars.filter(c => c.T.police && c.driver === 'cop').length + peds.filter(p => p.cop && !p.dead).length;
  const wantTraffic = 50, wantParked = 26;
  if (nTraffic < wantTraffic) spawnTraffic(cx, cy, viewR, viewR + 140, false);
  if (nParked < wantParked) spawnParked(cx, cy, 90, 200);
  if (peds.filter(p => !p.dead).length < 50) spawnPed(cx, cy, 60, 130);
  const wantCops = wanted.stars === 0 ? 2 : [0, 2, 4, 6, 9, 12][wanted.stars];
  if (nCops < wantCops && Math.random() < dt * (wanted.stars ? 1.5 : 0.2)) spawnTraffic(cx, cy, viewR + 10, viewR + (wanted.stars ? 70 : 160), true);
}

// ====================================================================
// ENTRADA
// ====================================================================
const keys = {};
const input = { x: 0, y: 0, fire: false, brake: false, stick: false };
addEventListener('keydown', e => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (state === 'title' && (e.code === 'Enter' || e.code === 'Space')) startGame();
  if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') enterOrExit();
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyH' && player.car) sfx.horn(player.car, true);
  if (e.code === 'KeyR' && (state === 'wasted' || state === 'busted') && stateT > 1) respawn();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
const canvas = document.getElementById('game');
let mouse = { x: 0, y: 0, used: false, down: false };
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.used = true; });
canvas.addEventListener('mousedown', e => { if (state === 'play') { mouse.down = true; mouse.used = true; mouse.x = e.clientX; mouse.y = e.clientY; } });
addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// controles táctiles
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const stickEl = document.getElementById('stick'), knob = document.getElementById('knob');
let stickId = null, stickC = { x: 0, y: 0 };
function stickMove(t) {
  const r = stickEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy), m = r.width / 2;
  if (d > m) { dx *= m / d; dy *= m / d; }
  input.x = dx / m; input.y = dy / m; input.stick = true;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
stickEl.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; stickId = t.identifier; stickMove(t); }, { passive: false });
stickEl.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === stickId) stickMove(t); }, { passive: false });
const stickEnd = e => { for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; input.x = input.y = 0; input.stick = false; knob.style.transform = ''; } };
stickEl.addEventListener('touchend', stickEnd); stickEl.addEventListener('touchcancel', stickEnd);
document.querySelectorAll('#btns .b').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('touchstart', e => {
    e.preventDefault(); b.classList.add('down');
    if (k === 'fire') input.fire = true; if (k === 'brake') input.brake = true;
    if (k === 'enter') enterOrExit(); if (k === 'map') toggleMap();
  }, { passive: false });
  const up = e => { e.preventDefault(); b.classList.remove('down'); if (k === 'fire') input.fire = false; if (k === 'brake') input.brake = false; };
  b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
});
canvas.addEventListener('touchstart', e => { if (state === 'wasted' || state === 'busted') { if (stateT > 1) respawn(); } }, { passive: true });

function readControls() {
  let x = 0, y = 0;
  if (keys.KeyA || keys.ArrowLeft) x -= 1; if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y -= 1; if (keys.KeyS || keys.ArrowDown) y += 1;
  if (input.stick) { x = input.x; y = input.y; }
  return { x, y, brake: keys.Space || input.brake, fire: keys.KeyJ || keys.ControlLeft || input.fire || mouse.down };
}

// ====================================================================
// SONIDO (WebAudio sintetizado)
// ====================================================================
const sfx = (() => {
  let ac = null, master, engOsc, engGain, engFilt, sirenOsc, sirenGain, noiseBuf;
  const ok = () => !!ac;
  function init() {
    if (ac) return;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    engOsc = ac.createOscillator(); engOsc.type = 'sawtooth'; engFilt = ac.createBiquadFilter(); engFilt.type = 'lowpass'; engFilt.frequency.value = 400;
    engGain = ac.createGain(); engGain.gain.value = 0; engOsc.connect(engFilt); engFilt.connect(engGain); engGain.connect(master); engOsc.start();
    sirenOsc = ac.createOscillator(); sirenOsc.type = 'triangle'; sirenGain = ac.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain); sirenGain.connect(master); sirenOsc.start();
  }
  function vol(src) { if (!src) return 1; const d = Math.hypot(src.x - view.cx, src.y - view.cy); return clamp(1 - d / 140, 0, 1); }
  function noise(dur, v, freq, type = 'lowpass') {
    if (!ok() || v <= 0.01) return;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.setValueAtTime(v, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(); s.stop(ac.currentTime + dur);
  }
  function tone(freq, dur, v, type = 'square', slide) {
    if (!ok() || v <= 0.01) return;
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, ac.currentTime + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(v, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ac.currentTime + dur);
  }
  return {
    init,
    shot: src => noise(0.18, 0.7 * vol(src), 1800, 'bandpass'),
    crash: (k, src) => noise(0.35, 0.6 * k * vol(src), 700),
    boom: src => { noise(1.2, 1.0 * vol(src), 300); tone(80, 0.8, 0.5 * vol(src), 'sine', 30); },
    door: () => tone(180, 0.08, 0.25, 'square', 90),
    cash: () => { tone(988, 0.1, 0.2); setTimeout(() => tone(1319, 0.25, 0.2), 90); },
    pickup: () => tone(660, 0.15, 0.2, 'triangle', 1320),
    horn: (src, force) => { const v = force ? 0.35 : 0.25 * vol(src); tone(415, 0.35, v, 'square'); tone(523, 0.35, v * 0.8, 'square'); },
    engine(c) {
      if (!ok()) return;
      const s = c ? Math.abs(carSpeed(c)) : 0;
      const gear = c ? s / c.T.max : 0;
      const rpm = c ? 50 + (gear * 5 % 1) * 70 + gear * 80 + (c.throttle ? 15 : 0) : 0;
      engOsc.frequency.setTargetAtTime(rpm, ac.currentTime, 0.05);
      engFilt.frequency.setTargetAtTime(300 + rpm * 4, ac.currentTime, 0.05);
      engGain.gain.setTargetAtTime(c ? 0.07 + Math.abs(c.throttle) * 0.05 : 0, ac.currentTime, 0.08);
    },
    stopEngine() { if (ok()) engGain.gain.setTargetAtTime(0, ac.currentTime, 0.05); },
    siren(on) {
      if (!ok()) return;
      sirenGain.gain.setTargetAtTime(on ? 0.05 : 0, ac.currentTime, 0.1);
      if (on) sirenOsc.frequency.setTargetAtTime((gameTime * 1.6 % 1) < 0.5 ? 760 : 980, ac.currentTime, 0.02);
    },
  };
})();

// ====================================================================
// HUD
// ====================================================================
const $ = id => document.getElementById(id);
const hud = { money: $('money'), stars: $('stars'), weapon: $('weapon'), hp: $('hpBar'), car: $('carInfo'), mission: $('mission'),
  street: $('street'), big: $('bigText'), toast: $('toast') };
let toastT = 0, streetT = 0, flashRed = 0, lastHud = {};
function toast(msg) { hud.toast.textContent = msg; toastT = msg ? 3 : 0; }
function setText(el, key, v) { if (lastHud[key] !== v) { lastHud[key] = v; el.innerHTML = v; } }
function updateHUD(dt) {
  setText(hud.money, 'm', '$' + player.money.toLocaleString('es-MX'));
  let st = ''; for (let i = 1; i <= 5; i++) st += `<span class="${i <= wanted.stars ? 'on' : 'off'}">★</span>`;
  setText(hud.stars, 's', st);
  hud.stars.classList.toggle('flash', wanted.stars > 0 && wanted.unseen < 2);
  setText(hud.weapon, 'w', player.car ? '' : `🔫 Pistola · ${player.ammo}`);
  hud.hp.style.width = player.hp + '%';
  if (player.car) {
    const c = player.car;
    setText(hud.car, 'c', `<div class="spd">${Math.round(carSpeed(c) * 3.6)} km/h</div>${c.T.name} · ${Math.max(0, Math.round(c.hp / c.T.hp * 100))}%`);
  } else setText(hud.car, 'c', '');
  const mt = mission ? `🔧 Encargo: <b>${CAR_TYPES[mission.type].name}</b> → ${SPOTS.garage.name} ($${mission.reward})` + (wanted.stars ? ' · 🎨 Pinta Rápido quita estrellas' : '') : '';
  setText(hud.mission, 'mi', mt);
  toastT -= dt; if (toastT <= 0 && hud.toast.textContent) hud.toast.textContent = '';
  // calle actual y entre qué calles (siempre visible)
  streetT -= dt;
  if (streetT <= 0) {
    streetT = 0.3;
    const r = nearestRoad(view.cx, view.cy, 45, s => ROADS[segR[s]].t !== 8) || nearestRoad(view.cx, view.cy, 45);
    let html = '';
    if (r) {
      const nm = ROADS[segR[r.s]].name || 'Calle sin nombre';
      const cs = crossStreets(r.s);
      html = `<div class="st">${nm}</div>` + (cs ? `<div class="cs">${cs}</div>` : '');
    } else html = '<div class="st">Fuera de la ciudad</div>';
    // lugar real más cercano
    let bp = null, bd = 60 * 60;
    poiGrid.query(view.cx - 60, view.cy - 60, view.cx + 60, view.cy + 60, i => { const p = POIS[i], d = dist2(p.x, p.y, view.cx, view.cy) - (p.imp ? 900 : 0); if (d < bd) { bd = d; bp = p; } });
    if (bp) html += `<div class="poi">${bp.cat.icon} ${bp.name} · ${Math.round(Math.hypot(bp.x - view.cx, bp.y - view.cy))} m</div>`;
    setText(hud.street, 'st', html);
  }
  if (state === 'wasted') setText(hud.big, 'b', '<span style="color:#ff4d4d">¡TE MATARON!</span><div style="font-size:18px;letter-spacing:1px">' + (stateT > 1 ? (isTouch ? 'Toca para continuar' : 'Pulsa R para continuar') : '') + '</div>');
  else if (state === 'busted') setText(hud.big, 'b', '<span style="color:#3c8dff">¡AGARRADO!</span><div style="font-size:18px;letter-spacing:1px">' + (stateT > 1 ? (isTouch ? 'Toca para continuar' : 'Pulsa R para continuar') : '') + '</div>');
  else setText(hud.big, 'b', '');
}

const ctx2d = document.createElement('canvas').getContext('2d');
// ====================================================================
// RENDER 3D (Three.js) — cámara en tercera persona
// ====================================================================
const view = { w: 0, h: 0, dpr: 1, zoom: 6, cx: player.x, cy: player.y, yaw: 0 };
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const SKY = 0xcfe3ee;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 60, 260);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 300);
function resize() {
  view.dpr = Math.min(devicePixelRatio || 1, 1.5);
  view.w = innerWidth; view.h = innerHeight;
  renderer.setPixelRatio(view.dpr); renderer.setSize(view.w, view.h, false);
  camera.aspect = view.w / view.h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a6a, 0.8));
const sun = new THREE.DirectionalLight(0xfff0d8, 0.7); sun.position.set(-0.6, 1, 0.35); scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: 0xa3967a }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
function lam(color, extra) {
  const k = color + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {})); matCache.set(k, m); }
  return m;
}

// --- geometría acumulada por trozos (chunks) para el mapa estático ---
const CHUNK = 500;
class ChunkGeo {
  constructor() { this.m = new Map(); }
  get(x, y) {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK);
    let c = this.m.get(k); if (!c) this.m.set(k, c = { p: [], c: [] }); return c;
  }
  tri(ch, ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    ch.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) ch.c.push(col.r, col.g, col.b);
  }
  quad(ch, a, b, c, d, y, col) { // a,b,c,d en sentido horario visto desde arriba
    this.tri(ch, a[0], y, a[1], c[0], y, c[1], b[0], y, b[1], col);
    this.tri(ch, a[0], y, a[1], d[0], y, d[1], c[0], y, c[1], col);
  }
  build(mat, order) {
    for (const ch of this.m.values()) {
      if (!ch.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(ch.p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(ch.c, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = order || 0;
      scene.add(mesh);
    }
  }
}
const flatMat = (off) => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -off, polygonOffsetUnits: -off * 4 });
const C = hex => new THREE.Color(hex);

// áreas (parques, canchas, etc.)
(() => {
  const cg = new ChunkGeo();
  const cols = [C(0x86b55e), C(0x74a352), C(0xb3ab9d), C(0xd2c3a8)];
  for (const a of MAP.areas) {
    const pts = []; for (let i = 2; i < a.length; i += 2) pts.push(new THREE.Vector2(a[i], a[i + 1]));
    if (pts.length < 3) continue;
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { continue; }
    const ch = cg.get(pts[0].x, pts[0].y);
    for (const t of tris) {
      const p = t.map(i => pts[i]);
      cg.tri(ch, p[0].x, 0.015, p[0].y, p[1].x, 0.015, p[1].y, p[2].x, 0.015, p[2].y, cols[a[0]]);
    }
  }
  cg.build(flatMat(1));
})();

// calles: banquetas, asfalto, líneas, y canales
(() => {
  const side = new ChunkGeo(), asph = new ChunkGeo(), line = new ChunkGeo(), water = new ChunkGeo();
  const cSide = C(0xa9a397), cAsph = C(0x4a4a50), cServ = C(0x5a5650), cYel = C(0xf2d14b), cWhite = C(0xeeeeee), cWater = C(0x3f7fa3), cBank = C(0x8b7d5e);
  const nodeR = new Float32Array(NN), nodeRS = new Float32Array(NN);
  const ribbon = (cg, x0, y0, x1, y1, hw, y, col) => {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L * hw, ny = dx / L * hw;
    cg.quad(cg.get(x0, y0), [x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny], y, col);
  };
  const disc = (cg, x, y, r, h, col) => {
    const ch = cg.get(x, y), n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU, a1 = (i + 1) / n * TAU;
      cg.tri(ch, x, h, y, x + Math.cos(a1) * r, h, y + Math.sin(a1) * r, x + Math.cos(a0) * r, h, y + Math.sin(a0) * r, col);
    }
  };
  for (let s = 0; s < NSEG; s++) {
    const r = ROADS[segR[s]], a = segA[s], b = segB[s];
    const sw = r.t === 8 ? 0.4 : 2.3;
    ribbon(side, NX[a], NY[a], NX[b], NY[b], r.hw + sw, 0.03, cSide);
    ribbon(asph, NX[a], NY[a], NX[b], NY[b], r.hw, 0.06, r.t >= 7 ? cServ : cAsph);
    nodeR[a] = Math.max(nodeR[a], r.hw); nodeR[b] = Math.max(nodeR[b], r.hw);
    nodeRS[a] = Math.max(nodeRS[a], r.hw + sw); nodeRS[b] = Math.max(nodeRS[b], r.hw + sw);
    // líneas: amarilla discontinua al centro (doble sentido), blanca en un sentido
    if (r.t >= 1 && r.t <= 4) {
      const dx = NX[b] - NX[a], dy = NY[b] - NY[a], L = Math.hypot(dx, dy);
      if (L < 12) continue;
      const ux = dx / L, uy = dy / L;
      for (let d = 4; d < L - 4; d += 7) {
        const e = Math.min(d + 3.5, L - 4);
        ribbon(line, NX[a] + ux * d, NY[a] + uy * d, NX[a] + ux * e, NY[a] + uy * e, 0.11, 0.08, r.ow ? cWhite : cYel);
      }
    }
  }
  for (let i = 0; i < NN; i++) if (nodeR[i] > 0) { disc(side, NX[i], NY[i], nodeRS[i], 0.03, cSide); disc(asph, NX[i], NY[i], nodeR[i], 0.06, cAsph); }
  for (const w of MAP.water) {
    const hw = w[0] / 2;
    for (let i = 1; i < w.length - 2; i += 2) {
      ribbon(water, w[i], w[i + 1], w[i + 2], w[i + 3], hw + 1.5, 0.02, cBank);
      ribbon(water, w[i], w[i + 1], w[i + 2], w[i + 3], hw, 0.035, cWater);
    }
  }
  water.build(flatMat(1)); side.build(flatMat(2)); asph.build(flatMat(3)); line.build(flatMat(4));
})();

// edificios y árboles: InstancedMesh por chunk, visibilidad manual
const windowTex = (() => {
  // una celda = una ventana; se repite según el tamaño de cada edificio (ver shader abajo)
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#6f7d8a'; g.fillRect(14, 14, 36, 32);
  g.fillStyle = '#93a3b1'; g.fillRect(14, 14, 36, 6);
  g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 58, 64, 6);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
})();
const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: windowTex });
wallMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
  #ifdef USE_INSTANCING
    vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    float hsc = abs(normal.x) > 0.5 ? isc.z : isc.x;
    vUv = vec2(uv.x * max(1.0, floor(hsc / 3.5)), uv.y * max(1.0, floor(isc.y / 3.0)));
  #endif`);
};
const bldMats = [wallMat, wallMat, lam(0xe8e2d8), lam(0x444444), wallMat, wallMat];
const BCOLS = ['#e8c8a0', '#d9a679', '#c97b63', '#e3dccf', '#9fb7c9', '#d6c27a', '#b6c99a', '#e0a3a3',
  '#f2f2ee', '#efe2c4', '#f7f7f7', '#d9b36c', '#e6d7b8', '#b0b4b8', '#c9805e'].map(c => new THREE.Color(c));
const instChunks = []; // {mesh[], cx, cy}
(() => {
  const groups = new Map();
  const grp = (x, y) => { const k = Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK); let g = groups.get(k); if (!g) groups.set(k, g = { b: [], t: [], cx: (Math.floor(x / CHUNK) + 0.5) * CHUNK, cy: (Math.floor(y / CHUNK) + 0.5) * CHUNK }); return g; };
  for (let i = 0; i < NB; i++) grp(B.x[i], B.y[i]).b.push(i);
  // árboles: en parques y algunos en banquetas
  let sd = 99; const r01 = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (const a of AREAS) {
    if (a.kind !== 0) continue;
    const n = Math.min(300, Math.floor(a.size / 250));
    for (let k = 0; k < n * 3 && k < 900; k++) {
      const x = lerp(a.x0, a.x1, r01()), y = lerp(a.y0, a.y1, r01());
      if (ctx2d.isPointInPath(a.path, x, y) && !onRoad(x, y)) grp(x, y).t.push([x, y, 0.8 + r01() * 0.6]);
    }
  }
  for (let s = 0; s < NSEG; s += 3) {
    const r = ROADS[segR[s]]; if (r.t < 4 || r.t > 6) continue;
    if (r01() > 0.35) continue;
    const a = segA[s], b = segB[s], t = r01(), dx = NX[b] - NX[a], dy = NY[b] - NY[a], L = Math.hypot(dx, dy) || 1, sd2 = r01() < 0.5 ? 1 : -1;
    const x = NX[a] + dx * t - dy / L * (r.hw + 1.6) * sd2, y = NY[a] + dy * t + dx / L * (r.hw + 1.6) * sd2;
    if (!pointInBuilding(x, y)) grp(x, y).t.push([x, y, 0.7 + r01() * 0.5]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.22, 2.2, 5); trunkGeo.translate(0, 1.1, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.8, 0); crownGeo.translate(0, 3.4, 0);
  const trunkMat = lam(0x6b4a2b), crownMat = lam(0x4f8a3a, { flatShading: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  for (const g of groups.values()) {
    const meshes = [];
    if (g.b.length) {
      const im = new THREE.InstancedMesh(boxGeo, bldMats, g.b.length);
      g.b.forEach((i, k) => {
        q.setFromAxisAngle(up, -Math.atan2(B.s[i], B.c[i]));
        m4.compose(pos.set(B.x[i], 0, B.y[i]), q, scl.set(B.hw[i] * 2, B.h[i], B.hd[i] * 2));
        im.setMatrixAt(k, m4); im.setColorAt(k, BCOLS[B.col[i]]);
      });
      im.frustumCulled = false; scene.add(im); meshes.push(im);
    }
    if (g.t.length) {
      const it = new THREE.InstancedMesh(trunkGeo, trunkMat, g.t.length), ic = new THREE.InstancedMesh(crownGeo, crownMat, g.t.length);
      g.t.forEach(([x, y, s], k) => { m4.compose(pos.set(x, 0, y), q.setFromAxisAngle(up, s * 7), scl.set(s, s, s)); it.setMatrixAt(k, m4); ic.setMatrixAt(k, m4); });
      it.frustumCulled = ic.frustumCulled = false; scene.add(it); scene.add(ic); meshes.push(it, ic);
    }
    instChunks.push({ meshes, box: new THREE.Box3(new THREE.Vector3(g.cx - CHUNK / 2 - 20, 0, g.cy - CHUNK / 2 - 20), new THREE.Vector3(g.cx + CHUNK / 2 + 20, 40, g.cy + CHUNK / 2 + 20)) });
  }
})();
// decoración de edificios emblemáticos (torres de iglesia, cruces de hospital, letreros de plazas)
(() => {
  for (let i = 0; i < NB; i++) {
    const col = B.col[i]; if (col < 8) continue;
    const g = new THREE.Group(); g.position.set(B.x[i], 0, B.y[i]); g.rotation.y = -Math.atan2(B.s[i], B.c[i]);
    const hw = B.hw[i], hd = B.hd[i], h = B.h[i];
    if (col === 9) { // iglesia: torre con cúpula y cruz
      part(g, lam(0xefe2c4), 5, h + 14, 5, hw - 2.5, (h + 14) / 2, 0);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3, 5, 8), lam(0xb5651d)); cone.position.set(hw - 2.5, h + 16.5, 0); g.add(cone);
      part(g, lam(0x333333), 0.3, 2.4, 0.3, hw - 2.5, h + 20, 0); part(g, lam(0x333333), 0.3, 0.3, 1.4, hw - 2.5, h + 20.4, 0);
    } else if (col === 10) { // hospital: cruz roja en la azotea y en la fachada
      part(g, lam(0xd32f2f), 8, 0.4, 2.4, 0, h + 0.2, 0); part(g, lam(0xd32f2f), 2.4, 0.4, 8, 0, h + 0.2, 0);
      part(g, lam(0xd32f2f), 0.3, 4, 1.3, hw + 0.05, h - 3, 0); part(g, lam(0xd32f2f), 0.3, 1.3, 4, hw + 0.05, h - 3, 0);
    } else if (col === 8) { // plaza comercial: franja de color con letreros
      part(g, lam(0xe91e63), hw * 2 + 0.3, 1.6, hd * 2 + 0.3, 0, h - 1.2, 0);
      part(g, lam(0x37474f), hw * 2 + 0.1, 3, hd * 2 + 0.1, 0, 1.5, 0);
    } else if (col === 13) { // estadio: cancha en el techo y gradas
      part(g, lam(0x5d9c3a), hw * 1.6, 0.3, hd * 1.5, 0, h + 0.15, 0);
      part(g, lam(0xffffff), 0.3, 0.32, hd * 1.5, 0, h + 0.17, 0);
    } else if (col === 11) { // universidad/escuela: banda
      part(g, lam(0x8d6e63), hw * 2 + 0.2, 0.8, hd * 2 + 0.2, 0, h - 0.4, 0);
    } else if (col === 12 || col === 14) { // gobierno/cultura: columnas al frente
      for (let k = -2; k <= 2; k++) part(g, lam(0xf5f5f5), 0.8, h - 1, 0.8, hw + 1, (h - 1) / 2, k * hd * 0.4);
      part(g, lam(0xf5f5f5), 1.6, 1, hd * 2, hw + 1, h - 0.5, 0);
    }
    scene.add(g);
  }
})();
const frustum = new THREE.Frustum(), projM = new THREE.Matrix4();
function cullChunks() {
  projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projM);
  const cp = camera.position;
  for (const ch of instChunks) {
    const b = ch.box, dx = Math.max(b.min.x - cp.x, 0, cp.x - b.max.x), dz = Math.max(b.min.z - cp.z, 0, cp.z - b.max.z);
    const vis = dx * dx + dz * dz < 270 * 270 && frustum.intersectsBox(b);
    for (const m of ch.meshes) m.visible = vis;
  }
}

// --- etiquetas (sprites con texto) ---
function makeLabel(text, color, size = 1, fixed = false) {
  const cv = document.createElement('canvas'), g = cv.getContext('2d');
  const fs = 44; g.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 30; cv.width = w; cv.height = fs + 26;
  g.font = `bold ${fs}px "Trebuchet MS", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.55)'; const r = 14;
  g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, cv.height, r); g.arcTo(w, cv.height, 0, cv.height, r); g.arcTo(0, cv.height, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
  g.fillStyle = color; g.fillText(text, w / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, sizeAttenuation: !fixed }));
  const k = fixed ? 0.00075 * size : 0.035 * size; sp.scale.set(cv.width * k, cv.height * k, 1);
  return sp;
}

// lugares especiales: columna de luz + etiqueta
const spotObjs = [];
for (const k of ['garage', 'paint', 'hospital', 'police']) {
  const s = SPOTS[k];
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 30, 20, 1, true), new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  beam.position.set(s.x, 15, s.y); scene.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4, 5, 32), new THREE.MeshBasicMaterial({ color: s.color, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.12, s.y); scene.add(ring);
  const lb = makeLabel(s.icon + ' ' + s.name, s.color, 1.6); lb.position.set(s.x, 9, s.y); scene.add(lb);
  spotObjs.push({ beam, ring, lb });
}

// lugares reales (POIs): etiquetas cercanas creadas bajo demanda
const POI_CATS = [
  { k: 'comida', icon: '🌮', col: '#ffb74d' }, { k: 'tienda', icon: '🛒', col: '#81d4fa' }, { k: 'escuela', icon: '🎓', col: '#ce93d8' },
  { k: 'salud', icon: '✚', col: '#ef9a9a' }, { k: 'iglesia', icon: '⛪', col: '#fff59d' }, { k: 'banco', icon: '🏦', col: '#a5d6a7' },
  { k: 'gobierno', icon: '🏛️', col: '#90caf9' }, { k: 'gasolinera', icon: '⛽', col: '#ffcc80' }, { k: 'hotel', icon: '🏨', col: '#b39ddb' },
  { k: 'parque', icon: '🌳', col: '#c5e1a5' }, { k: 'deporte', icon: '🏟️', col: '#80cbc4' }, { k: 'plaza', icon: '🛍️', col: '#f48fb1' },
  { k: 'cultura', icon: '🎭', col: '#ffe082' }, { k: 'otro', icon: '📍', col: '#eeeeee' },
];
const POIS = (MAP.pois || []).map(p => ({ x: p[0], y: p[1], cat: POI_CATS[p[2]] || POI_CATS[13], name: p[3], imp: p[4] || 0 }));
const poiGrid = new Grid(100); POIS.forEach((p, i) => poiGrid.add(i, p.x, p.y, p.x, p.y));
const poiLabels = new Map();
function updatePoiLabels() {
  const want = new Set();
  poiGrid.query(view.cx - 110, view.cy - 110, view.cx + 110, view.cy + 110, i => {
    const p = POIS[i]; if (dist2(p.x, p.y, view.cx, view.cy) < 110 * 110) want.add(i);
  });
  for (const [i, o] of poiLabels) if (!want.has(i)) { scene.remove(o); o.material.map.dispose(); o.material.dispose(); poiLabels.delete(i); }
  for (const i of want) if (!poiLabels.has(i)) {
    const p = POIS[i];
    const lb = makeLabel(p.cat.icon + ' ' + p.name, p.cat.col, p.imp ? 1.2 : 0.85, true);
    lb.position.set(p.x, p.imp ? 14 : 6, p.y); if (p.imp) { lb.material.depthTest = false; lb.renderOrder = 10; } scene.add(lb); poiLabels.set(i, lb);
  }
}

// --- vehículos ---
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10); wheelGeo.rotateX(Math.PI / 2);
const glassMat = lam(0x23313f), wheelMat = lam(0x1b1b1b), lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6c0 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0x8b0000 }), brakeMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
const redOn = new THREE.MeshBasicMaterial({ color: 0xff1744 }), redOff = lam(0x5a0000), blueOn = new THREE.MeshBasicMaterial({ color: 0x2979ff }), blueOff = lam(0x0d2050);
const wreckMat = lam(0x262626);
function part(parent, mat, sx, sy, sz, x, y, z) { const m = new THREE.Mesh(unitBox, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m); return m; }
function buildCar(c) {
  const T = c.T, L = T.len, W = T.wid, g = new THREE.Group(), body = lam(c.color);
  const o = { g, body: [], tails: [], lights: null };
  if (T.bus) {
    o.body.push(part(g, body, L, 2.2, W, 0, 1.55, 0));
    part(g, glassMat, L - 0.6, 0.8, W + 0.02, -0.1, 1.95, 0);
    part(g, glassMat, 0.05, 1.1, W - 0.3, L / 2, 1.8, 0);
    part(g, lam(0xf4d03f), L - 0.4, 0.25, W + 0.03, 0, 1.0, 0);
  } else {
    const bh = T.sport ? 0.55 : 0.7, by = 0.35 + bh / 2;
    o.body.push(part(g, body, L, bh, W, 0, by, 0));
    let cabL = L * 0.5, cabX = -L * 0.05, cabH = T.sport ? 0.45 : 0.62;
    if (T.bed) { cabL = L * 0.36; cabX = L * 0.12; }
    if (T.round) { cabL = L * 0.55; cabH = 0.7; }
    part(g, glassMat, cabL, cabH, W * 0.86, cabX, by + bh / 2 + cabH / 2, 0);
    o.body.push(part(g, body, cabL * 0.82, 0.08, W * 0.88, cabX - cabL * 0.04, by + bh / 2 + cabH + 0.04, 0));
    if (T.bed) part(g, lam(0x2a2a2a), L * 0.4, 0.05, W * 0.8, -L * 0.27, by + bh / 2 + 0.01, 0);
    if (T.taxi) { part(g, lam(0x1b5e20), L * 0.98, 0.14, W + 0.02, 0, by, 0); part(g, lam(0xffffff), 0.5, 0.22, 0.25, cabX, by + bh / 2 + cabH + 0.19, 0); }
    if (T.police) {
      part(g, lam(0x1f3a93), L * 0.5, bh * 0.6, W + 0.02, -0.1, by, 0);
      const lr = part(g, redOff, 0.3, 0.16, W * 0.4, cabX, by + bh / 2 + cabH + 0.16, -W * 0.22);
      const lb = part(g, blueOff, 0.3, 0.16, W * 0.4, cabX, by + bh / 2 + cabH + 0.16, W * 0.22);
      o.lights = [lr, lb];
    }
    part(g, lightMat, 0.06, 0.18, 0.35, L / 2, by + 0.05, -W / 2 + 0.3); part(g, lightMat, 0.06, 0.18, 0.35, L / 2, by + 0.05, W / 2 - 0.3);
    o.tails.push(part(g, tailMat, 0.06, 0.18, 0.35, -L / 2, by + 0.05, -W / 2 + 0.3), part(g, tailMat, 0.06, 0.18, 0.35, -L / 2, by + 0.05, W / 2 - 0.3));
  }
  const wx = L / 2 - (T.bus ? 1.6 : 0.85);
  for (const sx of [wx, -wx]) for (const sz of [W / 2 - 0.12, -W / 2 + 0.12]) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(sx, 0.36, sz); g.add(w); }
  o.color = c.color; o.wreck = false;
  scene.add(g); return o;
}
const carObjs = new Map();
function syncCars() {
  const alive = new Set();
  for (const c of cars) {
    alive.add(c.id);
    let o = carObjs.get(c.id);
    if (o && o.color !== c.color && !c.wreck) { scene.remove(o.g); o = null; }
    if (!o) { o = buildCar(c); carObjs.set(c.id, o); }
    o.g.position.set(c.x, 0, c.y); o.g.rotation.y = -c.ang;
    const dd = dist2(c.x, c.y, view.cx, view.cy); o.g.visible = dd < 320 * 320;
    if (c.wreck && !o.wreck) { o.wreck = true; for (const m of o.body) m.material = wreckMat; }
    const braking = c.throttle < 0 || c.hb;
    for (const t of o.tails) t.material = braking && c.driver ? brakeMat : tailMat;
    if (o.lights) {
      const on = c.siren && (c.driver === 'cop' || wanted.stars > 0) && !c.wreck, ph = (gameTime * 6 % 2) < 1;
      o.lights[0].material = on && ph ? redOn : redOff; o.lights[1].material = on && !ph ? blueOn : blueOff;
    }
    // inclinación al frenar/girar
    o.g.rotation.z = clamp(-(c.throttle || 0) * 0.02, -0.03, 0.03);
  }
  for (const [id, o] of carObjs) if (!alive.has(id)) { scene.remove(o.g); carObjs.delete(id); }
}

// --- peatones ---
const pedObjs = new Map(); let pedIdN = 1;
const headGeo = new THREE.SphereGeometry(0.17, 8, 6);
function buildPed(p, isPlayer) {
  const g = new THREE.Group();
  const shirt = lam(isPlayer ? 0xffd23f : p.shirt), pants = lam(p.cop ? 0x0d1b4d : 0x2c3e50), skin = lam(p.skin || '#c68642');
  const legL = part(g, pants, 0.16, 0.8, 0.16, 0, 0.4, -0.11), legR = part(g, pants, 0.16, 0.8, 0.16, 0, 0.4, 0.11);
  part(g, shirt, 0.28, 0.62, 0.5, 0, 1.11, 0);
  const armL = part(g, shirt, 0.13, 0.58, 0.13, 0, 1.12, -0.32), armR = part(g, shirt, 0.13, 0.58, 0.13, 0, 1.12, 0.32);
  const head = new THREE.Mesh(headGeo, skin); head.position.set(0, 1.62, 0); g.add(head);
  part(g, lam(p.cop ? 0x0d1b4d : isPlayer ? 0x3b2412 : 0x2b1a0e), 0.3, 0.1, 0.3, -0.02, 1.76, 0);
  if (isPlayer || p.cop) part(g, lam(0x222222), 0.35, 0.09, 0.07, 0.25, 1.0, 0.36);
  scene.add(g);
  return { g, legL, legR, armL, armR, cop: p.cop };
}
function poseHuman(o, x, y, ang, walk, moving, dead) {
  o.g.position.set(x, 0, y); o.g.rotation.y = -ang;
  if (dead) { o.g.rotation.z = -Math.PI / 2; o.g.position.y = 0.15; return; }
  o.g.rotation.z = 0;
  const sw = moving ? Math.sin(walk) * 0.6 : 0;
  o.legL.rotation.z = sw; o.legR.rotation.z = -sw; o.armL.rotation.z = -sw * 0.8; o.armR.rotation.z = sw * 0.8;
}
let playerObj = null;
function syncPeds() {
  const alive = new Set();
  for (const p of peds) {
    if (!p.id) p.id = pedIdN++;
    alive.add(p.id);
    let o = pedObjs.get(p.id);
    if (o && o.cop !== p.cop) { scene.remove(o.g); o = null; }
    if (!o) { o = buildPed(p); pedObjs.set(p.id, o); }
    const vis = dist2(p.x, p.y, view.cx, view.cy) < 160 * 160; o.g.visible = vis;
    if (vis) poseHuman(o, p.x, p.y, p.ang, p.walk, Math.hypot(p.vx, p.vy) > 0.2, p.dead);
  }
  for (const [id, o] of pedObjs) if (!alive.has(id)) { scene.remove(o.g); pedObjs.delete(id); }
  if (!playerObj) playerObj = buildPed({ skin: '#c68642' }, true);
  playerObj.g.visible = !player.car && state !== 'title';
  poseHuman(playerObj, player.x, player.y, player.ang, player.walk, player.moving, player.dead);
}

// --- efectos (pools) ---
function pool(make) { const items = []; let n = 0; return { begin() { n = 0; }, get() { if (n >= items.length) { const m = make(); scene.add(m); items.push(m); } const m = items[n++]; m.visible = true; return m; }, end() { for (let i = n; i < items.length; i++) items[i].visible = false; } }; }
const bloodPool = pool(() => { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: 0x7a0000, transparent: true, opacity: 0.8, depthWrite: false })); m.rotation.x = -Math.PI / 2; return m; });
const fxPool = pool(() => new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false })));
const bitPool = pool(() => new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: 0xffaa00 })));
const pickPool = pool(() => new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 })));
const tracerGeo = new THREE.BufferGeometry(); tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 64), 3));
const tracerLines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: 0xfff09a })); tracerLines.frustumCulled = false; scene.add(tracerLines);
function syncEffects() {
  bloodPool.begin(); fxPool.begin(); bitPool.begin(); pickPool.begin();
  for (const e of effects) {
    const k = e.t / e.life;
    if (e.type === 'blood') { const m = bloodPool.get(); m.position.set(e.x, 0.09, e.y); m.scale.setScalar(e.r); }
    else if (e.type === 'boom') { const m = fxPool.get(); m.position.set(e.x, 1.5, e.y); m.scale.setScalar(2 + k * 9); m.material.color.setHex(k < 0.3 ? 0xffffaa : 0xff7a00); m.material.opacity = 1 - k; }
    else if (e.type === 'smoke') { const m = fxPool.get(); m.position.set(e.x, 1.2 + k * 4, e.y); m.scale.setScalar(0.5 + k * 1.8); m.material.color.setHex(e.fire ? 0xff7a1a : 0x555555); m.material.opacity = (1 - k) * 0.55; }
    else if (e.type === 'spark' || e.type === 'debris') { const m = bitPool.get(); m.position.set(e.x, 0.6 + (1 - k), e.y); m.scale.setScalar(e.type === 'spark' ? 0.12 : 0.4); m.material.color.setHex(e.type === 'spark' ? 0xffc040 : 0x222222); }
    else if (e.type === 'cash') { const m = pickPool.get(); m.position.set(e.x, 0.6, e.y); m.rotation.y = gameTime * 3; m.material.color.setHex(0x2e7d32); m.scale.setScalar(0.6); }
  }
  for (const p of PICKUPS) {
    if (p.respawn > 0 || dist2(p.x, p.y, view.cx, view.cy) > 150 * 150) continue;
    const m = pickPool.get(); m.position.set(p.x, 0.9 + Math.sin(gameTime * 3 + p.x) * 0.2, p.y); m.rotation.y = gameTime * 2; m.scale.setScalar(1);
    m.material.color.setHex(p.type === 'health' ? 0xff4444 : p.type === 'ammo' ? 0xffc107 : 0x43a047);
  }
  bloodPool.end(); fxPool.end(); bitPool.end(); pickPool.end();
  const arr = tracerGeo.attributes.position.array; let n = 0;
  for (const t of tracers) { if (n >= 64) break; arr.set([t.x0, 1.1, t.y0, t.x1, 1.0, t.y1], n * 6); n++; }
  tracerGeo.setDrawRange(0, n * 2); tracerGeo.attributes.position.needsUpdate = true;
}

// --- cámara en tercera persona ---
const cam = { x: player.x - 6, y: player.y, h: 3, yaw: 0, lx: player.x, ly: player.y, init: false };
function updateCamera(dt) {
  if (state === 'title') {
    const a = gameTime * 0.06;
    camera.position.set(SPOTS.start.x + Math.cos(a) * 140, 60, SPOTS.start.y + Math.sin(a) * 140);
    camera.lookAt(SPOTS.start.x, 0, SPOTS.start.y);
    view.cx = SPOTS.start.x; view.cy = SPOTS.start.y;
    return;
  }
  const c = player.car;
  const tx = c ? c.x : player.x, ty = c ? c.y : player.y;
  let heading = c ? c.ang : player.ang;
  if (c) { const fv = c.vx * Math.cos(c.ang) + c.vy * Math.sin(c.ang); if (fv < -2) heading = c.ang; }
  const yawRate = c ? 3.2 : 4;
  if (!cam.init) { cam.yaw = heading; cam.init = true; }
  cam.yaw += wrapAng(heading - cam.yaw) * (1 - Math.exp(-dt * yawRate));
  const sp = c ? carSpeed(c) : 0;
  const portrait = view.h > view.w;
  let dist = c ? 7 + c.T.len * 0.55 + sp * 0.07 : (portrait ? 6 : 4.8);
  const height = c ? 2.6 + c.T.len * 0.13 + sp * 0.02 : (portrait ? 2.9 : 2.4);
  const dx = -Math.cos(cam.yaw), dy = -Math.sin(cam.yaw);
  // evitar que la cámara quede dentro de un edificio
  for (let k = 1.2; k <= dist; k += 0.6) if (pointInBuilding(tx + dx * k, ty + dy * k)) { dist = Math.max(1.5, k - 0.8); break; }
  const px = tx + dx * dist, py = ty + dy * dist;
  const f = 1 - Math.exp(-dt * 10);
  cam.x = lerp(cam.x, px, f); cam.y = lerp(cam.y, py, f); cam.h = lerp(cam.h, height, f);
  const sx = shake > 0 ? rand(-shake, shake) * 0.3 : 0;
  camera.position.set(cam.x + sx, cam.h + sx, cam.y);
  const ahead = c ? 3 + sp * 0.15 : 2;
  cam.lx = lerp(cam.lx, tx + Math.cos(cam.yaw) * ahead, f); cam.ly = lerp(cam.ly, ty + Math.sin(cam.yaw) * ahead, f);
  camera.lookAt(cam.lx, c ? 1.2 : 1.3, cam.ly);
  camera.fov = lerp(camera.fov, (c ? 62 + sp * 0.25 : 60) + (portrait ? 14 : 0), f * 0.3); camera.updateProjectionMatrix();
  view.cx = tx; view.cy = ty; view.yaw = cam.yaw;
}

let poiT = 0;
function render(dt) {
  updateCamera(dt);
  syncCars(); syncPeds(); syncEffects();
  poiT -= dt; if (poiT <= 0) { poiT = 0.5; updatePoiLabels(); }
  for (const o of spotObjs) { o.beam.material.opacity = 0.16 + 0.08 * Math.sin(gameTime * 3); o.ring.rotation.z = gameTime; }
  camera.updateMatrixWorld(); cullChunks();
  renderer.render(scene, camera);
  overlay.style.background = flashRed > 0 ? `rgba(200,0,0,${flashRed})` : (state === 'wasted' || state === 'busted') ? `rgba(0,0,0,${Math.min(0.5, stateT * 0.4)})` : 'transparent';
}
const overlay = document.getElementById('overlay');

// ====================================================================
// MINIMAPA (gira con la cámara) y MAPA INTERACTIVO
// ====================================================================
const MINI_SCALE = 0.25;
const miniBase = document.createElement('canvas');
(() => {
  const W = Math.ceil((BOUNDS[2] - BOUNDS[0]) * MINI_SCALE), H = Math.ceil((BOUNDS[3] - BOUNDS[1]) * MINI_SCALE);
  miniBase.width = W; miniBase.height = H;
  const m = miniBase.getContext('2d');
  m.fillStyle = '#2b2b2b'; m.fillRect(0, 0, W, H);
  m.setTransform(MINI_SCALE, 0, 0, MINI_SCALE, -BOUNDS[0] * MINI_SCALE, -BOUNDS[1] * MINI_SCALE);
  drawMapVector(m, 1 / MINI_SCALE, MINI_SCALE, null);
})();
function drawMapVector(m, minW, scale, rect) {
  for (const a of AREAS) { if (rect && (a.x1 < rect[0] || a.x0 > rect[2] || a.y1 < rect[1] || a.y0 > rect[3])) continue; m.fillStyle = a.kind <= 1 ? '#3f6b2a' : '#3a3a3a'; m.fill(a.path); }
  m.lineCap = 'round'; m.lineJoin = 'round';
  for (const wt of WATER) { m.strokeStyle = '#2f5f80'; m.lineWidth = Math.max(wt.w, minW * 1.5); m.stroke(wt.path); }
  const segs = [];
  if (rect) segGrid.query(rect[0], rect[1], rect[2], rect[3], s => segs.push(s));
  for (let t = 8; t >= 0; t--) {
    const p = new Path2D();
    const list = rect ? segs : null;
    if (list) { for (const s of list) if (ROADS[segR[s]].t === t) { p.moveTo(NX[segA[s]], NY[segA[s]]); p.lineTo(NX[segB[s]], NY[segB[s]]); } }
    else for (let s = 0; s < NSEG; s++) if (ROADS[segR[s]].t === t) { p.moveTo(NX[segA[s]], NY[segA[s]]); p.lineTo(NX[segB[s]], NY[segB[s]]); }
    m.strokeStyle = t <= 3 ? '#e0c068' : t === 4 ? '#c4c4c4' : t === 8 ? '#6d6d6d' : '#9a9a9a';
    m.lineWidth = Math.max(HALF_W[t] * 2, minW * (t <= 3 ? 2.2 : t === 4 ? 1.6 : 1));
    m.stroke(p);
  }
}
const mini = document.getElementById('minimap'), mctx = mini.getContext('2d');
function drawMinimap() {
  const S = mini.width, px = view.cx, py = view.cy, z = 0.8;
  mctx.save();
  mctx.clearRect(0, 0, S, S);
  mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2, 0, TAU); mctx.clip();
  mctx.fillStyle = '#2b2b2b'; mctx.fillRect(0, 0, S, S);
  mctx.translate(S / 2, S / 2); mctx.rotate(-Math.PI / 2 - view.yaw);
  const k = z / MINI_SCALE;
  mctx.drawImage(miniBase, -(px - BOUNDS[0]) * z, -(py - BOUNDS[1]) * z, miniBase.width * k, miniBase.height * k);
  for (const c of cars) if (c.T.police && c.driver === 'cop' && wanted.stars) { mctx.fillStyle = (gameTime * 4 % 2) < 1 ? '#ff1744' : '#2979ff'; mctx.fillRect((c.x - px) * z - 3, (c.y - py) * z - 3, 6, 6); }
  mctx.restore();
  mctx.save(); mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2, 0, TAU); mctx.clip();
  const rot = -Math.PI / 2 - view.yaw, cr = Math.cos(rot), sr = Math.sin(rot);
  for (const kk of ['garage', 'paint', 'hospital', 'police']) {
    const s = SPOTS[kk], wx = (s.x - px) * z, wy = (s.y - py) * z;
    let x = S / 2 + wx * cr - wy * sr, y = S / 2 + wx * sr + wy * cr;
    const dx = x - S / 2, dy = y - S / 2, d = Math.hypot(dx, dy), R = S / 2 - 10;
    if (d > R) { x = S / 2 + dx / d * R; y = S / 2 + dy / d * R; }
    mctx.fillStyle = s.color; mctx.beginPath(); mctx.arc(x, y, 7, 0, TAU); mctx.fill();
    mctx.fillStyle = '#000'; mctx.font = 'bold 9px sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
    mctx.fillText({ garage: 'T', paint: 'P', hospital: '+', police: '★' }[kk], x, y + 0.5);
  }
  // norte
  const NR = S / 2 - 10;
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 3; mctx.font = 'bold 12px sans-serif';
  mctx.strokeText('N', S / 2 + NR * sr, S / 2 - NR * cr); mctx.fillText('N', S / 2 + NR * sr, S / 2 - NR * cr);
  // jugador (siempre hacia arriba, relativo a la cámara)
  const a = (player.car ? player.car.ang : player.ang) - view.yaw - Math.PI / 2;
  mctx.translate(S / 2, S / 2); mctx.rotate(a);
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5;
  mctx.beginPath(); mctx.moveTo(9, 0); mctx.lineTo(-6, -6); mctx.lineTo(-2, 0); mctx.lineTo(-6, 6); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
}

// mapa grande: arrastrar para mover, rueda/pellizco para zoom, tocar para teletransportarse
const bigmap = document.getElementById('bigmap'), bmc = document.getElementById('bigmapCanvas'), bctx = bmc.getContext('2d');
const bm = { x: 0, y: 0, s: 0.2, dirty: true, pts: new Map(), moved: 0, pinch: 0, open: false, target: null };
function toggleMap() {
  if (state !== 'play' && !bm.open) return;
  bm.open = !bm.open;
  bigmap.classList.toggle('hidden', !bm.open);
  if (bm.open) { bm.x = view.cx; bm.y = view.cy; bm.s = Math.min(innerWidth, innerHeight) / 2500; bm.target = null; bm.dirty = true; sizeBigMap(); requestAnimationFrame(drawBigMapLoop); }
}
function sizeBigMap() { const d = Math.min(devicePixelRatio || 1, 2); bmc.width = innerWidth * d; bmc.height = innerHeight * d; bm.dpr = d; bm.dirty = true; }
addEventListener('resize', () => { if (bm.open) sizeBigMap(); });
function bmToWorld(sx, sy) { return [bm.x + (sx - innerWidth / 2) / bm.s, bm.y + (sy - innerHeight / 2) / bm.s]; }
function drawBigMapLoop() {
  if (!bm.open) return;
  if (bm.dirty) { bm.dirty = false; drawBigMap(); }
  requestAnimationFrame(drawBigMapLoop);
}
function drawBigMap() {
  const W = innerWidth, H = innerHeight, d = bm.dpr, b = bctx;
  b.setTransform(d, 0, 0, d, 0, 0); b.fillStyle = '#242424'; b.fillRect(0, 0, W, H);
  const [x0, y0] = bmToWorld(0, 0), [x1, y1] = bmToWorld(W, H);
  b.setTransform(d * bm.s, 0, 0, d * bm.s, d * (W / 2 - bm.x * bm.s), d * (H / 2 - bm.y * bm.s));
  if (bm.s < 0.3) {
    b.imageSmoothingEnabled = true;
    b.drawImage(miniBase, BOUNDS[0], BOUNDS[1], miniBase.width / MINI_SCALE, miniBase.height / MINI_SCALE);
  } else drawMapVector(b, 1 / bm.s, bm.s, [x0 - 50, y0 - 50, x1 + 50, y1 + 50]);
  b.setTransform(d, 0, 0, d, 0, 0);
  const toS = (x, y) => [W / 2 + (x - bm.x) * bm.s, H / 2 + (y - bm.y) * bm.s];
  b.textBaseline = 'middle'; b.lineJoin = 'round';
  // nombres de calles con zoom alto
  if (bm.s > 1.2) {
    const seen = new Set(); b.font = 'bold 12px sans-serif'; b.textAlign = 'center';
    segGrid.query(x0, y0, x1, y1, s => {
      const r = ROADS[segR[s]]; if (!r.name || seen.has(r.name + Math.round(NX[segA[s]] / 250) + Math.round(NY[segA[s]] / 250))) return;
      const a = segA[s], bb = segB[s], L = Math.hypot(NX[bb] - NX[a], NY[bb] - NY[a]); if (L * bm.s < 90) return;
      seen.add(r.name + Math.round(NX[a] / 250) + Math.round(NY[a] / 250));
      const [sx, sy] = toS((NX[a] + NX[bb]) / 2, (NY[a] + NY[bb]) / 2);
      let ang = Math.atan2(NY[bb] - NY[a], NX[bb] - NX[a]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      b.save(); b.translate(sx, sy); b.rotate(ang); b.lineWidth = 3; b.strokeStyle = '#000'; b.strokeText(r.name, 0, 0); b.fillStyle = '#fff'; b.fillText(r.name, 0, 0); b.restore();
    });
  }
  // parques
  b.font = `bold ${bm.s > 0.5 ? 13 : 11}px sans-serif`; b.textAlign = 'center';
  for (const a of AREAS) if (a.name && a.kind <= 1 && a.size * bm.s * bm.s > 2500) { const [x, y] = toS(a.cx, a.cy); b.lineWidth = 3; b.strokeStyle = '#000'; b.strokeText(a.name, x, y); b.fillStyle = '#cfe8c0'; b.fillText(a.name, x, y); }
  // lugares reales
  const showAll = bm.s > 0.9;
  b.textAlign = 'left';
  for (const p of POIS) {
    if (!showAll && !(p.imp && bm.s > 0.35)) continue;
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    const [x, y] = toS(p.x, p.y);
    b.fillStyle = p.cat.col; b.beginPath(); b.arc(x, y, 4, 0, TAU); b.fill();
    b.font = `${p.imp ? 'bold ' : ''}12px sans-serif`; b.lineWidth = 3; b.strokeStyle = '#000';
    const t = p.cat.icon + ' ' + p.name; b.strokeText(t, x + 7, y); b.fillStyle = '#fff'; b.fillText(t, x + 7, y);
  }
  // lugares del juego
  b.font = 'bold 15px sans-serif';
  for (const kk of ['garage', 'paint', 'hospital', 'police']) {
    const s = SPOTS[kk], [x, y] = toS(s.x, s.y);
    b.fillStyle = s.color; b.beginPath(); b.arc(x, y, 9, 0, TAU); b.fill(); b.strokeStyle = '#000'; b.lineWidth = 2; b.stroke();
    b.lineWidth = 4; b.strokeText(s.name, x + 13, y); b.fillStyle = '#fff'; b.fillText(s.name, x + 13, y);
  }
  // jugador
  const [px, py] = toS(view.cx, view.cy), pa = player.car ? player.car.ang : player.ang;
  b.save(); b.translate(px, py); b.rotate(pa); b.fillStyle = '#ffd23f'; b.strokeStyle = '#000'; b.lineWidth = 2;
  b.beginPath(); b.moveTo(13, 0); b.lineTo(-9, -9); b.lineTo(-4, 0); b.lineTo(-9, 9); b.closePath(); b.fill(); b.stroke(); b.restore();
  if (bm.target) {
    const [tx, ty] = toS(bm.target.x, bm.target.y);
    b.strokeStyle = '#ff4081'; b.lineWidth = 3; b.beginPath(); b.arc(tx, ty, 12, 0, TAU); b.stroke();
    b.beginPath(); b.moveTo(tx - 18, ty); b.lineTo(tx + 18, ty); b.moveTo(tx, ty - 18); b.lineTo(tx, ty + 18); b.stroke();
  }
  // escala
  const meters = [50, 100, 250, 500, 1000, 2000].find(m => m * bm.s > 70) || 2000;
  b.fillStyle = '#fff'; b.fillRect(16, H - 30, meters * bm.s, 4); b.font = '12px sans-serif'; b.fillText(meters >= 1000 ? meters / 1000 + ' km' : meters + ' m', 16, H - 42);
}
function bmZoom(f, sx, sy) {
  const [wx, wy] = bmToWorld(sx, sy);
  bm.s = clamp(bm.s * f, 0.04, 6);
  bm.x = wx - (sx - innerWidth / 2) / bm.s; bm.y = wy - (sy - innerHeight / 2) / bm.s;
  bm.dirty = true;
}
bmc.addEventListener('wheel', e => { e.preventDefault(); bmZoom(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
bmc.addEventListener('pointerdown', e => { bmc.setPointerCapture(e.pointerId); bm.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }); bm.moved = 0; bm.t0 = performance.now(); if (bm.pts.size === 2) { const [a, b2] = [...bm.pts.values()]; bm.pinch = Math.hypot(a.x - b2.x, a.y - b2.y); } });
bmc.addEventListener('pointermove', e => {
  const p = bm.pts.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  bm.moved += Math.abs(dx) + Math.abs(dy);
  if (bm.pts.size === 1) { bm.x -= dx / bm.s; bm.y -= dy / bm.s; bm.dirty = true; }
  else if (bm.pts.size === 2) {
    const [a, b2] = [...bm.pts.values()], d = Math.hypot(a.x - b2.x, a.y - b2.y);
    if (bm.pinch > 0) bmZoom(d / bm.pinch, (a.x + b2.x) / 2, (a.y + b2.y) / 2);
    bm.pinch = d; bm.moved += 100;
  }
});
const bmUp = e => {
  const p = bm.pts.get(e.pointerId); bm.pts.delete(e.pointerId);
  if (!p || bm.pts.size) { if (bm.pts.size < 2) bm.pinch = 0; return; }
  if (bm.moved < 8 && performance.now() - bm.t0 < 500) {
    const [wx, wy] = bmToWorld(e.clientX, e.clientY);
    const r = nearestRoad(wx, wy, 400, s => ROADS[segR[s]].t !== 8) || nearestRoad(wx, wy, 1500);
    if (r) { bm.target = { x: r.px, y: r.py }; bm.dirty = true; showTeleport(r); }
  }
};
bmc.addEventListener('pointerup', bmUp); bmc.addEventListener('pointercancel', bmUp);
const tpBox = document.getElementById('tpBox');
let tpTarget = null;
function showTeleport(r) {
  tpTarget = r;
  const nm = ROADS[segR[r.s]].name || 'Calle sin nombre', cs = crossStreets(r.s);
  document.getElementById('tpText').innerHTML = `<b>${nm}</b>${cs ? '<br><small>' + cs + '</small>' : ''}`;
  tpBox.classList.remove('hidden');
}
document.getElementById('tpGo').addEventListener('click', () => { if (tpTarget) teleport(tpTarget); tpBox.classList.add('hidden'); toggleMap(); });
document.getElementById('tpCancel').addEventListener('click', () => { tpBox.classList.add('hidden'); bm.target = null; bm.dirty = true; });
document.getElementById('mapClose').addEventListener('click', () => { tpBox.classList.add('hidden'); toggleMap(); });
document.getElementById('mapIn').addEventListener('click', () => bmZoom(1.6, innerWidth / 2, innerHeight / 2));
document.getElementById('mapOut').addEventListener('click', () => bmZoom(1 / 1.6, innerWidth / 2, innerHeight / 2));
document.getElementById('mapMe').addEventListener('click', () => { bm.x = view.cx; bm.y = view.cy; bm.dirty = true; });

function teleport(r) {
  const a = segA[r.s], b = segB[r.s], ang = Math.atan2(NY[b] - NY[a], NX[b] - NX[a]);
  if (player.car) {
    const c = player.car; c.x = r.px; c.y = r.py; c.ang = ang; c.vx = c.vy = 0;
  } else { player.x = r.px; player.y = r.py; player.ang = ang; }
  player.x = r.px; player.y = r.py;
  cars = cars.filter(c => c === player.car); peds = [];
  cam.init = false; cam.x = r.px - Math.cos(ang) * 8; cam.y = r.py - Math.sin(ang) * 8; cam.lx = r.px; cam.ly = r.py;
  view.cx = r.px; view.cy = r.py;
  for (let i = 0; i < 5; i++) spawnParked(r.px, r.py, 10, 60);
  for (let i = 0; i < 25; i++) spawnTraffic(r.px, r.py, 40, 220, false);
  for (let i = 0; i < 25; i++) spawnPed(r.px, r.py, 10, 110);
  toast('Teletransportado');
}

// ---------- entre qué calles estás ----------
const crossCache = new Map();
function crossStreets(seg) {
  if (crossCache.has(seg)) return crossCache.get(seg);
  const name = ROADS[segR[seg]].name;
  const walk = (start, fromSeg) => {
    let node = start, prev = fromSeg;
    for (let i = 0; i < 80; i++) {
      let other = null, best = -1, cont = null;
      for (const e of adjAll[node]) {
        if (e.s === prev) continue;
        const r = ROADS[segR[e.s]];
        if (r.name === name) { if (!cont) cont = e; continue; }
        if (r.name && r.t !== 8 && (9 - r.t) > best) { best = 9 - r.t; other = r.name; }
      }
      if (other) return other;
      if (!cont) return null;
      prev = cont.s; node = cont.n;
    }
    return null;
  };
  const a = walk(segB[seg], seg), b = walk(segA[seg], seg);
  let out = '';
  if (a && b && a !== b) out = `entre ${a} y ${b}`;
  else if (a || b) out = `cerca de ${a || b}`;
  crossCache.set(seg, out);
  return out;
}

// ====================================================================
// BUCLE PRINCIPAL
// ====================================================================
function update(dt) {
  gameTime += dt;
  stateT += dt;
  const ctl = readControls();
  shake = Math.max(0, shake - dt * 2);
  flashRed = Math.max(0, flashRed - dt);
  spotCooldown -= dt;

  if (state === 'play') {
    if (player.car) {
      const c = player.car;
      if (input.stick) { c.steer = clamp(ctl.x * 1.3, -1, 1); c.throttle = clamp(-ctl.y * 1.25, -1, 1); }
      else if (false) {
        const mag = Math.min(1, Math.hypot(ctl.x, ctl.y));
        if (mag > 0.2) {
          const desired = Math.atan2(ctl.y, ctl.x);
          const fv = c.vx * Math.cos(c.ang) + c.vy * Math.sin(c.ang);
          let da = wrapAng(desired - c.ang);
          // si el destino está justo detrás: un momento de reversa y luego vuelta
          if (Math.abs(da) > 2.5 && fv < 4) c.joyRev = (c.joyRev || 0) + 1 / 60; else c.joyRev = 0;
          if (c.joyRev > 0 && c.joyRev < 1.0) { const rda = wrapAng(desired + Math.PI - c.ang); c.steer = clamp(-rda * 2.5, -1, 1); c.throttle = -mag; }
          else { c.steer = clamp(da * 2.5, -1, 1); c.throttle = Math.abs(da) > 1.8 && fv > 8 ? -0.5 : mag; }
        } else { c.steer = 0; c.throttle = 0; }
      } else { c.steer = ctl.x; c.throttle = -ctl.y; }
      c.hb = !!ctl.brake;
      sfx.engine(c);
      // lugares
      if (spotCooldown <= 0) {
        if (dist2(c.x, c.y, SPOTS.garage.x, SPOTS.garage.y) < 36 && carSpeed(c) < 6) { spotCooldown = 2; deliverCar(); }
        else if (dist2(c.x, c.y, SPOTS.paint.x, SPOTS.paint.y) < 36 && carSpeed(c) < 8) { spotCooldown = 4; paintCar(); }
      }
      player.x = c.x; player.y = c.y;
      // atropellos
      const sp = carSpeed(c);
      if (sp > 3) for (const p of peds) {
        if (p.dead || Math.abs(p.x - c.x) > 6 || Math.abs(p.y - c.y) > 6) continue;
        for (const [x, y, r] of carCircles(c)) if (dist2(x, y, p.x, p.y) < (r + 0.4) ** 2) {
          if (sp > 6) { killPed(p, 'player'); c.vx *= 0.94; c.vy *= 0.94; sfx.crash(0.3, c); }
          else { p.x += (p.x - x) * 0.5; p.y += (p.y - y) * 0.5; p.flee = 5; p.fleeX = c.x; p.fleeY = c.y; }
          break;
        }
      }
    } else if (!player.dead) {
      const mag = Math.min(1, Math.hypot(ctl.x, ctl.y));
      const spd = ctl.brake ? 7 : 5.2; // espacio = correr
      if (input.stick) {
        // joystick relativo a la cámara: arriba = hacia donde mira la cámara
        player.moving = mag > 0.15;
        if (player.moving) {
          const a = view.yaw + Math.atan2(ctl.x, -ctl.y);
          player.ang += wrapAng(a - player.ang) * Math.min(1, dt * 10);
          player.x += Math.cos(a) * spd * mag * dt; player.y += Math.sin(a) * spd * mag * dt;
          player.walk += spd * dt * 3;
        }
      } else {
        // teclado: A/D giran, W/S avanzan
        player.ang = wrapAng(player.ang + ctl.x * 2.8 * dt);
        player.moving = ctl.y !== 0;
        if (player.moving) {
          const k = ctl.y < 0 ? 1 : -0.6;
          player.x += Math.cos(player.ang) * spd * k * dt; player.y += Math.sin(player.ang) * spd * k * dt;
          player.walk += spd * dt * 3;
        }
      }
      circleVsBuildings(player.x, player.y, 0.45, (nx, ny, pen) => { player.x += nx * pen; player.y += ny * pen; });
      for (const c of cars) for (const [x, y, r] of carCircles(c)) {
        const d = Math.hypot(player.x - x, player.y - y);
        if (d < r + 0.45 && d > 0) {
          const sp = carSpeed(c);
          if (sp > 6 && !player.hitCd) { hurtPlayer(sp * 2.2); player.hitCd = 0.6; }
          player.x = x + (player.x - x) / d * (r + 0.45); player.y = y + (player.y - y) / d * (r + 0.45);
        }
      }
      player.hitCd = Math.max(0, (player.hitCd || 0) - dt);
      if (false) {
        player.aimAng = Math.atan2(mouse.y - view.h / 2 - (player.y - view.cy) * view.zoom, mouse.x - view.w / 2 - (player.x - view.cx) * view.zoom);
        if (!player.moving) player.ang = player.aimAng;
        if (mouse.down) player.ang = player.aimAng;
      } else {
        // apuntado automático al peatón/policía más cercano enfrente
        let best = null, bs = 1e9;
        for (const p of peds) {
          if (p.dead) continue;
          const dx = p.x - player.x, dy = p.y - player.y, d = Math.hypot(dx, dy);
          if (d > 25) continue;
          const da = Math.abs(wrapAng(Math.atan2(dy, dx) - player.ang));
          const sc = d + da * 15 - (p.cop ? 10 : 0);
          if (da < 0.8 && sc < bs) { bs = sc; best = p; }
        }
        player.aimAng = best ? Math.atan2(best.y - player.y, best.x - player.x) : player.ang;
        if (ctl.fire && best) player.ang = player.aimAng;
      }
      player.shootT -= dt;
      if (ctl.fire) shoot();
      if (spotCooldown <= 0 && player.hp < 100 && dist2(player.x, player.y, SPOTS.hospital.x, SPOTS.hospital.y) < 36 && player.money >= 50) {
        spotCooldown = 3; player.money -= 50; player.hp = 100; toast('Curado: -$50'); sfx.cash();
      }
    }
    // pickups y dinero
    for (const p of PICKUPS) {
      if (p.respawn > 0) { p.respawn -= dt; continue; }
      if (dist2(p.x, p.y, player.x, player.y) < (player.car ? 9 : 2.5)) {
        if (p.type === 'health') { if (player.hp >= 100) continue; player.hp = Math.min(100, player.hp + 40); toast('+ Salud'); }
        else if (p.type === 'ammo') { player.ammo += 30; toast('+30 balas'); }
        else { const a = (rand(50, 300) | 0); player.money += a; toast(`+$${a}`); }
        p.respawn = 90; sfx.pickup();
      }
    }
    for (const e of effects) if (e.type === 'cash' && !e.taken && dist2(e.x, e.y, player.x, player.y) < (player.car ? 9 : 2)) {
      e.taken = true; e.life = 0; player.money += e.amt; toast(`+$${e.amt}`); sfx.pickup();
    }
    // búsqueda policial
    if (wanted.stars > 0) {
      if (copSees()) wanted.unseen = 0; else wanted.unseen += dt;
      if (wanted.unseen > 10 + wanted.stars * 3) {
        wanted.heat = Math.max(0, wanted.heat - dt * 60);
        const ns = STAR_HEAT.reduce((s, h, i) => wanted.heat >= h ? i : s, 0);
        if (ns < wanted.stars) { wanted.stars = ns; wanted.heat = STAR_HEAT[ns] + (ns ? 50 : 0); wanted.unseen = 0; if (ns === 0) { wanted.heat = 0; toast('Los perdiste. ¡Limpio!'); } }
      }
      bustTimer = Math.max(0, bustTimer - dt * 0.5);
      if (bustTimer > 1.4) die('busted');
    } else bustTimer = 0;
  } else if (state === 'wasted' || state === 'busted') {
    if (stateT > 6) respawn();
  }

  // carros
  for (const c of cars) {
    if (c.driver === 'ai') updateTraffic(c, dt);
    else if (c.driver === 'cop') updateCop(c, dt);
    else if (c.driver !== 'player') { c.throttle = 0; c.steer = 0; c.hb = true; }
    physicsCar(c, dt);
    collideCarWorld(c);
    if (c.fire > 0) {
      c.fire -= dt;
      if (Math.random() < 0.5) effects.push({ type: 'smoke', fire: true, x: c.x + rand(-1, 1), y: c.y + rand(-1, 1), t: 0, life: 0.8 });
      if (c.driver === 'ai' || c.driver === 'cop') {
        const fx = Math.cos(c.ang), fy = Math.sin(c.ang);
        peds.push(makePed(c.x + fy * 1.8, c.y - fx * 1.8, { flee: 8, fleeX: c.x, fleeY: c.y, shirt: c.driver === 'cop' ? '#1f3a93' : pick(SHIRTS) }));
        c.driver = null; c.ai = null;
      }
      if (c.fire <= 0) explodeCar(c);
    } else if (!c.wreck && c.hp < c.T.hp * 0.3 && Math.random() < 0.15) effects.push({ type: 'smoke', x: c.x + Math.cos(c.ang) * c.T.len * 0.4, y: c.y + Math.sin(c.ang) * c.T.len * 0.4, t: 0, life: 1.2 });
    // AI que huye cuando le disparan
    if (c.driver === 'ai' && c.hp < c.T.hp * 0.8 && c.ai.mode !== 'flee') { c.ai.mode = 'flee'; c.ai.t = 10; }
  }
  collideCars();
  if (player.car && player.car.fire > 0 && player.car.fire < 3.5) toast('¡El carro se incendia! ¡Bájate! (E)');
  // peatones
  for (const p of peds) updatePed(p, dt);
  // efectos
  for (const e of effects) {
    e.t += dt;
    if (e.vx !== undefined) { e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.92; e.vy *= 0.92; }
  }
  effects = effects.filter(e => e.t < e.life);
  if (effects.length > 600) effects.splice(0, effects.length - 600);
  for (const t of tracers) t.t -= dt;
  tracers = tracers.filter(t => t.t > 0);
  for (const s of skids) s.a -= dt * 0.02;
  manageWorld(dt);
  // sirena
  const copsClose = wanted.stars > 0 && cars.some(c => c.T.police && c.driver === 'cop' && dist2(c.x, c.y, view.cx, view.cy) < 150 * 150);
  sfx.siren(copsClose && state === 'play');
}

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state !== 'title') {
    acc += dt;
    while (acc >= 1 / 60) { update(1 / 60); acc -= 1 / 60; }
    updateHUD(dt);
    drawMinimap();
  } else gameTime += dt;
  render(dt);
  requestAnimationFrame(frame);
}

function startGame() {
  if (state !== 'title') return;
  sfx.init();
  document.getElementById('title').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  if (isTouch) { document.getElementById('touch').classList.remove('hidden'); document.body.classList.add('touch'); }
  state = 'play'; stateT = 0;
  view.cx = player.x; view.cy = player.y;
  // primeros carros cerca para robar
  for (let i = 0; i < 6; i++) spawnParked(player.x, player.y, 8, 60);
  for (let i = 0; i < 30; i++) spawnTraffic(player.x, player.y, 40, 250, false);
  for (let i = 0; i < 30; i++) spawnPed(player.x, player.y, 10, 120);
  { const r = nearestRoad(player.x, player.y, 60); if (r) player.ang = Math.atan2(NY[segB[r.s]] - NY[segA[r.s]], NX[segB[r.s]] - NX[segA[r.s]]); }
  toast('¡Bienvenido a Los Mochis! Acércate a un carro y pulsa E (🚗) para robarlo');
}
document.getElementById('play').addEventListener('click', startGame);
window.__game = { player, cars, peds, SPOTS, mission: () => mission, nearestRoad, ROADS, segR, NX, NY, get state() { return state; }, wanted, view, enterOrExit, crime, getCars: () => cars };
requestAnimationFrame(frame);
})();
