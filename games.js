/* Nimion HQ arcade: small original games on a 480×360 canvas, played in a popup while the crew works.
   window.Games[id] = { title, help, modes, start(canvas, done, opts) -> stop }
   - modes: subset of ['1p', '2p', 'coop']; the first entry is the default. opts.mode picks one.
   - done(score, note) is called exactly once when a game ends. score: a non-negative integer for the high-score table
     (higher is better; 2P versus: the winner's score; co-op: the team score). note: optional short line, e.g. 'P2 wins!'.
   - stop() removes every listener and stops the loop (popup closed, another game picked). Safe to call twice.
   - Keys (claimed only while a game runs): 1P takes arrows and WASD (+ Space / Enter). Two players on one keyboard:
     P1 = W A S D + Space/F, P2 = arrow keys + Enter/right Shift.
   - A game starts as soon as start() is called. All motion is time-based (per second × dt). */
(function () {
'use strict';
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
const BG = '#1c2340', INK = '#2a3460', YEL = '#ffd84d';
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TONES = ['#ffd84d', '#f08c00', '#5fd38a', '#4fb3ff', '#ff7aa8', '#b48cff', '#e0447a', '#0f9db0'];

// A little nimion face (big eyes, rosy cheeks, a leaf sprout), drawn at (x, y) with radius r.
function face(x, cx, cy, r, tone, eyes, mood) {
  const pack = globalThis.HQ_CLASSIC; // an optional look pack, loaded before this file when the server offers one
  if (pack && pack.face) return pack.face(x, cx, cy, r, tone, eyes, mood);
  x.save();
  x.strokeStyle = '#3f9d4f'; x.lineWidth = Math.max(1.5, r * .09); x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx, cy - r * .94); x.lineTo(cx, cy - r * 1.2); x.stroke();
  x.fillStyle = '#5cc46a';
  for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * r * .2, cy - r * 1.25, r * .22, r * .1, s * -.45, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = tone; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  const dot = (ex, ey, er, col) => { x.fillStyle = col; x.beginPath(); x.arc(ex, ey, er, 0, Math.PI * 2); x.fill(); };
  const eye = (ex, er) => {
    const ey = cy - r * .2;
    dot(ex, ey, er * 1.1, '#3b2a20'); dot(ex, ey, er, '#fff'); dot(ex, ey + er * .06, er * .6, '#6b4322'); dot(ex, ey + er * .06, er * .32, '#111');
    dot(ex + er * .26, ey - er * .24, er * .18, '#fff');
  };
  if (eyes === 1) eye(cx, r * .38); else { eye(cx - r * .33, r * .27); eye(cx + r * .33, r * .27); }
  x.fillStyle = 'rgba(255, 143, 163, .6)';
  for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * r * .64, cy + r * .2, r * .16, r * .1, 0, 0, Math.PI * 2); x.fill(); }
  x.strokeStyle = '#5a2a1a'; x.fillStyle = '#5a2a1a'; x.lineWidth = Math.max(2, r * .08); x.lineCap = 'round';
  x.beginPath();
  if (mood === 0) { x.arc(cx, cy + r * .3, r * .28, .15 * Math.PI, .85 * Math.PI); x.stroke(); }
  else if (mood === 1) { x.arc(cx, cy + r * .32, r * .2, 0, Math.PI); x.fill(); }
  else { x.arc(cx, cy + r * .55, r * .22, 1.2 * Math.PI, 1.8 * Math.PI); x.stroke(); }
  x.restore();
}
function banana(x, cx, cy, s, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
  x.fillStyle = '#ffe14d'; x.strokeStyle = '#b8900a'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(-14, -3); x.quadraticCurveTo(0, 14, 14, -3); x.quadraticCurveTo(0, 6, -14, -3); x.fill(); x.stroke();
  x.restore();
}
function pill(x, cx, cy, w, h, col) { x.fillStyle = col; x.beginPath(); x.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(w, h) / 2); x.fill(); }
function loop(step) { // step(dt) returns false to stop; dt is never negative (a frame can be stamped just before the start)
  let raf = 0, last = performance.now(), on = true;
  const f = now => { if (!on) return; const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now; if (step(dt) === false) on = false; else raf = requestAnimationFrame(f); };
  raf = requestAnimationFrame(f);
  return () => { on = false; cancelAnimationFrame(raf); };
}
function text(x, t, cx, cy, size, col = '#fff', align = 'center') { x.fillStyle = col; x.font = `800 ${size}px ${FONT}`; x.textAlign = align; x.textBaseline = 'middle'; x.fillText(t, cx, cy); }

// Key codes per pad. Actions: l r u d = directions, a = action (fire / drop / launch).
const PADS = {
  p1: { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], a: ['Space', 'KeyF'] },
  p2: { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], a: ['Enter', 'NumpadEnter', 'ShiftRight'] },
};
PADS.solo = Object.fromEntries(Object.keys(PADS.p1).map(k => [k, PADS.p1[k].concat(PADS.p2[k])]));

// The frame every game runs in: context, keyboard for 1 or 2 players, canvas listeners, the loop and a single ending.
// g.press(i, act) (set by the game) fires on a fresh key press; g.is(i, act) says whether it is held.
function shell(canvas, done, players) {
  const x = canvas.getContext('2d'), pads = players === 1 ? [PADS.solo] : [PADS.p1, PADS.p2], held = {}, subs = [];
  let stopLoop = () => {}, fin = null, dead = false;
  const find = code => { for (let i = 0; i < pads.length; i++) for (const a in pads[i]) if (pads[i][a].includes(code)) return [i, a]; };
  const key = e => {
    const m = find(e.code); if (!m) return;
    e.preventDefault();
    const down = e.type === 'keydown';
    if (down && !held[e.code] && g.press) g.press(m[0], m[1]);
    held[e.code] = down;
  };
  const listen = (t, type, f) => { t.addEventListener(type, f); subs.push([t, type, f]); };
  listen(window, 'keydown', key); listen(window, 'keyup', key);
  const g = {
    x, W: canvas.width, H: canvas.height, press: null,
    is: (i, a) => pads[i][a].some(c => held[c]),
    axis: (i, neg, pos) => (g.is(i, pos) ? 1 : 0) - (g.is(i, neg) ? 1 : 0),
    on: (type, f) => listen(canvas, type, f),
    at(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * canvas.width, (e.clientY - r.top) / r.height * canvas.height]; },
    clear() { x.fillStyle = BG; x.fillRect(0, 0, g.W, g.H); },
    end(score, note) { if (!fin) fin = [Math.max(0, Math.round(score) || 0), note]; },
    run(step) {
      stopLoop = loop(dt => {
        step(dt);
        if (!fin) return;
        const [score, note] = fin;
        x.fillStyle = 'rgba(10,14,30,.7)'; x.fillRect(0, g.H / 2 - 32, g.W, 64);
        text(x, `${note || 'Game over'} · ${score}`, g.W / 2, g.H / 2, 30, YEL);
        g.stop(); done(score, note);
        return false;
      });
    },
    stop() { if (dead) return; dead = true; stopLoop(); subs.forEach(([t, type, f]) => t.removeEventListener(type, f)); },
  };
  return g;
}
const def = (title, help, modes, play) => ({ title, help, modes, start: (canvas, done, opts) => play(canvas, done, modes.includes(opts && opts.mode) ? opts.mode : modes[0]) });
const winner = (a, b) => a === b ? -1 : a > b ? 0 : 1;

// 1. Fruit catch: move the bucket, catch fruit, dodge the rotten ones. Three misses and it's over.
const fruitCatch = def('Fruit catch',
  'Move with the mouse, ← → or A D. Bananas 3, other fruit 1. Dodge the brown ones. Three misses and the game ends. Co-op: P1 A D (or the mouse), P2 ← →, shared score and lives.',
  ['1p', 'coop'], (canvas, done, mode) => {
  const n = mode === 'coop' ? 2 : 1, g = shell(canvas, done, n), { x, W, H } = g;
  const bx = n === 2 ? [W / 3, W * 2 / 3] : [W / 2];
  let score = 0, lives = 3, t = 0, spawn = 0, items = [];
  g.on('pointermove', e => { bx[0] = g.at(e)[0]; });
  g.run(dt => {
    t += dt; spawn -= dt;
    bx.forEach((b, i) => { bx[i] = clamp(b + g.axis(i, 'l', 'r') * 630 * dt, 40, W - 40); });
    if (spawn <= 0) {
      spawn = Math.max(.22, .7 - t / 45) / (n === 2 ? 1.4 : 1);
      const k = Math.random();
      items.push({ x: rand(20, W - 20), y: -20, v: rand(190, 270) + t * 7, kind: k < .2 ? 'banana' : k < .32 ? 'rotten' : 'fruit', c: TONES[Math.floor(rand(1, 8))] });
    }
    g.clear(); x.fillStyle = INK; x.fillRect(0, H - 24, W, 24);
    for (const it of items) {
      const was = it.y; it.y += it.v * dt;
      if (was < H - 30 && it.y >= H - 52 && bx.some(b => Math.abs(it.x - b) < 42)) { it.gone = true; if (it.kind === 'rotten') lives--; else score += it.kind === 'banana' ? 3 : 1; }
      if (!it.gone && it.y > H) { it.gone = true; if (it.kind !== 'rotten') lives--; }
      if (it.gone) continue;
      if (it.kind === 'banana') banana(x, it.x, it.y, 1, t * 3);
      else { x.fillStyle = it.kind === 'rotten' ? '#6b4a2a' : it.c; x.beginPath(); x.arc(it.x, it.y, 11, 0, Math.PI * 2); x.fill(); x.fillStyle = '#3d9a5a'; x.fillRect(it.x - 1, it.y - 16, 3, 6); }
    }
    items = items.filter(it => !it.gone);
    bx.forEach((b, i) => {
      x.fillStyle = i ? '#3d9a5a' : '#2f5ea8'; x.beginPath(); x.moveTo(b - 40, H - 54); x.lineTo(b + 40, H - 54); x.lineTo(b + 30, H - 26); x.lineTo(b - 30, H - 26); x.fill();
      face(x, b, H - 76, 20, YEL, 2, 1);
      if (n === 2) text(x, `P${i + 1}`, b, H - 40, 13);
    });
    text(x, `🍌 ${score}`, 14, 20, 20, YEL, 'left'); text(x, '❤️'.repeat(Math.max(0, lives)), W - 14, 20, 18, '#fff', 'right');
    if (lives <= 0) g.end(score);
  });
  return g.stop;
});

// 2. Crate stack: a crate slides across; drop it on the stack. Whatever hangs over the edge falls off.
const crateStack = def('Crate stack',
  'Click, tap or press Space to drop the crate. Only the part over the stack stays. Miss completely and the game ends.',
  ['1p'], (canvas, done) => {
  const g = shell(canvas, done, 1), { x, W, H } = g, CH = 26;
  let stack = [{ x: W / 2 - 80, w: 160 }], cur = { x: 0, w: 160, dir: 1 }, speed = 160, over = false, endIn = 0, falling = [], cam = 0;
  const drop = () => {
    if (over) return;
    const top = stack[stack.length - 1], a = Math.max(cur.x, top.x), b = Math.min(cur.x + cur.w, top.x + top.w);
    if (b <= a) { falling.push({ x: cur.x, w: cur.w, y: 0, v: 0 }); over = true; endIn = .7; return; }
    if (cur.x < a) falling.push({ x: cur.x, w: a - cur.x, y: 0, v: 0 });
    if (cur.x + cur.w > b) falling.push({ x: b, w: cur.x + cur.w - b, y: 0, v: 0 });
    stack.push({ x: a, w: b - a });
    cur = { x: cur.dir > 0 ? W - (b - a) : 0, w: b - a, dir: -cur.dir };
    speed = Math.min(420, speed + 14);
  };
  g.press = (i, a) => { if (a === 'a') drop(); };
  g.on('pointerdown', drop);
  g.run(dt => {
    if (over && (endIn -= dt) <= 0) g.end(stack.length - 1);
    if (!over) { cur.x += cur.dir * speed * dt; const hi = W - cur.w; if (cur.x < 0 || cur.x > hi) { cur.dir *= -1; cur.x = clamp(cur.x < 0 ? -cur.x : 2 * hi - cur.x, 0, hi); } } // bounce off the wall
    const want = Math.max(0, (stack.length - 8) * CH); cam += (want - cam) * (1 - Math.exp(-dt * 6));
    g.clear();
    const yOf = i => H - 20 - (i + 1) * CH + cam;
    const crate = (cx, cy, w, i) => { x.fillStyle = TONES[i % TONES.length]; x.fillRect(cx, cy, w, CH - 2); x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 2; x.strokeRect(cx + 2, cy + 2, w - 4, CH - 6); };
    stack.forEach((c, i) => crate(c.x, yOf(i), c.w, i));
    if (!over) crate(cur.x, yOf(stack.length), cur.w, stack.length);
    falling = falling.filter(f => f.y < 2 * H);
    for (const f of falling) { f.y += f.v * dt + 450 * dt * dt; f.v += 900 * dt; x.globalAlpha = .7; crate(f.x, yOf(stack.length - 1) + f.y, f.w, stack.length); x.globalAlpha = 1; }
    x.fillStyle = INK; x.fillRect(0, H - 20 + cam, W, 20);
    face(x, W - 40, 40, 22, YEL, 1, over ? 2 : 1);
    text(x, `📦 ${stack.length - 1}`, 14, 20, 20, YEL, 'left');
  });
  return g.stop;
});

// 3. Face match: find the pairs of nimion faces. Fewer flips and less time score more. 2P: take turns, most pairs wins.
const faceMatch = def('Face match',
  'Click two cards to flip them, or move with the arrows / WASD and flip with Space. Find all 8 pairs; fewer flips and a faster finish score more. 2P: take turns (P1 WASD + Space, P2 arrows + Enter, or click); a match keeps your turn; most pairs wins.',
  ['1p', '2p'], (canvas, done, mode) => {
  const two = mode === '2p', g = shell(canvas, done, two ? 2 : 1), { x, W, H } = g, C = 4, R = 4, gw = (W - 50) / C, gh = (H - 50) / R;
  const faces = Array.from({ length: 8 }, (_, i) => ({ tone: TONES[i], eyes: i % 2 + 1, mood: i % 3 }));
  const cards = faces.concat(faces).map(f => ({ f, up: false, done: false })).sort(() => Math.random() - .5);
  const pairs = [0, 0];
  let open = [], flips = 0, t = 0, lock = 0, over = false, endIn = 0, turn = 0, cur = 0;
  const flip = i => {
    const c = cards[i];
    if (over || lock > 0 || !c || c.up) return;
    c.up = true; open.push(c);
    if (open.length < 2) return;
    flips++;
    if (open[0].f !== open[1].f) { lock = .8; return; }
    open.forEach(o => { o.done = true; }); open = []; pairs[turn]++;
    if (cards.every(k => k.done)) { over = true; endIn = .4; }
  };
  g.on('pointerdown', e => {
    const [px, py] = g.at(e);
    if (px < 25 || py < 25 || px >= W - 25 || py >= H - 25) return;
    cur = Math.floor((px - 25) / gw) + Math.floor((py - 25) / gh) * C; flip(cur);
  });
  g.press = (i, a) => {
    if (two && i !== turn) return;
    if (a === 'a') return flip(cur);
    const dx = a === 'r' ? 1 : a === 'l' ? -1 : 0, dy = a === 'd' ? 1 : a === 'u' ? -1 : 0;
    cur = clamp(cur % C + dx, 0, C - 1) + clamp(Math.floor(cur / C) + dy, 0, R - 1) * C;
  };
  g.run(dt => {
    if (!over) t += dt;
    if (lock > 0 && (lock -= dt) <= 0) { open.forEach(o => { o.up = false; }); open = []; if (two) turn = 1 - turn; }
    if (over && (endIn -= dt) <= 0) {
      if (!two) g.end(1000 - flips * 25 - t * 4, 'All pairs!');
      else { const w = winner(pairs[0], pairs[1]); g.end(pairs[Math.max(0, w)] * 100, w < 0 ? 'Tie!' : `P${w + 1} wins!`); }
    }
    g.clear();
    cards.forEach((c, i) => {
      const cx = 25 + (i % C) * gw, cy = 25 + Math.floor(i / C) * gh;
      x.fillStyle = c.done ? '#2a3a2e' : c.up ? '#fff8e1' : '#2f5ea8'; x.fillRect(cx + 4, cy + 4, gw - 8, gh - 8);
      if (c.up || c.done) face(x, cx + gw / 2, cy + gh / 2, Math.min(gw, gh) * .32, c.f.tone, c.f.eyes, c.f.mood);
      else text(x, '🍌', cx + gw / 2, cy + gh / 2, 22);
      if (i === cur) { x.strokeStyle = turn ? '#5fd38a' : YEL; x.lineWidth = 3; x.strokeRect(cx + 2, cy + 2, gw - 4, gh - 4); }
    });
    if (two) { text(x, `P1 ${pairs[0]} · P2 ${pairs[1]}`, 25, 13, 15, YEL, 'left'); text(x, `P${turn + 1}'s turn`, W - 25, 13, 15, turn ? '#5fd38a' : YEL, 'right'); }
    else text(x, `flips ${flips} · ${Math.floor(t)}s`, 25, 13, 15, YEL, 'left');
  });
  return g.stop;
});

// 4. Paper plop: throw a paper ball into the bin; the wind pushes it.
const paperPlop = def('Paper plop',
  'Drag back from anywhere and let go to throw, or aim with ↑ ↓ / W S, set power with ← → / A D and throw with Space. Mind the wind. 10 throws; baskets in a row score more. 2P: 5 throws each, P1 WASD + Space, P2 arrows + Enter.',
  ['1p', '2p'], (canvas, done, mode) => {
  const two = mode === '2p', g = shell(canvas, done, two ? 2 : 1), { x, W, H } = g;
  const G = 600, FLOOR = H - 22, SX = 70, SY = H - 90, MOUTH = FLOOR - 64, R = 9;
  const pts = [0, 0], streak = [0, 0], left = two ? [5, 5] : [10, 0];
  let turn = 0, ang = 55, pow = 480, wind = 0, bin = 0, ball = null, wait = 0, drag = null, msg = '';
  const round = () => { wind = Math.round(rand(-1, 1) * 150); bin = rand(250, 430); };
  round();
  const fling = () => {
    if (ball || wait > 0 || left[turn] <= 0) return;
    const a = ang * Math.PI / 180; ball = { x: SX, y: SY, vx: Math.cos(a) * pow, vy: -Math.sin(a) * pow }; left[turn]--;
  };
  const land = hit => {
    ball = null; wait = 1;
    if (hit) { pts[turn] += 10 + 5 * streak[turn]; streak[turn]++; msg = streak[turn] > 1 ? `Plop! ×${streak[turn]}` : 'Plop!'; }
    else { streak[turn] = 0; msg = 'Miss'; }
  };
  g.press = (i, a) => { if (i === turn && a === 'a') fling(); };
  g.on('pointerdown', e => { const [px, py] = g.at(e); drag = { px, py, moved: false }; });
  g.on('pointermove', e => {
    if (!drag || ball || wait > 0) return;
    const [px, py] = g.at(e), dx = drag.px - px, dy = drag.py - py, len = Math.hypot(dx, dy);
    if (len < 10) return;
    drag.moved = true; ang = clamp(Math.atan2(-dy, dx) * 180 / Math.PI, 10, 85); pow = clamp(len * 5, 200, 800);
  });
  g.on('pointerup', () => { if (drag && drag.moved) fling(); drag = null; });
  g.on('pointerleave', () => { drag = null; });
  g.run(dt => {
    if (!ball && wait <= 0) { ang = clamp(ang + g.axis(turn, 'd', 'u') * 50 * dt, 10, 85); pow = clamp(pow + g.axis(turn, 'l', 'r') * 260 * dt, 200, 800); }
    if (wait > 0 && (wait -= dt) <= 0) {
      msg = '';
      if (left[0] + left[1] > 0) { if (two && left[1 - turn] > 0) turn = 1 - turn; round(); }
      else if (!two) g.end(pts[0]);
      else { const w = winner(pts[0], pts[1]); g.end(pts[Math.max(0, w)], w < 0 ? 'Tie!' : `P${w + 1} wins!`); }
    }
    for (let k = 0, m = Math.ceil(dt * 240); ball && k < m; k++) {
      const h = dt / m, was = ball.y;
      ball.x += ball.vx * h + wind * h * h / 2; ball.vx += wind * h;
      ball.y += ball.vy * h + G * h * h / 2; ball.vy += G * h;
      const dx = ball.x - bin;
      if (was < MOUTH && ball.y >= MOUTH) {
        if (Math.abs(dx) < 24 - R / 2) { land(true); break; }
        if (Math.abs(dx) < 32) { ball.y = MOUTH - 1; ball.vy *= -.35; ball.vx = ball.vx * .4 + Math.sign(dx) * 60; } // off the rim
      } else if (ball.y > MOUTH && Math.abs(dx) < 30 + R) { ball.x = bin + Math.sign(dx || 1) * (30 + R); ball.vx = -ball.vx * .4; } // side of the bin
      if (ball.y > FLOOR - R || ball.x < -40 || ball.x > W + 40) { land(false); break; }
    }
    g.clear(); x.fillStyle = INK; x.fillRect(0, FLOOR, W, H - FLOOR);
    x.fillStyle = '#4a5a8c'; x.beginPath(); x.moveTo(bin - 30, MOUTH); x.lineTo(bin + 30, MOUTH); x.lineTo(bin + 22, FLOOR); x.lineTo(bin - 22, FLOOR); x.fill();
    x.fillStyle = '#6d7fb8'; x.fillRect(bin - 32, MOUTH - 3, 64, 6); banana(x, bin, MOUTH + 30, .8, 0);
    face(x, SX - 30, SY + 34, 24, YEL, 2, msg === 'Miss' ? 2 : 1);
    if (!ball && wait <= 0) {
      const a = ang * Math.PI / 180; x.fillStyle = 'rgba(255,216,77,.55)';
      for (let i = 1; i <= 8; i++) { const s = i * .06; x.beginPath(); x.arc(SX + Math.cos(a) * pow * s, SY - Math.sin(a) * pow * s + G * s * s / 2, 3, 0, Math.PI * 2); x.fill(); }
    }
    if (ball || wait <= 0) {
      const bx = ball ? ball.x : SX, by = ball ? ball.y : SY;
      x.fillStyle = '#eef2f7'; x.beginPath(); x.arc(bx, by, R, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#9aa3b8'; x.lineWidth = 1.5; x.beginPath(); x.arc(bx - 2, by - 1, 5, .3, 2.2); x.stroke();
    }
    text(x, `wind ${wind < 0 ? '←' : '→'} ${Math.abs(wind)}`, W / 2, 20, 16, '#cfe9ff');
    if (two) { text(x, `P1 ${pts[0]} · P2 ${pts[1]}`, 14, 20, 17, YEL, 'left'); text(x, `P${turn + 1} · ${left[turn]} left`, W - 14, 20, 15, turn ? '#5fd38a' : YEL, 'right'); }
    else { text(x, `🗑️ ${pts[0]}`, 14, 20, 20, YEL, 'left'); text(x, `${left[0]} throws left`, W - 14, 20, 15, '#fff', 'right'); }
    if (msg) text(x, msg, W / 2, H / 2 - 70, 28, msg === 'Miss' ? '#ff7aa8' : YEL);
  });
  return g.stop;
});

// 5. Banana bumpers: a small pinball table with flippers, a launch lane, goggle bumpers and banana targets.
const bumpers = def('Banana bumpers',
  'Flippers: A or ← (left), D or → (right). Hold Space (or S / ↓) and let go to launch. Bumpers 50; light all three bananas for 500. 3 balls. Mouse: press the left or right half to flip; press and let go to launch. 2P: 3 balls each in turn, P1 A D + Space, P2 ← → + Enter.',
  ['1p', '2p'], (canvas, done, mode) => {
  const two = mode === '2p', g = shell(canvas, done, two ? 2 : 1), { x, W, H } = g;
  const R = 7, GRAV = 520, STEP = 1 / 480, LEN = 46, REST = .5, UP = -.45;
  const WALLS = [[100, 250, 100, 40], [100, 40, 130, 12], [130, 12, 345, 12], [345, 12, 390, 57], [390, 57, 390, 350], [360, 110, 360, 350], [360, 342, 390, 342], [100, 250, 175, 298], [360, 250, 285, 298]];
  const BUMPS = [[170, 95], [255, 85], [215, 150]].map(([cx, cy], i) => ({ cx, cy, tone: TONES[i + 3], glow: 0 }));
  const NANAS = [[122, 165], [338, 165], [230, 32]].map(([cx, cy]) => ({ cx, cy, lit: false }));
  const flips = [{ px: 175, py: 300, s: 1, a: REST, w: 0 }, { px: 285, py: 300, s: -1, a: REST, w: 0 }];
  const pts = [0, 0], balls = two ? [3, 3] : [3, 0];
  let turn = 0, b, charge = 0, ptr = null, acc = 0, flash = 0;
  const serve = () => { b = { x: 375, y: 334, vx: 0, vy: 0 }; charge = 0; };
  serve();
  const inLane = () => b.x > 360 && b.y > 300;
  // Pushes the ball out of a capsule (segment a-b, radius rad) and bounces it; sv(px, py) is the surface velocity.
  const hit = (ax, ay, bx, by, rad, e, sv) => {
    const dx = bx - ax, dy = by - ay, t = clamp(((b.x - ax) * dx + (b.y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(b.x - px, b.y - py);
    if (d >= R + rad || d === 0) return null;
    const nx = (b.x - px) / d, ny = (b.y - py) / d; b.x = px + nx * (R + rad); b.y = py + ny * (R + rad);
    const [ux, uy] = sv ? sv(px, py) : [0, 0], vn = (b.vx - ux) * nx + (b.vy - uy) * ny;
    if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
    return [nx, ny];
  };
  const tick = h => {
    const k = two ? turn : 0, held = [g.is(k, 'l') || ptr === 'l', g.is(k, 'r') || ptr === 'r'];
    flips.forEach((f, i) => { const sp = held[i] ? 16 : 9, na = f.a + clamp((held[i] ? UP : REST) - f.a, -sp * h, sp * h); f.w = (na - f.a) / h; f.a = na; });
    b.vy += GRAV * h; b.x += b.vx * h; b.y += b.vy * h;
    for (const w of WALLS) hit(w[0], w[1], w[2], w[3], 0, .5);
    for (const u of BUMPS) { const nv = hit(u.cx, u.cy, u.cx, u.cy, 15, .5); if (nv) { b.vx += nv[0] * 260; b.vy += nv[1] * 260; u.glow = .15; pts[turn] += 50; } }
    for (const q of NANAS) if (hit(q.cx, q.cy, q.cx, q.cy, 10, .6) && !q.lit) {
      q.lit = true; pts[turn] += 100;
      if (NANAS.every(z => z.lit)) { pts[turn] += 500; flash = 1.2; NANAS.forEach(z => { z.lit = false; }); }
    }
    for (const f of flips) hit(f.px, f.py, f.px + f.s * LEN * Math.cos(f.a), f.py + LEN * Math.sin(f.a), 5, .3, (qx, qy) => [-f.w * f.s * (qy - f.py), f.w * f.s * (qx - f.px)]);
    const sp = Math.hypot(b.vx, b.vy); if (sp > 1100) { b.vx *= 1100 / sp; b.vy *= 1100 / sp; }
  };
  g.on('pointerdown', e => { ptr = inLane() ? 'launch' : g.at(e)[0] < W / 2 ? 'l' : 'r'; });
  g.on('pointerup', () => { ptr = null; });
  g.on('pointerleave', () => { ptr = null; });
  g.run(dt => {
    const k = two ? turn : 0, pull = g.is(k, 'a') || g.is(k, 'd') || ptr === 'launch';
    if (inLane()) { if (pull) charge = Math.min(1, charge + dt * 1.2); else if (charge > 0) { b.vy = -(520 + 480 * charge); charge = 0; } }
    else charge = 0;
    acc += dt; while (acc >= STEP) { tick(STEP); acc -= STEP; }
    if (b.y > H + 20) {
      balls[turn]--;
      if (balls[0] + balls[1] > 0) { if (two && balls[1 - turn] > 0) turn = 1 - turn; serve(); }
      else if (!two) g.end(pts[0]);
      else { const w = winner(pts[0], pts[1]); g.end(pts[Math.max(0, w)], w < 0 ? 'Tie!' : `P${w + 1} wins!`); }
    }
    g.clear();
    x.fillStyle = '#222a4c'; x.fillRect(100, 12, 290, H);
    x.strokeStyle = '#6d7fb8'; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath();
    for (const w of WALLS) { x.moveTo(w[0], w[1]); x.lineTo(w[2], w[3]); }
    x.stroke();
    NANAS.forEach(q => { x.globalAlpha = q.lit ? 1 : .35; banana(x, q.cx, q.cy, .8, -.3); }); x.globalAlpha = 1;
    BUMPS.forEach(u => {
      if (u.glow > 0) { u.glow -= dt; x.fillStyle = 'rgba(255,216,77,.45)'; x.beginPath(); x.arc(u.cx, u.cy, 21, 0, Math.PI * 2); x.fill(); }
      face(x, u.cx, u.cy, 15, u.tone, 1, u.glow > 0 ? 1 : 0);
    });
    x.strokeStyle = YEL; x.lineWidth = 10; x.beginPath();
    for (const f of flips) { x.moveTo(f.px, f.py); x.lineTo(f.px + f.s * LEN * Math.cos(f.a), f.py + LEN * Math.sin(f.a)); }
    x.stroke();
    x.fillStyle = YEL; x.fillRect(394, 342 - charge * 120, 6, charge * 120);
    x.fillStyle = '#e6ecf5'; x.beginPath(); x.arc(b.x, b.y, R, 0, Math.PI * 2); x.fill();
    if (flash > 0) { flash -= dt; text(x, 'BANANA BONUS!', 230, 120, 20, YEL); }
    for (let i = 0; i < (two ? 2 : 1); i++) {
      const y = 30 + i * 80, col = i ? '#5fd38a' : YEL;
      text(x, `${two ? `P${i + 1}` : 'Score'}${two && turn === i ? ' ◀' : ''}`, 12, y, 13, '#cfe9ff', 'left');
      text(x, String(pts[i]), 12, y + 22, 20, col, 'left');
      text(x, '●'.repeat(Math.max(0, balls[i])), 12, y + 44, 12, col, 'left');
    }
  });
  return g.stop;
});

// 6. Goggle-bot raid: rows of little goggle-bots march down; throw bananas at them before they land.
const raid = def('Goggle-bot raid',
  'Move with ← → / A D or the mouse; Space or a click throws bananas. Clear each wave before the bots reach you. Co-op: P1 A D + Space, P2 ← → + Enter, shared lives.',
  ['1p', 'coop'], (canvas, done, mode) => {
  const n = mode === 'coop' ? 2 : 1, g = shell(canvas, done, n), { x, W, H } = g, PY = H - 30;
  const ROWC = ['#ff7aa8', '#5fd38a', '#4fb3ff', '#b48cff'];
  const ps = Array.from({ length: n }, (_, i) => ({ x: W * (i + 1) / (n + 1), cd: 0, hurt: 0 }));
  let bots = [], dir = 1, wave = 0, score = 0, lives = 3, shots = [], bolts = [], fire = 1, t = 0;
  const newWave = () => {
    wave++; dir = 1; bots = []; bolts = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) bots.push({ x: 70 + c * 42, y: 50 + r * 30 + Math.min(wave - 1, 4) * 8, row: r });
  };
  newWave();
  const shoot = i => { const p = ps[i]; if (p.cd > 0) return; p.cd = .32; shots.push({ x: p.x, y: PY - 16 }); };
  const bot = (cx, cy, col, leg) => {
    x.fillStyle = col; x.fillRect(cx - 13, cy - 9, 26, 18); x.fillRect(cx - 1, cy - 15, 2, 6);
    x.beginPath(); x.arc(cx, cy - 16, 3, 0, Math.PI * 2); x.fill();
    x.fillRect(cx - 11 + leg * 3, cy + 9, 4, 5); x.fillRect(cx + 7 - leg * 3, cy + 9, 4, 5);
    x.fillStyle = '#2b2a2a'; x.fillRect(cx - 13, cy - 4, 26, 4);
    x.fillStyle = '#c3c9d3'; x.beginPath(); x.arc(cx, cy - 2, 7, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy - 2, 5, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#111'; x.beginPath(); x.arc(cx, cy - 2, 2.2, 0, Math.PI * 2); x.fill();
  };
  g.press = (i, a) => { if (a === 'a') shoot(i); };
  g.on('pointermove', e => { ps[0].x = clamp(g.at(e)[0], 20, W - 20); });
  g.on('pointerdown', () => shoot(0));
  g.run(dt => {
    t += dt;
    ps.forEach((p, i) => { p.x = clamp(p.x + g.axis(i, 'l', 'r') * 280 * dt, 20, W - 20); p.cd -= dt; p.hurt -= dt; if (g.is(i, 'a')) shoot(i); });
    const speed = (26 + wave * 8) * (1 + 2.5 * (1 - bots.length / 32));
    bots.forEach(o => { o.x += dir * speed * dt; });
    if (bots.some(o => (dir > 0 ? o.x > W - 18 : o.x < 18))) { dir = -dir; bots.forEach(o => { o.y += 14; }); }
    if ((fire -= dt) <= 0 && bots.length) {
      fire = rand(.4, 1.1) / (1 + wave * .15);
      const o = bots[Math.floor(Math.random() * bots.length)], low = bots.filter(q => Math.abs(q.x - o.x) < 5).reduce((m, q) => (q.y > m.y ? q : m), o);
      bolts.push({ x: low.x, y: low.y + 12, v: 170 + wave * 15 });
    }
    for (const s of shots) {
      s.y -= 460 * dt;
      const o = bots.find(q => !q.dead && Math.abs(q.x - s.x) < 16 && Math.abs(q.y - s.y) < 13);
      if (o) { o.dead = s.dead = true; score += (4 - o.row) * 10; }
      if (s.y < 10) s.dead = true;
    }
    for (const z of bolts) {
      z.y += z.v * dt;
      for (const p of ps) if (!z.dead && p.hurt <= 0 && Math.abs(z.x - p.x) < 16 && Math.abs(z.y - PY) < 14) { z.dead = true; p.hurt = 1.5; lives--; }
      if (z.y > H) z.dead = true;
    }
    bots = bots.filter(o => !o.dead); shots = shots.filter(s => !s.dead); bolts = bolts.filter(z => !z.dead);
    if (!bots.length) { score += 100 * wave; newWave(); }
    if (bots.some(o => o.y > PY - 34)) lives = 0;
    g.clear(); x.fillStyle = INK; x.fillRect(0, H - 10, W, 10);
    bots.forEach(o => bot(o.x, o.y, ROWC[o.row], Math.floor(t * 4) % 2));
    shots.forEach(s => banana(x, s.x, s.y, .55, t * 12));
    x.fillStyle = '#ff7aa8'; bolts.forEach(z => x.fillRect(z.x - 2, z.y - 7, 4, 14));
    ps.forEach((p, i) => {
      if (p.hurt > 0 && Math.floor(t * 10) % 2) return;
      face(x, p.x, PY, 16, YEL, 2, p.hurt > 0 ? 2 : 1);
      if (n === 2) text(x, `P${i + 1}`, p.x, PY + 22, 11, '#cfe9ff');
    });
    text(x, `🍌 ${score}`, 14, 18, 18, YEL, 'left'); text(x, `wave ${wave}`, W / 2, 18, 15, '#cfe9ff'); text(x, '❤️'.repeat(Math.max(0, lives)), W - 14, 18, 16, '#fff', 'right');
    if (lives <= 0) g.end(score);
  });
  return g.stop;
});

// 7. Banana bricks: bounce the ball off your paddle and clear the bricks. Power-ups: W wide paddle, M more balls.
const brickBash = def('Banana bricks',
  'Move the paddle with the mouse, ← → or A D; Space or a click launches the ball. Catch W for a wide paddle and M for more balls. Co-op: P1 A D + Space, P2 ← → + Enter, shared lives.',
  ['1p', 'coop'], (canvas, done, mode) => {
  const n = mode === 'coop' ? 2 : 1, g = shell(canvas, done, n), { x, W, H } = g, PY = H - 26, R = 6, TOP = 30;
  const LEVELS = [() => true, (r, c) => (r + c) % 3 !== 0, (r, c) => Math.abs(c - 4.5) + r > 3, (r, c) => c % 3 !== 1 || r % 2 === 0];
  const pads = Array.from({ length: n }, (_, i) => ({ x: W * (i + 1) / (n + 1), wide: 0 }));
  let level = -1, score = 0, lives = 3, speed = 0, balls = [], caps = [], bricks = [], hold = 0;
  const pw = p => (p.wide > 0 ? 110 : 70);
  const stick = () => { balls = [{ x: pads[0].x, y: PY - R - 1, vx: 0, vy: 0, stuck: true }]; hold = 2; };
  const nextLevel = () => {
    level++; speed = 300 + 25 * level; bricks = []; caps = [];
    const f = LEVELS[level % LEVELS.length];
    for (let r = 0; r < 5 + Math.min(level, 3); r++) for (let c = 0; c < 10; c++) if (f(r, c)) bricks.push({ x: 20 + c * 44, y: TOP + 14 + r * 20, r, hp: level > 0 && r === 0 ? 2 : 1 });
    stick();
  };
  nextLevel();
  const launch = () => balls.forEach(b => { if (!b.stuck) return; b.stuck = false; const a = rand(-.4, .4); b.vx = speed * Math.sin(a); b.vy = -speed * Math.cos(a); });
  const move = h => {
    for (const b of balls) {
      if (b.stuck) { b.x = pads[0].x; continue; }
      b.x += b.vx * h; b.y += b.vy * h;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); }
      if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); }
      if (b.y < TOP + R) { b.y = TOP + R; b.vy = Math.abs(b.vy); }
      for (const p of pads) {
        const hw = pw(p) / 2;
        if (b.vy > 0 && b.y + R >= PY && b.y < PY + 8 && Math.abs(b.x - p.x) < hw + R) { const a = clamp((b.x - p.x) / hw, -1, 1) * 1.05; b.vx = speed * Math.sin(a); b.vy = -speed * Math.cos(a); }
      }
      const k = bricks.find(q => !q.dead && b.x + R > q.x && b.x - R < q.x + 40 && b.y + R > q.y && b.y - R < q.y + 16);
      if (!k) continue;
      const ox = Math.min(b.x + R - k.x, k.x + 40 - (b.x - R)), oy = Math.min(b.y + R - k.y, k.y + 16 - (b.y - R));
      if (ox < oy) b.vx = b.x < k.x + 20 ? -Math.abs(b.vx) : Math.abs(b.vx); else b.vy = b.y < k.y + 8 ? -Math.abs(b.vy) : Math.abs(b.vy);
      speed = Math.min(520, speed + 2);
      if (--k.hp > 0) continue;
      k.dead = true; score += 10 + 5 * Math.max(0, 7 - k.r);
      if (Math.random() < .14) caps.push({ x: k.x + 20, y: k.y + 8, kind: Math.random() < .5 ? 'W' : 'M' });
    }
    bricks = bricks.filter(q => !q.dead);
  };
  const turn = (b, a) => ({ x: b.x, y: b.y, vx: b.vx * Math.cos(a) - b.vy * Math.sin(a), vy: b.vx * Math.sin(a) + b.vy * Math.cos(a) });
  g.press = (i, a) => { if (a === 'a') launch(); };
  g.on('pointermove', e => { pads[0].x = g.at(e)[0]; });
  g.on('pointerdown', launch);
  g.run(dt => {
    pads.forEach((p, i) => { p.wide -= dt; p.x = clamp(p.x + g.axis(i, 'l', 'r') * 520 * dt, pw(p) / 2, W - pw(p) / 2); });
    if (balls.some(b => b.stuck) && (hold -= dt) <= 0) launch();
    for (let k = 0, m = Math.ceil(dt * 240); k < m; k++) move(dt / m);
    balls = balls.filter(b => b.y < H + R);
    for (const c of caps) {
      c.y += 130 * dt;
      const p = pads.find(q => Math.abs(c.x - q.x) < pw(q) / 2 + 8 && Math.abs(c.y - PY) < 10);
      if (p) { c.dead = true; if (c.kind === 'W') p.wide = 12; else { launch(); balls = balls.concat(balls.slice(0, 4).flatMap(b => [turn(b, -.45), turn(b, .45)])).slice(0, 12); } }
      if (c.y > H) c.dead = true;
    }
    caps = caps.filter(c => !c.dead);
    if (!balls.length && --lives > 0) stick();
    if (!bricks.length) { score += 200; nextLevel(); }
    g.clear(); x.fillStyle = INK; x.fillRect(0, TOP - 2, W, 2);
    bricks.forEach(q => { x.fillStyle = TONES[q.r % TONES.length]; x.fillRect(q.x, q.y, 40, 16); if (q.hp > 1) { x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(q.x + 2, q.y + 2, 36, 12); } });
    caps.forEach(c => { pill(x, c.x, c.y, 26, 14, c.kind === 'W' ? '#4fb3ff' : '#ff7aa8'); text(x, c.kind, c.x, c.y + 1, 11); });
    pads.forEach((p, i) => {
      const w = pw(p); pill(x, p.x, PY + 5, w, 12, YEL);
      x.fillStyle = '#2b2a2a'; x.fillRect(p.x - w / 2 + 4, PY + 3, w - 8, 3);
      [-8, 8].forEach(o => { x.fillStyle = '#c3c9d3'; x.beginPath(); x.arc(p.x + o, PY + 4, 4, 0, Math.PI * 2); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(p.x + o, PY + 4, 1.6, 0, Math.PI * 2); x.fill(); });
      if (n === 2) text(x, `P${i + 1}`, p.x, PY + 18, 9, '#cfe9ff');
    });
    x.fillStyle = '#ffe14d'; balls.forEach(b => { x.beginPath(); x.arc(b.x, b.y, R, 0, Math.PI * 2); x.fill(); });
    text(x, `🍌 ${score}`, 14, 14, 16, YEL, 'left'); text(x, `level ${level + 1}`, W / 2, 14, 14, '#cfe9ff'); text(x, '❤️'.repeat(Math.max(0, lives)), W - 14, 14, 14, '#fff', 'right');
    if (lives <= 0) g.end(score);
  });
  return g.stop;
});

// 8. Banana volley: paddle tennis, first to 7.
const volley = def('Banana volley',
  '1P: you play on the left with W S, ↑ ↓ or the mouse against the CPU. 2P: P1 W S on the left, P2 ↑ ↓ on the right. First to 7.',
  ['1p', '2p'], (canvas, done, mode) => {
  const two = mode === '2p', g = shell(canvas, done, two ? 2 : 1), { x, W, H } = g, PH = 64, PX = [22, W - 22], R = 8, WIN = 7;
  const py = [H / 2, H / 2], pts = [0, 0];
  let b, wait = 0, sp = 300, aim = 0;
  const serve = dir => { b = { x: W / 2, y: H / 2, vx: 0, vy: 0, dir }; wait = .9; sp = 300; };
  serve(Math.random() < .5 ? -1 : 1);
  g.on('pointermove', e => { py[0] = g.at(e)[1]; });
  const move = h => {
    b.x += b.vx * h; b.y += b.vy * h;
    if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); }
    if (b.y > H - R) { b.y = H - R; b.vy = -Math.abs(b.vy); }
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1; // the way the ball leaves paddle i
      if (b.vx * s < 0 && Math.abs(b.x - PX[i]) < 6 + R && Math.abs(b.y - py[i]) < PH / 2 + R) {
        const a = clamp((b.y - py[i]) / (PH / 2), -1, 1) * .9; sp = Math.min(720, sp + 28);
        b.vx = s * sp * Math.cos(a); b.vy = sp * Math.sin(a); b.x = PX[i] + s * (6 + R);
        aim = rand(-.8, .8) * PH / 2; // where the CPU will try to meet the ball
      }
    }
  };
  g.run(dt => {
    py[0] += g.axis(0, 'u', 'd') * 380 * dt;
    if (two) py[1] += g.axis(1, 'u', 'd') * 380 * dt;
    else py[1] += clamp((b.vx > 0 ? b.y + aim : H / 2) - py[1], -270 * dt, 270 * dt);
    py.forEach((v, i) => { py[i] = clamp(v, PH / 2, H - PH / 2); });
    if (wait > 0 && (wait -= dt) <= 0) { const a = rand(-.5, .5); b.vx = b.dir * sp * Math.cos(a); b.vy = sp * Math.sin(a); }
    for (let k = 0, m = Math.ceil(dt * 240); k < m; k++) move(dt / m);
    if (b.x < -R || b.x > W + R) { const w = b.x < 0 ? 1 : 0; pts[w]++; serve(w ? -1 : 1); }
    if (Math.max(pts[0], pts[1]) >= WIN) {
      const w = pts[0] >= WIN ? 0 : 1, sc = 100 * pts[w] + 100 * (WIN - pts[1 - w]);
      if (two) g.end(sc, `P${w + 1} wins!`); else g.end(w ? 100 * pts[0] : sc, w ? 'CPU wins' : 'You win!');
    }
    g.clear(); x.fillStyle = INK; for (let y = 6; y < H; y += 24) x.fillRect(W / 2 - 2, y, 4, 12);
    face(x, W / 2 - 100, 32, 14, YEL, 2, 1); face(x, W / 2 + 100, 32, 14, two ? '#5fd38a' : '#b48cff', two ? 2 : 1, 1);
    text(x, String(pts[0]), W / 2 - 50, 32, 32, YEL); text(x, String(pts[1]), W / 2 + 50, 32, 32, two ? '#5fd38a' : '#b48cff');
    text(x, two ? 'P1' : 'You', W / 2 - 100, 58, 11, '#cfe9ff'); text(x, two ? 'P2' : 'CPU', W / 2 + 100, 58, 11, '#cfe9ff');
    pill(x, PX[0], py[0], 12, PH, YEL); pill(x, PX[1], py[1], 12, PH, two ? '#5fd38a' : '#b48cff');
    x.fillStyle = '#ffe14d'; x.beginPath(); x.arc(b.x, b.y, R, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#6b4a2a'; x.beginPath(); x.arc(b.x + 4, b.y - 4, 2, 0, Math.PI * 2); x.fill();
  });
  return g.stop;
});

// 9. Banana dash: top-down road; dodge traffic, grab fuel. Two players get a split screen each.
const dash = def('Banana dash',
  'Steer with ← → / A D (or the mouse), speed up with ↑ / W, brake with ↓ / S. Dodge the traffic and grab ⛽ before the tank runs dry. Co-op: two cars, one shared tank and score. 2P: race for distance; P1 WASD, P2 arrows.',
  ['1p', 'coop', '2p'], (canvas, done, mode) => {
  const n = mode === '1p' ? 1 : 2, g = shell(canvas, done, n), { x, W, H } = g, VW = W / n, RW = Math.min(210, VW - 30), RL = (VW - RW) / 2, CY = H - 64;
  const shared = { f: 100 }, lane = l => RL + RW * (l + .5) / 3;
  const ps = Array.from({ length: n }, () => ({ cx: VW / 2, spd: 180, dist: 0, cars: [], cans: [], nextCar: 120, nextCan: 900, crash: 0, tank: mode === 'coop' ? shared : { f: 100 } }));
  if (n === 1) g.on('pointermove', e => { ps[0].cx = clamp(g.at(e)[0], RL + 14, RL + RW - 14); });
  const car = (cx, cy, col) => {
    x.fillStyle = '#111'; [-1, 1].forEach(s => { x.fillRect(cx + s * 13 - 2, cy - 15, 4, 9); x.fillRect(cx + s * 13 - 2, cy + 6, 4, 9); });
    x.fillStyle = col; x.beginPath(); x.roundRect(cx - 12, cy - 20, 24, 40, 6); x.fill();
    x.fillStyle = 'rgba(20,24,40,.7)'; x.fillRect(cx - 9, cy - 13, 18, 7); x.fillRect(cx - 9, cy + 9, 18, 5);
  };
  const drive = (p, i, dt) => {
    const gas = p.tank.f > 0;
    p.spd = gas ? clamp(p.spd + g.axis(i, 'd', 'u') * 220 * dt, 80, 460) : Math.max(0, p.spd - 160 * dt);
    if (p.crash > 0) { p.crash -= dt; p.spd = Math.min(p.spd, 70); }
    p.cx = clamp(p.cx + g.axis(i, 'l', 'r') * 250 * dt, RL + 14, RL + RW - 14);
    p.dist += p.spd * dt;
    if (gas) p.tank.f = Math.max(0, p.tank.f - (2 + p.spd / 110 + p.dist / 20000) * dt * (mode === 'coop' ? .6 : 1));
    if (p.dist >= p.nextCar) { p.nextCar += rand(150, 300) / (1 + p.dist / 15000); p.cars.push({ l: Math.floor(rand(0, 3)), y: -40, v: rand(60, 160), c: TONES[Math.floor(rand(1, 8))] }); }
    if (p.dist >= p.nextCan) { p.nextCan += rand(1400, 2200); p.cans.push({ l: Math.floor(rand(0, 3)), y: -20 }); }
    for (const c of p.cars) {
      c.y += (p.spd - c.v) * dt;
      if (!c.hit && p.crash <= 0 && Math.abs(lane(c.l) - p.cx) < 22 && Math.abs(c.y - CY) < 38) { c.hit = true; p.crash = 1.2; p.spd = 40; p.tank.f = Math.max(0, p.tank.f - 10); }
    }
    for (const k of p.cans) { k.y += p.spd * dt; if (Math.abs(lane(k.l) - p.cx) < 24 && Math.abs(k.y - CY) < 30) { k.got = true; p.tank.f = Math.min(100, p.tank.f + 25); } }
    p.cars = p.cars.filter(c => c.y > -80 && c.y < H + 60); p.cans = p.cans.filter(k => !k.got && k.y < H + 30);
  };
  g.run(dt => {
    ps.forEach((p, i) => drive(p, i, dt));
    if (ps.every(p => p.tank.f <= 0 && p.spd <= 0)) {
      const m = ps.map(p => Math.floor(p.dist / 10));
      if (mode !== '2p') g.end(m.reduce((a, v) => a + v, 0));
      else { const w = winner(m[0], m[1]); g.end(Math.max(m[0], m[1]), w < 0 ? 'Tie!' : `P${w + 1} wins!`); }
    }
    ps.forEach((p, i) => {
      x.save(); x.beginPath(); x.rect(i * VW, 0, VW, H); x.clip(); x.translate(i * VW, 0);
      x.fillStyle = BG; x.fillRect(0, 0, VW, H);
      x.fillStyle = '#2f5e3a'; for (let y = p.dist % 60 - 60; y < H; y += 60) { x.fillRect(RL - 24, y, 8, 8); x.fillRect(RL + RW + 16, y + 30, 8, 8); }
      x.fillStyle = '#26305a'; x.fillRect(RL, 0, RW, H);
      x.fillStyle = YEL; x.fillRect(RL - 4, 0, 4, H); x.fillRect(RL + RW, 0, 4, H);
      x.fillStyle = '#8a94b8'; for (let l = 1; l < 3; l++) for (let y = p.dist % 40 - 40; y < H; y += 40) x.fillRect(RL + RW * l / 3 - 2, y, 4, 20);
      p.cans.forEach(k => text(x, '⛽', lane(k.l), k.y, 20));
      p.cars.forEach(c => car(lane(c.l), c.y, c.hit ? '#5a6080' : c.c));
      if (!(p.crash > 0 && Math.floor(p.crash * 10) % 2)) { car(p.cx, CY, YEL); face(x, p.cx, CY, 9, YEL, 2, p.crash > 0 ? 2 : 1); }
      text(x, `${Math.floor(p.dist / 10)} m`, 10, 18, 16, YEL, 'left');
      x.fillStyle = INK; x.fillRect(VW - 90, 12, 80, 10);
      x.fillStyle = p.tank.f < 25 ? '#e0447a' : '#5fd38a'; x.fillRect(VW - 90, 12, 80 * p.tank.f / 100, 10);
      text(x, '⛽', VW - 102, 17, 13);
      if (n === 2) text(x, `P${i + 1}`, VW / 2, H - 14, 13, '#cfe9ff');
      if (p.tank.f <= 0) text(x, 'Out of fuel', VW / 2, H / 2 - 40, 18, '#ff7aa8');
      x.restore();
    });
    if (n === 2) { x.fillStyle = '#000'; x.fillRect(VW - 1, 0, 2, H); }
  });
  return g.stop;
});

// 10. Hill hurlers: artillery duel on rolling hills. Angle, power, wind; shells dig craters.
const hurlers = def('Hill hurlers',
  'Take turns: aim with ← → / A D, power with ↑ ↓ / W S, fire with Space / Enter. Wind changes every shot and shells dig craters. 2P: P1 WASD + Space, P2 arrows + Enter. 1P: you (left) against the CPU.',
  ['2p', '1p'], (canvas, done, mode) => {
  const cpu = mode === '1p', g = shell(canvas, done, cpu ? 1 : 2), { x, W, H } = g, GV = 300, BLAST = 26;
  const ph = [rand(0, 6), rand(0, 6), rand(0, 6)], ground = [];
  for (let i = 0; i <= W; i++) ground.push(H * .64 + Math.sin(i / 70 + ph[0]) * 30 + Math.sin(i / 29 + ph[1]) * 12 + Math.sin(i / 150 + ph[2]) * 34);
  const tk = [{ x: Math.round(rand(40, 110)), ang: 45, pow: 360, hp: 100, tone: YEL }, { x: Math.round(rand(370, 440)), ang: 135, pow: 360, hp: 100, tone: '#b48cff' }];
  tk.forEach(t => { const y = ground[t.x]; for (let i = t.x - 14; i <= t.x + 14; i++) ground[i] = y; });
  const gy = px => ground[clamp(Math.round(px), 0, W)];
  const stars = Array.from({ length: 30 }, () => [rand(0, W), rand(0, H * .45)]);
  let turn = 0, wind = Math.round(rand(-1, 1) * 40), shot = null, boom = null, wait = 0, ai = null, cpuShots = 0;
  // Moves a shell on by h seconds; says what it hit ('out', 'ground', 'tank') or null.
  const fly = (s, h) => {
    s.x += s.vx * h + wind * h * h / 2; s.vx += wind * h;
    s.y += s.vy * h + GV * h * h / 2; s.vy += GV * h;
    if (s.x < -20 || s.x > W + 20 || s.y > H) return 'out';
    if (s.x >= 0 && s.x <= W && s.y >= gy(s.x)) return 'ground';
    return tk.some(t => Math.hypot(s.x - t.x, s.y - (gy(t.x) - 8)) < 12) ? 'tank' : null;
  };
  const shellFrom = (t, ang, pow) => { const a = ang * Math.PI / 180; return { x: t.x + Math.cos(a) * 18, y: gy(t.x) - 14 - Math.sin(a) * 18, vx: Math.cos(a) * pow, vy: -Math.sin(a) * pow }; };
  const fire = () => { if (!shot && wait <= 0) shot = shellFrom(tk[turn], tk[turn].ang, tk[turn].pow); };
  const blast = (cx, cy) => {
    tk.forEach(t => { const d = Math.hypot(t.x - cx, gy(t.x) - 8 - cy); if (d < 40) t.hp = Math.max(0, t.hp - Math.round(48 * (1 - d / 40) + (d < 12 ? 14 : 0))); });
    for (let i = Math.max(0, Math.ceil(cx - BLAST)); i <= Math.min(W, cx + BLAST); i++) { const low = cy + Math.sqrt(BLAST * BLAST - (i - cx) ** 2); if (ground[i] < low) ground[i] = Math.min(H - 4, low); }
    boom = { x: cx, y: cy, t: .5 };
  };
  const plan = () => { // the CPU tries every power for a random angle, keeps the closest, then misses by a shrinking error
    const ang = rand(118, 152); let best = { miss: Infinity, pow: 360 };
    for (let pow = 150; pow <= 650; pow += 5) {
      const s = shellFrom(tk[1], ang, pow); let r = null;
      for (let k = 0; k < 900 && !r; k++) r = fly(s, 1 / 120);
      const miss = r === 'out' ? Infinity : Math.abs(s.x - tk[0].x);
      if (miss < best.miss) best = { miss, pow };
    }
    const err = Math.max(6, 30 - cpuShots * 6);
    ai = { ang: clamp(ang + rand(-1, 1) * err / 8, 95, 175), pow: clamp(best.pow + rand(-1, 1) * err, 150, 650), t: .8 };
  };
  const finish = () => {
    const w = winner(tk[0].hp, tk[1].hp), sc = i => (100 - tk[1 - i].hp) * 5 + (i === w ? tk[i].hp * 10 : 0);
    if (cpu) g.end(sc(0), w === 0 ? 'You win!' : w === 1 ? 'CPU wins' : 'Tie!');
    else g.end(sc(Math.max(0, w)), w < 0 ? 'Tie!' : `P${w + 1} wins!`);
  };
  g.press = (i, a) => { if (a === 'a' && i === (cpu ? 0 : turn) && !(cpu && turn === 1)) fire(); };
  g.run(dt => {
    const t = tk[turn];
    if (!shot && wait <= 0) {
      if (cpu && turn === 1) {
        if (!ai) plan();
        t.ang += clamp(ai.ang - t.ang, -50 * dt, 50 * dt); t.pow += clamp(ai.pow - t.pow, -200 * dt, 200 * dt);
        if ((ai.t -= dt) <= 0 && Math.abs(ai.ang - t.ang) < .5 && Math.abs(ai.pow - t.pow) < 2) { fire(); ai = null; cpuShots++; }
      } else {
        const k = cpu ? 0 : turn;
        t.ang = clamp(t.ang + g.axis(k, 'r', 'l') * 50 * dt, 0, 180); t.pow = clamp(t.pow + g.axis(k, 'd', 'u') * 180 * dt, 150, 650);
      }
    }
    for (let s = 0, m = Math.ceil(dt * 240); shot && s < m; s++) { const r = fly(shot, dt / m); if (r) { if (r !== 'out') blast(shot.x, shot.y); shot = null; wait = 1; } }
    if (boom && (boom.t -= dt) <= 0) boom = null;
    if (wait > 0 && (wait -= dt) <= 0) {
      if (tk.some(q => q.hp <= 0)) finish();
      else { turn = 1 - turn; wind = Math.round(rand(-1, 1) * 40); }
    }
    g.clear(); x.fillStyle = 'rgba(255,255,255,.35)'; stars.forEach(([sx, sy]) => x.fillRect(sx, sy, 2, 2));
    x.fillStyle = '#2f5e3a'; x.beginPath(); x.moveTo(0, H); for (let i = 0; i <= W; i += 2) x.lineTo(i, ground[i]); x.lineTo(W, H); x.fill();
    x.strokeStyle = '#5fd38a'; x.lineWidth = 3; x.beginPath(); for (let i = 0; i <= W; i += 2) x.lineTo(i, ground[i]); x.stroke();
    tk.forEach((q, i) => {
      const y = gy(q.x), a = q.ang * Math.PI / 180;
      x.strokeStyle = '#cfd6ea'; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.moveTo(q.x, y - 14); x.lineTo(q.x + Math.cos(a) * 18, y - 14 - Math.sin(a) * 18); x.stroke();
      pill(x, q.x, y - 4, 30, 10, '#4a5a8c');
      face(x, q.x, y - 14, 9, q.tone, i ? 1 : 2, q.hp > 0 ? 1 : 2);
      const bx = i ? W - 114 : 14;
      text(x, i ? (cpu ? 'CPU' : 'P2') : (cpu ? 'You' : 'P1'), bx, 16, 13, '#cfe9ff', 'left');
      x.fillStyle = INK; x.fillRect(bx, 26, 100, 8); x.fillStyle = q.hp < 30 ? '#e0447a' : q.tone; x.fillRect(bx, 26, q.hp, 8);
    });
    if (!shot && wait <= 0) text(x, '▼', t.x, gy(t.x) - 34, 14, YEL);
    if (shot) { x.fillStyle = '#fff'; x.beginPath(); x.arc(shot.x, shot.y, 3, 0, Math.PI * 2); x.fill(); }
    if (boom) { x.fillStyle = `rgba(255,170,60,${Math.min(1, boom.t * 1.6)})`; x.beginPath(); x.arc(boom.x, boom.y, BLAST * (1.2 - boom.t), 0, Math.PI * 2); x.fill(); }
    text(x, `wind ${wind < 0 ? '←' : wind > 0 ? '→' : '·'} ${Math.abs(wind)}`, W / 2, 16, 15, YEL);
    text(x, `angle ${Math.round(t.ang)}° · power ${Math.round(t.pow)}`, W / 2, 38, 13, '#cfe9ff');
  });
  return g.stop;
});

window.Games = { catch: fruitCatch, stack: crateStack, match: faceMatch, toss: paperPlop, pinball: bumpers, aliens: raid, bricks: brickBash, paddle: volley, racer: dash, tanks: hurlers };
})();
