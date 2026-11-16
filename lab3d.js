/* Nimion HQ: the 3D lab. A lit, low-poly room (three.js) where the crew works and plays, seen from inside, at eye level.
   API: Lab.mount(el, { onNimionClick(name) }), Lab.update(S), Lab.props.
   With { full: true, onObjectClick(id) } it fills the window and is the app: objects in the room open the page's panels.
   Extra API: Lab.world, Lab.objects, Lab.focus(id), Lab.release(), Lab.feed(line), Lab.arcade(on),
   Lab.sky('auto'|'day'|'night') (window sky and lights: the local clock, or forced midday/midnight),
   Lab.react('win'|'lose') (idle nimions cheer or groan at the human's arcade result),
   Lab.deliverables(n) (the count on the Deliverables cabinet, object id 'files'),
   Lab.game(kind) (demo/test helper: start 'catch'|'kick'|'tag'|'board' now between two idle nimions; true if started).
   ES module; sets window.Lab. Without WebGL2 (or if the 3D start throws) Lab.mount leaves the element empty and Lab.world is false. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- 1. constants and helpers ----------
// World: x runs along the back wall (centre 0), z from the back wall (0) toward the viewer, y up. 1 unit is about one nimion.
const SPEED = 2.0;                                 // units per second
const CY = 3.4, ZY = 3.95;                         // corridor row; desk pods live at z > ZY
const SIDE = 9.3;                                  // half width of the activity area: snack nook left, play corner right
const PLAT = { x: 2.4, z1: 2.6, h: 0.18 };         // the boss platform, centred under the big screen
const BOSS_SEAT = [0, 0.85], BOSS_BOARD = [-1.25, 0.6];
const SEAT_H = 0.3, HW0 = 10.8, HC0 = 4.6, WAIN = 0.95; // shell: half width and ceiling before the camera pushes them out
const R = 0.23, L = 0.42, LEG = 0.13, MS = 1.35;   // nimion: capsule radius, straight part, leg height, model scale
const TOP = LEG + R + L, EYE_Y = 0.76, MOUTH_Y = 0.575, ARM_Y = 0.47;
const GUM_RB = R + .04, GUM_YB = LEG + .2;         // the bobble style's gumdrop body: its widest radius, and the height where it starts to narrow
const gumRad = y => (y >= TOP ? R : y <= GUM_YB ? GUM_RB : R + (GUM_RB - R) * Math.pow(1 - (y - GUM_YB) / (TOP - GUM_YB), 1.6));
const COLORS = ['#f08c00', '#2f5ea8', '#2e9e5b', '#b04fd0', '#d64545', '#0f9db0']; // same tints as index.html
const PROPS = ['hat', 'wrench', 'lens', 'clipboard', 'laptop', 'paintbrush', 'headset', 'flask',
  'cap', 'beanie', 'tophat', 'crown', 'glasses', 'sunglasses', 'headphones', 'mug', 'hammer', 'book', 'pencil', 'bowtie', 'none'];
const NO_HAIR = new Set(['hat', 'cap', 'beanie', 'tophat']);
const STYLES = ['sprout', 'bobble', 'tuft'], TONE = '#ffaa33'; // the three styles (the first is the default), and the body colour of a nimion that has none set
const CHIP = { needs: 'Needs you', waiting: 'Queued', paused: 'Paused', idle: 'Idle' };
const CHAT = ['Banana?', 'Ha!', 'Nice diff', 'Coffee?', 'Lunch?', 'Ship it!', 'Hmm…', 'LGTM', 'Tests green?'];
const SITTABLE = new Set(['sit', 'type', 'sleep', 'look', 'hand', 'nod', 'chat', 'move', 'think']);
const PRI = { needs: 5, flash: 4, work: 3, wait: 3, zzz: 2, chat: 1 };
const PI = Math.PI, DEG = PI / 180;
const AZ0 = 6 * DEG, AZ_SPAN = 25 * DEG, TILT_UP = 8 * DEG, TILT_DOWN = 8 * DEG;
const IDLE_BACK = 20000;                           // ms without input before the camera eases back to the fitted view
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
const LIQ = ['#5fd38a', '#4fb3ff', '#ff7aa8', '#ffd84d', '#b48cff'];
const PILE = 10, PILE_X = .17, PILE_Z = .22;          // desk paper pile: max sheets, place on the desk (pod coordinates, times the seat side)
const HOLD = 3500;                                 // ms: the longest a little scene may keep a nimion from work that started
const WIN = { x0: -8.3, x1: -5.8, y0: 1.35, y1: 2.95 }; // the sunny window (back wall, left); its twin is mirrored on the right
const CUP = [-7.5, .6, .6];
const MR_DOOR = [-5.1, .55];                       // newcomers walk in through the NR office door
const GUIDE_AT = [1.27, 1.35, .05];                // centre of the guidance board, where new notes get pinned
// Objects in the room that open the page's panels: id -> [icon, label]. Desks are added per nimion as desk:<name>.
const OBJ = { board: ['📋', 'Mission board'], guidance: ['📌', 'Guidance board'], mr: ['🚪', 'NR office · Nimion Resources'], arcade: ['🕹️', 'Arcade'],
  log: ['📜', 'Live log'], context: ['📚', 'Linked context'], needs: ['✋', 'Needs you'], compose: ['📨', 'New job'], schedules: ['⏰', 'Schedules'],
  files: ['🗄️', 'Deliverables'] };
const GAMES3 = [['FRUIT CATCH', '#b04fd0'], ['CRATE STACK', '#0f9db0'], ['FACE MATCH', '#e0447a']];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const still = () => mq.matches;
const _c = new THREE.Color(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _look = new THREE.Vector3(), _f = new THREE.Vector3();
// Eye-level framing per aspect: wide heroes look in about 19 degrees down; narrow ones step back, look down more and widen the lens.
const viewFor = a => { const k = clamp((2 - a) / .9, 0, 1); return { pol: (71 - 19 * k) * DEG, fov: 48 + 8 * k }; };

// ---------- 2. styles ----------
const CSS = `
.l3{position:relative;-webkit-user-select:none;user-select:none;container-type:inline-size}
.l3-wrap{position:relative;height:clamp(300px,46vh,480px);overflow:hidden;border-radius:20px;border:1px solid var(--line,#f0e4bb);
  background:linear-gradient(var(--sky,#fdf0c2),var(--bg,#fff8e1));touch-action:pan-y}
@media (max-width:520px){.l3-wrap{height:300px;border-radius:16px}}
.l3-wrap>canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block;outline:none;cursor:grab;touch-action:pan-y}
.l3-wrap>canvas.drag{cursor:grabbing} .l3-wrap>canvas.hot{cursor:pointer}
.l3-bubs{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.l3-bub{position:absolute;left:0;top:0;max-width:min(170px,42cqw);padding:3px 8px;border-radius:10px;background:var(--card,#fff);color:var(--ink,#2b2a33);
  border:1.5px solid color-mix(in srgb,var(--ink,#2b2a33) 55%,transparent);font:600 11px/1.3 ${FONT};white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;box-shadow:0 2px 6px rgba(0,0,0,.14);will-change:transform}
.l3-bub[hidden]{display:none} .l3-bub .s{display:none} .l3-bub.mini .t{display:none} .l3-bub.mini .s{display:inline} .l3-bub.mini{padding:2px 6px}
.l3-bub[data-k=work]{border-color:var(--tint,#2f5ea8)}
.l3-bub[data-k=needs]{background:var(--warn,#e08a00);border-color:var(--warn,#e08a00);color:#fff;font-weight:800;animation:l3-pulse 1.2s ease-in-out infinite}
.l3-bub[data-k=needs]::before{content:"!";display:inline-block;width:14px;height:14px;line-height:14px;margin-right:5px;text-align:center;border-radius:50%;background:#fff;color:var(--warn,#e08a00);font-weight:900}
.l3-bub.mini[data-k=needs]::before{margin:0}
.l3-bub[data-k=zzz]{font-style:italic;color:var(--muted,#6f6c7a);background:color-mix(in srgb,var(--card,#fff) 80%,transparent)}
.l3-bub[data-k=flash]{font-size:13px;border-color:var(--yellow-d,#d9a900)} .l3-bub[data-k=chat]{border-style:dashed}
.l3.crowd .l3-bub{max-width:min(120px,30cqw);font-size:10px;padding:2px 6px}
@container (max-width:520px){.l3-bub .t{display:none}.l3-bub .s{display:inline}.l3-bub{padding:2px 6px}.l3-bub[data-k=needs]::before{margin:0}}
.l3-tag{position:absolute;left:0;top:0;z-index:2;pointer-events:none;padding:1px 8px;border-radius:99px;background:var(--ink,#2b2a33);color:var(--card,#fff);font:700 11px/1.5 ${FONT};white-space:nowrap}
.l3-tag[hidden],.l3-msg[hidden]{display:none}
.l3-fit{position:absolute;right:10px;bottom:10px;z-index:3;border:1px solid var(--line,#f0e4bb);border-radius:99px;padding:3px 10px;cursor:pointer;
  background:color-mix(in srgb,var(--card,#fff) 82%,transparent);color:var(--ink,#2b2a33);font:700 12px/1.4 ${FONT};backdrop-filter:blur(4px)}
.l3-fit:hover{border-color:var(--denim,#2f5ea8)} .l3-fit:focus-visible{outline:3px solid var(--denim,#2f5ea8);outline-offset:2px}
.l3-hint{position:absolute;left:50%;bottom:12px;z-index:3;transform:translateX(-50%);pointer-events:none;padding:3px 10px;border-radius:99px;opacity:0;transition:opacity .3s;
  background:color-mix(in srgb,var(--ink,#2b2a33) 80%,transparent);color:var(--card,#fff);font:600 12px/1.4 ${FONT};white-space:nowrap}
.l3-hint.on{opacity:1}
.l3.full .l3-wrap{position:fixed;inset:0;height:auto;border:0;border-radius:0;touch-action:none}
.l3.full .l3-wrap>canvas{touch-action:none} .l3.full .l3-roster{display:none} .l3.full .l3-fit{bottom:14px;right:14px}
.l3-tag.obj{background:var(--yellow,#ffd84d);color:#2b2a33;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.l3-msg{position:absolute;inset:0;z-index:4;display:grid;place-items:center;padding:16px;text-align:center;color:var(--ink,#2b2a33);font:600 13px/1.4 ${FONT};
  background:color-mix(in srgb,var(--bg,#fff8e1) 75%,transparent)}
.l3-roster{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:8px}
.l3-rb{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 5px 4px 9px;border-radius:99px;border:1px solid var(--line,#f0e4bb);
  background:var(--card,#fff);color:var(--ink,#2b2a33);font:inherit;font-size:12px;cursor:pointer}
.l3-rb:hover{border-color:var(--tint,#2f5ea8)} .l3-rb:focus-visible{outline:3px solid var(--denim,#2f5ea8);outline-offset:2px}
.l3-rb i{width:8px;height:8px;border-radius:50%;background:var(--tint,#2f5ea8);flex:none}
.l3-rb .ti{color:var(--muted,#6f6c7a);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.l3-rb .ch{font-size:11px;font-weight:700;padding:1px 7px;border-radius:99px;background:var(--line,#f0e4bb);white-space:nowrap}
.l3-rb[data-m=working] .ch{background:var(--tint,#2f5ea8);color:#fff} .l3-rb[data-m=needs] .ch{background:var(--warn,#e08a00);color:#fff}
.l3-rb[data-m=paused] .ch{background:var(--muted,#6f6c7a);color:var(--card,#fff)}
@media (max-width:520px){.l3-rb .ti{display:none}}
@keyframes l3-pulse{50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--warn,#e08a00) 30%,transparent)}}
@media (prefers-reduced-motion:reduce){.l3 *{animation:none!important;transition:none!important}}
`;

// ---------- 3. shared geometry, materials, canvas textures ----------
const geos = new Map(), mats = new Map();
const geo = (k, make) => { let g = geos.get(k); if (!g) geos.set(k, g = make()); return g; };
const BOX = (w, h, d) => geo(`b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d));
const CYL = (a, b, h, s = 12) => geo(`c${a}|${b}|${h}|${s}`, () => new THREE.CylinderGeometry(a, b, h, s));
const SPH = (r, w = 12, h = 8) => geo(`s${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h));
function lam(color, o) {
  const k = 'L' + color + (o ? JSON.stringify(o) : '');
  let m = mats.get(k);
  if (!m) mats.set(k, m = new THREE.MeshLambertMaterial(Object.assign({ color }, o)));
  return m;
}
function basic(color, o) {
  const k = 'B' + color + (o ? JSON.stringify(o) : '');
  let m = mats.get(k);
  if (!m) mats.set(k, m = new THREE.MeshBasicMaterial(Object.assign({ color }, o)));
  return m;
}
// sh: 1 = casts a shadow, 2 = receives shadows
function mesh(parent, g, mat, x = 0, y = 0, z = 0, sh = 0) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = !!(sh & 1); m.receiveShadow = !!(sh & 2);
  parent.add(m);
  return m;
}
const boxAt = (p, mat, x0, y0, z0, x1, y1, z1, sh = 3) =>
  mesh(p, BOX(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, sh);
// A flat panel facing +z (back wall), or turned by rot around y.
function panel(p, mat, w, h, x, y, z, rot = 0) {
  const m = mesh(p, geo(`p${w}|${h}`, () => new THREE.PlaneGeometry(w, h)), mat, x, y, z);
  m.rotation.y = rot;
  return m;
}
function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { c, x: c.getContext('2d'), t };
}
const hex = (a, b, k) => '#' + _c.set(a).lerp(new THREE.Color(b), k).getHexString();

let MAT = null, FIG = null;
function sharedMats() {
  if (MAT) return MAT;
  MAT = {
    eyeRim: basic('#3b2a20'), cheek: basic('#ff8fa3', { transparent: true, opacity: .55, depthWrite: false }), leaf: lam('#5cc46a'), leafD: lam('#3f9d4f'), stalk: lam('#5b5560'),
    badge: lam('#ffffff'), badgeLine: basic('#b9c0cc'), creamN: lam('#fff4dc'), wearGrey: lam('#8b90a0'), paleGrey: lam('#d6d9e0'), metal: lam('#c3c9d3'),
    white: lam('#ffffff'), iris: lam('#6b4322'), pupil: basic('#111111'), glint: basic('#ffffff'), mouth: lam('#5a2a1a'),
    outline: new THREE.MeshBasicMaterial({ color: '#2f5ea8', side: THREE.BackSide }), hit: new THREE.MeshBasicMaterial(),
    paper: lam('#ffffff'), red: lam('#ffd0d0', { emissive: '#d64545', emissiveIntensity: .35 }), ball: lam('#e0447a'), nana: lam('#ffe14d'),
    orange: lam('#f08c00'), orangeD: lam('#cf7400'), wood: lam('#b5793f'), steel: lam('#8d96a3'), pink: lam('#e0447a'), laptop: lam('#9aa3b2'),
    glass: lam('#d8efff', { transparent: true, opacity: .3, depthWrite: false }), greenGlow: lam('#5fd38a', { emissive: '#5fd38a', emissiveIntensity: .5 }),
    ink: lam('#3b3946'), chair: lam('#5d7fbf'), desk: lam('#f4efe6'), deskLeg: lam('#8a8f9c'), kb: lam('#4a4858'), envelope: lam('#ffffff', { emissive: '#ffffff', emissiveIntensity: .3 }),
    flap: lam('#2f5ea8', { side: THREE.DoubleSide }), screenOff: basic('#1a1d29'), redLed: basic('#d64545'), shelf: lam('#b98a5a'),
    cream: lam('#f1e6c8'), alert: lam('#e08a00', { emissive: '#e08a00', emissiveIntensity: .7 }),
  };
  return MAT;
}
function figGeo() {
  if (FIG) return FIG;
  const env = new THREE.Shape([new THREE.Vector2(-.13, .085), new THREE.Vector2(.13, .085), new THREE.Vector2(0, -.015)]);
  const gum = []; // the gumdrop body's outline, from the bottom up: a round base, a gentle taper, a round head
  for (let i = 0; i <= 8; i++) { const a = -PI / 2 + i / 8 * PI / 2; gum.push(new THREE.Vector2(Math.cos(a) * GUM_RB, GUM_YB + Math.sin(a) * .2)); }
  for (let i = 1; i <= 8; i++) { const y = GUM_YB + i / 8 * (TOP - GUM_YB); gum.push(new THREE.Vector2(gumRad(y), y)); }
  for (let i = 1; i <= 8; i++) { const a = i / 8 * PI / 2; gum.push(new THREE.Vector2(Math.cos(a) * R, TOP + Math.sin(a) * R)); }
  const tummy = new THREE.RingGeometry(.001, 1, 30, 6), tp = tummy.attributes.position; // a paler tummy that follows the gumdrop's curve
  for (let i = 0; i < tp.count; i++) { const x = tp.getX(i) * .15, y = .372 + tp.getY(i) * .165; tp.setXYZ(i, x, y, Math.sqrt(gumRad(y) ** 2 - x * x) + .004); }
  tummy.computeVertexNormals();
  FIG = {
    body: new THREE.CapsuleGeometry(R, L, 5, 16), outline: new THREE.CapsuleGeometry(R + .03, L, 4, 14), gum: new THREE.LatheGeometry(gum, 28), tummy,
    eyeRim2: new THREE.CircleGeometry(.0685, 24), eyeRim1: new THREE.CircleGeometry(.0935, 26), eyeW2: new THREE.CircleGeometry(.063, 20), eyeW1: new THREE.CircleGeometry(.087, 22),
    eyeI2: new THREE.CircleGeometry(.038, 16), eyeI1: new THREE.CircleGeometry(.051, 18), eyeP2: new THREE.CircleGeometry(.02, 12), eyeP1: new THREE.CircleGeometry(.027, 12),
    glintB: new THREE.CircleGeometry(.015, 10), glintS: new THREE.CircleGeometry(.007, 8), cheek: new THREE.CircleGeometry(.036, 14),
    stem: new THREE.CylinderGeometry(.008, .012, .09, 6), leaf: new THREE.SphereGeometry(.055, 12, 8),
    bobStalk: new THREE.CylinderGeometry(.006, .007, .12, 5), bob: new THREE.SphereGeometry(.038, 12, 8), tuft: new THREE.SphereGeometry(.052, 12, 8),
    scarf: new THREE.TorusGeometry(R + .012, .038, 10, 28), knot: new THREE.SphereGeometry(.04, 10, 8), tail: new THREE.ConeGeometry(.045, .13, 8),
    lany: new THREE.BoxGeometry(.012, .15, .005), badge: new THREE.BoxGeometry(.09, .115, .012), badgeDot: new THREE.CircleGeometry(.02, 12), badgeLine: new THREE.BoxGeometry(.05, .008, .002),
    jumper: new THREE.CylinderGeometry(R + .011, R + .011, .056, 24, 1, true), roll: new THREE.TorusGeometry(R + .011, .014, 6, 24), sleeve: new THREE.CapsuleGeometry(.043, .06, 2, 8),
    smile: new THREE.TorusGeometry(.05, .011, 4, 10, PI), open: new THREE.CircleGeometry(.055, 12, PI, PI), o: new THREE.CircleGeometry(.026, 10),
    arm: new THREE.CapsuleGeometry(.036, .13, 2, 6), glove: new THREE.SphereGeometry(.05, 10, 8), leg: new THREE.CylinderGeometry(.05, .05, .1, 8),
    shoe: new THREE.SphereGeometry(.062, 10, 6), toe: new THREE.SphereGeometry(.05, 10, 6), hit: new THREE.CylinderGeometry(.34, .34, 1.25, 8), paper: new THREE.BoxGeometry(.2, .26, .008),
    cup: new THREE.CylinderGeometry(.036, .03, .075, 10), ball: new THREE.SphereGeometry(.085, 12, 8), nana: new THREE.TorusGeometry(.07, .022, 5, 10, 2.2),
    hat: new THREE.SphereGeometry(R + .025, 16, 6, 0, PI * 2, 0, PI / 2), headband: new THREE.TorusGeometry(R + .03, .014, 4, 16, PI),
    envBox: new THREE.BoxGeometry(.26, .17, .02), envFlap: new THREE.ShapeGeometry(env), blob: new THREE.CircleGeometry(.34, 20),
  };
  return FIG;
}
// One body material per tone, plus a greyed twin (sleep) and monitor-lit twins (typing), shared by every nimion with that tone.
const toneMats = new Map();
function toneMat(tone) {
  let e = toneMats.get(tone);
  if (!e) {
    const c = new THREE.Color(tone), l = c.r * .3 + c.g * .59 + c.b * .11;
    e = { mat: new THREE.MeshLambertMaterial({ color: c }), grey: new THREE.MeshLambertMaterial({ color: new THREE.Color(l, l, l * 1.08) }), lit: new Map(), n: 0, gen };
    toneMats.set(tone, e);
  }
  e.n++;
  return e;
}
function litMat(e, tint) {
  let m = e.lit.get(tint);
  if (!m) e.lit.set(tint, m = new THREE.MeshLambertMaterial({ color: e.mat.color, emissive: tint, emissiveIntensity: .07 }));
  return m;
}
function dropTone(tone) {
  const e = toneMats.get(tone);
  if (e && --e.n <= 0) {
    if (e.gen === gen) { e.mat.dispose(); e.grey.dispose(); for (const m of e.lit.values()) m.dispose(); for (const k of ['light', 'deep']) if (e[k]) e[k].dispose(); }
    toneMats.delete(tone);
  }
}

// ---------- 4. state of the module ----------
let root = null, wrap, canvas, bubLayer, tagEl, hintEl, msgEl, roster, renderer, scene, camera, ocam, controls, onClick = () => {};
let room, fxGroup, sun, hemi, fill, lamps = [], lampShades = [], rigs = [];
let theme = {}, glowK = 1, screenK = 1, dayKey = '', lightAt = 0;
const mins = new Map();                    // name -> nimion
const stations = new Map();                // name -> desk seat
const hitList = [];
let flyers = [], gaps = [-2, 2], boss = null, first = true, seen = new Map(), crewSig = null, layoutSig = null, labelSig = '', screenSig = '';
let clockG = null, plateT = null, plateAt = 0, ringAt = -1e9; // the wall clock is the Schedules object: a plate under it shows the next run
const plate = { text: '', next: null, held: null, ring: '' };
let raf = 0, last = 0, onScreen = true, lost = false, gen = 0, vw = 1, vh = 1, needFit = false;
let fit = null, actPts = [], podX = 0, front = 4.2, zoomGoal = 0, zoomAt = 0, anim = null, lastUser = 0, dragging = false, down = null, hoverAt = null, hovered = null;
let focus = null, att = 0;                 // gentle camera attention: { m, until }
let full = false, onObj = () => {}, held = null, saved = null, hoverBox = null, hoveredObj = null, arcadeOn = false;
const objs = new Map();                    // id -> { id, icon, label, group }
let boardT, guideT, logT, ctxT, filesT, filesN = 0, needsT, needsMat, needsN = -1, guideSig = null, memAt = null, ctxN = -1, feedLines = [], feedDirty = false, feedAt = 0, notes = [];
const touches = new Map();
let pinch = null;
// the stretchable room shell, and animated room bits
const shell = { hw: HW0, hc: HC0, dz: 12 }, S = {}, T = {};
let floorT, rugT, skyT, wbT, scrT, wbOn = false, wbShown = -1, bubbles, bubbleSrc = [], liqMats = [], steam = [], dust, dustSrc = [],
  plants = [], leds = [], cornerBall, clockHands, beamMat, patchMat, beamDir, fg = [];

// ---------- 5. the room: a fixed set inside a shell that stretches to cover the frame ----------
function drawFloor() {
  const { c, x } = floorT, s = c.width / 2, a = hex(theme.floor, '#ffffff', theme.dark ? .1 : 0), b = hex(a, theme.ink, .06);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? b : a; x.fillRect(i * s, j * s, s, s); }
  x.strokeStyle = hex(theme.floor, theme.ink, .16); x.lineWidth = 2;
  x.beginPath();
  for (const k of [1, s + 1]) { x.moveTo(k, 0); x.lineTo(k, c.height); x.moveTo(0, k); x.lineTo(c.width, k); }
  x.stroke();
  floorT.t.needsUpdate = true;
}
function drawRug() {
  const { c, x } = rugT;
  x.fillStyle = hex(theme.yellow, theme.floor, .55); x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = hex(theme.yellow, theme.floor, .3);
  for (let i = 0; i < 6; i++) x.fillRect(18 + i * 40, 22, 20, c.height - 44);
  x.setLineDash([12, 8]); x.lineWidth = 4; x.strokeStyle = hex(theme.yellowD, theme.floor, .2); x.strokeRect(8, 8, c.width - 16, c.height - 16);
  x.setLineDash([]);
  rugT.t.needsUpdate = true;
}
// The window sky at hour h: the sun crosses from left (06:00) to right (18:00), the moon and stars by night, warm near sunrise and sunset.
function drawSky(day, warm, h) {
  const { c, x } = skyT, W = c.width, H = c.height, night = 1 - day, g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hex(hex('#5fb4ff', '#ff8a4c', warm * .7), '#0b1433', night));
  g.addColorStop(1, hex(hex('#d6efff', '#ffb36b', warm * .9), '#2a3768', night));
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const arc = u => [W * (.08 + .84 * u), H * (.92 - .72 * Math.sin(clamp(u, 0, 1) * PI))];
  if (night > .25) {
    x.globalAlpha = clamp((night - .25) / .5, 0, 1);
    x.fillStyle = '#ffffff';
    for (let i = 0; i < 30; i++) x.fillRect((i * 73) % W, (i * 37) % (H * .75), i % 4 ? 1.5 : 2.5, i % 4 ? 1.5 : 2.5);
    const [mx, my] = arc(((h + 6) % 24) / 12); // 18:00 rises left, 06:00 sets right
    x.fillStyle = '#fff4c8'; x.beginPath(); x.arc(mx, my, 11, 0, PI * 2); x.fill();
    x.fillStyle = hex('#0b1433', '#2a3768', .3); x.beginPath(); x.arc(mx + 6, my - 4, 10, 0, PI * 2); x.fill();
    x.globalAlpha = 1;
  }
  if (day > 0) {
    const [sx, sy] = arc((h - 6) / 12);
    x.globalAlpha = clamp(day * 2, 0, 1);
    x.fillStyle = 'rgba(255,240,180,.35)'; x.beginPath(); x.arc(sx, sy, 22, 0, PI * 2); x.fill();
    x.fillStyle = warm > .5 ? '#ffb060' : '#fff1a8'; x.beginPath(); x.arc(sx, sy, 13, 0, PI * 2); x.fill();
    x.globalAlpha = day * .85;
    x.fillStyle = '#ffffff';
    for (const [cx, cy, k] of [[40, 30, 1], [120, 50, .8], [170, 22, .6]]) {
      x.beginPath(); x.arc(cx, cy, 10 * k, 0, PI * 2); x.arc(cx + 12 * k, cy - 5 * k, 12 * k, 0, PI * 2); x.arc(cx + 26 * k, cy, 9 * k, 0, PI * 2); x.fill();
    }
    x.globalAlpha = 1;
  }
  skyT.t.needsUpdate = true;
}
// Whiteboard scribbles in a 100 x 48 box; while the boss plans they appear one by one.
const WB = ['M6 8 h30', 'M6 15 h20', 'M8 40 l8 -9 l7 5 l8 -12 l8 6', 'M46 6 h16 v9 h-16 z', 'M54 15 v6', 'M46 21 h16 v9 h-16 z', 'M54 30 v6',
  'M46 36 h16 v8 h-16 z', 'M70 8 h22', 'M70 14 h18', 'M68 24 l3 3 l6 -7', 'M68 40 q6 -5 12 0 t12 0'].map(d => new Path2D(d));
const INK = ['#2f5ea8', '#d64545', '#2e9e5b'];
function drawBoard(n) {
  const { c, x } = wbT, k = c.width / 100;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = '#fbfcff'; x.fillRect(0, 0, c.width, c.height);
  x.setTransform(k, 0, 0, k, 0, 0);
  x.lineWidth = 1.3; x.lineCap = x.lineJoin = 'round';
  for (let i = 0; i < n; i++) { x.strokeStyle = INK[i % 3]; x.stroke(WB[i]); }
  wbT.t.needsUpdate = true;
}
// Text helpers for canvas textures.
function fitText(x, t, w) {
  t = String(t == null ? '' : t);
  if (x.measureText(t).width <= w) return t;
  while (t.length > 1 && x.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
function wrapText(x, t, w, max) {
  const out = [];
  let line = '';
  for (const word of String(t || '').split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word;
    if (x.measureText(next).width <= w || !line) line = next; else { out.push(line); line = word; }
    if (out.length === max) break;
  }
  if (line && out.length < max) out.push(line);
  if (out.length === max && out.join(' ').length < String(t).trim().length) out[max - 1] = fitText(x, out[max - 1] + ' …', w);
  return out.map(l => fitText(x, l, w));
}
function rrect(x, a, b, w, h, r) { x.beginPath(); x.roundRect ? x.roundRect(a, b, w, h, r) : x.rect(a, b, w, h); }
// The mission board: what every nimion is on, in four live columns.
// The mission board on the wall: one row per group from HQW.boardGroups (a job you gave the boss with its steps, direct jobs,
// scheduled runs), open ones first, then the ones finished today.
const ST_COL = { 'needs-you': '#e08a00', working: '#5fd38a', queued: '#7fa3d9', done: '#9aa3b2', failed: '#ff6b6b', stopped: '#ff6b6b' };
const ST_TXT = { 'needs-you': 'NEEDS YOU', working: 'WORKING', queued: 'QUEUED', done: 'DONE', failed: 'FAILED', stopped: 'STOPPED' };
function drawMission(rows, status, next = []) {
  const { c, x } = scrT, W = c.width, H = c.height, pad = 22, top = 62, rh = 53, max = next.length ? 5 : 6;
  x.fillStyle = '#1f2a44'; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  x.fillStyle = '#ffd84d'; x.font = `800 34px ${FONT}`; x.fillText('MISSION BOARD', pad, 44);
  banana(x, pad + 300, 30, 2, -.3);
  x.textAlign = 'right'; x.fillStyle = '#cfe9ff'; x.font = `700 22px ${FONT}`; x.fillText(fitText(x, status, 480), W - pad, 42); x.textAlign = 'left';
  const shown = rows.length > max ? max - 1 : max;
  rows.slice(0, shown).forEach((g, i) => {
    const y = top + i * rh, col = ST_COL[g.status] || '#9aa3b2';
    x.fillStyle = g.finished ? 'rgba(255,255,255,.04)' : '#2b3a5c'; rrect(x, pad, y, W - pad * 2, rh - 7, 9); x.fill();
    x.fillStyle = col; x.fillRect(pad, y + 5, 7, rh - 17);
    x.fillStyle = g.finished ? '#b8c4dc' : '#ffffff'; x.font = `800 19px ${FONT}`; x.fillText(fitText(x, `${g.icon} ${g.title}`, W - 470), pad + 20, y + 21);
    x.fillStyle = '#9fb3d9'; x.font = `600 14px ${FONT}`; x.fillText(fitText(x, g.steps || '—', W - 470), pad + 20, y + 40);
    const px = W - pad - 330; // progress bar, count and state on the right
    if (g.total) {
      x.fillStyle = 'rgba(255,255,255,.12)'; rrect(x, px, y + 18, 130, 9, 4.5); x.fill();
      x.fillStyle = col; rrect(x, px, y + 18, Math.max(9, 130 * g.done / g.total), 9, 4.5); x.fill();
      x.fillStyle = '#cfe9ff'; x.font = `700 16px ${FONT}`; x.fillText(`${g.done}/${g.total}`, px + 140, y + 28);
    }
    x.textAlign = 'right'; x.fillStyle = col; x.font = `800 16px ${FONT}`; x.fillText(ST_TXT[g.status] || g.status, W - pad - 14, y + 28); x.textAlign = 'left';
  });
  if (rows.length > shown) { x.fillStyle = '#9fb3d9'; x.font = `700 16px ${FONT}`; x.fillText(`+${rows.length - shown} more on the board`, pad + 20, top + shown * rh + 26); }
  if (!rows.length) { x.fillStyle = 'rgba(207,233,255,.5)'; x.font = `600 20px ${FONT}`; x.fillText('Nothing on the board. Give the boss a job.', pad + 20, top + 40); }
  if (next.length) { // the next scheduled runs, along the bottom
    const y = H - 46;
    x.fillStyle = '#2b3a5c'; rrect(x, pad, y, W - pad * 2, 34, 9); x.fill();
    x.fillStyle = '#ffd84d'; x.font = `800 16px ${FONT}`; x.fillText('⏰ NEXT UP', pad + 14, y + 23);
    x.fillStyle = '#cfe9ff'; x.font = `700 16px ${FONT}`; x.fillText(fitText(x, next.join('   ·   '), W - pad * 2 - 150), pad + 132, y + 23);
  }
  scrT.t.needsUpdate = true;
}
// The guidance board: one pinned note per line of the boss's memory.
const NOTE = ['#fff3a3', '#ffd1dc', '#cdeaff', '#d4f5c9', '#ffe0b3', '#e6dcff'];
function drawGuide(items) {
  const { c, x } = guideT, W = c.width, H = c.height;
  x.fillStyle = '#c8955a'; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(90,50,20,.18)';
  for (let i = 0; i < 160; i++) x.fillRect((i * 97) % W, (i * 53) % H, 2, 2);
  x.fillStyle = '#3b3946'; rrect(x, 8, 6, 132, 26, 6); x.fill();
  x.fillStyle = '#ffd84d'; x.font = `800 17px ${FONT}`; x.textBaseline = 'middle'; x.textAlign = 'left'; x.fillText('GUIDANCE', 18, 20);
  const list = items.length ? items : ['No guidance yet. Click to add some.'], max = 6, shown = list.length > max ? max - 1 : max;
  const notes = list.slice(0, shown).concat(list.length > shown ? [`+${list.length - shown} more…`] : []);
  notes.forEach((t, i) => {
    const cx = 14 + (i % 3) * 166, cy = 40 + Math.floor(i / 3) * 106, rot = ((i * 37) % 7 - 3) * .012;
    x.save(); x.translate(cx + 78, cy + 50); x.rotate(rot);
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(-74, -44, 152, 96);
    x.fillStyle = NOTE[i % NOTE.length]; x.fillRect(-76, -48, 152, 96);
    x.fillStyle = '#2b2a33'; x.font = `600 15px ${FONT}`; x.textBaseline = 'top';
    wrapText(x, t, 136, 4).forEach((l, k) => x.fillText(l, -68, -34 + k * 19));
    x.fillStyle = '#d64545'; x.beginPath(); x.arc(0, -44, 6, 0, PI * 2); x.fill();
    x.restore();
  });
  x.textBaseline = 'alphabetic';
  guideT.t.needsUpdate = true;
}
function drawFiles(n) {
  const { c, x } = filesT;
  x.fillStyle = '#3b3946'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#ffd84d'; x.font = `800 21px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`DELIVERABLES · ${n}`, c.width / 2, c.height / 2 + 1);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  filesT.t.needsUpdate = true;
}
function drawCtx(n) {
  const { c, x } = ctxT;
  x.fillStyle = '#3b3946'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#ffd84d'; x.font = `800 22px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`LINKED CONTEXT · ${n}`, c.width / 2, c.height / 2 + 1);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  ctxT.t.needsUpdate = true;
}
// The plate under the wall clock: the next scheduled run with a countdown, a bell when one starts, grey while runs are held.
const until = ms => { const s = Math.max(0, Math.round((ms - Date.now()) / 1000)), m = Math.floor(s / 60); return s < 60 ? `in ${s}s` : m < 60 ? `in ${m}m` : m < 2880 ? `in ${Math.floor(m / 60)}h ${m % 60}m` : `in ${Math.round(m / 1440)}d`; };
const hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function plateText(now) {
  if (plate.ring && now - ringAt < 5000) return `🔔 ${plate.ring} · started`;
  if (plate.held && plate.next) return `⏸ held: ${plate.held}`;
  return plate.next ? `⏰ ${hhmm(plate.next.nextAt)} · ${until(plate.next.nextAt)} · ${plate.next.name}` : '⏰ nothing scheduled'; // the name last, so a long one loses its end, not the time
}
function drawPlate() {
  if (!plateT) return;
  const { c, x } = plateT, W = c.width, H = c.height, ring = plate.text.startsWith('🔔'), held = plate.held && plate.next && !ring;
  x.clearRect(0, 0, W, H);
  x.fillStyle = ring ? theme.yellow : held ? hex(theme.ink, theme.card, .55) : theme.ink; rrect(x, 0, 0, W, H, 14); x.fill(); // theme colours, so day and night follow the page
  x.fillStyle = ring ? (theme.dark ? theme.bg : theme.ink) : theme.card; x.font = `800 25px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(fitText(x, plate.text, W - 24), W / 2, H / 2 + 1);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  plateT.t.needsUpdate = true;
}
const KIND = { you: '🧑', say: '💬', tool: '🔧', sys: '⚙️', err: '⛔' };
function drawLog() {
  const { c, x } = logT, W = c.width, H = c.height;
  x.fillStyle = '#12161f'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#5fd38a'; x.font = `800 18px ${FONT}`; x.textAlign = 'left'; x.fillText('● LIVE LOG', 12, 24);
  x.font = '13px ui-monospace, Menlo, monospace';
  const lines = feedLines.slice(-9);
  if (!lines.length) { x.fillStyle = '#6f7a8c'; x.fillText('waiting for the crew…', 12, 52); }
  lines.forEach((l, i) => {
    const y = 50 + i * 21, m = mins.get(l.nimion);
    x.fillStyle = m ? m.tint : '#9aa3b2'; x.fillText(fitText(x, l.nimion || '', 54), 12, y);
    x.fillStyle = l.k === 'err' ? '#ff8a8a' : l.k === 'say' || l.k === 'you' ? '#e8eefc' : '#8b95a7';
    x.fillText(fitText(x, `${KIND[l.k] || '·'} ${String(l.t || '').replace(/\s+/g, ' ')}`, W - 84), 72, y);
  });
  logT.t.needsUpdate = true;
}
function drawNeeds(n) {
  const { c, x } = needsT, W = c.width, H = c.height;
  x.fillStyle = n ? '#e08a00' : '#3b3946'; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = n ? '#ffffff' : '#a9a6b5'; x.font = `800 26px ${FONT}`; x.fillText('✋ NEEDS YOU', W / 2, 38);
  x.font = `900 66px ${FONT}`; x.fillText(String(n), W / 2, 104);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  needsT.t.needsUpdate = true;
}
// A room object that opens a panel. Its parts go in this group; a hit box is fitted around it once the room is built.
function objGroup(id) {
  const g = new THREE.Group();
  room.add(g);
  objs.set(id, { id, icon: OBJ[id][0], label: OBJ[id][1], group: g });
  return g;
}
function fitHits() {
  for (const o of objs.values()) {
    if (o.hit || o.id.startsWith('desk:')) continue;
    const b = new THREE.Box3().setFromObject(o.group).expandByScalar(.05), sz = b.getSize(new THREE.Vector3());
    o.hit = mesh(scene, BOX(sz.x, sz.y, Math.max(sz.z, .2)), sharedMats().hit, ...b.getCenter(new THREE.Vector3()).toArray());
    o.hit.visible = false; o.hit.userData.obj = o;
    hitList.push(o.hit);
  }
}
// An arcade cabinet facing the room, with a lit marquee and a coin light.
function cabinet(p, x, name, col) {
  const M = sharedMats(), c = new THREE.Group();
  c.position.set(x, 0, .05); p.add(c);
  boxAt(c, lam(col), -.34, 0, 0, .34, 1.7, .55);
  boxAt(c, M.ink, -.3, .84, .5, .3, .92, .78);
  const scr = panel(c, new THREE.MeshBasicMaterial({ map: staticTex(128, 96, (x2, w, h) => {
    x2.fillStyle = '#10142a'; x2.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) { x2.fillStyle = ['#ffd84d', '#5fd38a', '#ff7aa8', '#4fb3ff'][i % 4]; x2.fillRect((i * 37) % w, (i * 23) % (h - 20), 6, 6); }
    x2.fillStyle = '#ffffff'; x2.font = `800 13px ${FONT}`; x2.textAlign = 'center'; x2.fillText('INSERT BANANA', w / 2, h - 8);
  }), fog: false }), .5, .38, 0, 1.2, .552);
  scr.rotation.x = -.12;
  panel(c, new THREE.MeshBasicMaterial({ map: staticTex(160, 40, (x2, w, h) => {
    x2.fillStyle = '#2b2a33'; x2.fillRect(0, 0, w, h); x2.fillStyle = '#ffd84d'; x2.font = `900 19px ${FONT}`; x2.textAlign = 'center'; x2.fillText(name, w / 2, 27);
  }), fog: false }), .6, .15, 0, 1.56, .553);
  mesh(c, CYL(.012, .012, .08, 6), M.ink, -.12, .96, .64);
  mesh(c, SPH(.035, 8, 6), M.ball, -.12, 1.0, .64);
  mesh(c, CYL(.03, .03, .02, 10), lam('#ffd84d'), .06, .93, .64);
  mesh(c, CYL(.03, .03, .02, 10), lam('#4fb3ff'), .15, .93, .62);
  leds.push(mesh(c, BOX(.06, .06, .01), new THREE.MeshBasicMaterial({ color: '#2e9e5b' }), 0, .45, .555));
}
function banana(x, cx, cy, s, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
  x.fillStyle = '#ffe14d'; x.strokeStyle = '#b8900a'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(-9, -2); x.quadraticCurveTo(0, 9, 9, -2); x.quadraticCurveTo(0, 4, -9, -2); x.fill(); x.stroke();
  x.restore();
}
const texMat = (map, glow = 0) => new THREE.MeshLambertMaterial({ map, emissive: '#ffffff', emissiveMap: glow ? map : null, emissiveIntensity: glow });
function staticTex(w, h, draw) { const ct = canvasTex(w, h); draw(ct.x, w, h); ct.t.needsUpdate = true; return ct.t; }
function softDot(a = 1) {
  return staticTex(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(.4, `rgba(255,255,255,${a / 2})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
}

// A glass flask with glowing liquid; kind: e = conical, r = round, t = three test tubes.
function flask(p, x, y, z, kind, ci) {
  const M = sharedMats(), liq = liqMats[ci % liqMats.length], g = new THREE.Group(), k = 1.5;
  g.position.set(x, y, z); g.scale.setScalar(k); p.add(g);
  if (kind === 't') {
    for (let i = 0; i < 3; i++) {
      mesh(g, CYL(.018, .018, .16, 8), M.glass, -.06 + i * .06, .08, 0);
      mesh(g, CYL(.014, .014, .07 - i * .015, 8), liqMats[(ci + i) % liqMats.length], -.06 + i * .06, .035, 0);
    }
    return;
  }
  if (kind === 'e') {
    mesh(g, CYL(.03, .085, .15, 12), M.glass, 0, .075, 0);
    mesh(g, CYL(.024, .024, .06, 10), M.glass, 0, .18, 0);
    mesh(g, CYL(.055, .08, .06, 12), liq, 0, .03, 0);
  } else {
    mesh(g, SPH(.075, 12, 10), M.glass, 0, .075, 0);
    mesh(g, CYL(.022, .022, .07, 10), M.glass, 0, .18, 0);
    mesh(g, geo('liqR', () => new THREE.SphereGeometry(.066, 12, 6, 0, PI * 2, PI / 2, PI / 2)), liq, 0, .075, 0).scale.y = .9;
  }
  bubbleSrc.push([x, y + .07 * k, z]);
}
function chair(p, x, z, y0, yaw, tall) {
  const M = sharedMats(), g = new THREE.Group();
  g.position.set(x, y0, z); g.rotation.y = yaw; p.add(g);
  mesh(g, CYL(.2, .2, .03, 10), M.ink, 0, .015, 0, 2);
  mesh(g, CYL(.025, .025, .26, 6), M.ink, 0, .14, 0);
  boxAt(g, M.chair, -.21, .26, -.2, .21, SEAT_H, .2);
  boxAt(g, M.chair, -.21, .3, -.27, .21, tall ? .95 : .62, -.21);
  return g;
}
function plant(p, x, z, s = 1, y = 0) {
  const g = new THREE.Group(), leaves = new THREE.Group();
  g.position.set(x, y, z); g.scale.setScalar(s); p.add(g);
  mesh(g, CYL(.17, .13, .3, 12), lam('#c96f4a'), 0, .15, 0, 3);
  mesh(g, CYL(.15, .15, .02, 12), lam('#5a3d2b'), 0, .29, 0);
  leaves.position.y = .3; g.add(leaves);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * PI * 2, l = mesh(leaves, SPH(.1, 8, 6), lam(i % 2 ? '#4caf6a' : '#3d9a5a'), Math.cos(a) * .09, .22 + (i % 3) * .07, Math.sin(a) * .09, 1);
    l.scale.set(.55, 1.9, .55); l.rotation.set(Math.sin(a) * .5, 0, -Math.cos(a) * .5);
  }
  plants.push({ g: leaves, ph: x + z });
  return g;
}
function windowAt(g, x0, x1) {
  const frame = lam('#f4f1ea'), { y0, y1 } = WIN, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  panel(g, S.sky, x1 - x0, y1 - y0, xm, ym, .012);
  boxAt(g, frame, x0 - .08, y0 - .1, 0, x1 + .08, y0, .14); boxAt(g, frame, x0 - .08, y1, 0, x1 + .08, y1 + .07, .06);
  boxAt(g, frame, x0 - .08, y0, 0, x0, y1, .06); boxAt(g, frame, x1, y0, 0, x1 + .08, y1, .06);
  boxAt(g, frame, xm - .03, y0, 0, xm + .03, y1, .05, 0); boxAt(g, frame, x0, ym - .03, 0, x1, ym + .03, .05, 0);
}

function buildShell() {
  const g = room, unit = geo('unit', () => new THREE.PlaneGeometry(1, 1));
  floorT = canvasTex(128, 128);
  floorT.t.wrapS = floorT.t.wrapT = THREE.RepeatWrapping; floorT.t.anisotropy = 8;
  T.floor = new THREE.MeshLambertMaterial({ map: floorT.t });
  for (const k of ['wall', 'wain', 'ceil', 'rail', 'beam', 'skirt', 'plat']) T[k] = new THREE.MeshLambertMaterial();
  S.floor = mesh(g, unit, T.floor, 0, 0, 0, 2); S.floor.rotation.x = -PI / 2;
  S.ceil = mesh(g, unit, T.ceil); S.ceil.rotation.x = PI / 2;
  S.back = mesh(g, unit, T.wall, 0, 0, 0, 2); S.backW = mesh(g, unit, T.wain, 0, 0, .004, 2);
  S.sides = [-1, 1].map(s => {
    const w = mesh(g, unit, T.wall, 0, 0, 0, 2), wa = mesh(g, unit, T.wain, 0, 0, 0, 2);
    w.rotation.y = wa.rotation.y = -s * PI / 2;
    return { s, w, wa, rail: boxAt(g, T.rail, -.025, -.02, -.5, .025, .02, .5, 0), skirt: boxAt(g, T.skirt, -.015, 0, -.5, .015, .1, .5, 2) };
  });
  S.rail = boxAt(g, T.rail, -.5, -.02, 0, .5, .02, .05, 0);
  S.skirt = boxAt(g, T.skirt, -.5, 0, 0, .5, .1, .03, 2);
  S.beams = Array.from({ length: 10 }, () => boxAt(g, T.beam, -.5, -.11, -.13, .5, .11, .13, 0));
  // a door in the right wall: newcomers walk in through it
  S.door = new THREE.Group(); g.add(S.door);
  boxAt(S.door, lam('#e9e3d6'), -.06, 0, -.68, 0, 2.18, .68, 2); boxAt(S.door, lam('#c08a55'), -.09, 0, -.58, -.05, 2.08, .58, 2);
  mesh(S.door, SPH(.04, 8, 6), sharedMats().metal, -.12, 1.0, .42);
}
// Stretch the shell so the camera is always inside it: then every ray hits floor, wall or ceiling, at any aspect ratio.
function sizeShell() {
  const { hw, hc, dz } = shell;
  S.floor.scale.set(2 * hw, dz, 1); S.floor.position.set(0, 0, dz / 2); floorT.t.repeat.set(hw, dz / 2);
  S.ceil.scale.set(2 * hw, dz, 1); S.ceil.position.set(0, hc, dz / 2);
  S.back.scale.set(2 * hw, hc, 1); S.back.position.set(0, hc / 2, 0);
  S.backW.scale.set(2 * hw, WAIN, 1); S.backW.position.y = WAIN / 2;
  S.rail.scale.x = S.skirt.scale.x = 2 * hw; S.rail.position.y = WAIN;
  for (const { s, w, wa, rail, skirt } of S.sides) {
    w.scale.set(dz, hc, 1); w.position.set(s * hw, hc / 2, dz / 2);
    wa.scale.set(dz, WAIN, 1); wa.position.set(s * (hw - .004), WAIN / 2, dz / 2);
    rail.scale.z = skirt.scale.z = dz; rail.position.set(s * (hw - .025), WAIN, dz / 2); skirt.position.set(s * (hw - .015), .05, dz / 2);
  }
  S.beams.forEach((b, k) => { const z = 1.5 + k * 3.2; b.visible = z < dz - .3; b.scale.x = 2 * hw; b.position.set(0, hc - .11, z); });
  S.door.position.set(hw, 0, CY);
  // hanging lamps: shades just below eye height so they dip into the top of the frame; cords run up to the ceiling
  const y = clamp(fit ? fit.pos.y - .75 : 3.2, 2.9, hc - .6);
  for (const r of rigs) {
    r.g.position.set(r.x, y, r.z);
    const len = Math.max(.05, hc - y - .13);
    r.cord.scale.y = len; r.cord.position.y = .13 + len / 2;
  }
}

function buildRoom() {
  const M = sharedMats(), g = room;
  skyT = canvasTex(208, 132);
  S.sky = new THREE.MeshBasicMaterial({ map: skyT.t, fog: false });
  buildShell();
  for (const c of LIQ) liqMats.push(new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: .8 }));

  // back wall: windows, the mission board with the whiteboard and the guidance board under it, shelves, clock, signs
  windowAt(g, WIN.x0, WIN.x1); windowAt(g, -WIN.x1, -WIN.x0);
  const mb = objGroup('board');
  scrT = canvasTex(1024, 400);
  boxAt(mb, M.ink, -2.2, 1.98, 0, 2.2, 3.72, .07, 2);
  panel(mb, new THREE.MeshBasicMaterial({ map: scrT.t, fog: false }), 4.24, 1.66, 0, 2.85, .072);
  wbT = canvasTex(256, 123);
  boxAt(g, lam('#9aa3b2'), -2.32, .84, 0, -.22, 1.86, .03, 2);
  panel(g, new THREE.MeshBasicMaterial({ map: wbT.t }), 1.98, .95, -1.27, 1.35, .032);
  boxAt(g, lam('#9aa3b2'), -1.8, .8, 0, -.7, .83, .08);
  drawMission([], 'all quiet'); drawBoard(WB.length);
  // the guidance board mirrors the whiteboard: a cork board with the boss's standing guidance pinned as notes
  const gb = objGroup('guidance');
  guideT = canvasTex(512, 256);
  boxAt(gb, lam('#8a5a32'), .22, .84, 0, 2.32, 1.86, .03, 2);
  panel(gb, new THREE.MeshLambertMaterial({ map: guideT.t }), 1.98, .95, GUIDE_AT[0], GUIDE_AT[1], .032);
  boxAt(gb, lam('#8a5a32'), .7, .8, 0, 1.8, .83, .08);
  drawGuide([]);
  for (const y of [1.2, 1.7]) boxAt(g, M.shelf, -4.35, y - .035, 0, -2.9, y, .26);
  flask(g, -4.1, 1.2, .13, 'e', 1); flask(g, -3.6, 1.2, .13, 'r', 0); flask(g, -3.1, 1.2, .13, 't', 2);
  flask(g, -4.0, 1.7, .13, 'r', 4); flask(g, -3.3, 1.7, .13, 'e', 3);
  // linked context: the bookshelf, with a plate that counts the linked folders
  const bs = objGroup('context');
  boxAt(bs, M.shelf, 2.9, 1.465, 0, 4.7, 1.5, .26); boxAt(bs, M.shelf, 2.9, 1.0, 0, 4.7, 1.035, .26);
  [['#d64545', 3.0, .3], ['#2f5ea8', 3.1, .34], ['#2e9e5b', 3.2, .26], ['#f08c00', 3.3, .32], ['#b04fd0', 3.4, .28]].forEach(([c, x, h]) => boxAt(bs, lam(c), x, 1.5, .05, x + .08, 1.5 + h, .22));
  [['#0f9db0', 3.05, .3], ['#ffd84d', 3.15, .26], ['#d64545', 3.25, .34], ['#2f5ea8', 3.6, .28], ['#2e9e5b', 3.7, .32], ['#f08c00', 3.8, .25]].forEach(([c, x, h]) => boxAt(bs, lam(c), x, 1.035, .05, x + .08, 1.035 + h, .22));
  plant(bs, 4.3, .13, .45, 1.5);
  ctxT = canvasTex(256, 56);
  panel(bs, texMat(ctxT.t, .25), 1.2, .26, 4.1, 1.2, .012);
  drawCtx(0);
  // deliverables: a filing cabinet under the bookshelf, a drawer pulled out with folders, and a plate that counts the files
  const fc = objGroup('files'), steelB = lam("#7d8a99"), drw = lam('#9aa6b5');
  boxAt(fc, steelB, 3.0, 0, 0, 4.6, .86, .5);
  for (const x of [3.04, 3.82]) {
    boxAt(fc, drw, x, .05, .5, x + .74, .33, .52, 0);
    boxAt(fc, M.metal, x + .27, .2, .52, x + .47, .23, .55, 0);
    boxAt(fc, M.paper, x + .3, .26, .52, x + .44, .3, .525, 0);
  }
  boxAt(fc, drw, 3.04, .36, .5, 3.78, .63, .52, 0); boxAt(fc, M.metal, 3.31, .5, .52, 3.51, .53, .55, 0);
  boxAt(fc, drw, 3.82, .36, .5, 4.56, .63, .66); boxAt(fc, M.metal, 4.09, .5, .66, 4.29, .53, .69, 0); // pulled out
  ['#ffd84d', '#5fd38a', '#4fb3ff', '#ff7aa8'].forEach((c, i) => boxAt(fc, lam(c), 3.9 + i * .16, .6, .53, 4.02 + i * .16, .68 + (i % 2) * .02, .62, 0));
  filesT = canvasTex(256, 40);
  panel(fc, texMat(filesT.t, .25), 1.1, .15, 3.8, .78, .502);
  drawFiles(0);
  // the live log: a wall screen with the newest lines
  const lg = objGroup('log');
  logT = canvasTex(384, 240);
  boxAt(lg, M.ink, 3.0, 1.95, 0, 4.62, 2.98, .06, 2);
  panel(lg, new THREE.MeshBasicMaterial({ map: logT.t, fog: false }), 1.54, .95, 3.81, 2.465, .062);
  drawLog();
  // needs you: a sign that glows and counts when something waits for the human
  const nd = objGroup('needs');
  needsT = canvasTex(256, 150);
  needsMat = new THREE.MeshBasicMaterial({ map: needsT.t, fog: false });
  boxAt(nd, M.ink, -3.45, 2.7, 0, -2.3, 3.4, .05, 2);
  panel(nd, needsMat, 1.07, .62, -2.875, 3.05, .052);
  drawNeeds(0);
  // the wall clock by the boss: real local time, the hands move every frame (animateRoom)
  const clock = objGroup('schedules'), CR = .3; // click the clock (or its plate) for Schedules
  clock.position.set(-3.95, 2.6, .02); clockG = clock;
  plateT = canvasTex(528, 64);
  panel(clock, texMat(plateT.t, .2), 1.12, .136, 0, -.43, .01);
  plate.text = ''; // drawn on the first update
  mesh(clock, CYL(CR, CR, .04, 32), lam('#fffdf5'), 0, 0, .02).rotation.x = PI / 2;
  mesh(clock, geo('rim3', () => new THREE.TorusGeometry(CR, .026, 6, 32)), M.ink, 0, 0, .04);
  for (let i = 0; i < 12; i++) { // hour marks, longer at 12, 3, 6 and 9
    const m = new THREE.Group(); m.position.z = .042; m.rotation.z = -i / 12 * PI * 2; clock.add(m);
    const big = i % 3 === 0;
    boxAt(m, M.ink, big ? -.011 : -.006, CR - (big ? .075 : .05), 0, big ? .011 : .006, CR - .028, .003, 0);
  }
  clockHands = ['#3b3946', '#3b3946', '#d64545'].map((c, i) => {
    const h = new THREE.Group(); h.position.z = .046 + i * .004; clock.add(h);
    boxAt(h, lam(c), -.011 + i * .004, -.03, 0, .011 - i * .004, [.15, .22, .25][i], .004, 0);
    return h;
  });
  mesh(clock, CYL(.018, .018, .02, 12), lam('#d64545'), 0, 0, .06).rotation.x = PI / 2;

  // boss platform (back centre): desk facing the room, chair, desk lamp, a plant
  boxAt(g, T.plat, -PLAT.x, 0, 0, PLAT.x, PLAT.h, PLAT.z1);
  const h = PLAT.h, top = h + .55;
  boxAt(g, lam('#fff0b8'), -.9, top - .05, 1.35, .9, top, 2.05);
  boxAt(g, lam('#e6cf86'), -.87, h, 1.38, -.8, top - .05, 2.02); boxAt(g, lam('#e6cf86'), .8, h, 1.38, .87, top - .05, 2.02);
  boxAt(g, lam('#e6cf86'), -.8, h + .12, 1.95, .8, top - .05, 2.0);
  panel(g, texMat(staticTex(128, 40, (x, w, hh) => {
    x.fillStyle = '#3b3946'; x.fillRect(0, 0, w, hh); x.fillStyle = '#ffd84d'; x.font = `800 26px ${FONT}`; x.textAlign = 'center'; x.fillText('BOSS', w / 2, 30);
  })), .5, .16, 0, top - .2, 2.004);
  boxAt(g, M.laptop, -.6, top, 1.5, -.15, top + .02, 1.8);
  const lid = boxAt(g, M.laptop, -.6, top, 1.8, -.15, top + .28, 1.82); lid.rotation.x = .25;
  mesh(g, figGeo().nana, M.nana, .2, top + .03, 1.75).rotation.x = -PI / 2;
  mesh(g, CYL(.06, .08, .03, 10), M.ink, .6, top + .015, 1.55);
  mesh(g, CYL(.012, .012, .3, 6), M.ink, .6, top + .17, 1.55);
  const shade = lam('#ffe6b0', { emissive: '#ffb84d', emissiveIntensity: .6 });
  lampShades.push(shade);
  mesh(g, CYL(.06, .11, .12, 12), shade, .6, top + .34, 1.55);
  chair(g, BOSS_SEAT[0], BOSS_SEAT[1], PLAT.h, 0, true);
  // the job box at the front of the platform: post a new job here
  const jb = objGroup('compose');
  boxAt(jb, lam('#d64545'), -2.3, h, 2.05, -1.8, h + .72, 2.5);
  boxAt(jb, lam('#a83232'), -2.34, h + .72, 2.01, -1.76, h + .78, 2.54);
  boxAt(jb, M.ink, -2.2, h + .58, 2.5, -1.9, h + .61, 2.505, 0);
  panel(jb, texMat(staticTex(128, 64, (x, w, hh) => {
    x.fillStyle = '#fff4dc'; x.fillRect(0, 0, w, hh); x.fillStyle = '#d64545'; x.font = `800 22px ${FONT}`; x.textAlign = 'center';
    x.fillText('NEW JOB', w / 2, 28); x.font = `800 26px ${FONT}`; x.fillText('＋', w / 2, 56);
  }), .2), .4, .2, -2.05, h + .36, 2.506);

  // snack nook (left): coffee counter under the window, vending machine, bistro table
  boxAt(g, lam('#c08a55'), -8.7, 0, .05, -6.3, .52, .7); boxAt(g, lam('#e9e3d6'), -8.75, .52, .02, -6.25, .56, .74);
  boxAt(g, M.metal, -7.8, .56, .1, -7.2, 1.05, .5);
  boxAt(g, M.ink, -7.72, .95, .5, -7.28, 1.0, .51, 0);
  mesh(g, CYL(.036, .03, .08, 10), M.white, CUP[0], CUP[1], CUP[2], 1);
  mesh(g, CYL(.14, .09, .05, 12), M.metal, -8.3, .59, .4);
  for (let i = 0; i < 3; i++) mesh(g, figGeo().nana, M.nana, -8.35 + i * .05, .64, .4).rotation.set(-PI / 2, 0, i);
  // the NR office (Nimion Resources): a door in the back wall
  const mr = objGroup('mr');
  boxAt(mr, lam('#e9e3d6'), -5.74, 0, 0, -4.46, 2.32, .07, 2);
  const leaf = new THREE.Group(); leaf.position.set(-5.62, 0, .07); mr.add(leaf); S.mrLeaf = leaf;
  boxAt(leaf, lam('#5d7fbf'), 0, 0, 0, 1.04, 2.18, .05, 3);
  boxAt(leaf, lam('#4a6aa8'), .14, 1.2, .05, .9, 1.95, .056, 0);
  mesh(leaf, SPH(.045, 8, 6), M.metal, .9, 1.0, .09);
  panel(leaf, texMat(staticTex(128, 128, (x, w, hh) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, hh); x.fillStyle = '#2b2a33'; x.font = `900 64px ${FONT}`; x.textAlign = 'center'; x.fillText('NR', w / 2, 74);
    x.font = `700 15px ${FONT}`; x.fillText('NIMION', w / 2, 98); x.fillText('RESOURCES', w / 2, 116);
  })), .5, .5, .52, 1.57, .058);
  // the vending machine, now in the right corner beside the arcade
  boxAt(g, lam('#ffd84d'), 8.4, 0, .05, 9.4, 1.55, .8);
  boxAt(g, M.ink, 8.4, 1.55, .05, 9.4, 1.61, .8);
  panel(g, texMat(staticTex(96, 138, (x, w, hh) => {
    x.fillStyle = '#3b3946'; x.fillRect(0, 0, w, hh); x.fillStyle = '#ffd84d'; x.font = `800 15px ${FONT}`; x.textAlign = 'center'; x.fillText('BANANAS', w / 2, 18);
    x.fillStyle = '#bfe3ff'; x.fillRect(6, 26, 64, 98);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) banana(x, 22 + c * 30, 40 + r * 23, 1.3, 0);
    x.fillStyle = '#9aa3b2'; x.fillRect(76, 30, 14, 34); x.fillStyle = '#2b2a33'; x.fillRect(10, 128, 76, 7);
  }), .15), .8, 1.15, 8.9, .84, .805);
  mesh(g, CYL(.42, .42, .04, 20), lam('#fff4dc'), -7.0, .62, 2.35, 3);
  mesh(g, CYL(.035, .035, .6, 8), M.ink, -7.0, .31, 2.35, 1);
  mesh(g, CYL(.22, .25, .03, 14), M.ink, -7.0, .015, 2.35, 2);
  mesh(g, CYL(.05, .045, .1, 10), lam('#e0447a'), -6.85, .69, 2.3, 1);
  const dot = softDot();
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    s.scale.setScalar(.12); s.position.set(CUP[0], .7, CUP[2]); fxGroup.add(s); steam.push(s);
  }
  plant(g, -9.0, 3.3, 1.2);

  // play corner (right): rug, couch, floor lamp, server rack, bouncing ball
  rugT = canvasTex(260, 190);
  mesh(g, new THREE.PlaneGeometry(4.4, 3.2), new THREE.MeshLambertMaterial({ map: rugT.t }), 7.15, .006, 1.95, 2).rotation.x = -PI / 2;
  const ar = objGroup('arcade');
  GAMES3.forEach(([name, col], i) => cabinet(ar, 6.25 + i * .8, name, col));
  mesh(g, CYL(.16, .18, .03, 12), M.ink, 5.5, .015, .5, 3);
  mesh(g, CYL(.015, .015, 1.3, 6), M.ink, 5.5, .66, .5, 1);
  const fshade = lam('#fff2d6', { emissive: '#ffb84d', emissiveIntensity: .6 });
  lampShades.push(fshade);
  mesh(g, CYL(.12, .2, .22, 14), fshade, 5.5, 1.38, .5, 1);
  cornerBall = mesh(g, SPH(.17, 16, 12), M.ball, 8.7, .17, 2.9, 1);
  plant(g, 9.0, 3.6, 1.2);

  // hanging lamps over the pods and the corners; four of them really light the room
  for (const [x, z, on] of [[-7.2, 1.9, 1], [-3.6, 6.0, 1], [0, 6.4, 0], [3.6, 6.0, 1], [7.2, 1.9, 1]]) {
    const r = { x, z, g: new THREE.Group() }, sh = lam('#ffe3a8', { emissive: '#ffb04d', emissiveIntensity: .7, side: THREE.DoubleSide });
    lampShades.push(sh);
    mesh(r.g, geo('lampShade', () => new THREE.CylinderGeometry(.1, .3, .26, 16, 1, true)), sh, 0, 0, 0);
    mesh(r.g, SPH(.07, 10, 8), basic('#fff6dc'), 0, -.08, 0);
    r.cord = mesh(r.g, CYL(.008, .008, 1, 4), M.ink);
    scene.add(r.g); rigs.push(r);
    if (on) lamps.push(lamp('#ffb35c', 2.6, x, 2.9, z, 9));
  }

  // the sunbeam through the left window: a faint additive volume, a floor patch, and dust motes
  beamDir = new THREE.Vector3(.28, -.78, .56).normalize();
  const win = [[WIN.x0, WIN.y0], [WIN.x1, WIN.y0], [WIN.x1, WIN.y1], [WIN.x0, WIN.y1]].map(([x, y]) => new THREE.Vector3(x, y, .03));
  const hit = win.map(p => p.clone().addScaledVector(beamDir, p.y / -beamDir.y));
  const pos = [], quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(win[i].toArray(), win[j].toArray(), hit[j].toArray(), hit[i].toArray()); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  beamMat = new THREE.MeshBasicMaterial({ color: '#fff1c9', transparent: true, opacity: .07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  fxGroup.add(new THREE.Mesh(bg, beamMat));
  const pg = new THREE.BufferGeometry(), hp = hit.map(p => [p.x, .008, p.z]);
  pg.setAttribute('position', new THREE.Float32BufferAttribute([...hp[0], ...hp[2], ...hp[1], ...hp[0], ...hp[3], ...hp[2]], 3));
  patchMat = new THREE.MeshBasicMaterial({ color: '#fff1c9', transparent: true, opacity: .12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  fxGroup.add(new THREE.Mesh(pg, patchMat));
  const n = 40, dp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) dustSrc.push([Math.random(), Math.random(), Math.random(), rand(.02, .06)]);
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: .05, map: dot, color: '#fff3d0', transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false;
  fxGroup.add(dust);
  // bubbles rising in the flasks: one instanced mesh for all of them
  bubbles = new THREE.InstancedMesh(SPH(.012, 6, 4), basic('#ffffff', { transparent: true, opacity: .8 }), bubbleSrc.length * 2);
  bubbles.frustumCulled = false;
  fxGroup.add(bubbles);
  buildForeground();
  buildConfetti();
  buildPlay();
  fitHits();
}
function lamp(color, base, x, y, z, dist) {
  const l = new THREE.PointLight(color, base, dist, 1.3);
  l.position.set(x, y, z); l.userData.base = base;
  scene.add(l);
  return l;
}
// Foreground depth cues near the camera, half cropped by the frame: a big plant (left) and a counter corner with a mug (right).
function buildForeground() {
  const M = sharedMats(), p = new THREE.Group(), c = new THREE.Group();
  mesh(p, CYL(.34, .26, .6, 14), lam('#c96f4a'), 0, .3, 0, 1);
  const leaves = new THREE.Group(); leaves.position.y = .58; p.add(leaves);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * PI * 2, l = mesh(leaves, SPH(.2, 8, 6), lam(i % 2 ? '#4caf6a' : '#2f8a4c'), Math.cos(a) * .2, .45 + (i % 3) * .2, Math.sin(a) * .2);
    l.scale.set(.6, 2.3, .6); l.rotation.set(Math.sin(a) * .6, 0, -Math.cos(a) * .6);
  }
  plants.push({ g: leaves, ph: 7 });
  boxAt(c, lam('#c08a55'), -.9, 0, -.5, .9, .95, .5, 0); boxAt(c, lam('#e9e3d6'), -.95, .95, -.55, .95, 1.0, .55, 0);
  mesh(c, CYL(.07, .06, .15, 12), lam('#2f5ea8'), .1, 1.075, .1);
  mesh(c, geo('mugH', () => new THREE.TorusGeometry(.045, .012, 6, 10)), lam('#2f5ea8'), .18, 1.08, .1);
  mesh(c, CYL(.12, .12, .03, 12), M.ink, -.35, 1.015, -.1);
  fg = [{ g: p, ndc: -.98, r: .75, h: 1.9 }, { g: c, ndc: .98, r: 1.1, h: 1.2 }];
  for (const f of fg) scene.add(f.g);
}

function buildLights() {
  hemi = new THREE.HemisphereLight('#fff4e0', '#b8a27a', 1.2);
  scene.add(hemi);
  sun = new THREE.DirectionalLight('#fff3dc', 2.4);
  sun.castShadow = true;
  const s = (wrap.clientWidth || 800) > 700 ? 2048 : 1024;
  sun.shadow.mapSize.set(s, s);
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  scene.add(sun, sun.target);
  fill = new THREE.DirectionalLight('#fff2dd', .55); // soft light from the viewer's side, so faces are not lost against the window
  fill.position.set(2, 7, 30); fill.target.position.set(0, 1, 3);
  scene.add(fill, fill.target);
  aimSun();
}
// Tight shadow camera around the activity area, seen from the sun.
function aimSun() {
  sun.target.position.set(0, 0, front / 2);
  sun.position.copy(sun.target.position).addScaledVector(beamDir, -25);
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position); cam.lookAt(sun.target.position); cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse, b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const x of [-SIDE - .6, SIDE + .6]) for (const y of [0, 3.7]) for (const z of [-.2, front + .8]) {
    _v.set(x, y, z).applyMatrix4(inv);
    b[0] = Math.min(b[0], _v.x); b[1] = Math.max(b[1], _v.x); b[2] = Math.min(b[2], _v.y); b[3] = Math.max(b[3], _v.y); b[4] = Math.min(b[4], _v.z); b[5] = Math.max(b[5], _v.z);
  }
  Object.assign(cam, { left: b[0] - .3, right: b[1] + .3, bottom: b[2] - .3, top: b[3] + .3, near: Math.max(.1, -b[5] - 1), far: -b[4] + 1 });
  cam.updateProjectionMatrix();
}

// ---------- 6. theme and day/night ----------
function readTheme() {
  const cs = getComputedStyle(root);
  const v = (n, fb) => { const s = cs.getPropertyValue(n).trim(); return /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(s) ? s : fb; };
  theme = { bg: v('--bg', '#fff8e1'), card: v('--card', '#ffffff'), ink: v('--ink', '#2b2a33'), line: v('--line', '#f0e4bb'), yellow: v('--yellow', '#ffd84d'),
    yellowD: v('--yellow-d', '#d9a900'), denim: v('--denim', '#2f5ea8'), floor: v('--floor', '#f3e2a4'), sky: v('--sky', '#fdf0c2') };
  const c = new THREE.Color(theme.bg);
  theme.dark = c.r * .2126 + c.g * .7152 + c.b * .0722 < .2;
}
function applyTheme() {
  readTheme();
  drawFloor(); drawRug(); drawPlate();
  const d = theme.dark;
  T.wall.color.set(d ? hex(theme.sky, '#a8a2c0', .3) : hex(theme.sky, theme.card, .35));
  T.wain.color.set(d ? hex(theme.sky, '#000000', .15) : hex(theme.floor, theme.ink, .1));
  T.ceil.color.set(d ? hex(theme.sky, '#000000', .3) : hex(theme.sky, '#ffffff', .4));
  T.rail.color.set(d ? '#5a4a3a' : '#c9a26b'); T.beam.color.set(d ? '#4a3d32' : '#c9a26b');
  T.skirt.color.set(hex(theme.floor, theme.ink, .35));
  T.plat.color.set(hex(theme.yellowD, theme.floor, .62));
  scene.fog.color.set(d ? hex(theme.bg, '#3a3550', .4) : hex(theme.sky, '#ffffff', .3));
  dayKey = '';
  applyLight();
}
// 0 at night, 1 by mid-morning; warm near sunrise and sunset. From the user's local clock, or forced by Lab.sky('day'|'night').
let skyMode = 'auto';
function daylight() {
  const d = new Date(), h = skyMode === 'day' ? 12 : skyMode === 'night' ? 0 : d.getHours() + d.getMinutes() / 60, s = Math.sin((h - 6) / 12 * PI);
  const day = clamp((s + .1) / .45, 0, 1);
  return { h, day, warm: day > 0 ? 1 - clamp((s - .1) / .4, 0, 1) : 0 };
}
// The time of day comes from the clock in both themes; dark mode only darkens the room's materials and caps the brightness a little.
function applyLight() {
  const { h, day, warm } = daylight(), night = 1 - day, cap = theme.dark ? .72 : 1, lampK = clamp((.75 - day) / .55, 0, 1); // lamps come on at dusk
  const key = `${day.toFixed(2)}${warm.toFixed(2)}${Math.round(h * 6)}${cap}`;
  if (key === dayKey) return;
  dayKey = key;
  sun.color.set('#fff3dc').lerp(_c.set('#ffb070'), warm * .8).lerp(_c.set('#9db4ff'), night);
  sun.intensity = (.45 + 2.1 * day) * cap;
  hemi.intensity = (.8 + .6 * day) * cap;
  hemi.color.set('#fff4e0').lerp(_c.set('#8090c8'), night);
  hemi.groundColor.set('#b8a27a').lerp(_c.set('#3a3346'), night);
  fill.intensity = (.3 + .35 * day) * cap;
  for (const l of lamps) l.intensity = l.userData.base * (.15 + 2.35 * lampK);
  for (const s of lampShades) s.emissiveIntensity = .12 + 1.8 * lampK;
  glowK = .55 + .7 * night;
  screenK = .82 + .18 * night;
  for (const st of stations.values()) styleStation(st);
  beamMat.color.copy(sun.color); patchMat.color.copy(sun.color);
  beamMat.opacity = .01 + .075 * day; patchMat.opacity = .015 + .145 * day;
  dust.material.opacity = .1 + .65 * day;
  drawSky(day, warm, h);
}

// ---------- 7. desk pods: pairs face each other across a shared table ----------
const LINES = [12, 8, 15, 6, 10, 13];
const seatYaw = s => Math.atan2(-s * Math.cos(.3), Math.sin(.3)); // face the partner, turned a little toward the viewer
// One seat of a pod, in pod coordinates; s = -1 is the left seat, +1 the right one. Each seat brings its half of the table.
function makeStation(name, s) {
  const M = sharedMats(), g = new THREE.Group(), a = 34 * DEG;
  boxAt(g, M.desk, 0, .46, -.5, s * .62, .5, .5);
  boxAt(g, M.deskLeg, s * .56, 0, -.46, s * .62, .46, .46);
  if (s < 0) boxAt(g, M.deskLeg, -.025, .12, -.44, .025, .46, .44);
  // the monitor faces its owner, angled toward the viewer so the screen can be glimpsed
  const mon = new THREE.Group();
  mon.position.set(s * .2, .5, -.05); mon.rotation.y = Math.atan2(s * Math.cos(a), Math.sin(a)); g.add(mon);
  boxAt(mon, M.ink, -.12, 0, -.09, .12, .015, .05);
  boxAt(mon, M.ink, -.025, 0, -.07, .025, .16, -.04);
  boxAt(mon, M.ink, -.3, .13, -.05, .3, .48, -.01);
  const scr = canvasTex(256, 144), onMat = new THREE.MeshBasicMaterial({ map: scr.t });
  const screen = panel(mon, M.screenOff, .55, .31, 0, .305, -.004);
  boxAt(g, M.kb, s * .36, .5, -.22, s * .52, .518, .14);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#2f5ea8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = mesh(g, geo('glow', () => new THREE.PlaneGeometry(.62, .8)), glowMat, s * .3, .503, -.05);
  glow.rotation.x = -PI / 2; glow.visible = false;
  const label = canvasTex(128, 32);
  label.x.fillStyle = '#3b3946'; label.x.fillRect(0, 0, 128, 32);
  label.x.fillStyle = '#ffffff'; label.x.font = `700 20px ${FONT}`; label.x.textAlign = 'center'; label.x.textBaseline = 'middle';
  label.x.fillText(name.slice(0, 10), 64, 17);
  label.t.needsUpdate = true;
  const labelMat = new THREE.MeshLambertMaterial({ map: label.t });
  boxAt(g, M.ink, s * .2, .5, .36, s * .54, .58, .39, 0);
  panel(g, labelMat, .32, .07, s * .37, .54, .3905);
  chair(g, s, -.1, 0, seatYaw(s), false);
  // the in-tray at the front of the desk: a paper pile, one sheet per queued job (capped), and a count
  const tray = new THREE.Group(); tray.position.set(s * PILE_X, .5, PILE_Z); g.add(tray);
  boxAt(tray, M.ink, -.16, 0, -.12, .16, .02, .12);
  const papers = Array.from({ length: PILE }, (_, i) => { const p = mesh(tray, BOX(.28, .034, .21), i % 2 ? M.cream : M.paper); p.rotation.y = ((i * 7) % 5 - 2) * .07; p.visible = false; return p; });
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(64, 64).t, depthTest: false, transparent: true }));
  badge.scale.setScalar(.2); badge.position.set(0, .2, 0); badge.visible = false; badge.renderOrder = 5; tray.add(badge);
  const alarm = new THREE.Group(); alarm.position.set(s * .5, .5, .25); alarm.visible = false; g.add(alarm); // shown while this nimion has a schedule
  mesh(alarm, CYL(.05, .05, .035, 16), lam('#d64545'), 0, .06, 0).rotation.x = PI / 2;
  mesh(alarm, CYL(.038, .038, .006, 16), lam('#fffdf5'), 0, .06, .019).rotation.x = PI / 2;
  for (const k of [-1, 1]) mesh(alarm, CYL(.018, .018, .012, 10), lam('#d64545'), k * .032, .108, 0).rotation.z = k * .6;
  for (const k of [-1, 1]) boxAt(alarm, M.ink, k * .03 - .006, 0, -.006, k * .03 + .006, .03, .006, 0);
  g.traverse(o => { if (o.isMesh && o !== glow && o !== screen) { o.castShadow = true; o.receiveShadow = true; } });
  const hit = mesh(g, BOX(1.0, 1.1, 1.3), M.hit, s * .45, .55, -.05);
  hit.visible = false;
  const o = { id: 'desk:' + name, icon: '🖥️', label: `${name}'s desk`, group: g, hit };
  hit.userData.obj = o; hitList.push(hit);
  room.add(g);
  return { name, side: s, g, screen, scr, onMat, glow, glowMat, label, labelMat, alarm, on: false, tint: '#2f5ea8', next: 0, off: 0, gen, papers, badge, hit, job: null, queued: -1, jsig: '', lv: 0, goal: 0 };
}
function styleStation(st) {
  st.onMat.color.setScalar(screenK);
  st.glowMat.color.set(st.tint);
  st.glowMat.opacity = .32 * glowK;
}
// The monitor shows the job: its title while working, the question while it needs you, the next job while it waits.
function drawMonitor(st) {
  const { c, x } = st.scr, W = c.width, H = c.height, j = st.job || {}, lh = 9;
  x.fillStyle = j.kind === 'needs' ? '#7a4a00' : hex(st.tint, '#12121a', .78); x.fillRect(0, 0, W, H);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillStyle = j.kind === 'needs' ? '#ffd27a' : st.tint; x.font = `800 17px ${FONT}`;
  x.fillText(fitText(x, j.kind === 'needs' ? '✋ needs you' : j.kind === 'queued' ? `next up · #${j.id}` : j.kind === 'paused' ? 'zzz · paused' : j.kind === 'sched' ? '⏰ scheduled' : `#${j.id} · working`, W - 20), 10, 22);
  x.fillStyle = '#ffffff'; x.font = `700 21px ${FONT}`;
  wrapText(x, j.title, W - 20, 3).forEach((l, i) => x.fillText(l, 10, 50 + i * 25));
  if (j.kind === 'working') {
    x.fillStyle = st.tint;
    for (let i = 0; i < 3; i++) x.fillRect(10 + (i === 1 ? 14 : 0), 124 + ((i * lh - st.off * 2) % (lh * 3) + lh * 3) % (lh * 3) - 6, LINES[(i + Math.floor(st.off / 3)) % 6] * 9, 4);
  }
  st.scr.t.needsUpdate = true;
}
function setStationOn(st, on) {
  st.on = on;
  st.screen.material = on ? st.onMat : sharedMats().screenOff;
  st.glow.visible = on && st.job && st.job.kind === 'working';
  if (on) drawMonitor(st);
}
function setTray(st, n, snap) {
  if (n === st.queued) return;
  st.queued = n; st.goal = Math.min(n, PILE);
  if (snap) { st.lv = st.goal; pile(st); }
  st.badge.visible = n > 0;
  if (n > 0) {
    const t = st.badge.material.map, cv = t.image, x = cv.getContext('2d');
    x.clearRect(0, 0, 64, 64); x.fillStyle = '#d64545'; x.beginPath(); x.arc(32, 32, 28, 0, PI * 2); x.fill();
    x.fillStyle = '#ffffff'; x.font = `900 34px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 32, 34);
    t.needsUpdate = true;
  }
}
// Sheets below the level lie on the pile; the top one is part-way: dropping in (growing) or lifting off (shrinking).
function pile(st) {
  st.papers.forEach((p, i) => {
    const k = clamp(st.lv - i, 0, 1);
    p.visible = k > 0;
    if (k > 0) p.position.set(0, .037 + i * .04 + (1 - k) * .35, 0);
  });
  st.badge.position.y = .22 + st.lv * .04;
}
function disposeStation(st) {
  room.remove(st.g);
  hitList.splice(hitList.indexOf(st.hit), 1);
  if (hoveredObj && hoveredObj.hit === st.hit) setHover(null);
  if (st.gen !== gen) return; // made before a context restore: its GL handles died with the old context
  st.scr.t.dispose(); st.onMat.dispose(); st.label.t.dispose(); st.labelMat.dispose(); st.glowMat.dispose(); st.badge.material.map.dispose(); st.badge.material.dispose();
}
// Pods across the width (up to 4), then a second row. Lanes run in the gaps between pod columns.
function layout(names) {
  const sig = names.join('\u0001');
  if (sig === layoutSig) return;
  layoutSig = sig;
  const n = names.length, pods = Math.max(1, Math.ceil(n / 2)), rows = pods <= 4 ? 1 : 2, cols = Math.ceil(pods / rows);
  const px = Math.min(4.2, 16.8 / cols), rowZ = rows === 1 ? [5.5] : [5.0, 7.4], off1 = Math.floor((cols - (pods - cols)) / 2);
  const xs = c => (c - (cols - 1) / 2) * px, want = new Map();
  gaps = Array.from({ length: cols + 1 }, (_, c) => xs(c) - px / 2);
  names.forEach((name, i) => {
    const p = Math.floor(i / 2), r = p < cols ? 0 : 1;
    want.set(name, { s: i % 2 ? 1 : -1, cx: xs(r ? p - cols + off1 : p), cz: rowZ[r] });
  });
  for (const [nm, st] of stations) { const w = want.get(nm); if (!w || w.s !== st.side) { disposeStation(st); stations.delete(nm); } }
  podX = 0; front = 4.2;
  for (const [name, w] of want) {
    const st = stations.get(name) || makeStation(name, w.s);
    Object.assign(st, { seat: [w.cx + w.s, w.cz - .1], yaw: seatYaw(w.s), stand: [w.cx + w.s * 1.05, w.cz + .9] });
    st.g.position.set(w.cx, 0, w.cz);
    stations.set(name, st);
    const m = mins.get(name);
    if (m) st.tint = m.tint;
    styleStation(st);
    podX = Math.max(podX, Math.abs(w.cx) + 1.4); front = Math.max(front, w.cz + 1.3);
  }
  for (const m of mins.values()) if (!m.boss && m.cur && !m.cur.sc && m.mode !== 'idle') endStep(m); // walk to the new desk
  needFit = true;
}
const lane = x => gaps.reduce((b, g) => Math.abs(g - x) < Math.abs(b - x) ? g : b, gaps[0]);

// ---------- 8. nimions: model and procedural animation ----------
// [where, group, x rotation, position]: 'head' sits on top of the head (group origin at TOP), 'body' on the front, A/B in a hand.
function buildProp(prop, one) {
  const M = sharedMats(), G = figGeo(), g = new THREE.Group(), cone = geo('cone4', () => new THREE.ConeGeometry(1, 1, 4));
  switch (prop) {
    case 'cap': {
      const red = lam('#d64545');
      mesh(g, G.hat, red, 0, .015, 0, 1);
      const visor = mesh(g, CYL(.17, .17, .014, 16), red, 0, .08, .2); visor.rotation.x = -.18; visor.scale.x = .85; // above the eyes
      mesh(g, SPH(.022, 8, 6), lam('#f4efe6'), 0, R + .035, 0);
      return ['head', g];
    }
    case 'beanie': {
      mesh(g, G.hat, lam('#0f9db0'), 0, .02, 0, 1).scale.y = 1.25;
      mesh(g, CYL(R + .03, R + .03, .07, 18), lam('#0b7a89'), 0, .03, 0);
      mesh(g, SPH(.06, 10, 8), lam('#f4efe6'), 0, (R + .025) * 1.25 + .05, 0, 1);
      return ['head', g];
    }
    case 'tophat': {
      const blk = lam('#26252c');
      mesh(g, CYL(.25, .25, .02, 20), blk, 0, .17, 0, 1);
      mesh(g, CYL(.15, .16, .3, 18), blk, 0, .33, 0, 1);
      mesh(g, CYL(.163, .168, .05, 18), lam('#d64545'), 0, .21, 0);
      return ['head', g];
    }
    case 'crown': {
      const gold = lam('#f5c542', { emissive: '#b8860b', emissiveIntensity: .25 });
      mesh(g, CYL(.16, .15, .09, 10), gold, 0, .19, 0, 1);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * PI * 2, c = mesh(g, cone, gold, Math.sin(a) * .15, .275, Math.cos(a) * .15);
        c.scale.set(.035, .08, .035);
        mesh(g, SPH(.018, 6, 4), i % 2 ? lam('#2f5ea8') : lam('#d64545'), Math.sin(a) * .162, .19, Math.cos(a) * .162);
      }
      return ['head', g];
    }
    case 'glasses': case 'sunglasses': {
      const sun = prop === 'sunglasses', fr = sun ? M.ink : lam('#8a5a32'), r = one ? .115 : .078, z = one ? .29 : .265;
      const lens = sun ? basic('#15151c', { transparent: true, opacity: .9 }) : M.glass, y = EYE_Y - TOP;
      for (const x of one ? [0] : [-.088, .088]) {
        mesh(g, geo('gRing' + r, () => new THREE.TorusGeometry(r, .012, 6, 18)), fr, x, y, z);
        mesh(g, geo('gLens' + r, () => new THREE.CircleGeometry(r, 18)), lens, x, y, z - .002);
      }
      if (!one) boxAt(g, fr, -.012, y + .01, z - .006, .012, y + .026, z + .006, 0);
      for (const s of [-1, 1]) boxAt(g, fr, s * (R + .012) - .006, y, -.05, s * (R + .012) + .006, y + .016, z - .03, 0);
      return ['head', g];
    }
    case 'headphones': {
      const c = lam('#b04fd0');
      mesh(g, G.headband, c, 0, 0, 0).scale.set(1.12, 1.2, 1.4);
      for (const s of [-1, 1]) {
        mesh(g, CYL(.085, .085, .07, 14), c, s * (R + .04), -.05, 0, 1).rotation.z = PI / 2;
        mesh(g, CYL(.06, .06, .08, 12), M.ink, s * (R + .03), -.05, 0).rotation.z = PI / 2;
      }
      return ['head', g];
    }
    case 'bowtie': {
      const red = lam('#d64545');
      for (const s of [-1, 1]) { const w = mesh(g, cone, red, s * .045, 0, 0); w.scale.set(.04, .075, .025); w.rotation.z = s * PI / 2; }
      mesh(g, SPH(.022, 8, 6), lam('#a83232'), 0, 0, .006);
      return ['body', g, 0, [0, .515, R + .02]];
    }
    case 'mug':
      mesh(g, CYL(.05, .045, .1, 12), lam('#2e9e5b'), 0, .05, 0);
      mesh(g, CYL(.043, .043, .004, 12), lam('#5a3d2b'), 0, .098, 0);
      mesh(g, geo('mugH', () => new THREE.TorusGeometry(.045, .012, 6, 10)), lam('#2e9e5b'), .055, .05, 0).scale.setScalar(.75);
      return ['B', g, 0, [0, -.2, .07]];
    case 'hammer':
      mesh(g, CYL(.014, .017, .22, 6), M.wood, 0, .11, 0);
      boxAt(g, M.steel, -.07, .2, -.024, .06, .25, .024, 1);
      return ['B', g, PI / 2];
    case 'book':
      boxAt(g, lam('#2f5ea8'), -.014, -.11, -.08, .014, .11, .08, 1); boxAt(g, M.white, .014, -.104, -.072, .018, .104, .078);
      boxAt(g, lam('#ffd84d'), -.016, .02, -.05, -.014, .06, .05, 0);
      return ['A', g, 0, [.06, -.2, .03]];
    case 'pencil': {
      mesh(g, CYL(.013, .013, .18, 6), lam('#ffcf33'), 0, .09, 0);
      const tip = mesh(g, cone, lam('#e8c49a'), 0, .2, 0); tip.scale.set(.013, .04, .013);
      mesh(g, CYL(.013, .013, .025, 6), lam('#ff8fa8'), 0, -.012, 0);
      return ['B', g, PI / 2];
    }
    case 'hat':
      mesh(g, G.hat, M.orange, 0, .015, 0, 1); mesh(g, CYL(R + .07, R + .07, .02, 18), M.orangeD, 0, .01, 0);
      mesh(g, geo('ridge', () => new THREE.TorusGeometry(R + .03, .022, 4, 14, PI)), lam('#ffa833'), 0, .015, 0).rotation.y = PI / 2;
      return ['head', g];
    case 'headset': {
      const b = mesh(g, G.headband, M.ink, 0, 0, 0);
      b.scale.y = 1.1;
      for (const s of [-1, 1]) mesh(g, CYL(.055, .055, .045, 12), M.ink, s * (R + .02), -.04, 0).rotation.z = PI / 2;
      mesh(g, CYL(.008, .008, .2, 4), M.ink, .14, -.17, .14).rotation.set(.9, 0, .5);
      mesh(g, SPH(.022, 8, 6), M.redLed, .07, -.22, .22);
      return ['head', g];
    }
    case 'wrench':
      boxAt(g, M.steel, -.016, 0, -.01, .016, .2, .01, 1); boxAt(g, M.steel, -.05, .19, -.01, -.01, .26, .01, 1); boxAt(g, M.steel, .01, .19, -.01, .05, .26, .01, 1);
      return ['B', g, PI / 2];
    case 'lens':
      mesh(g, CYL(.015, .015, .13, 6), M.wood, 0, .065, 0); mesh(g, geo('lensRing', () => new THREE.TorusGeometry(.06, .013, 6, 16)), M.ink, 0, .19, 0);
      mesh(g, geo('lensGlass', () => new THREE.CircleGeometry(.058, 16)), M.glass, 0, .19, 0);
      return ['B', g, PI / 2];
    case 'paintbrush':
      mesh(g, CYL(.012, .015, .18, 6), M.wood, 0, .09, 0); mesh(g, CYL(.018, .018, .035, 8), M.metal, 0, .195, 0); mesh(g, CYL(.002, .022, .07, 8), M.pink, 0, .245, 0).rotation.x = PI;
      return ['B', g, PI / 2];
    case 'flask':
      mesh(g, CYL(.022, .06, .1, 10), M.glass, 0, .06, 0); mesh(g, CYL(.019, .019, .05, 8), M.glass, 0, .13, 0); mesh(g, CYL(.04, .057, .04, 10), M.greenGlow, 0, .03, 0);
      return ['B', g, 0, [0, -.18, .07]];
    case 'clipboard':
      boxAt(g, M.wood, -.01, -.13, -.1, .01, .14, .1); boxAt(g, M.white, .01, -.1, -.08, .016, .11, .08); boxAt(g, M.ink, -.014, .11, -.03, .014, .15, .03);
      return ['A', g, 0, [.06, -.2, .03]];
    case 'laptop':
      boxAt(g, M.laptop, -.012, -.1, -.14, .012, .1, .14); boxAt(g, M.ink, .012, -.09, -.12, .014, .09, .12);
      return ['A', g, 0, [.06, -.2, .03]];
  }
  return null;
}
let blobMat = null;
function createNimion(name) {
  const G = figGeo(), M = sharedMats(), g = new THREE.Group();
  scene.add(g);
  const hit = mesh(g, G.hit, M.hit, 0, .62, 0);
  hit.visible = false;
  // a soft contact shadow, so a nimion stays grounded even inside another object's shadow
  blobMat = blobMat || new THREE.MeshBasicMaterial({ color: '#000000', map: softDot(.9), transparent: true, opacity: .32, depthWrite: false, fog: false });
  mesh(g, G.blob, blobMat, 0, .012, 0).rotation.x = -PI / 2;
  const bub = document.createElement('div');
  bub.className = 'l3-bub'; bub.hidden = true;
  bub.innerHTML = '<span class="s"></span><span class="t"></span>';
  bubLayer.appendChild(bub);
  const m = { name, g, hit, bub, fig: null, boss: null, idx: 0, tint: COLORS[0], x: MR_DOOR[0], z: MR_DOOR[1], y: 0, yaw: 0, walkYaw: 0,
    path: [], cur: null, script: [], mode: 'idle', scAt: 0, busyAt: 0, mb: null, chip: 'Idle', phase: Math.random() * 6, walkPhase: 0, sitH: 0, place: first, lsig: null,
    j: { aAx: 0, aAz: .1, aBx: 0, aBz: -.1, lA: 0, lB: 0, tx: 0, tz: 0, sit: 0 }, blinkAt: 0, blinkEnd: 0, bk: null, bw: 60, bvis: false, look: 'base' };
  hit.userData.m = m;
  hitList.push(hit);
  mins.set(name, m);
  return m;
}
// What an optional look pack is given to build a figure with (see buildFig).
const PACK = { THREE, mesh, lam, basic, geo, BOX, SPH, CYL, figGeo, sharedMats, toneMat, dropTone, buildProp, PROPS, NO_HAIR, R, L, LEG, TOP, EYE_Y, MOUTH_Y, ARM_Y, PI,
  get gen() { return gen; }, isHovered: m => hovered === m };
// A paler or deeper shade of a body colour (the tummy, the tuft), made the first time a style needs it.
function shade(e, k) {
  return e[k] || (e[k] = new THREE.MeshLambertMaterial({ color: k === 'light' ? e.mat.color.clone().lerp(new THREE.Color('#ffffff'), .62) : e.mat.color.clone().multiplyScalar(.66) }));
}
// A nimion's figure: its body colour, one eye or two, a prop, and one of three styles.
//   sprout: a leaf sprout and a scarf · bobble: a bobble, a gumdrop body and an HQ badge · tuft: a tuft of hair and a striped jumper
// What it wears is in its own colour (its tint), or a deeper shade when that is too close to the body colour.
function buildFig(m, look) {
  const pack = globalThis.HQ_CLASSIC; // an optional look pack, loaded before this module when the server offers one
  if (pack && pack.fig) return pack.fig(m, look, PACK);
  const G = figGeo(), M = sharedMats(), W = globalThis.HQW;
  const tone = /^#[0-9a-f]{6}$/i.test(look.tone || '') ? look.tone.toLowerCase() : TONE;
  const prop = PROPS.includes(look.prop) ? look.prop : 'none', one = look.eyes === 1;
  const style = STYLES.includes(look.style) ? look.style : STYLES[0], gum = style === 'bobble';
  if (m.fig) { m.g.remove(m.fig); dropTone(m.tone); }
  m.tone = tone; m.te = toneMat(tone); m.look = 'base';
  const f = m.fig = new THREE.Group(), skin = m.te.mat, tint = m.tint || COLORS[0], acc = lam(W ? W.accent(tone, tint) : tint);
  m.g.add(f);
  // the body's radius at a height (the gumdrop is wider at the bottom), and how far forward its surface is at x
  const rad = y => (gum ? gumRad(y) : R), surf = (x, y = EYE_Y) => Math.sqrt(rad(y) ** 2 - x * x);
  m.dress = []; // what it wears: each piece, its material, and the material it takes while the nimion sleeps
  const wear = (o, grey = M.wearGrey) => { m.dress.push([o, o.material, grey]); return o; };
  m.skin = [gum ? mesh(f, G.gum, skin, 0, 0, 0, 1) : mesh(f, G.body, skin, 0, LEG + R + L / 2, 0, 1)];

  // the face: big open eyes with a thin rim and two glints, rosy cheeks and a mouth
  m.eyes = [];
  for (const ex of one ? [0] : [-.092, .092]) {
    const gg = new THREE.Group(), k = one ? '1' : '2', ball = new THREE.Group(), s = one ? 1.3 : 1;
    gg.position.set(ex, EYE_Y, surf(ex) + .006); gg.rotation.y = Math.asin(ex / R);
    gg.add(ball);
    mesh(ball, G['eyeRim' + k], M.eyeRim);
    mesh(ball, G['eyeW' + k], M.white, 0, 0, .002);
    mesh(ball, G['eyeI' + k], M.iris, 0, -.005, .004);
    mesh(ball, G['eyeP' + k], M.pupil, 0, -.005, .006);
    mesh(ball, G.glintB, M.glint, .016 * s, .014 * s, .008).scale.setScalar(s);
    mesh(ball, G.glintS, M.glint, -.014 * s, -.02 * s, .008).scale.setScalar(s);
    f.add(gg);
    m.eyes.push(ball);
  }
  for (const s of [-1, 1]) {
    const x = s * .145, y = MOUTH_Y + .052, c = mesh(f, G.cheek, M.cheek, x, y, surf(x, y) + .003);
    c.rotation.y = Math.asin(x / rad(y)); c.scale.y = .7;
  }
  const mz = rad(MOUTH_Y) + .004;
  m.mouths = { smile: mesh(f, G.smile, M.mouth, 0, MOUTH_Y + .03, mz), sad: mesh(f, G.smile, M.mouth, 0, MOUTH_Y - .045, mz),
    cheer: mesh(f, G.open, M.mouth, 0, MOUTH_Y + .025, mz), work: mesh(f, G.o, M.mouth, 0, MOUTH_Y, mz) };
  m.mouths.smile.rotation.z = PI; m.mouths.work.scale.y = 1.3;
  for (const k in m.mouths) m.mouths[k].visible = k === 'smile';
  m.mouthK = 'smile';

  // on top of the head (a hat hides it)
  const HEAD = TOP + R;
  if (!NO_HAIR.has(prop)) {
    if (style === 'sprout') {
      mesh(f, G.stem, M.leafD, 0, HEAD + .035, 0);
      for (const s of [-1, 1]) { const lf = mesh(f, G.leaf, M.leaf, s * .05, HEAD + .09, 0, 1); lf.scale.set(1, .3, .62); lf.rotation.z = s * .5; }
    } else if (gum) {
      mesh(f, G.bobStalk, M.stalk, .014, HEAD + .05, 0).rotation.z = -.22;
      wear(mesh(f, G.bob, acc, .03, HEAD + .125, 0, 1));
    } else {
      const deep = shade(m.te, 'deep');
      for (const [x, y, s] of [[-.052, -.006, .74], [0, .024, 1], [.056, -.002, .7], [.03, .07, .46]]) wear(mesh(f, G.tuft, deep, x, HEAD - .012 + y, .012, 1), m.te.grey).scale.setScalar(s);
    }
  }

  // what it wears
  if (style === 'sprout') { // a scarf, knotted at the side
    const sc = wear(mesh(f, G.scarf, acc, 0, .503, 0, 1)); sc.rotation.x = PI / 2; sc.scale.z = .9;
    const kx = .1, kz = surf(kx, .5) + .034;
    wear(mesh(f, G.knot, acc, kx, .492, kz, 1));
    for (const [dx, rz] of [[-.036, .34], [.04, -.3]]) { const t = wear(mesh(f, G.tail, acc, kx + dx, .415, kz + .004, 1)); t.rotation.z = rz; t.scale.set(1, 1.15, .42); }
  } else if (gum) { // a paler tummy, and an HQ badge on a lanyard
    wear(mesh(f, G.tummy, shade(m.te, 'light')), M.paleGrey);
    for (const s of [-1, 1]) {
      const st = wear(mesh(f, G.lany, acc, s * .058, .452, surf(s * .058, .452) + .016));
      st.rotation.set(0, Math.asin(s * .058 / rad(.452)), -s * .78);
    }
    const b = new THREE.Group(); b.position.set(0, .345, .285); b.rotation.z = .05; f.add(b);
    mesh(b, G.badge, M.badge, 0, 0, 0, 1);
    wear(mesh(b, G.badgeDot, acc, 0, .022, .0065));
    mesh(b, G.badgeLine, M.badgeLine, 0, -.018, .0065); mesh(b, G.badgeLine, M.badgeLine, 0, -.034, .0065).scale.x = .7;
  } else { // a striped jumper
    [acc, M.creamN, acc].forEach((mt, i) => wear(mesh(f, G.jumper, mt, 0, .366 + i * .056, 0, 1), i === 1 ? M.paleGrey : M.wearGrey));
    for (const y of [.338, .506]) wear(mesh(f, G.roll, acc, 0, y, 0)).rotation.x = PI / 2;
  }

  const ax = rad(ARM_Y) + .012;
  const arm = s => {
    const p = new THREE.Group();
    p.position.set(s * ax, ARM_Y, 0); f.add(p);
    m.skin.push(mesh(p, G.arm, skin, 0, -.1, 0, 1));
    if (style === 'tuft') wear(mesh(p, G.sleeve, acc, 0, -.055, 0, 1));
    m.skin.push(mesh(p, G.glove, skin, 0, -.2, 0)); // a mitten in its own colour
    return p;
  };
  m.armA = arm(1); m.armB = arm(-1);
  const leg = s => {
    const p = new THREE.Group();
    p.position.set(s * .085, LEG + .03, 0); f.add(p);
    m.skin.push(mesh(p, G.leg, skin, 0, -.05, 0));
    const shoe = style === 'tuft' ? wear(mesh(p, G.shoe, acc, 0, -.12, .03, 1)) : wear(mesh(p, G.shoe, M.creamN, 0, -.12, .03, 1), M.paleGrey);
    shoe.scale.set(1, .55, 1.45);
    if (gum) wear(mesh(p, G.toe, acc, 0, -.119, .088)).scale.set(.95, .5, .62);
    return p;
  };
  m.legA = leg(1); m.legB = leg(-1);
  m.hp = null;
  const pr = buildProp(prop, one);
  if (pr) {
    const [at, grp, rx = 0, pos] = pr;
    if (at === 'head') { grp.position.y = TOP; f.add(grp); }
    else if (at === 'body') { grp.position.set(pos[0], pos[1], rad(pos[1]) + (style === 'sprout' ? .066 : .03)); f.add(grp); } // in front of the scarf, the badge or the jumper
    else { (at === 'A' ? m.armA : m.armB).add(grp); grp.position.set(...(pos || [0, -.2, .02])); grp.rotation.x = rx; if (at === 'B') m.hp = grp; }
  }
  m.paper = mesh(f, G.paper, M.paper, 0, .42, R + .17); m.paper.rotation.x = -.35; m.paper.visible = false;
  m.cup = mesh(m.armB, G.cup, M.white, 0, -.2, .06); m.cup.visible = false;
  m.ball = mesh(f, G.ball, M.ball, -.32, .1, .2, 1); m.ball.visible = false;
  m.nanas = [0, 1, 2].map(() => { const n = mesh(f, G.nana, M.nana); n.visible = false; return n; });
  m.alert = new THREE.Group(); m.alert.position.y = TOP + R + .3; m.alert.visible = false; f.add(m.alert); // needs you: a bobbing "!"
  mesh(m.alert, BOX(.06, .16, .06), M.alert, 0, .06, 0); mesh(m.alert, SPH(.036, 8, 6), M.alert, 0, -.08, 0);
  m.outline = gum ? mesh(f, G.gum, M.outline, 0, -.02, 0) : mesh(f, G.outline, M.outline, 0, LEG + R + L / 2, 0);
  if (gum) m.outline.scale.set(1.12, 1.035, 1.12);
  m.outline.visible = hovered === m;
}
// base, grey (asleep) or lit by its monitor (typing)
function setLook(m, k) {
  if (m.look === k) return;
  m.look = k;
  const skin = k === 'grey' ? m.te.grey : k === 'lit' ? litMat(m.te, m.tint) : m.te.mat;
  for (const s of m.skin) s.material = skin;
  for (const [o, base, grey] of m.dress) o.material = k === 'grey' ? grey : base;
}
const vis = (o, on) => { if (o.visible !== on) o.visible = on; };

// Joint targets per pose; joints ease toward them so poses blend instead of snapping.
function pose3d(m, pose, c, now, dt) {
  const calm = still(), t = calm ? m.phase : now / 1000 + m.phase, j = m.j;
  const sit = m.sitH > 0 && SITTABLE.has(pose);
  let aAx = 0, aAz = .1, aBx = 0, aBz = -.1, lA = 0, lB = 0, tx = 0, tz = 0, bob = 0, mouth = 'smile', open = true;
  if (sit) { lA = lB = -1.5; aAx = aBx = -.3; }
  else if (!calm) bob = Math.sin(t * 2) * .006;
  switch (pose) {
    case 'walk': { const s = Math.sin(m.walkPhase); lA = s * .7; lB = -s * .7; aAx = -s * .6; aBx = s * .6; bob = calm ? 0 : Math.abs(Math.cos(m.walkPhase)) * .04; break; }
    case 'run': { const s = Math.sin(m.walkPhase); lA = s; lB = -s; aAx = -s * .9; aBx = s * .9; aAz = .3; aBz = -.3; tx = .12; bob = calm ? 0 : Math.abs(Math.cos(m.walkPhase)) * .07; mouth = 'cheer'; break; }
    case 'facepalm': aAx = -1.9; aAz = -.35; aBz = -.3; tx = .2 + Math.sin(t * 3) * .03; tz = Math.sin(t * 1.5) * .05; mouth = 'sad'; break;
    case 'shrug': { const w = Math.abs(Math.sin(t * 2.2)); aAx = aBx = -.5; aAz = .5 + w * .5; aBz = -.5 - w * .5; tz = Math.sin(t * 2.2) * .05; mouth = 'sad'; break; }
    case 'kick': lA = -1.1; aAz = .5; aBz = -.5; tx = -.08; mouth = 'cheer'; break;
    case 'move': aAx = -1.2; aAz = -.1; tx = .14; mouth = 'work'; break;
    case 'think': aBx = -1.9; aBz = .35; tx = .05; tz = Math.sin(t * 1.2) * .04; break;
    case 'type': aAx = -1.2 + Math.sin(t * 24) * .1; aBx = -1.2 - Math.sin(t * 24) * .1; aAz = .05; aBz = -.05; tx = .08; mouth = 'work'; break;
    case 'sleep': tx = .36 + Math.sin(t * 1.4) * .025; aAx = aBx = -1.0; open = false; mouth = 'sad'; break;
    case 'hand': // wave wide with one arm, the other on the hip; standing, hop now and then
      aBz = -2.7 + Math.sin(t * 9) * .4; aAz = .55; aAx = .2; tz = Math.sin(t * 4.5) * .07; mouth = 'work';
      if (!sit && !calm) bob = Math.pow(Math.max(0, Math.sin(t * 4.5)), 6) * .1;
      break;
    case 'tap': {
      lB = -Math.max(0, Math.sin(t * 12)) * .35;
      const w = (t % 4) / 4;
      if (w > .55 && w < .9) { aAx = -1.45; aAz = -.35; }
      break;
    }
    case 'ball': aBx = -.45 + Math.sin(t * 11.4) * .2; aBz = -.3; m.ball.position.y = .1 + Math.abs(Math.cos(t * 5.7)) * .38; break;
    case 'juggle': {
      aAx = -1.75 + Math.sin(t * 9) * .25; aBx = -1.75 - Math.sin(t * 9) * .25; aAz = .25; aBz = -.25;
      m.nanas.forEach((n, i) => { const a = t * 4.5 + i * 2.094; n.position.set(Math.cos(a) * .24, 1.32 + Math.sin(a) * .24, .2); n.rotation.z = a; });
      break;
    }
    case 'sip': { const w = (t % 3.6) / 3.6; aBx = w > .35 && w < .8 ? -2.3 : -.5; aBz = w > .35 && w < .8 ? .35 : -.1; break; }
    case 'vend': { const w = (t % 1.8) / 1.8; aBx = w > .7 && w < .88 ? -1.5 : -.4; break; }
    case 'chat': aBx = -.6 + Math.sin(t * 7) * .35; tz = Math.sin(t * 2.5) * .04; mouth = Math.sin(t * 9) > 0 ? 'work' : 'smile'; break;
    case 'draw': aAx = -2.0 + Math.sin(t * 6) * .25; aAz = .25 + Math.sin(t * 4.3) * .2; mouth = 'work'; break;
    case 'toss': aBx = -2.8 + ((t * 2) % 1) * 2.3; mouth = 'work'; break;
    case 'catch': aAx = aBx = -2.6; aAz = .35; aBz = -.35; mouth = 'work'; break;
    case 'play': aAx = aBx = -1.25; aAz = .12 + Math.sin(t * 13) * .12; aBz = -.12 - Math.cos(t * 11) * .12; tx = .06; mouth = Math.sin(t * 3) > .6 ? 'cheer' : 'work'; break;
    case 'nod': tx = .05 + Math.sin(t * 10) * .12; break;
    case 'cheer':
      aAz = 2.7 + Math.sin(t * 12) * .2; aBz = -2.7 - Math.sin(t * 12) * .2; mouth = 'cheer';
      if (!calm && c) bob = Math.abs(Math.sin((now - c.arrived) / 1000 * PI * 2.2)) * .35;
      break;
    case 'sad': tx = .22; tz = Math.sin(t * 1.3) * .06; aAz = .04; aBz = -.04; mouth = 'sad'; break;
    case 'give': tx = .1 + Math.sin(t * 4) * .06; break;
  }
  const carry = (c && c.carry) || '';
  if (carry) { aAx = aBx = pose === 'give' ? -1.45 : -1.1; aAz = -.3; aBz = .3; }
  const k = calm ? 1 : 1 - Math.exp(-dt * 16);
  j.aAx += (aAx - j.aAx) * k; j.aAz += (aAz - j.aAz) * k; j.aBx += (aBx - j.aBx) * k; j.aBz += (aBz - j.aBz) * k;
  j.lA += (lA - j.lA) * k; j.lB += (lB - j.lB) * k; j.tx += (tx - j.tx) * k; j.tz += (tz - j.tz) * k;
  j.sit += ((sit ? SEAT_H / m.g.scale.y - LEG + .01 : 0) - j.sit) * k;
  m.armA.rotation.set(j.aAx, 0, j.aAz); m.armB.rotation.set(j.aBx, 0, j.aBz);
  m.legA.rotation.x = j.lA; m.legB.rotation.x = j.lB;
  m.fig.position.y = j.sit + bob;
  m.fig.rotation.set(j.tx, 0, j.tz);
  if (mouth !== m.mouthK) { m.mouths[m.mouthK].visible = false; m.mouths[mouth].visible = true; m.mouthK = mouth; }
  if (!calm && now > m.blinkAt) { m.blinkEnd = now + 130; m.blinkAt = now + rand(2500, 6500); }
  const ey = !open ? .12 : !calm && now < m.blinkEnd ? .1 : 1;
  for (const e of m.eyes) e.scale.y = ey;
  vis(m.paper, !!carry);
  if (carry) m.paper.material = carry === 'red' ? MAT.red : MAT.paper;
  vis(m.cup, pose === 'sip'); vis(m.ball, pose === 'ball');
  for (const n of m.nanas) vis(n, pose === 'juggle');
  if (m.hp) vis(m.hp, pose !== 'sip' && pose !== 'ball');
  vis(m.alert, m.mode === 'needs');
  if (m.alert.visible && !calm) { m.alert.position.y = TOP + R + .3 + Math.sin(t * 4) * .04; m.alert.rotation.y = t * 2; }
  setLook(m, pose === 'sleep' ? 'grey' : pose === 'type' ? 'lit' : 'base');
}

// ---------- 9. behaviour: where to go and what to do ----------
// Idle spots in the nook, the play corner and under the screen. Each holds one nimion; the two chat spots make a pair.
const SPOTS = [
  { p: [8.9, 1.3], pose: 'vend', face: PI }, { p: [-7.5, 1.2], pose: 'sip', face: PI },
  { p: [6.25, 1.08], pose: 'play', face: PI, arcade: 1 }, { p: [7.05, 1.08], pose: 'play', face: PI, arcade: 1 }, { p: [7.85, 1.08], pose: 'play', face: PI, arcade: 1 },
  { p: [5.9, 2.3], pose: 'ball', face: 'cam' }, { p: [7.7, 2.6], pose: 'juggle', face: 'cam' },
  { p: [-7.85, 2.35], pose: 'chat', sit: 1 }, { p: [-6.15, 2.35], pose: 'chat', sit: 1 }, // the stools at the round table
  { p: [-3.6, 1.5], pose: 'stand', face: 'cam' }, { p: [3.6, 1.5], pose: 'look', face: [0, 0] },
  { p: [-4.3, 2.9], pose: 'stand', face: 'cam' }, { p: [4.3, 2.9], pose: 'stand', face: 'cam' },
  // the crowd: only while the human plays a game, idle nimions gather here and cheer
  { p: [6.65, 1.9], pose: 'cheer', face: [7.05, 0], crowd: 1, arcade: 1 }, { p: [7.5, 1.95], pose: 'cheer', face: [7.05, 0], crowd: 1, arcade: 1 },
  { p: [5.85, 1.75], pose: 'cheer', face: [6.6, 0], crowd: 1, arcade: 1 }, { p: [8.3, 1.85], pose: 'cheer', face: [7.6, 0], crowd: 1, arcade: 1 },
  { p: [7.05, 2.7], pose: 'cheer', face: [7.05, 0], crowd: 1, arcade: 1 },
];
SPOTS[7].pair = SPOTS[8]; SPOTS[8].pair = SPOTS[7];
SPOTS[7].face = SPOTS[8].p; SPOTS[8].face = SPOTS[7].p;

// Walk along lanes and the corridor so nobody walks through a desk.
function route(a, b) {
  const az = a[1] > ZY, bz = b[1] > ZY, out = [];
  if (az === bz && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.6) return [b];
  if (az) { const l = lane(a[0]); out.push([l, a[1]], [l, CY]); }
  if (bz) { const l = lane(b[0]); if (!az) out.push([a[0], CY]); out.push([l, CY], [l, b[1]]); }
  out.push(b);
  return out;
}
function idleStep(m) {
  const prev = m.lastSpot, free = SPOTS.filter(s => !s.who && s !== prev && (arcadeOn || !s.crowd)), fans = free.filter(f => f.arcade);
  const s = (arcadeOn && fans.length ? pick(fans) : null) || free.find(f => f.pair && f.pair.who && Math.random() < .6) || (free.length ? pick(free) : null);
  if (s) s.who = m;
  m.lastSpot = s;
  return { to: s ? s.p : [rand(-3.2, 3.2), rand(2.8, 3.2)], pose: s ? s.pose : 'stand', spot: s, sit: s && s.sit, face: s ? s.face : 'cam',
    dur: still() ? 0 : rand(8000, 18000), say: s && s.pose === 'chat' ? pick(CHAT) : '' };
}
// What the nimion's state asks for, when no scripted moment is playing.
function modeStep(m) {
  if (m.boss) {
    if (m.mode === 'needs') return { to: BOSS_SEAT, pose: 'hand', sit: true, face: 'cam' };
    if (m.mode === 'working') return { to: BOSS_BOARD, pose: 'draw', face: PI };
    return { to: BOSS_SEAT, pose: m.mode === 'paused' ? 'sleep' : 'look', sit: true, face: 0 };
  }
  const st = stations.get(m.name);
  if (st && m.mode === 'needs') return { to: st.stand, pose: 'hand', face: 'cam' }; // stand up beside the desk and wave
  if (st && m.mode === 'working') return { to: st.seat, pose: 'type', sit: true, face: st.yaw };
  if (st && m.mode === 'waiting') return { to: st.stand, pose: 'tap', face: 'cam' };
  if (st && m.mode === 'paused') return { to: st.seat, pose: 'sleep', sit: true, face: st.yaw };
  return idleStep(m);
}
function next(m) {
  const s = m.script.shift() || modeStep(m);
  m.cur = s;
  s.arrived = 0;
  if (s.to) m.sitH = s.sit ? SEAT_H : 0;
  if (!s.to) m.path = [];
  else if (still() || m.place) { m.x = s.to[0]; m.z = s.to[1]; m.path = []; m.y = platY(m); }
  else m.path = route([m.x, m.z], s.to);
  m.place = false;
}
function endStep(m) {
  const c = m.cur;
  if (!c) return;
  if (c.spot && c.spot.who === m) c.spot.who = null;
  m.cur = null;
}
// Play a scripted moment: it starts now unless another scripted moment is already playing.
function play(m, steps) {
  for (const s of steps) s.sc = true;
  m.scAt = performance.now();
  if (m.cur && m.cur.sc) { m.script.push(...steps); m.script.splice(0, m.script.length - 8); return; }
  m.script.unshift(...steps);
  endStep(m);
}
const handSpot = m => [(m.idx % 2 ? 1 : -1) * 1.5, 1.35 + (m.idx % 3) * .35]; // beside the boss desk, on the platform
const atBoss = () => boss ? [boss.x, boss.z] : null;
const react = (text, m) => boss && play(boss, [{ to: null, pose: 'nod', dur: 1700, bub: text, face: [m.x, m.z] }]);
// A finished job: a jump with arms up and confetti, then the papers go to the next step's nimion (to), or to the boss.
function doneScript(m, to) {
  const cheer = { to: null, pose: 'cheer', dur: 1300, bub: 'Done! 🎉', face: 'cam', enter: () => confetti(m.x, m.y + 1.5, m.z, 45) };
  if (to && stations.get(to.name)) return [cheer].concat(deliver(m, to, `📄 → ${to.name}`));
  return [cheer, { to: handSpot(m), pose: 'give', carry: 'paper', dur: 1500, face: atBoss, enter: () => react('👍', m) }];
}
// Walk the papers to r's desk and drop them on its pile.
function deliver(g, r, bub) {
  const st = stations.get(r.name);
  if (!st) return [];
  const x = st.g.position.x, z = st.g.position.z, s = st.side;
  // from the front corner of the partner's half, turned toward the pile, so neither the giver nor a monitor hides it
  return [{ to: [x - s * .4, z + .72], pose: 'give', carry: 'paper', dur: 1200, bub, face: [x + s * PILE_X, z + PILE_Z], enter: () => { dropPaper(g, st); attend(r, 2500); } }];
}
// The boss, when free, walks new steps to up to three desks (round the side of his desk, there and back); otherwise envelopes fly.
function handOut(targets, now, free) {
  if (!boss) return;
  if (!free || targets.length > 3) return toss(targets, now);
  const st = stations.get(targets[0].name), sx = st && st.g.position.x + st.side * .35 < 0 ? -1 : 1, side = [sx * 1.3, 1.05];
  play(boss, [{ to: side, pose: 'stand', carry: 'paper', dur: 1 }, ...targets.flatMap(r => deliver(boss, r, `📄 → ${r.name}`)), { to: side, pose: 'stand', dur: 1 }]);
  attend(boss, 5000);
}
// The human won or lost an arcade game: idle nimions cheer or groan.
function reactAll(kind) {
  const win = kind === 'win';
  if (win) confetti(7.05, 2.2, 1.3, 60);
  for (const m of mins.values()) {
    if (m.mode !== 'idle' || (m.cur && m.cur.sc)) continue;
    play(m, [win ? { to: null, pose: 'cheer', dur: 2200, bub: pick(['🎉', 'Yay!', 'Woo!', '🏆']), face: 'cam' }
      : { to: null, pose: 'shrug', dur: 2000, bub: pick(['Aww…', 'So close!', 'Oof', '😩']), face: 'cam' }]);
  }
}
function failScript(m) {
  return [
    { to: null, pose: 'facepalm', dur: 1400, bub: 'Uh-oh… 🤦', face: 'cam' },
    { to: handSpot(m), pose: 'sad', carry: 'red', dur: 1600, face: atBoss, enter: () => react('🤔', m) },
    { to: null, pose: 'sad', dur: 1000, face: atBoss },
  ];
}
// The boss tosses an envelope to each newly assigned nimion; each one stops to catch it.
function toss(targets, now) {
  if (!boss) return;
  play(boss, [{ to: null, pose: 'toss', dur: 600 + targets.length * 250, bub: '📨', face: 'cam' }]);
  targets.forEach((m, i) => {
    const t0 = now + 250 + i * 250;
    launch(boss, m, t0);
    play(m, [{ to: null, pose: 'catch', dur: t0 - now + 1900, bub: '📨', face: atBoss }]);
  });
  attend(boss, 3000);
}
// Confetti: one instanced mesh, a ring buffer of pieces; only stepped while some are alive.
const CONF = 240, cP = new Float32Array(CONF * 3), cV = new Float32Array(CONF * 3), cL = new Float32Array(CONF), _e = new THREE.Euler();
let conf = null, confI = 0, confUntil = 0;
function buildConfetti() {
  conf = new THREE.InstancedMesh(BOX(.09, .09, .008), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONF);
  conf.frustumCulled = false;
  bubM.makeScale(0, 0, 0);
  for (let i = 0; i < CONF; i++) { conf.setMatrixAt(i, bubM); conf.setColorAt(i, _c.set(LIQ[i % LIQ.length])); }
  fxGroup.add(conf);
}
function confetti(x, y, z, n) {
  if (still() || !conf) return;
  for (let k = 0; k < n; k++) {
    const i = confI++ % CONF;
    cP[i * 3] = x; cP[i * 3 + 1] = y; cP[i * 3 + 2] = z;
    cV[i * 3] = rand(-1.4, 1.4); cV[i * 3 + 1] = rand(1.5, 3.6); cV[i * 3 + 2] = rand(-1.4, 1.4);
    cL[i] = rand(1.4, 2.2);
  }
  confUntil = performance.now() + 2400;
}
function stepConfetti(now, dt) {
  if (!conf || now > confUntil + 100) return;
  for (let i = 0; i < CONF; i++) {
    if (cL[i] <= 0) { bubM.makeScale(0, 0, 0); conf.setMatrixAt(i, bubM); continue; }
    cL[i] -= dt;
    const j = i * 3;
    cV[j + 1] -= 5 * dt; cV[j] *= 1 - dt * 1.5; cV[j + 2] *= 1 - dt * 1.5;
    cP[j] += cV[j] * dt; cP[j + 1] = Math.max(.01, cP[j + 1] + cV[j + 1] * dt); cP[j + 2] += cV[j + 2] * dt;
    if (cP[j + 1] <= .01) cV[j] = cV[j + 1] = cV[j + 2] = 0;
    bubM.makeRotationFromEuler(_e.set(now / 200 + i, now / 260 + i * 2, 0)).setPosition(cP[j], cP[j + 1], cP[j + 2]);
    conf.setMatrixAt(i, bubM);
  }
  conf.instanceMatrix.needsUpdate = true;
}
// A sheet flies from the giver's hands onto the receiving desk's pile.
let drops = [];
function dropPaper(from, st) {
  if (still()) return;
  const e = mesh(scene, figGeo().paper, sharedMats().paper), k = from.g.scale.y;
  drops.push({ e, st, t0: performance.now(), a: new THREE.Vector3(from.x + Math.sin(from.yaw) * .4 * k, from.y + .45 * k, from.z + Math.cos(from.yaw) * .4 * k) });
}
function stepDrop(d, now) {
  const t = clamp((now - d.t0) / 650, 0, 1), p = d.st.g.position;
  _v.set(p.x + d.st.side * PILE_X, .56 + .04 * Math.max(d.st.lv, 1), p.z + PILE_Z);
  d.e.position.lerpVectors(d.a, _v, t); d.e.position.y += Math.sin(PI * t) * .35;
  d.e.rotation.set(-PI / 2 * t, t * 1.5, 0);
  if (t < 1) return true;
  scene.remove(d.e);
  return false;
}

// ---------- 9b. play: two idle nimions pair up for a little game; any work ends it at once ----------
// at: where the two players stand; block: SPOTS kept free while it runs (they overlap the play area).
const GAMES = {
  catch: { at: [[3.0, 2.0], [5.0, 2.95]], block: [10, 12] },
  kick: { at: [[6.1, 3.15], [8.6, 2.1]], block: [5, 6] },
  tag: { c: [-4.3, 2.25], rx: 1.25, rz: .7, block: [9, 11] },
  board: { at: [[-7.85, 2.35], [-6.15, 2.35]], block: [7, 8], sit: 1 },
};
let games = [], gameAt = 0, gameBall = null, boardSet = null, ballBusy = false;
const onLoop = (D, a) => [D.c[0] + Math.cos(a) * D.rx, D.c[1] + Math.sin(a) * D.rz];
function startGame(kind, now) {
  const D = GAMES[kind];
  if (!D || games.some(G => G.kind === kind || D.block.some(i => SPOTS[i].who === G))) return false;
  const pool = [...mins.values()].filter(m => !m.boss && m.fig && m.mode === 'idle' && !m.script.length && !(m.cur && (m.cur.sc || m.cur.game)));
  if (pool.length < 2) return false;
  const a = pick(pool), b = pick(pool.filter(m => m !== a)), G = { kind, a, b, on: 0, until: now + rand(14000, 24000) };
  for (const i of D.block) { const w = SPOTS[i].who; if (w) endStep(w); SPOTS[i].who = G; } // whoever idles there moves on
  const at = D.at || [onLoop(D, 0), onLoop(D, -1.2)];
  [a, b].forEach((m, i) => { endStep(m); m.script.unshift({ to: at[i], pose: kind === 'board' ? 'think' : 'stand', game: G, sit: D.sit, face: at[1 - i] }); next(m); });
  games.push(G);
  return true;
}
function endGame(G) {
  G.over = true;
  for (const i of GAMES[G.kind].block) if (SPOTS[i].who === G) SPOTS[i].who = null;
  for (const m of [G.a, G.b]) if (m.cur && m.cur.game === G) endStep(m);
  if (G.kind === 'catch') gameBall.visible = false;
  if (G.kind === 'kick') ballBusy = false;
  if (G.kind === 'board') boardSet.visible = false;
}
const handAt = (m, v) => v.set(m.x + Math.sin(m.yaw) * .3, m.y + 1.25, m.z + Math.cos(m.yaw) * .3);
const footAt = (m, v) => v.set(m.x + Math.sin(m.yaw) * .35, .17, m.z + Math.cos(m.yaw) * .35);
function gameStep(G, now, dt) {
  const { a, b } = G, inG = m => mins.get(m.name) === m && m.cur && m.cur.game === G;
  if (!inG(a) || !inG(b) || now > G.until || arcadeOn || still()) { endGame(G); return false; }
  if (!G.on) {
    if (!(a.cur.arrived && b.cur.arrived && !a.path.length && !b.path.length)) return true;
    G.on = now;
    if (G.kind === 'catch') gameBall.visible = true;
    if (G.kind === 'kick') { ballBusy = true; G.from = cornerBall.position.clone(); }
    if (G.kind === 'board') { boardSet.visible = true; G.turn = 0; G.turnAt = now; }
    if (G.kind === 'tag') { G.lead = a; G.dir = 1; G.th = 0; G.tagAt = now - 1800; }
  }
  const s = (now - G.on) / 1000;
  if (G.kind === 'catch') { // the ball arcs from hand to hand
    const u = s / 1.15, k = Math.floor(u), f = u - k, from = k % 2 ? b : a, to = k % 2 ? a : b;
    gameBall.position.lerpVectors(handAt(from, _v), handAt(to, _v2), f); gameBall.position.y += Math.sin(PI * f) * 1.0;
    from.cur.pose = f < .3 ? 'toss' : 'stand'; to.cur.pose = f > .45 ? 'catch' : 'stand';
  } else if (G.kind === 'kick') { // the corner ball rolls from foot to foot
    if (s < .8) { footAt(a, _v); cornerBall.position.lerpVectors(G.from, _v, s / .8); cornerBall.position.y = .17; }
    else {
      const u = (s - .8) / 1.4, k = Math.floor(u), f = u - k, from = k % 2 ? b : a, to = k % 2 ? a : b;
      cornerBall.position.lerpVectors(footAt(from, _v), footAt(to, _v2), 1 - (1 - f) * (1 - f)); cornerBall.position.y = .17 + Math.sin(PI * f) * .12;
      from.cur.pose = f < .25 ? 'kick' : 'stand'; to.cur.pose = 'stand';
    }
    cornerBall.rotation.x += dt * 7;
  } else if (G.kind === 'tag') { // run round a loop; the chaser closes in, tags, and they swap and turn round
    const D = GAMES.tag, chase = G.lead === a ? b : a;
    let tau = (now - G.tagAt) / 1000;
    if (tau >= 3.6) {
      const ca = G.th - G.dir * .2;
      G.lead = chase; G.th = ca; G.dir = -G.dir; G.tagAt = now; tau = 0;
      chase.cur.bub = 'Tag! 👋'; G.bubM = chase; G.bubAt = now;
    }
    if (G.bubM && now - G.bubAt > 1000) { G.bubM.cur.bub = ''; G.bubM = null; }
    G.th += G.dir * 1.5 * dt;
    const gap = .2 + Math.sin(Math.min(tau / 3.6, 1) * PI);
    for (let i = 0; i < 2; i++) {
      const m = i ? (G.lead === a ? b : a) : G.lead, ang = i ? G.th - G.dir * gap : G.th;
      m.x = D.c[0] + Math.cos(ang) * D.rx; m.z = D.c[1] + Math.sin(ang) * D.rz;
      m.cur.pose = 'run'; m.walkPhase += dt * 15;
      m.cur.face = Math.atan2(-Math.sin(ang) * D.rx * G.dir, Math.cos(ang) * D.rz * G.dir);
    }
  } else if (G.kind === 'board') { // turns: reach and move a piece, then sit back; the other one thinks
    if (now - G.turnAt > 2600) {
      G.turn ^= 1; G.turnAt = now;
      const pc = pick(boardSet.pieces), ax = Math.random() < .5 ? 'x' : 'z';
      pc.position[ax] = clamp(pc.position[ax] + (Math.random() < .5 ? -.09 : .09), -.14, .14);
    }
    const mover = G.turn ? b : a;
    mover.cur.pose = now - G.turnAt < 1000 ? 'move' : 'sit';
    (mover === a ? b : a).cur.pose = 'think';
  }
  return true;
}
function buildPlay() {
  const M = sharedMats();
  gameBall = mesh(fxGroup, figGeo().ball, lam('#4fb3ff'), 0, 0, 0, 1); gameBall.scale.setScalar(1.3); gameBall.visible = false;
  for (const [x, z] of GAMES.board.at) { // stools at the round table
    mesh(room, CYL(.17, .17, .04, 12), M.chair, x, SEAT_H - .02, z, 3);
    mesh(room, CYL(.03, .03, SEAT_H - .04, 6), M.ink, x, (SEAT_H - .04) / 2, z, 1);
  }
  boardSet = new THREE.Group(); boardSet.position.set(-7.0, .642, 2.35); boardSet.visible = false; room.add(boardSet);
  mesh(boardSet, geo('board', () => new THREE.PlaneGeometry(.42, .42)), new THREE.MeshLambertMaterial({ map: staticTex(64, 64, (x) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#3b3946' : '#f4efe6'; x.fillRect(i * 16, j * 16, 16, 16); }
  }) }), 0, 0, 0).rotation.x = -PI / 2;
  boardSet.pieces = [[-.135, -.135, '#d64545'], [.045, -.135, '#d64545'], [-.045, -.045, '#d64545'], [.135, .135, '#2f5ea8'], [-.045, .135, '#2f5ea8'], [.045, .045, '#2f5ea8']]
    .map(([x, z, c]) => mesh(boardSet, CYL(.03, .03, .025, 10), lam(c), x, .013, z, 1));
}
const platY = m => Math.abs(m.x) < PLAT.x && m.z < PLAT.z1 ? PLAT.h : 0;
function faceYaw(m, c) {
  let f = c && c.face;
  if (f === 'cam') return Math.atan2(ocam.position.x - m.x, ocam.position.z - m.z);
  if (typeof f === 'function') f = f();
  if (typeof f === 'number') return f;
  if (Array.isArray(f) && Math.hypot(f[0] - m.x, f[1] - m.z) > .05) return Math.atan2(f[0] - m.x, f[1] - m.z);
  return m.yaw;
}
function walk(m, dt) {
  const [tx, tz] = m.path[0], dx = tx - m.x, dz = tz - m.z, dist = Math.hypot(dx, dz), stride = SPEED * dt;
  if (dist <= stride) { m.x = tx; m.z = tz; m.path.shift(); } else { m.x += dx / dist * stride; m.z += dz / dist * stride; }
  if (dist > 1e-3) m.walkYaw = Math.atan2(dx, dz); // face the way we walk
  m.walkPhase += dt * 11;
}
function tick(m, now, dt) {
  if (m.cur && m.cur.sc && (m.mode === 'working' || m.mode === 'needs') && now - Math.max(m.scAt, m.busyAt) > HOLD) { m.script.length = 0; endStep(m); } // work wins
  if (m.cur && m.cur.game && m.cur.game.over) endStep(m);
  if (!m.cur) next(m);
  const c = m.cur, calm = still();
  let pose;
  if (m.path.length) { walk(m, dt); pose = 'walk'; }
  else {
    if (!c.arrived) { c.arrived = now; if (c.enter) c.enter(m); }
    pose = c.pose;
    if (c.dur && now - c.arrived >= c.dur) endStep(m);
  }
  m.y += (platY(m) - m.y) * (calm ? 1 : 1 - Math.exp(-dt * 14));
  let yaw = pose === 'walk' ? m.walkYaw : faceYaw(m, c);
  if (pose === 'look' && !calm) yaw += Math.sin(now / 1600 + m.phase) * .45;
  m.yaw += wrapA(yaw - m.yaw) * (calm ? 1 : 1 - Math.exp(-dt * 9));
  m.g.position.set(m.x, m.y, m.z);
  m.g.rotation.y = m.yaw;
  pose3d(m, pose, c, now, dt);
}

function pinNote(items) {
  const m = mesh(scene, geo('note', () => new THREE.PlaneGeometry(.24, .24)), lam('#fff3a3', { side: THREE.DoubleSide }));
  const from = boss ? new THREE.Vector3(boss.x, boss.y + 1.3, boss.z) : new THREE.Vector3(0, 1.5, 1.5);
  notes.push({ m, t0: performance.now(), dur: 1400, from, to: new THREE.Vector3(GUIDE_AT[0], GUIDE_AT[1], .09), items });
  attend(boss, 2500);
}
function flyNote(n, now) {
  const t = clamp((now - n.t0) / n.dur, 0, 1);
  n.m.position.lerpVectors(n.from, n.to, ease(t));
  n.m.position.y += Math.sin(PI * t) * .7;
  n.m.rotation.set(0, (1 - t) * PI * 2, (1 - t) * .6);
  n.m.scale.setScalar(1 + Math.sin(PI * t) * .4);
  if (t < 1) return true;
  scene.remove(n.m);
  drawGuide(n.items);
  return false;
}
// Envelopes fly in a 3D arc from the boss's hand to each assigned nimion.
function launch(from, to, t0) {
  const G = figGeo(), M = sharedMats(), e = new THREE.Group();
  mesh(e, G.envBox, M.envelope, 0, 0, 0, 1);
  mesh(e, G.envFlap, M.flap, 0, 0, .011);
  e.visible = false;
  e.scale.setScalar(1.7);
  scene.add(e);
  const a = new THREE.Vector3(from.x, from.y + 1.2 * from.g.scale.y, from.z);
  flyers.push({ e, to, t0, a, dur: 700 + Math.hypot(to.x - from.x, to.z - from.z) * 70 });
}
function fly(f, now) {
  if (now < f.t0) return true;
  if (mins.get(f.to.name) !== f.to) { scene.remove(f.e); return false; }
  const t = Math.min(1, (now - f.t0) / f.dur);
  _v.set(f.to.x, f.to.y + 1.1 * MS, f.to.z);
  f.e.position.lerpVectors(f.a, _v, t);
  f.e.position.y += Math.sin(PI * t) * 1.1;
  f.e.rotation.set(Math.sin(PI * t) * .4, t * PI * 2, 0);
  f.e.visible = true;
  if (t >= 1) { scene.remove(f.e); return false; }
  return true;
}

// ---------- 10. camera: contain the activity, stretch the shell, limited orbit, own zoom, attention ----------
// What must always be in view: the nook, the play corner, the boss platform and screen, every pod and the spots around it.
function activityPoints() {
  const pts = [], add = (x, y, z) => pts.push(new THREE.Vector3(x, y, z)), px = Math.max(podX, 4.5);
  for (const s of [-1, 1]) {
    add(s * SIDE, 0, 0); add(s * SIDE, 2.0, 0); add(s * SIDE, 0, 3.8); add(s * SIDE, 1.9, 3.8);
    add(s * px, 0, front); add(s * px, 1.85, front); add(s * 2.2, 3.72, 0);
  }
  return pts;
}
// The orbit camera (ocam) is what the user steers; the render camera adds breathing and attention on top of it.
function computeFit() {
  const a = ocam.aspect, v = viewFor(a);
  for (const c of [ocam, camera]) { c.fov = v.fov; c.updateProjectionMatrix(); }
  actPts = activityPoints();
  const box = new THREE.Box3().setFromPoints(actPts);
  const F = new THREE.Vector3().setFromSphericalCoords(1, v.pol, AZ0).negate();
  const Rt = new THREE.Vector3().crossVectors(F, ocam.up).normalize(), U = new THREE.Vector3().crossVectors(Rt, F);
  const tanV = Math.tan(v.fov * DEG / 2) * .92, tanH = tanV * a, target = box.getCenter(new THREE.Vector3()); // 8% margin, also room for attention
  const need = () => {
    let d = 0;
    for (const p of actPts) { _v.subVectors(p, target); const f = _v.dot(F); d = Math.max(d, Math.abs(_v.dot(U)) / tanV - f, Math.abs(_v.dot(Rt)) / tanH - f); }
    return d;
  };
  for (let it = 0; it < 5; it++) { // centre the projected activity: shift the target by the projected offset
    const d = need();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of actPts) {
      _v.subVectors(p, target);
      const z = d + _v.dot(F), x = _v.dot(Rt) / z / tanH, y = _v.dot(U) / z / tanV;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    target.addScaledVector(Rt, (x0 + x1) / 2 * tanH * d).addScaledVector(U, (y0 + y1) / 2 * tanV * d);
  }
  // Same view, but orbit around the point of the central ray that is as deep as the activity's centre.
  const pos = target.clone().addScaledVector(F, -need()), dist = box.getCenter(_v).sub(pos).dot(F), maxD = dist * 1.08;
  target.copy(pos).addScaledVector(F, dist);
  fit = { az: AZ0, pol: v.pol, dist, target, pos };
  // Shell: a ceiling just above the farthest zoomed-out eye, side walls and front beyond every reachable camera position.
  shell.hc = Math.max(HC0, target.y + maxD * Math.cos(v.pol) + .55);
  const up = Math.acos(clamp((shell.hc - .45 - target.y) / maxD, -1, 1));
  const polMin = Math.min(v.pol, Math.max(v.pol - TILT_UP, up)), polMax = Math.min(v.pol + TILT_DOWN, 84 * DEG);
  Object.assign(controls, { minDistance: dist * .45, maxDistance: maxD, minPolarAngle: polMin, maxPolarAngle: polMax,
    minAzimuthAngle: AZ0 - AZ_SPAN, maxAzimuthAngle: AZ0 + AZ_SPAN });
  let mx = 0, mz = 0;
  for (const az of [AZ0 - AZ_SPAN, AZ0, AZ0 + AZ_SPAN]) for (const pol of [polMin, polMax]) {
    _v.setFromSphericalCoords(maxD, pol, az).add(target);
    mx = Math.max(mx, Math.abs(_v.x)); mz = Math.max(mz, _v.z);
  }
  shell.hw = Math.max(HW0, mx + .7);
  shell.dz = Math.max(front + 3, mz + 1.2);
  sizeShell();
  aimSun();
  scene.fog.near = dist * .8; scene.fog.far = dist * 4.5;
  saved = { minDistance: controls.minDistance, minPolarAngle: polMin, maxPolarAngle: polMax };
}
// Fly toward a room object or a nimion ('m:<name>') while its panel is open; side > 0 keeps it left of a drawer.
function focusOn(id, opt = {}, snap = false) {
  if (!fit) return;
  let c, r;
  if (id.startsWith('m:')) { const m = mins.get(id.slice(2)); if (!m) return; c = new THREE.Vector3(m.x, m.y + .8, m.z); r = .9; }
  else {
    const o = objs.get(id) || (id.startsWith('desk:') && stations.get(id.slice(5)) && { group: stations.get(id.slice(5)).g });
    if (!o) return;
    const b = new THREE.Box3().setFromObject(o.group); c = b.getCenter(new THREE.Vector3()); r = b.getSize(_v).length() / 2;
  }
  const pol = c.y > 1.6 ? Math.min(fit.pol + 12 * DEG, 84 * DEG) : fit.pol, dist = clamp(r * 2.6 + 2.2, 3, fit.dist * .8);
  const F = new THREE.Vector3().setFromSphericalCoords(1, pol, fit.az), Rt = new THREE.Vector3().crossVectors(ocam.up, F).normalize();
  const side = opt.side || 0;
  c.addScaledVector(Rt, dist * Math.tan(camera.fov * DEG / 2) * camera.aspect * side); // side > 0: the target moves right, so the object sits left of centre
  held = { id, opt, az: fit.az, pol, dist, target: c };
  Object.assign(controls, { minDistance: Math.min(saved.minDistance, dist * .8), minPolarAngle: Math.min(saved.minPolarAngle, pol), maxPolarAngle: Math.max(saved.maxPolarAngle, pol) });
  zoomGoal = dist;
  lastUser = performance.now();
  if (snap || still()) { anim = null; setCam(held.az, pol, dist, c); killInertia(); }
  else { killInertia(); anim = { t0: performance.now(), dur: 900, from: camNow(), to: held }; }
  start();
}
function release() {
  if (!held) return;
  held = null;
  if (saved) Object.assign(controls, saved);
  lastUser = performance.now();
  easeFit();
  start();
}
function camNow() {
  _v.subVectors(ocam.position, controls.target);
  const s = new THREE.Spherical().setFromVector3(_v);
  return { az: s.theta, pol: s.phi, dist: s.radius, target: controls.target.clone() };
}
function setCam(az, pol, dist, target) {
  controls.target.copy(target);
  ocam.position.setFromSphericalCoords(dist, pol, az).add(target);
  ocam.lookAt(target);
}
function killInertia() { controls.enableDamping = false; controls.update(); controls.enableDamping = true; }
function snapFit() {
  anim = null;
  setCam(fit.az, fit.pol, fit.dist, fit.target);
  zoomGoal = fit.dist;
  killInertia();
  placeForeground();
}
function easeFit() {
  if (still()) return snapFit();
  killInertia();
  anim = { t0: performance.now(), dur: 900, from: camNow(), to: fit };
  zoomGoal = fit.dist;
}
const atFit = () => !!fit && ocam.position.distanceToSquared(fit.pos) < 1e-4 * fit.dist * fit.dist && controls.target.distanceToSquared(fit.target) < 1e-4;
function setZoom(d) {
  zoomGoal = clamp(d, controls.minDistance, controls.maxDistance);
  anim = null;
  lastUser = zoomAt = performance.now();
}
function updateCamera(now, dt) {
  if (!fit) return;
  if (anim) {
    const k = ease(clamp((now - anim.t0) / anim.dur, 0, 1)), a = anim.from, b = anim.to; // a frame can be stamped before t0
    setCam(a.az + wrapA(b.az - a.az) * k, a.pol + (b.pol - a.pol) * k, a.dist + (b.dist - a.dist) * k, _v2.lerpVectors(a.target, b.target, k));
    if (k >= 1) { anim = null; killInertia(); }
    return;
  }
  _v.subVectors(ocam.position, controls.target);
  const d = _v.length();
  if (Math.abs(d - zoomGoal) > 1e-3) {
    _v.setLength(still() ? zoomGoal : d + (zoomGoal - d) * (1 - Math.exp(-dt * 10)));
    ocam.position.copy(controls.target).add(_v);
  }
  controls.update();
  if (!held && !still() && !dragging && !touches.size && now - lastUser > IDLE_BACK && !atFit()) easeFit();
}
// Ask the camera to look toward a nimion for a few seconds (needs you, a report walking to the boss, envelopes).
function attend(m, ms) { if (!first && !still() && m) focus = { m, until: performance.now() + ms }; }
const contained = () => actPts.every(p => { _v.copy(p).project(camera); return Math.abs(_v.x) < .985 && Math.abs(_v.y) < .985; });
// The render camera: the orbit camera plus a slow breathing drift and a gentle lean toward the focus,
// backed off until every activity point is still on screen. Nothing of this under reduced motion or while the user steers.
function renderCam(now, dt) {
  camera.position.copy(ocam.position); camera.quaternion.copy(ocam.quaternion);
  const free = fit && !still() && !anim && !dragging && !touches.size && now - zoomAt > 800 && atFit();
  if (focus && (now > focus.until + 4000 || mins.get(focus.m.name) !== focus.m)) focus = null;
  att += ((free && focus && now < focus.until ? 1 : 0) - att) * (1 - Math.exp(-dt * 1.5));
  if (!free) { camera.updateMatrixWorld(); return; }
  const t = now / 1000;
  camera.position.x += Math.sin(t * .23) * .04; camera.position.y += Math.sin(t * .31 + 1) * .025;
  _look.copy(controls.target); _look.x += Math.sin(t * .17 + 2) * .03; _look.y += Math.sin(t * .13) * .02;
  _v2.copy(camera.position);
  if (focus && att > .003) {
    _f.set(focus.m.x, focus.m.y + .9, focus.m.z);
    for (let k = att; k > .02; k *= .5) {
      camera.position.copy(_v2).lerp(_f, .07 * k);
      camera.lookAt(_v.copy(_look).lerp(_f, .25 * k));
      camera.updateMatrixWorld();
      if (contained()) return;
    }
    camera.position.copy(_v2);
  }
  camera.lookAt(_look);
  camera.updateMatrixWorld();
}
// Put the foreground plant and counter where the bottom corners of the frame meet the floor, only if they hide nothing that matters.
function placeForeground() {
  ocam.updateMatrixWorld();
  for (const f of fg) {
    _v.set(f.ndc, -.97, .5).unproject(ocam).sub(ocam.position).normalize();
    const t = _v.y < -.05 ? -ocam.position.y / _v.y : -1;
    const p = _v2.copy(ocam.position).addScaledVector(_v, t);
    let ok = t > 0 && p.z > front + .5 && p.z < ocam.position.z - .8 && Math.abs(p.x) < shell.hw - .3;
    if (ok) {
      f.g.position.set(p.x, 0, p.z);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const dx of [-f.r, f.r]) for (const dy of [0, f.h]) for (const dz of [-f.r, f.r]) {
        _v.set(p.x + dx, dy, p.z + dz).project(ocam);
        x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
      }
      ok = !actPts.some(q => { _v.copy(q).project(ocam); return _v.x > x0 && _v.x < x1 && _v.y > y0 && _v.y < y1; });
    }
    f.g.visible = ok;
  }
}
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  vw = w; vh = h;
  renderer.setSize(w, h, false);
  camera.aspect = ocam.aspect = w / h;
  computeFit();
  if (held) focusOn(held.id, held.opt, true); else snapFit();
  if (!raf) { renderCam(performance.now(), 0); renderer.render(scene, camera); }
}

// ---------- 11. pointer input: rotate, zoom, hover, click ----------
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(hitList, false)[0];
  return h ? h.object.userData.m || h.object.userData.obj : null;
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// Hover: a nimion gets its outline, an object a yellow box; both get a name tag.
function setHover(t) {
  const m = t && t.fig ? t : null, o = t && !t.fig ? t : null;
  if (m === hovered && o === hoveredObj) return;
  if (hovered && hovered.outline) hovered.outline.visible = false;
  hovered = m; hoveredObj = o;
  if (m && m.outline) m.outline.visible = true;
  if (hoverBox) { hoverBox.visible = !!o; if (o) hoverBox.box.setFromObject(o.group).expandByScalar(.04); }
  canvas.classList.toggle('hot', !!t);
  tagEl.hidden = !t;
  tagEl.classList.toggle('obj', !!o);
  if (t) tagEl.textContent = m ? m.name : `${o.icon} ${o.label}`;
}
function clickOn(t) {
  if (!t) return;
  if (t.fig) return onClick(t.name);
  if (t.id.startsWith('desk:')) return onClick(t.id.slice(5));
  onObj(t.id);
}
let hintTm = 0;
function onWheel(e) {
  if (!full && !(e.ctrlKey || e.metaKey)) { // plain wheel scrolls the page; say how to zoom
    hintEl.classList.add('on');
    clearTimeout(hintTm); hintTm = setTimeout(() => hintEl.classList.remove('on'), 1300);
    return;
  }
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  setZoom(zoomGoal * Math.exp(clamp(dy, -40, 40) * .006));
}
function touchState(e, isDown) {
  if (e.pointerType !== 'touch') return;
  if (full) { if (isDown) touches.set(e.pointerId, [e.clientX, e.clientY]); else touches.delete(e.pointerId); return; }
  if (isDown) touches.set(e.pointerId, [e.clientX, e.clientY]); else touches.delete(e.pointerId);
  // One finger rotates only around the vertical axis, so vertical swipes stay page scrolls (touch-action: pan-y).
  if (touches.size) { if (!touchState.saved) touchState.saved = [controls.minPolarAngle, controls.maxPolarAngle]; controls.minPolarAngle = controls.maxPolarAngle = controls.getPolarAngle(); }
  else if (touchState.saved) { killInertia(); [controls.minPolarAngle, controls.maxPolarAngle] = touchState.saved; touchState.saved = null; } // flush vertical inertia while still locked
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoomGoal }; } else pinch = null;
}
function bindInput() {
  canvas.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, moved: false };
    touchState(e, true);
    lastUser = performance.now();
    anim = null;
  });
  canvas.addEventListener('pointermove', e => {
    if (down && e.buttons && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down.moved = true; canvas.classList.add('drag'); }
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > 10) setZoom(pinch.z * pinch.d / d); }
    }
    hoverAt = e.pointerType === 'mouse' && !e.buttons ? [e.clientX, e.clientY] : null;
    if (e.buttons) setHover(null);
  });
  const up = e => { touchState(e, false); canvas.classList.remove('drag'); lastUser = performance.now(); };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { hoverAt = null; setHover(null); });
  canvas.addEventListener('click', e => { // a drag that rotated is not a click
    const moved = down && down.moved;
    down = null;
    if (moved) return;
    clickOn(pickAt(e.clientX, e.clientY));
  });
  canvas.addEventListener('dblclick', () => { lastUser = performance.now(); easeFit(); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  controls.addEventListener('start', () => { dragging = true; anim = null; lastUser = performance.now(); });
  controls.addEventListener('end', () => { dragging = false; lastUser = performance.now(); });
  root.querySelector('.l3-fit').addEventListener('click', () => { lastUser = performance.now(); easeFit(); });
  roster.addEventListener('click', e => { const b = e.target.closest('.l3-rb'); if (b) onClick(b.getAttribute('data-name')); });
}

// ---------- 12. the frame loop, room life, bubbles ----------
const bubM = new THREE.Matrix4();
function animateRoom(now, dt) {
  const t = now / 1000, calm = still();
  if (now - lightAt > 60000) { lightAt = now; applyLight(); }
  const d = new Date(), sec = d.getSeconds() + (calm ? 0 : d.getMilliseconds() / 1000), min = d.getMinutes() + sec / 60;
  clockHands[0].rotation.z = -((d.getHours() % 12) + min / 60) / 12 * PI * 2; clockHands[1].rotation.z = -min / 60 * PI * 2; clockHands[2].rotation.z = -sec / 60 * PI * 2;
  if (clockG) { const k = now - ringAt; clockG.rotation.z = k < 1200 ? Math.sin(k / 28) * .1 * (1 - k / 1200) : 0; } // the ring: a short shake
  if (now - plateAt > 1000) { plateAt = now; const tx = plateText(now); if (tx !== plate.text) { plate.text = tx; drawPlate(); } } // the countdown changes once a minute, each second in the last one
  // monitors scroll a few times a second; the whiteboard fills in while the boss plans
  for (const st of stations.values()) if (st.on && st.job && st.job.kind === 'working' && !calm && now >= st.next) { st.next = now + 240; st.off++; drawMonitor(st); }
  if (feedDirty && now - feedAt > 250) { feedDirty = false; feedAt = now; drawLog(); }
  if (needsN > 0) needsMat.color.setScalar(calm ? 1 : .82 + .18 * Math.sin(t * 5));
  if (S.mrLeaf) { const want = hoveredObj && hoveredObj.id === 'mr' ? -.5 : 0; S.mrLeaf.rotation.y += (want - S.mrLeaf.rotation.y) * (calm ? 1 : 1 - Math.exp(-dt * 8)); }
  notes = notes.filter(n => flyNote(n, now));
  for (const st of stations.values()) if (st.lv !== st.goal) { // piles: a sheet drops in or lifts off about every 0.3 s
    const d = st.goal - st.lv, step = calm ? Math.abs(d) : dt * 3.5;
    st.lv = Math.abs(d) <= step ? st.goal : st.lv + Math.sign(d) * step;
    pile(st);
  }
  if (drops.length) drops = drops.filter(d => stepDrop(d, now));
  stepConfetti(now, dt);
  const shown = wbOn && !calm ? Math.floor((t / .8) % (WB.length + 3)) : WB.length;
  if (shown !== wbShown) { wbShown = shown; drawBoard(Math.min(WB.length, shown)); }
  vis(bubbles, !calm); vis(dust, !calm);
  if (calm) return;
  liqMats.forEach((m, i) => { m.emissiveIntensity = .8 + .3 * Math.sin(t * 1.5 + i); });
  bubbleSrc.forEach((p, i) => {
    for (let k = 0; k < 2; k++) {
      const u = (t * .6 + i * .37 + k * .5) % 1;
      bubM.makeScale(1.4 * (1 - u), 1.4 * (1 - u), 1.4 * (1 - u)).setPosition(p[0] + (k - .5) * .03, p[1] + u * .16, p[2] + Math.sin(t * 3 + i + k) * .015);
      bubbles.setMatrixAt(i * 2 + k, bubM);
    }
  });
  bubbles.instanceMatrix.needsUpdate = true;
  steam.forEach((s, i) => {
    const u = (t / 2.8 + i / 3) % 1;
    s.position.set(CUP[0] + Math.sin(t * 2 + i * 2) * .03, .7 + u * .4, CUP[2]);
    s.material.opacity = Math.sin(u * PI) * .55;
    s.scale.setScalar(.08 + u * .14);
  });
  const pos = dust.geometry.attributes.position, wh = WIN.y1 - WIN.y0;
  dustSrc.forEach((p, i) => {
    p[2] = (p[2] + dt * p[3] * .2) % 1;
    const y0 = WIN.y0 + p[1] * wh, s = p[2] * y0 / -beamDir.y;
    pos.setXYZ(i, WIN.x0 + p[0] * (WIN.x1 - WIN.x0) + beamDir.x * s + Math.sin(t * .7 + i) * .05, y0 + beamDir.y * s + Math.sin(t * .5 + i * 2) * .04,
      .05 + beamDir.z * s + Math.sin(t * .6 + i) * .04);
  });
  pos.needsUpdate = true;
  for (const p of plants) p.g.rotation.z = Math.sin(t * 1.2 + p.ph) * .035;
  leds.forEach((l, i) => l.material.color.set(Math.sin(t * (3 + i * 1.7) + i) > .3 ? (i === 2 ? '#ffb020' : '#36d96f') : '#1c2a22'));
  if (!ballBusy) cornerBall.position.y = .17 + Math.abs(Math.sin(t * 2.4)) * .32;
}

// Bubble = [kind, short text for narrow screens, full text].
function bubbleOf(m, now) {
  const c = m.cur;
  if (c && c.bub) return ['flash', c.bub, c.bub];
  if (c && c.sc) return null;
  if (m.mode !== 'idle') return m.mb;
  const mate = c && c.spot && c.spot.pair && c.spot.pair.who;
  if (c && c.say && c.arrived && mate && mate.cur && mate.cur.arrived && mate.cur.spot === c.spot.pair && (now / 2200 + (m.idx & 1)) % 2 < 1) return ['chat', '💬', c.say];
  return null;
}
function showBub(m, on) { if (m.bvis !== on) { m.bvis = on; m.bub.hidden = !on; } }
// Bubbles follow the heads; when they would overlap, the less urgent ones shrink to an icon or hide.
function overlay(now) {
  const narrow = vw < 520, crowd = mins.size > 6, items = [];
  for (const m of mins.values()) {
    const b = bubbleOf(m, now), key = b ? b.join('\u0001') : '';
    if (key !== m.bk) {
      m.bk = key;
      if (b) {
        m.bub.setAttribute('data-k', b[0]); m.bub.firstChild.textContent = b[1]; m.bub.lastChild.textContent = b[2]; m.bub.title = b[2];
        m.bw = Math.min(crowd ? 120 : 170, 20 + [...b[2]].length * (crowd ? 5.6 : 6.2) + (b[0] === 'needs' ? 19 : 0));
      }
    }
    if (!b) { showBub(m, false); continue; }
    _v.set(m.x, m.y + (m.fig.position.y + TOP + R + (m.alert.visible ? .52 : .12)) * m.g.scale.y, m.z).project(camera); // above the "!" when it shows
    if (_v.z > 1 || Math.abs(_v.x) > 1.02 || Math.abs(_v.y) > 1.02) { showBub(m, false); continue; }
    items.push({ m, k: b[0], x: (_v.x + 1) / 2 * vw, y: (1 - _v.y) / 2 * vh, z: _v.z });
  }
  items.sort((a, b) => (PRI[b.k] - PRI[a.k]) || (a.z - b.z));
  const placed = [], hit = r => placed.some(p => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
  items.forEach((it, i) => {
    const m = it.m, rect = w => [it.x - w / 2, it.y - (crowd ? 19 : 22), it.x + w / 2, it.y];
    let mini = narrow, r = rect(mini ? 30 : m.bw);
    if (hit(r) && !mini) { mini = true; r = rect(30); }
    if (hit(r) && it.k !== 'needs') { showBub(m, false); return; }
    placed.push(r);
    showBub(m, true);
    if (mini !== m.bmini) { m.bmini = mini; m.bub.classList.toggle('mini', mini); }
    const tf = `translate(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px) translate(-50%,-100%)`;
    if (tf !== m.btf) m.bub.style.transform = m.btf = tf;
    const z = String(items.length - i + (it.k === 'needs' ? 100 : 0));
    if (z !== m.bz) m.bub.style.zIndex = m.bz = z;
  });
  if (hoveredObj) {
    const b = hoverBox.box; _v.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(camera);
    tagEl.style.transform = `translate(${((_v.x + 1) / 2 * vw).toFixed(1)}px,${((1 - _v.y) / 2 * vh - 30).toFixed(1)}px) translate(-50%,0)`;
  } else if (hovered) {
    _v.set(hovered.x, hovered.y, hovered.z).project(camera);
    tagEl.style.transform = `translate(${((_v.x + 1) / 2 * vw).toFixed(1)}px,${((1 - _v.y) / 2 * vh + 4).toFixed(1)}px) translate(-50%,0)`;
  }
}

function frame(now) {
  raf = 0;
  if (!root || document.hidden || !onScreen || lost) return;
  const dt = Math.min(.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!first && !still() && !arcadeOn && now > gameAt) { gameAt = now + rand(4000, 9000); if (games.length < 2 && Math.random() < .6) startGame(pick(Object.keys(GAMES)), now); }
  if (games.length) games = games.filter(G => gameStep(G, now, dt));
  for (const m of Array.from(mins.values())) tick(m, now, dt);
  if (flyers.length) flyers = flyers.filter(f => fly(f, now));
  animateRoom(now, dt);
  if (needFit && fit) { needFit = false; const was = atFit(); computeFit(); if (held) focusOn(held.id, held.opt, true); else if (was || still()) snapFit(); else placeForeground(); }
  updateCamera(now, dt);
  renderCam(now, dt);
  if (hoverAt && !dragging) setHover(pickAt(hoverAt[0], hoverAt[1]));
  renderer.render(scene, camera);
  overlay(now);
  raf = requestAnimationFrame(frame);
}
function start() {
  if (root && !raf && !document.hidden && onScreen && !lost) { last = performance.now(); raf = requestAnimationFrame(frame); }
}

// ---------- 13. state: crew, modes, transitions, roster ----------
function live(l) {
  if (l && l.k === 'tool') return ['work', '🔧', '🔧 ' + l.t];
  if (l && l.k === 'say') { // first line, without markdown marks, so the bubble reads as plain words
    const t = String(l.t == null ? '' : l.t).trim().split('\n')[0].replace(/^\s*(?:[-*+]|\d+\.|#+)\s+/, '').replace(/[*_`#]/g, '').trim();
    if (t) return ['work', '💬', t];
  }
  return ['work', '💭', 'Thinking…'];
}
function syncCrew(crew) {
  const list = [], names = new Set();
  for (const c of crew) if (c && typeof c.name === 'string' && c.name && !names.has(c.name)) { names.add(c.name); list.push(c); }
  const sig = JSON.stringify(list.map(c => [c.name, c.title || '', !!c.boss, c.look || {}]));
  if (sig === crewSig) return;
  crewSig = sig;
  const bossC = list.find(c => c.boss) || null;
  for (const m of Array.from(mins.values())) if (!names.has(m.name)) removeNimion(m);
  list.forEach((c, i) => {
    const m = mins.get(c.name) || createNimion(c.name), isBoss = c === bossC;
    const look = c.look && typeof c.look === 'object' ? c.look : {}, lsig = JSON.stringify(look);
    m.idx = i;
    if (m.tint !== COLORS[i % COLORS.length]) { m.tint = COLORS[i % COLORS.length]; if (m.look === 'lit') m.look = ''; m.lsig = null; } // what it wears is in its tint: build it again
    m.bub.style.setProperty('--tint', m.tint);
    if (lsig !== m.lsig) { m.lsig = lsig; buildFig(m, look); }
    if (m.boss !== isBoss) {
      if (isBoss && m.boss === null) { m.x = BOSS_SEAT[0]; m.z = BOSS_SEAT[1]; }
      m.boss = isBoss;
      m.g.scale.setScalar(isBoss ? 1.12 * MS : MS);
      m.script.length = 0;
      endStep(m);
    }
  });
  boss = Array.from(mins.values()).find(m => m.boss) || null;
  root.classList.toggle('crowd', mins.size > 6);
  layout(list.filter(c => c !== bossC).map(c => c.name));
  for (const st of stations.values()) { const m = mins.get(st.name); if (m && st.tint !== m.tint) { st.tint = m.tint; styleStation(st); if (st.on) drawMonitor(st); } }
  roster.innerHTML = list.map(c => `<button type="button" class="l3-rb" data-name="${esc(c.name)}"><i aria-hidden="true"></i><b>${esc(c.name)}</b>` +
    `<span class="ti">${esc(c.title || '')}</span><span class="ch"></span></button>`).join('');
  for (const b of roster.children) {
    const m = mins.get(b.getAttribute('data-name'));
    if (m) { m.rb = b; m.rchip = null; b.style.setProperty('--tint', m.tint); }
  }
}
function removeNimion(m) {
  endStep(m);
  for (const s of SPOTS) if (s.who === m) s.who = null;
  if (hovered === m) setHover(null);
  scene.remove(m.g);
  dropTone(m.tone);
  m.bub.remove();
  hitList.splice(hitList.indexOf(m.hit), 1);
  mins.delete(m.name);
  if (boss === m) boss = null;
}

function update(S) {
  if (!root || !S || !Array.isArray(S.crew)) return;
  const now = performance.now();
  syncCrew(S.crew);
  const tasks = Array.isArray(S.tasks) ? S.tasks.filter(t => t && typeof t === 'object') : [];
  const aps = Array.isArray(S.approvals) ? S.approvals.filter(a => a && typeof a === 'object') : [];
  const by = new Map();
  for (const t of tasks) if (mins.has(t.nimion)) { if (!by.has(t.nimion)) by.set(t.nimion, []); by.get(t.nimion).push(t); }

  // Transitions: compare each task's status with the last push. Nothing fires for tasks present at the first update.
  const bossTasks = new Set(boss ? (by.get(boss.name) || []).map(t => t.id) : []);
  const tossTo = [], nowSeen = new Map(), doneNow = [];
  for (const t of tasks) {
    if (t.id == null) continue;
    const p = seen.get(t.id), m = mins.get(t.nimion);
    nowSeen.set(t.id, t.status);
    if (p === undefined && t.schedule && !first && !still()) { ringAt = now; plate.ring = String(t.title || '').replace(/^⏰\s*/, ''); } // a scheduled run just started: the clock rings
    if (first || still() || !m || m.boss || p === t.status) continue; // reduced motion: show only the state, no scenes
    if (p === 'working' && t.status === 'done') doneNow.push([t, m]);
    else if (p === 'working' && (t.status === 'failed' || t.status === 'stopped')) { play(m, failScript(m)); attend(m, 6000); }
    else if (p === undefined && t.parent != null && bossTasks.has(t.parent) && !tossTo.includes(m)) tossTo.push(m);
  }
  seen = nowSeen;
  for (const [t, m] of doneNow) { // hand-off: a step that waited for this one goes to another nimion, who gets the papers on the desk
    const q = tasks.find(u => u.status !== 'done' && u.nimion !== m.name && [].concat(u.after ?? []).includes(t.id) && mins.has(u.nimion) && !mins.get(u.nimion).boss);
    play(m, doneScript(m, q && mins.get(q.nimion)));
    attend(m, 6000);
  }
  const bossFree = !!boss && !(boss.cur && boss.cur.sc) && !aps.some(a => a.nimion === boss.name) && !(by.get(boss.name) || []).some(t => t.status === 'working' || t.status === 'needs-you');

  // Schedules: the next run per nimion (desk monitors and alarm clocks), the plate under the clock, the board's "Next up".
  const upcoming = (Array.isArray(S.schedules) ? S.schedules : []).filter(x => x && !x.paused && x.nextAt).sort((a, b) => a.nextAt - b.nextAt);
  plate.next = upcoming[0] || null; plate.held = (S.sched && S.sched.held) || null;
  const nextUp = upcoming.filter(x => x.nextAt - Date.now() < 86400_000).slice(0, 3)
    .map(x => `${new Date(x.nextAt).toDateString() === new Date().toDateString() ? '' : new Date(x.nextAt).toLocaleDateString([], { weekday: 'short' }) + ' '}${hhmm(x.nextAt)} ${x.name} · ${x.nimion}`);
  // Activity per nimion.
  const count = { working: 0, needs: 0, waiting: 0, paused: 0, idle: 0 }, busy = [], bars = [];
  for (const m of mins.values()) {
    const mine = by.get(m.name) || [];
    const w = mine.find(t => t.status === 'working'), q = mine.filter(t => t.status === 'queued').length;
    const ap = aps.find(a => a.nimion === m.name), ask = mine.find(t => t.status === 'needs-you');
    const mode = ap || ask ? 'needs' : w ? 'working' : q ? (S.breaker ? 'paused' : 'waiting') : 'idle';
    m.mb = mode === 'needs' ? ['needs', '', ap ? `May I use ${ap.tool || 'a tool'}?` : 'I have a question']
      : mode === 'working' ? live(w.last) : mode === 'waiting' ? ['wait', '⌚', `⌚ Waiting · ${q} queued`]
      : mode === 'paused' ? ['zzz', 'zzz', 'zzz… paused by the usage limit'] : null;
    m.chip = mode === 'working' ? `Working on #${w.id}` : CHIP[mode];
    if (mode !== m.mode) {
      m.mode = mode;
      if (mode === 'working') m.busyAt = now;
      if (mode === 'needs') { m.script.length = 0; attend(m, 4000); } // asking the human beats any little scene
      if (!m.cur || !m.cur.sc || mode === 'needs') endStep(m);
    }
    count[mode]++;
    bars.push(mode === 'working' ? m.tint : mode === 'needs' ? '#e08a00' : mode === 'waiting' ? '#7fa3d9' : mode === 'paused' ? '#6f6c7a' : '#3a4560');
    if (mode !== 'idle') busy.push(`${m.name} ${m.chip.toLowerCase()}`);
    if (m.rb && m.rchip !== m.chip + mode) { m.rchip = m.chip + mode; m.rb.lastChild.textContent = m.chip; m.rb.setAttribute('data-m', mode); }
    const st = stations.get(m.name);
    if (st) { // the desk: the job on the monitor, queued jobs in the in-tray
      const qt = mine.filter(t => t.status === 'queued'), jt = ask || (ap && tasks.find(t => t.id === ap.taskId)) || w || qt[0];
      const kind = mode === 'needs' ? 'needs' : mode === 'working' ? 'working' : mode === 'paused' ? 'paused' : jt ? 'queued' : null;
      const soon = !kind && upcoming.find(x => x.nimion === m.name && x.nextAt - Date.now() < 3600_000); // idle, with a scheduled run in the coming hour
      const job = kind && jt ? { kind, id: jt.id, title: String(jt.title || '') } : soon ? { kind: 'sched', id: soon.id, title: `${hhmm(soon.nextAt)} ${soon.name}` } : null, jsig = job ? `${job.kind}|${job.id}|${job.title}|${st.tint}` : '';
      st.alarm.visible = (S.schedules || []).some(x => x && x.nimion === m.name && !x.paused);
      if (jsig !== st.jsig) { st.jsig = jsig; st.job = job; setStationOn(st, !!job); }
      setTray(st, qt.length, first || still());
    }
  }
  if (tossTo.length) handOut(tossTo, now, bossFree);
  wbOn = !!boss && boss.mode === 'working';
  const scr = count.needs ? `${count.working} working · ${count.needs} need${count.needs > 1 ? '' : 's'} you`
    : count.working ? `${count.working} working` : S.breaker ? 'paused: usage limit' : 'all quiet';
  const day0 = new Date().setHours(0, 0, 0, 0), ended = t => (t.started || t.created || 0) + (t.ms || 0);
  const SHORT = { 'needs-you': 'needs you', done: '✓', failed: '✗', stopped: 'stopped' };
  const rows = (globalThis.HQW ? HQW.boardGroups(tasks, boss && boss.name) : [])
    .filter(g => !g.finished || Math.max(...(g.root ? [g.root] : []).concat(g.items).map(ended)) >= day0)
    .map(g => ({ title: g.title, status: g.status, finished: g.finished, done: g.done, total: g.total, icon: { thread: '📨', direct: '🎯', sched: '⏰' }[g.kind],
      steps: g.items.slice(0, 8).map(t => `${t.nimion} ${SHORT[t.status] || t.status}`).join(' · ') + (g.items.length > 8 ? ` · +${g.items.length - 8}` : '') }));
  const msig = scr + JSON.stringify(rows) + nextUp.join();
  if (msig !== screenSig) { screenSig = msig; drawMission(rows, scr, nextUp); }
  plateAt = 0; // redraw the plate on the next frame
  const nn = aps.length + tasks.filter(t => t.status === 'needs-you').length;
  if (nn !== needsN) { needsN = nn; drawNeeds(nn); }
  if (Array.isArray(S.context) && S.context.length !== ctxN) { ctxN = S.context.length; drawCtx(ctxN); }
  const memo = S.memory || {}, mem = typeof memo.text === 'string' ? memo.text : '';
  if (mem !== guideSig) { // when the boss saves guidance from a chat, a note flies to the board and is pinned
    const items = mem.split('\n').map(l => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
    const byBoss = !first && memAt !== null && memo.at !== memAt && !/^you/.test(memo.by || '');
    guideSig = mem; memAt = memo.at || 0;
    if (byBoss && !still()) { pinNote(items); if (boss) play(boss, [{ to: null, pose: 'nod', dur: 1500, bub: '📌 Noted', face: 'cam' }]); }
    else drawGuide(items);
  }
  const label = `Crew lab with ${mins.size} nimions. ${busy.length ? busy.join('; ') + '. ' : ''}${count.idle ? count.idle + ' idle.' : ''}`;
  if (label !== labelSig) canvas.setAttribute('aria-label', labelSig = label);
  first = false;
  start();
}

// ---------- 14. API ----------
function mount3d(el, opts) {
  full = !!(opts && opts.full);
  onObj = opts && typeof opts.onObjectClick === 'function' ? opts.onObjectClick : () => {};
  if (!document.getElementById('lab3d-style')) {
    const st = document.createElement('style');
    st.id = 'lab3d-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  el.innerHTML = '<div class="l3"><div class="l3-wrap"><div class="l3-bubs" aria-hidden="true"></div><div class="l3-tag" aria-hidden="true" hidden></div>' +
    `<div class="l3-hint" aria-hidden="true">${/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl'} + scroll or pinch to zoom · drag to look around</div>` +
    '<button type="button" class="l3-fit" title="Show the whole lab (double-click works too)">⟲ Fit</button><div class="l3-msg" role="status" hidden></div></div>' +
    '<div class="l3-roster" role="group" aria-label="Crew status" aria-live="polite"></div></div>';
  root = el.firstChild;
  root.classList.toggle('full', full);
  wrap = root.firstChild;
  bubLayer = root.querySelector('.l3-bubs'); tagEl = root.querySelector('.l3-tag'); hintEl = root.querySelector('.l3-hint');
  msgEl = root.querySelector('.l3-msg'); roster = root.querySelector('.l3-roster');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(full ? 1.5 : 2, window.devicePixelRatio || 1)); // full screen: keep a laptop at 60 fps
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Crew lab');
  wrap.prepend(canvas);
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#fff8e1', 10, 60);
  room = new THREE.Group(); fxGroup = new THREE.Group();
  scene.add(room, fxGroup);
  camera = new THREE.PerspectiveCamera(48, 1, .1, 300);
  ocam = new THREE.PerspectiveCamera(48, 1, .1, 300);
  controls = new OrbitControls(ocam, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: .08, enablePan: false, enableZoom: false, rotateSpeed: .45 });
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: null, RIGHT: null };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  canvas.style.touchAction = 'pan-y'; // OrbitControls sets 'none'; keep vertical page scrolling on phones
  buildRoom();
  hoverBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd84d);
  hoverBox.visible = false;
  scene.add(hoverBox);
  buildLights();
  applyTheme();
  bindInput();
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); lost = true;
    msgEl.textContent = 'The 3D view lost its graphics context. It comes back on its own; the roster below stays live.'; msgEl.hidden = false;
  });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; gen++; msgEl.hidden = true; screenSig = ''; plate.text = ''; wbShown = -1; start(); });
  new ResizeObserver(resize).observe(wrap);
  new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; start(); }).observe(wrap);
  document.addEventListener('visibilitychange', start);
  const rethem = () => { applyTheme(); if (!raf) renderer.render(scene, camera); };
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rethem);
  new MutationObserver(rethem).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  resize();
  start();
  if (full) {
    hintEl.textContent = 'Click anything in the room · drag to look around · scroll to zoom · double-click to refit · ? for keyboard shortcuts';
    hintEl.classList.add('on'); clearTimeout(hintTm); hintTm = setTimeout(() => hintEl.classList.remove('on'), 5000);
  }
}
function mount(el, opts) {
  if (root || !el) return;
  onClick = opts && typeof opts.onNimionClick === 'function' ? opts.onNimionClick : () => {};
  try {
    if (!webgl2()) throw new Error('WebGL 2 is not available.');
    mount3d(el, opts);
  } catch (err) { // no WebGL2, or it was refused at runtime: the page shows what is needed
    console.warn('Nimion HQ: the 3D office could not start.', err);
    if (renderer) renderer.dispose();
    root = null;
    el.innerHTML = '';
  }
}
const live3d = () => !!root;
const Lab3D = {
  mount, update, props: PROPS.slice(), styles: STYLES.slice(),
  get world() { return live3d() && full; },
  get objects() { return [...objs.values()].map(({ id, icon, label }) => ({ id, icon, label })); },
  focus(id, opt) { if (live3d()) focusOn(String(id), opt || {}); },
  release() { if (live3d()) release(); },
  feed(l) { if (!live3d() || !l) return; feedLines.push(l); if (feedLines.length > 40) feedLines.shift(); feedDirty = true; },
  arcade(on) { // while the human plays, idle nimions gather at the arcade and cheer
    if (!live3d() || arcadeOn === !!on) return;
    arcadeOn = !!on;
    for (const m of mins.values()) if (m.mode === 'idle' && !(m.cur && m.cur.sc)) endStep(m);
  },
  sky(mode) { // 'auto' follows the local clock; 'day' is midday, 'night' midnight
    skyMode = mode === 'day' || mode === 'night' ? mode : 'auto';
    if (!live3d()) return;
    dayKey = ''; applyLight();
    if (!raf) renderer.render(scene, camera);
  },
  react(kind) { if (live3d() && (kind === 'win' || kind === 'lose')) { reactAll(kind); start(); } },
  deliverables(n) { n = Math.max(0, Math.floor(Number(n)) || 0); if (live3d() && n !== filesN) { filesN = n; drawFiles(n); if (!raf) renderer.render(scene, camera); } },
  game(kind) { if (!live3d() || still() || arcadeOn) return false; const ok = startGame(Object.hasOwn(GAMES, kind) ? kind : pick(Object.keys(GAMES)), performance.now()); start(); return ok; },
};

function webgl2() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    if (!gl) return false;
    const x = gl.getExtension('WEBGL_lose_context');
    if (x) x.loseContext();
    return true;
  } catch { return false; }
}
if (typeof window !== 'undefined') window.Lab = Lab3D;
