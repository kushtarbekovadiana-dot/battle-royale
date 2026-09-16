const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const WORLD = { w: 2000, h: 2000 };
const TICK = 1000 / 30;
const obstacles = [];

for (let i = 0; i < 25; i++) {
  obstacles.push({ type: 'tree', x: 100 + Math.random() * (WORLD.w - 200),
    y: 100 + Math.random() * (WORLD.h - 200), r: 22 });
}
for (let i = 0; i < 12; i++) {
  const w = 100 + Math.random() * 80;
  const h = 100 + Math.random() * 80;
  obstacles.push({ type: 'house', x: 150 + Math.random() * (WORLD.w - 300),
    y: 150 + Math.random() * (WORLD.h - 300), w, h });
}

function collides(x, y, r) {
  for (const o of obstacles) {
    if (o.type === 'tree') {
      const dx = x - o.x, dy = y - o.y;
      if (dx * dx + dy * dy < (r + o.r) ** 2) return true;
    } else {
      if (x + r > o.x - o.w/2 && x - r < o.x + o.w/2 &&
          y + r > o.y - o.h/2 && y - r < o.y + o.h/2) return true;
    }
  }
  return false;
}

const players = new Map();
const bullets = [];

function randSpawn() {
  for (let i = 0; i < 50; i++) {
    const x = 100 + Math.random() * (WORLD.w - 200);
    const y = 100 + Math.random() * (WORLD.h - 200);
    if (!collides(x, y, 18)) return { x, y };
  }
  return { x: WORLD.w / 2, y: WORLD.h / 2 };
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2, 10);
  const spawn = randSpawn();
  const player = {
    id, name: 'Player-' + id.slice(0, 4),
    x: spawn.x, y: spawn.y, hp: 100,
    ammo: 5, angle: 0, alive: true, kills: 0,
    input: { up: false, down: false, left: false, right: false },
  };
  players.set(id, player);

  ws.send(JSON.stringify({ type: 'init', id, world: WORLD, obstacles }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const p = players.get(id);
    if (!p || !p.alive) return;
    if (msg.type === 'input') {
      p.input = msg.input;
      p.angle = msg.angle ?? p.angle;
    }
    if (msg.type === 'shoot') {
      if (p.ammo <= 0) return;
      p.ammo--;
      bullets.push({
        x: p.x, y: p.y,
        vx: Math.cos(msg.angle) * 14,
        vy: Math.sin(msg.angle) * 14,
        owner: id, life: 80, r: 4,
      });
    }
    if (msg.type === 'addAmmo') p.ammo += 3;
    if (msg.type === 'setName') p.name = String(msg.name).slice(0, 12) || p.name;
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
  });
});

function move(p) {
  if (!p.alive) return;
  const s = 3.2;
  let dx = 0, dy = 0;
  if (p.input.up) dy -= 1;
  if (p.input.down) dy += 1;
  if (p.input.left) dx -= 1;
  if (p.input.right) dx += 1;
  const len = Math.hypot(dx, dy) || 1;
  dx = dx / len * s; dy = dy / len * s;
  const nx = p.x + dx, ny = p.y + dy;
  if (!collides(nx, p.y, 18)) p.x = nx;
  if (!collides(p.x, ny, 18)) p.y = ny;
  p.x = Math.max(20, Math.min(WORLD.w - 20, p.x));
  p.y = Math.max(20, Math.min(WORLD.h - 20, p.y));
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx; b.y += b.vy; b.life--;
    if (collides(b.x, b.y, b.r) || b.life <= 0 ||
        b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h) {
      bullets.splice(i, 1); continue;
    }
    for (const p of players.values()) {
      if (!p.alive || p.id === b.owner) continue;
      const dx = p.x - b.x, dy = p.y - b.y;
      if (dx*dx + dy*dy < 400) {
        p.hp -= 25;
        bullets.splice(i, 1);
        broadcast({ type: 'hit', target: p.id, hp: p.hp });
        if (p.hp <= 0) {
          p.alive = false;
          const sh = players.get(b.owner);
          if (sh) sh.kills++;
          broadcast({ type: 'death', id: p.id, by: b.owner });
        }
        break;
      }
    }
  }
}

function checkWin() {
  const alive = [...players.values()].filter(p => p.alive);
  if (alive.length === 1 && players.size > 1)
    broadcast({ type: 'winner', id: alive[0].id, name: alive[0].name });
}

setInterval(() => {
  for (const p of players.values()) move(p);
  updateBullets();
  checkWin();
  broadcast({
    type: 'state',
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y,
      hp: p.hp, ammo: p.ammo, angle: p.angle,
      alive: p.alive, kills: p.kills,
    })),
    bullets: bullets.map(b => ({ x: b.x, y: b.y })),
  });
}, TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server on ' + PORT));
