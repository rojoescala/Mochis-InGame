// Mochis: Ruta Robada — juego de mundo abierto en vista cenital sobre las calles reales de Los Mochis.
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
const SPOTS = {
  start: spotNear(0, 0),
  garage: Object.assign(spotNear(1500, 900), { name: 'Taller "El Chuy"', color: '#ffb000', icon: '🔧' }),
  paint: Object.assign(spotNear(-1700, -300), { name: 'Pinta Rápido', color: '#d05cff', icon: '🎨' }),
  hospital: Object.assign(spotNear(400, -900), { name: 'Hospital', color: '#ff4d4d', icon: '✚' }),
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
  const viewR = Math.max(view.w, view.h) / view.zoom * 0.6 + 30;
  // eliminar lejanos
  cars = cars.filter(c => {
    if (c === player.car) return true;
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d > 520 || (c.despawn && d > viewR)) return false;
    if (c.despawn && d <= viewR) c.despawn = false;
    return true;
  });
  peds = peds.filter(p => !p.remove && Math.hypot(p.x - cx, p.y - cy) < 300 && !(p.dead && p.deadT > 30));
  const nTraffic = cars.filter(c => c.driver === 'ai').length;
  const nParked = cars.filter(c => !c.driver && !c.wreck).length;
  const nCops = cars.filter(c => c.T.police && c.driver === 'cop').length + peds.filter(p => p.cop && !p.dead).length;
  const wantTraffic = 38, wantParked = 22;
  if (nTraffic < wantTraffic) spawnTraffic(cx, cy, viewR, viewR + 150, false);
  if (nParked < wantParked) spawnParked(cx, cy, viewR, viewR + 120);
  if (peds.filter(p => !p.dead).length < 45) spawnPed(cx, cy, viewR * 0.8, viewR + 80);
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
let toastT = 0, streetName = '', streetT = 0, flashRed = 0, lastHud = {};
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
  // nombre de calle
  const r = nearestRoad(view.cx, view.cy, 25);
  const nm = r ? ROADS[segR[r.s]].name : '';
  if (nm && nm !== streetName) { streetName = nm; streetT = 3.5; hud.street.textContent = nm; }
  streetT -= dt; hud.street.classList.toggle('show', streetT > 0);
  if (state === 'wasted') setText(hud.big, 'b', '<span style="color:#ff4d4d">¡TE MATARON!</span><div style="font-size:18px;letter-spacing:1px">' + (stateT > 1 ? (isTouch ? 'Toca para continuar' : 'Pulsa R para continuar') : '') + '</div>');
  else if (state === 'busted') setText(hud.big, 'b', '<span style="color:#3c8dff">¡AGARRADO!</span><div style="font-size:18px;letter-spacing:1px">' + (stateT > 1 ? (isTouch ? 'Toca para continuar' : 'Pulsa R para continuar') : '') + '</div>');
  else setText(hud.big, 'b', '');
}

// ====================================================================
// RENDER
// ====================================================================
const ctx = canvas.getContext('2d');
const view = { w: 0, h: 0, dpr: 1, zoom: 6, cx: player.x, cy: player.y };
function resize() {
  view.dpr = Math.min(devicePixelRatio || 1, 2);
  view.w = innerWidth; view.h = innerHeight;
  canvas.width = view.w * view.dpr; canvas.height = view.h * view.dpr;
}
addEventListener('resize', resize); resize();

const ROAD_COL = ['#444449', '#46464b', '#47474c', '#47474c', '#48484d', '#4a4a4e', '#4a4a4e', '#56524c', '#55524e'];
const ROOF = ['#e8c8a0', '#d9a679', '#c97b63', '#e3dccf', '#9fb7c9', '#d6c27a', '#b6c99a', '#e0a3a3'];
const WALL = ROOF.map(c => shade(c, -0.35));
const WALL2 = ROOF.map(c => shade(c, -0.5));
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = k < 0 ? 0 : 255, t = Math.abs(k);
  r = Math.round(r + (f - r) * t); g = Math.round(g + (f - g) * t); b = Math.round(b + (f - b) * t);
  return `rgb(${r},${g},${b})`;
}
const segStamp = new Uint32Array(NSEG); let stampN = 1;
const bStamp = new Uint32Array(NB);

function render() {
  const { w, h, dpr } = view;
  const z = view.zoom;
  const sx = shake > 0 ? rand(-shake, shake) * 4 : 0, sy = shake > 0 ? rand(-shake, shake) * 4 : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#b9a98a'; ctx.fillRect(0, 0, w, h);
  ctx.setTransform(z * dpr, 0, 0, z * dpr, (w / 2 - view.cx * z + sx) * dpr, (h / 2 - view.cy * z + sy) * dpr);
  const x0 = view.cx - w / 2 / z - 20, x1 = view.cx + w / 2 / z + 20, y0 = view.cy - h / 2 / z - 20, y1 = view.cy + h / 2 / z + 20;

  // áreas
  for (const a of AREAS) {
    if (a.x1 < x0 || a.x0 > x1 || a.y1 < y0 || a.y0 > y1) continue;
    ctx.fillStyle = ['#7fae5a', '#6f9e4d', '#a39d93', '#c9b9a0'][a.kind];
    ctx.fill(a.path);
    if (a.kind === 1) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.4; ctx.stroke(a.path); }
  }
  // agua (canales)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const wt of WATER) {
    if (wt.x1 < x0 || wt.x0 > x1 || wt.y1 < y0 || wt.y0 > y1) continue;
    ctx.strokeStyle = '#8b7d5e'; ctx.lineWidth = wt.w + 3; ctx.stroke(wt.path);
    ctx.strokeStyle = '#3f7fa3'; ctx.lineWidth = wt.w; ctx.stroke(wt.path);
  }
  // calles
  stampN++;
  const vis = [];
  segGrid.query(x0, y0, x1, y1, s => { if (segStamp[s] !== stampN) { segStamp[s] = stampN; vis.push(s); } });
  // grupos por tipo y sentido (índice t*2 + oneway)
  const byGrp = Array.from({ length: 18 }, () => []);
  const byType = Array.from({ length: 9 }, () => []);
  for (const s of vis) { const r = ROADS[segR[s]]; byGrp[r.t * 2 + (r.ow ? 1 : 0)].push(s); byType[r.t].push(s); }
  const pathFor = list => { const p = new Path2D(); for (const s of list) { p.moveTo(NX[segA[s]], NY[segA[s]]); p.lineTo(NX[segB[s]], NY[segB[s]]); } return p; };
  const paths = byType.map(l => l.length ? true : null);
  const gp = byGrp.map(l => l.length ? pathFor(l) : null);
  const gw = g => HALF_W[g >> 1] * (g & 1 ? 0.6 : 1) * 2;
  // banquetas
  ctx.strokeStyle = '#c9c2b4';
  for (let g = 17; g >= 0; g--) if (gp[g]) { ctx.lineWidth = gw(g) + (g >> 1 === 8 ? 1 : 4.5); ctx.stroke(gp[g]); }
  ctx.strokeStyle = '#a8a092';
  for (let g = 17; g >= 0; g--) if (gp[g]) { ctx.lineWidth = gw(g) + (g >> 1 === 8 ? 0.4 : 0.8); ctx.stroke(gp[g]); }
  // asfalto
  for (let g = 17; g >= 0; g--) if (gp[g]) { ctx.strokeStyle = ROAD_COL[g >> 1]; ctx.lineWidth = gw(g); ctx.stroke(gp[g]); }
  // líneas
  if (z > 2.2) {
    ctx.lineCap = 'butt';
    ctx.setLineDash([3, 4]); ctx.lineWidth = 0.25; ctx.strokeStyle = '#f2d14b';
    for (let t = 1; t <= 4; t++) if (paths[t]) {
      const p = new Path2D();
      for (const s of byType[t]) { if (ROADS[segR[s]].ow) continue; p.moveTo(NX[segA[s]], NY[segA[s]]); p.lineTo(NX[segB[s]], NY[segB[s]]); }
      ctx.stroke(p);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([2, 5]);
    for (let t = 1; t <= 3; t++) if (paths[t]) {
      const p = new Path2D();
      for (const s of byType[t]) {
        const a = segA[s], b = segB[s], dx = NX[b] - NX[a], dy = NY[b] - NY[a], L = Math.hypot(dx, dy) || 1, o = ROADS[segR[s]].hw / 2;
        const ow = ROADS[segR[s]].ow;
        for (const k of ow ? [0] : [-1, 1]) { const ox = -dy / L * o * k * (ow ? 0 : 1), oy = dx / L * o * k * (ow ? 0 : 1); p.moveTo(NX[a] + ox, NY[a] + oy); p.lineTo(NX[b] + ox, NY[b] + oy); }
      }
      ctx.stroke(p);
    }
    ctx.setLineDash([]); ctx.lineCap = 'round';
  }
  // marcas de llanta
  ctx.fillStyle = 'rgba(20,20,20,.35)';
  for (const s of skids) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) ctx.fillRect(s.x - 0.18, s.y - 0.18, 0.36, 0.36);
  // sangre, dinero
  for (const e of effects) {
    if (e.type === 'blood') { ctx.fillStyle = 'rgba(130,0,0,.75)'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill(); }
  }
  // puntos especiales
  const pulse = 0.6 + 0.4 * Math.sin(gameTime * 4);
  for (const k of ['garage', 'paint', 'hospital', 'police']) {
    const s = SPOTS[k]; if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
    ctx.globalAlpha = 0.35 + 0.25 * pulse; ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = s.color; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(s.x, s.y, 5 + pulse, 0, TAU); ctx.stroke();
    drawLabel(s.icon + ' ' + s.name, s.x, s.y - 7, z, s.color);
  }
  // pickups
  for (const p of PICKUPS) {
    if (p.respawn > 0 || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    const bob = Math.sin(gameTime * 3 + p.x) * 0.25;
    ctx.fillStyle = p.type === 'health' ? '#fff' : p.type === 'ammo' ? '#333' : '#2e7d32';
    ctx.beginPath(); ctx.arc(p.x, p.y + bob, 1, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.type === 'health' ? '#e53935' : p.type === 'ammo' ? '#fbc02d' : '#a5d6a7'; ctx.lineWidth = 0.3;
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.font = '1.2px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.type === 'health' ? '+' : p.type === 'ammo' ? '•' : '$', p.x, p.y + bob + 0.05);
  }
  for (const e of effects) if (e.type === 'cash') { ctx.fillStyle = '#2e7d32'; ctx.fillRect(e.x - 0.5, e.y - 0.3, 1, 0.6); }
  // peatones
  for (const p of peds) if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) drawPed(p);
  if (!player.car && !player.dead) {
    ctx.strokeStyle = `rgba(255,210,63,${0.5 + 0.3 * Math.sin(gameTime * 5)})`; ctx.lineWidth = 0.18;
    ctx.beginPath(); ctx.arc(player.x, player.y, 1.4, 0, TAU); ctx.stroke();
    drawPed(player, true);
  }
  else if (!player.car && player.dead) drawPed({ ...player, dead: true, shirt: '#ffd23f', skin: '#c68642' });
  // carros
  for (const c of cars) if (c.x > x0 - 6 && c.x < x1 + 6 && c.y > y0 - 6 && c.y < y1 + 6) drawCar(c);
  // balas
  ctx.lineCap = 'round';
  for (const t of tracers) { ctx.strokeStyle = `rgba(255,240,150,${t.t / 0.08})`; ctx.lineWidth = 0.15; ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke(); }
  // efectos
  for (const e of effects) {
    const k = e.t / e.life;
    if (e.type === 'spark') { ctx.fillStyle = `rgba(255,${200 - k * 150},50,${1 - k})`; ctx.fillRect(e.x - 0.15, e.y - 0.15, 0.3, 0.3); }
    else if (e.type === 'debris') { ctx.fillStyle = `rgba(40,40,40,${1 - k})`; ctx.fillRect(e.x - 0.25, e.y - 0.25, 0.5, 0.5); }
    else if (e.type === 'boom') {
      const r = 2 + k * 10;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(255,255,200,${1 - k})`); g.addColorStop(0.4, `rgba(255,140,0,${0.9 * (1 - k)})`); g.addColorStop(1, 'rgba(80,20,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.fill();
    } else if (e.type === 'smoke') {
      ctx.fillStyle = `rgba(${e.fire ? '255,120,20' : '60,60,60'},${(1 - k) * 0.5})`; ctx.beginPath(); ctx.arc(e.x, e.y, 0.6 + k * 2.2, 0, TAU); ctx.fill();
    }
  }
  // edificios (pseudo 3D)
  drawBuildings(x0, y0, x1, y1);
  // nombres de parques
  if (z > 1.6) for (const a of AREAS) {
    if (!a.name || a.kind > 1 || a.size < 4000 || a.cx < x0 || a.cx > x1 || a.cy < y0 || a.cy > y1) continue;
    drawLabel(a.name, a.cx, a.cy, z, '#e8ffe0');
  }
  // flecha hacia el taller cuando llevas el carro del encargo
  if (player.car && mission && player.car.type === mission.type) drawArrow(SPOTS.garage, '#ffb000');
  if (player.car && wanted.stars > 0) drawArrow(SPOTS.paint, '#d05cff');
  // apuntar
  if (!player.car && !player.dead && mouse.used && !isTouch) {
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.12;
    const ax = player.x + Math.cos(player.aimAng) * 6, ay = player.y + Math.sin(player.aimAng) * 6;
    ctx.beginPath(); ctx.arc(ax, ay, 0.5, 0, TAU); ctx.stroke();
  }
  // pantalla roja al recibir daño
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (flashRed > 0) { ctx.fillStyle = `rgba(200,0,0,${flashRed})`; ctx.fillRect(0, 0, w, h); }
  if (state === 'wasted' || state === 'busted') { ctx.fillStyle = `rgba(0,0,0,${Math.min(0.5, stateT * 0.4)})`; ctx.fillRect(0, 0, w, h); }
}

function drawLabel(text, x, y, z, col) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1 / z, 1 / z);
  ctx.font = 'bold 13px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(text, 0, 0); ctx.fillStyle = col; ctx.fillText(text, 0, 0);
  ctx.restore();
}
function drawArrow(target, col) {
  const px = player.car.x, py = player.car.y, d = Math.hypot(target.x - px, target.y - py);
  if (d < 30) return;
  const a = Math.atan2(target.y - py, target.x - px);
  const r = Math.min(view.w, view.h) / view.zoom * 0.32;
  ctx.save(); ctx.translate(px + Math.cos(a) * r, py + Math.sin(a) * r); ctx.rotate(a); ctx.scale(1 / view.zoom, 1 / view.zoom);
  ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.rotate(-a); ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.strokeText(Math.round(d) + ' m', 0, 26); ctx.fillText(Math.round(d) + ' m', 0, 26);
  ctx.restore();
}

function drawBuildings(x0, y0, x1, y1) {
  const list = [];
  stampN++;
  bGrid.query(x0, y0, x1, y1, i => { if (bStamp[i] !== stampN) { bStamp[i] = stampN; list.push(i); } });
  list.sort((a, b) => B.h[a] - B.h[b]);
  const k = 0.022;
  const cx = view.cx, cy = view.cy;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const bx = new Float32Array(4), by = new Float32Array(4), tx = new Float32Array(4), ty = new Float32Array(4);
  for (const i of list) {
    const h = B.h[i], c = B.c[i], s = B.s[i];
    const ox = (B.x[i] - cx) * h * k, oy = (B.y[i] - cy) * h * k;
    for (let j = 0; j < 4; j++) {
      const lx = corners[j][0] * B.hw[i], ly = corners[j][1] * B.hd[i];
      bx[j] = B.x[i] + lx * c - ly * s; by[j] = B.y[i] + lx * s + ly * c;
      tx[j] = bx[j] + ox; ty[j] = by[j] + oy;
    }
    // paredes visibles
    for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) & 3;
      // normal hacia afuera de la arista
      const ex = bx[j2] - bx[j], ey = by[j2] - by[j];
      const nx = ey, ny = -ex;
      if (nx * ox + ny * oy >= 0) continue; // cara oculta
      ctx.fillStyle = (Math.abs(nx) > Math.abs(ny)) ? WALL[B.col[i]] : WALL2[B.col[i]];
      ctx.beginPath(); ctx.moveTo(bx[j], by[j]); ctx.lineTo(bx[j2], by[j2]); ctx.lineTo(tx[j2], ty[j2]); ctx.lineTo(tx[j], ty[j]); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = ROOF[B.col[i]];
    ctx.beginPath(); ctx.moveTo(tx[0], ty[0]); ctx.lineTo(tx[1], ty[1]); ctx.lineTo(tx[2], ty[2]); ctx.lineTo(tx[3], ty[3]); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.25; ctx.stroke();
    if (h > 8 && view.zoom > 2.5) { // detalles de azotea
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      const mx = (tx[0] + tx[2]) / 2, my = (ty[0] + ty[2]) / 2;
      ctx.fillRect(mx - 1, my - 1, 2, 2);
    } else if (view.zoom > 3) {
      ctx.fillStyle = 'rgba(30,80,120,.55)'; // tinaco
      const mx = tx[0] * 0.7 + tx[2] * 0.3, my = ty[0] * 0.7 + ty[2] * 0.3;
      ctx.beginPath(); ctx.arc(mx, my, 0.55, 0, TAU); ctx.fill();
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function drawCar(c) {
  const T = c.T, L = T.len, W = T.wid;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.ang);
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,.25)'; roundRect(-L / 2 + 0.3, -W / 2 + 0.3, L, W, 0.5); ctx.fill();
  // carrocería
  ctx.fillStyle = c.color; roundRect(-L / 2, -W / 2, L, W, T.round ? 0.8 : 0.45); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.1; ctx.stroke();
  if (c.wreck) { ctx.fillStyle = 'rgba(0,0,0,.5)'; roundRect(-L / 2, -W / 2, L, W, 0.4); ctx.fill(); ctx.restore(); return; }
  const glass = 'rgba(30,45,60,.85)';
  if (T.bus) {
    ctx.fillStyle = glass; ctx.fillRect(L / 2 - 1.1, -W / 2 + 0.2, 0.8, W - 0.4);
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-L / 2 + 0.6, -W / 2 + 0.3, L - 2, W - 0.6);
    ctx.fillStyle = '#f4d03f'; ctx.font = 'bold 0.9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('URBANO', -0.5, 0.05);
  } else {
    const cabF = T.bed ? 1.0 : T.sport ? 0.4 : 0.9, cabB = T.bed ? -0.6 : T.sport ? -1.3 : -1.4;
    ctx.fillStyle = glass;
    ctx.beginPath(); ctx.moveTo(cabF, -W / 2 + 0.25); ctx.lineTo(cabF + 0.55, -W / 2 + 0.35); ctx.lineTo(cabF + 0.55, W / 2 - 0.35); ctx.lineTo(cabF, W / 2 - 0.25); ctx.fill();
    ctx.fillRect(cabB - 0.35, -W / 2 + 0.3, 0.35, W - 0.6);
    ctx.fillStyle = shade(c.color.length === 7 ? c.color : '#888888', -0.15);
    ctx.fillRect(cabB, -W / 2 + 0.2, cabF - cabB, W - 0.4);
    if (T.bed) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-L / 2 + 0.25, -W / 2 + 0.25, L / 2 - 0.9, W - 0.5); }
    if (T.taxi) { ctx.fillStyle = '#1b5e20'; ctx.fillRect(-L / 2 + 0.1, -W / 2, L - 0.2, 0.22); ctx.fillRect(-L / 2 + 0.1, W / 2 - 0.22, L - 0.2, 0.22); ctx.fillStyle = '#fff'; ctx.fillRect(-0.4, -0.25, 0.6, 0.5); }
    if (T.sport) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-L / 2 + 0.05, -0.25, L - 0.1, 0.18); ctx.fillRect(-L / 2 + 0.05, 0.07, L - 0.1, 0.18); }
    if (T.police) {
      ctx.fillStyle = '#1f3a93'; ctx.fillRect(-L / 2 + 0.6, -W / 2, L - 1.6, 0.25); ctx.fillRect(-L / 2 + 0.6, W / 2 - 0.25, L - 1.6, 0.25);
      ctx.fillRect(L / 2 - 1.1, -W / 2 + 0.2, 0.6, W - 0.4);
      const on = c.siren && (wanted.stars > 0 || c.driver === 'cop') && (gameTime * 6 % 2) < 1;
      ctx.fillStyle = on ? '#ff1744' : '#7f0000'; ctx.fillRect(-0.4, -W / 2 + 0.3, 0.4, W / 2 - 0.3);
      ctx.fillStyle = !on ? '#2979ff' : '#0d2a66'; ctx.fillRect(-0.4, 0, 0.4, W / 2 - 0.3);
      if (on && wanted.stars > 0) { ctx.fillStyle = 'rgba(255,23,68,.18)'; ctx.beginPath(); ctx.arc(0, -0.6, 3.5, 0, TAU); ctx.fill(); }
      else if (wanted.stars > 0) { ctx.fillStyle = 'rgba(41,121,255,.18)'; ctx.beginPath(); ctx.arc(0, 0.6, 3.5, 0, TAU); ctx.fill(); }
    }
  }
  // faros / calaveras
  ctx.fillStyle = '#fff9c4'; ctx.fillRect(L / 2 - 0.15, -W / 2 + 0.15, 0.15, 0.4); ctx.fillRect(L / 2 - 0.15, W / 2 - 0.55, 0.15, 0.4);
  const braking = c.throttle < 0 || c.hb;
  ctx.fillStyle = braking ? '#ff1744' : '#8b0000'; ctx.fillRect(-L / 2, -W / 2 + 0.15, 0.15, 0.4); ctx.fillRect(-L / 2, W / 2 - 0.55, 0.15, 0.4);
  if (braking && c.driver) { ctx.fillStyle = 'rgba(255,0,0,.2)'; ctx.fillRect(-L / 2 - 0.8, -W / 2, 0.8, W); }
  // daño
  if (c.hp < T.hp * 0.5) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(L / 2 - 1, -W / 4, 0.8, W / 2); }
  ctx.restore();
}

function drawPed(p, isPlayer) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1.7, 1.7);
  if (p.dead) {
    ctx.rotate(p.ang || 0);
    ctx.fillStyle = p.shirt; ctx.fillRect(-0.5, -0.3, 1, 0.6);
    ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(0.65, 0, 0.22, 0, TAU); ctx.fill();
    ctx.restore(); return;
  }
  ctx.rotate(isPlayer ? player.ang : p.ang);
  const sw = Math.sin(p.walk || 0) * 0.28 * (Math.hypot(p.vx || 0, p.vy || 0) > 0.2 || isPlayer && player.moving ? 1 : 0);
  ctx.fillStyle = '#222'; // piernas
  ctx.fillRect(sw - 0.12, -0.22, 0.3, 0.14); ctx.fillRect(-sw - 0.12, 0.08, 0.3, 0.14);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0.1, 0.1, 0.3, 0.45, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = isPlayer ? '#ffd23f' : p.shirt;
  ctx.beginPath(); ctx.ellipse(0, 0, 0.27, 0.43, 0, 0, TAU); ctx.fill();
  if (isPlayer || p.cop) { ctx.fillStyle = '#333'; ctx.fillRect(0.2, 0.12, 0.45, 0.1); } // pistola
  ctx.fillStyle = p.cop ? '#0d1b4d' : isPlayer ? '#3b2412' : (p.hair || '#2b1a0e');
  ctx.beginPath(); ctx.arc(0, 0, 0.2, 0, TAU); ctx.fill();
  if (p.cop) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(-0.05, -0.05, 0.1, 0.1); }
  ctx.restore();
}

// minimapa
const MINI_SCALE = 0.17;
const miniBase = document.createElement('canvas');
(() => {
  const W = Math.ceil((BOUNDS[2] - BOUNDS[0]) * MINI_SCALE), H = Math.ceil((BOUNDS[3] - BOUNDS[1]) * MINI_SCALE);
  miniBase.width = W; miniBase.height = H;
  const m = miniBase.getContext('2d');
  m.fillStyle = '#2b2b2b'; m.fillRect(0, 0, W, H);
  m.setTransform(MINI_SCALE, 0, 0, MINI_SCALE, -BOUNDS[0] * MINI_SCALE, -BOUNDS[1] * MINI_SCALE);
  for (const a of AREAS) { m.fillStyle = a.kind <= 1 ? '#3f6b2a' : '#3a3a3a'; m.fill(a.path); }
  m.lineCap = 'round';
  for (const wt of WATER) { m.strokeStyle = '#2f5f80'; m.lineWidth = Math.max(wt.w, 10); m.stroke(wt.path); }
  for (let t = 8; t >= 0; t--) {
    const p = new Path2D();
    for (let s = 0; s < NSEG; s++) if (ROADS[segR[s]].t === t) { p.moveTo(NX[segA[s]], NY[segA[s]]); p.lineTo(NX[segB[s]], NY[segB[s]]); }
    m.strokeStyle = t <= 3 ? '#e0c068' : t === 4 ? '#bbbbbb' : '#8a8a8a'; m.lineWidth = t <= 3 ? 16 : t === 4 ? 12 : t === 8 ? 5 : 8;
    m.stroke(p);
  }
})();
const mini = document.getElementById('minimap'), mctx = mini.getContext('2d');
function drawMinimap() {
  const S = mini.width, px = view.cx, py = view.cy;
  const z = 0.75; // px por metro en el minimapa
  mctx.save();
  mctx.clearRect(0, 0, S, S);
  mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2, 0, TAU); mctx.clip();
  mctx.fillStyle = '#2b2b2b'; mctx.fillRect(0, 0, S, S);
  const k = z / MINI_SCALE;
  mctx.drawImage(miniBase, S / 2 - (px - BOUNDS[0]) * z, S / 2 - (py - BOUNDS[1]) * z, miniBase.width * k, miniBase.height * k);
  const toM = (x, y) => [S / 2 + (x - px) * z, S / 2 + (y - py) * z];
  for (const c of cars) if (c.T.police && c.driver === 'cop' && wanted.stars) { const [x, y] = toM(c.x, c.y); mctx.fillStyle = (gameTime * 4 % 2) < 1 ? '#ff1744' : '#2979ff'; mctx.fillRect(x - 2.5, y - 2.5, 5, 5); }
  for (const kk of ['garage', 'paint', 'hospital', 'police']) {
    const s = SPOTS[kk]; let [x, y] = toM(s.x, s.y);
    const dx = x - S / 2, dy = y - S / 2, d = Math.hypot(dx, dy), R = S / 2 - 9;
    if (d > R) { x = S / 2 + dx / d * R; y = S / 2 + dy / d * R; }
    mctx.fillStyle = s.color; mctx.beginPath(); mctx.arc(x, y, 6, 0, TAU); mctx.fill();
    mctx.fillStyle = '#000'; mctx.font = 'bold 8px sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
    mctx.fillText({ garage: 'T', paint: 'P', hospital: '+', police: '★' }[kk], x, y + 0.5);
  }
  // jugador
  const a = player.car ? player.car.ang : player.ang;
  mctx.translate(S / 2, S / 2); mctx.rotate(a);
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5;
  mctx.beginPath(); mctx.moveTo(8, 0); mctx.lineTo(-5, -5); mctx.lineTo(-2, 0); mctx.lineTo(-5, 5); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
}

// mapa grande
const bigmap = document.getElementById('bigmap'), bmc = document.getElementById('bigmapCanvas');
function toggleMap() {
  if (state !== 'play' && bigmap.classList.contains('hidden')) return;
  bigmap.classList.toggle('hidden');
  if (!bigmap.classList.contains('hidden')) drawBigMap();
}
bigmap.addEventListener('click', toggleMap);
bigmap.addEventListener('touchstart', e => { e.preventDefault(); toggleMap(); }, { passive: false });
function drawBigMap() {
  // recorta al área urbana
  const cx0 = Math.max(BOUNDS[0], -4200), cy0 = Math.max(BOUNDS[1], -4000), cx1 = Math.min(BOUNDS[2], 4200), cy1 = Math.min(BOUNDS[3], 4000);
  const W = Math.round((cx1 - cx0) * MINI_SCALE), H = Math.round((cy1 - cy0) * MINI_SCALE);
  bmc.width = W; bmc.height = H;
  const b = bmc.getContext('2d');
  b.drawImage(miniBase, (cx0 - BOUNDS[0]) * MINI_SCALE, (cy0 - BOUNDS[1]) * MINI_SCALE, W, H, 0, 0, W, H);
  const toB = (x, y) => [(x - cx0) * MINI_SCALE, (y - cy0) * MINI_SCALE];
  const F = W / 38;
  b.textBaseline = 'middle'; b.lineJoin = 'round';
  b.font = `bold ${F * 0.6}px sans-serif`; b.textAlign = 'center';
  for (const a of AREAS) if (a.name && a.kind <= 1 && a.size > 40000) {
    const [x, y] = toB(a.cx, a.cy); b.strokeStyle = 'rgba(0,0,0,.8)'; b.lineWidth = F * 0.2; b.strokeText(a.name, x, y); b.fillStyle = '#cfe8c0'; b.fillText(a.name, x, y);
  }
  b.font = `bold ${F}px sans-serif`; b.textAlign = 'left';
  for (const kk of ['garage', 'paint', 'hospital', 'police']) {
    const s = SPOTS[kk], [x, y] = toB(s.x, s.y);
    b.fillStyle = s.color; b.beginPath(); b.arc(x, y, F * 0.55, 0, TAU); b.fill(); b.strokeStyle = '#000'; b.lineWidth = F * 0.15; b.stroke();
    b.lineWidth = F * 0.25; b.strokeText(s.name, x + F * 0.8, y); b.fillStyle = '#fff'; b.fillText(s.name, x + F * 0.8, y);
  }
  const [x, y] = toB(view.cx, view.cy);
  b.fillStyle = '#ffd23f'; b.strokeStyle = '#000'; b.lineWidth = F * 0.15; b.beginPath(); b.arc(x, y, F * 0.6, 0, TAU); b.fill(); b.stroke();
  b.textAlign = 'left'; b.font = `bold ${F * 0.7}px sans-serif`; b.lineWidth = F * 0.25; b.strokeText('TÚ', x + F * 0.8, y); b.fillStyle = '#ffd23f'; b.fillText('TÚ', x + F * 0.8, y);
  b.fillStyle = '#fff'; b.textAlign = 'center'; b.font = `900 italic ${F * 1.4}px sans-serif`; b.strokeText('LOS MOCHIS', W / 2, F * 1.2); b.fillText('LOS MOCHIS', W / 2, F * 1.2);
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
      if (input.stick) {
        // joystick: la dirección del joystick es hacia donde quieres ir
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
      player.moving = mag > 0.1;
      if (player.moving) {
        const a = Math.atan2(ctl.y, ctl.x);
        player.x += Math.cos(a) * spd * mag * dt; player.y += Math.sin(a) * spd * mag * dt;
        player.ang = a; player.walk += spd * dt * 3;
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
      if (mouse.used && !isTouch) {
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
  // cámara
  const tx = player.car ? player.car.x + player.car.vx * 0.6 : player.x, ty = player.car ? player.car.y + player.car.vy * 0.6 : player.y;
  view.cx = lerp(view.cx, tx, 1 - Math.exp(-dt * 5)); view.cy = lerp(view.cy, ty, 1 - Math.exp(-dt * 5));
  const base = Math.min(view.w, view.h) / 110;
  const targetZ = player.car ? base * lerp(1.15, 0.55, clamp(carSpeed(player.car) / 40, 0, 1)) : base * 1.7;
  view.zoom = lerp(view.zoom, targetZ, 1 - Math.exp(-dt * 1.5));
}

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state !== 'title') {
    acc += dt;
    while (acc >= 1 / 60) { update(1 / 60); acc -= 1 / 60; }
    updateHUD(dt);
    drawMinimap();
  } else {
    // vista de fondo en el título: paseo de cámara
    gameTime += dt;
    view.cx = SPOTS.start.x + Math.cos(gameTime * 0.05) * 300; view.cy = SPOTS.start.y + Math.sin(gameTime * 0.05) * 300;
    view.zoom = Math.min(view.w, view.h) / 220;
  }
  render();
  requestAnimationFrame(frame);
}

function startGame() {
  if (state !== 'title') return;
  sfx.init();
  document.getElementById('title').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  if (isTouch) { document.getElementById('touch').classList.remove('hidden'); document.body.classList.add('touch'); }
  state = 'play'; stateT = 0;
  view.cx = player.x; view.cy = player.y; view.zoom = Math.min(view.w, view.h) / 110 * 1.7;
  // primeros carros cerca para robar
  for (let i = 0; i < 6; i++) spawnParked(player.x, player.y, 8, 60);
  for (let i = 0; i < 20; i++) spawnTraffic(player.x, player.y, 40, 250, false);
  for (let i = 0; i < 25; i++) spawnPed(player.x, player.y, 10, 150);
  toast('¡Bienvenido a Los Mochis! Acércate a un carro y pulsa E (🚗) para robarlo');
}
document.getElementById('play').addEventListener('click', startGame);
window.__game = { player, cars, peds, SPOTS, mission: () => mission, nearestRoad, ROADS, segR, NX, NY, get state() { return state; }, wanted, view, enterOrExit, crime, getCars: () => cars };
requestAnimationFrame(frame);
})();
