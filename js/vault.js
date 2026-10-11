// =============================================================================
// vault.js : the opening scene of the site (a locked diary on a sunny desk).
//
// What it shows, in plain words:
//   1. A bright, soft desk in daylight. A pastel lavender diary with a few cute
//      stickers lies closed, held shut by a pink strap and a tiny gold heart lock.
//      Overlay: "How a Founder Is Made", "Israel Edition", a credit line, and
//      "Scroll to turn the key".
//   2. On the first scroll / swipe / click / Enter, a small gold key glides in
//      and turns so you can read its engraving: "To one of the world's premier
//      startup cultures". It slides into the heart lock and turns. The strap
//      lifts off.
//   3. The cover swings open, two pages turn over, and the first page writes
//      itself: "How a founder is made", then a pastel "ISRAEL EDITION" stamp.
//   4. Two pencil sketches draw themselves stroke by stroke, uncoloured (Omer
//      in Modiin, Shira on a kibbutz), labels are written under them, and
//      "Pick a path".
//   5. The visitor clicks (or Tab + Enter) one sketch. It colours in with a
//      quick felt-tip "marker fill", the camera glides into it until it fills
//      the screen, then onOpen('omer' | 'shira').
//
// How the rest of the site uses it:
//   import { mountVault } from './js/vault.js';
//   const vault = mountVault({ container, onOpen, onSound, paths });
//   vault.open();     // start the sequence (same as the visitor scrolling)
//   vault.destroy();  // free GPU memory, remove listeners and DOM
//
// Everything is built in code. Textures (desk, cover, paper, engraving,
// handwriting, drawings) are painted onto <canvas> elements at startup.
// =============================================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// -----------------------------------------------------------------------------
// Words
// -----------------------------------------------------------------------------
const COPY = {
  titleA: 'How a Founder',
  titleB: 'Is Made',
  edition: 'Israel Edition',
  credit: 'A film by Aiden Karo & Guy Taylor',
  cue: 'Scroll to turn the key',
  hintMouse: 'Click the drawing to begin',
  hintTouch: 'Tap a drawing to begin',
};
const KEY_LINES = ['To one of the world’s', 'premier startup cultures']; // engraved on the key
const HAND_LINES = ['How a founder', 'is made'];                              // written on the page
const STAMP_TEXT = 'ISRAEL EDITION';
const PICK_TEXT = 'Pick a path';
// paths[0] is the LEFT drawing (Omer, white stone city), paths[1] the RIGHT one
// (Shira, kibbutz). "Name · Place" labels are written as two lines.
const DEFAULT_PATHS = [
  { id: 'omer', label: 'Omer · Modiin' },
  { id: 'shira', label: 'Shira · a kibbutz in the Galilee' },
];

// -----------------------------------------------------------------------------
// Colours (pastel diary look, matched to the site's notebook pages)
// -----------------------------------------------------------------------------
const GRAPHITE = '50,54,72'; // cool pencil grey for the sketches
const C = {
  bg: '#f4ede3',                 // warm white room
  paper: [251, 248, 241],        // #FBF8F1
  rule: 'rgba(140,170,220,0.45)',   // drawn a little thicker so it survives the 3D view
  margin: 'rgba(240,150,160,0.6)',
  ink: '#3a4a6b',                // soft navy pen
  stamp: [118, 152, 214],        // pastel blue rubber stamp
  coverEdge: '#cbc3ea',          // lavender (#DCD6F2) cover, slightly deeper on the edges
  strap: '#f2b6c4',              // pink strap
  gold: 0xeac46e,
  skin: '#f3cba8', cheek: 'rgba(242,150,150,0.5)',
};

// -----------------------------------------------------------------------------
// Book measurements (1 unit is roughly 10 cm). The diary lies on the desk at the
// origin, spine on the left (-x), top of the page pointing away from us (-z).
// -----------------------------------------------------------------------------
const BOOK_W = 2.2, BOOK_D = 3.0;   // cover size
const BOARD = 0.05;                 // cover board thickness
const BLOCK_TOP = 0.37;             // y of the page we write on
const PAGE_W = 2.1, PAGE_D = 2.88;  // page size
const PAGE_X0 = -1.1;               // page's left edge (at the spine, so no gap in the gutter)
const COVER_OPEN = Math.PI + 0.1;   // final cover angle (leans onto the desk)
const CORNER = 0.16;                // rounded corner radius of the diary
const LOCK = new THREE.Vector3(0.74, BLOCK_TOP + BOARD, 0);   // heart lock centre on the cover
const LOCK_TOP = 0.058;                                        // height of the heart
const KEYHOLE = new THREE.Vector3(LOCK.x, LOCK.y + LOCK_TOP + 0.002, 0);
const KEY_S = 0.74;                                            // key scale (small and cute)

// Page layout, in page units: x from the page's left edge, y from its TOP edge.
const RULE0 = 0.30, RULE = 0.115, MARGIN_X = 0.32;
const ruleY = (k) => RULE0 + k * RULE;
const INK_TOP = 0.12, INK_BOTTOM = 2.3;          // area that can hold ink
const TITLE = { cx: 1.2, fs: 0.27, rules: [1, 3] };
const STAMP = { cx: 1.52, cy: 0.79, h: 0.135, rot: -0.07, fs: 0.062 };
// The film follows Shira only: her drawing sits centered, Omer's card is parked off the page and never drawn.
const SHIRA_ONLY = true;
const CARDS = SHIRA_ONLY ? [
  { x: -4, y: 0.93, w: 0.78, h: 0.7 },    // Omer (unused, off the page)
  { x: 0.83, y: 0.93, w: 0.78, h: 0.7 },  // Shira, centered on the page
] : [
  { x: 0.4, y: 0.93, w: 0.78, h: 0.7 },   // left  (paths[0])
  { x: 1.25, y: 0.93, w: 0.78, h: 0.7 },  // right (paths[1])
];
const SHOWN = (i) => !SHIRA_ONLY || i === 1;
const LABEL = { nameRule: 13, nameFs: 0.16, placeRule: 14, placeFs: 0.11 };
const PICK = { cx: 1.21, rule: 16, fs: 0.105 };

// -----------------------------------------------------------------------------
// Timeline, in seconds after the trigger. One main motion at a time.
// -----------------------------------------------------------------------------
const TL = {
  keyArrive: 1.3,       // key settles in front of the camera, blade facing us
  readEnd: 2.4,         // end of the "read the engraving" hold
  aboveLock: 3.0,       // key hovers over the keyhole, tip down
  inserted: 3.3,        // key fully in
  turn: [3.36, 0.36],   // [start, duration] of the quarter turn (clunk at the end)
  hasp: [3.74, 0.45],   // strap lifts off
  keyOut: [3.8, 0.6],   // key slides out and away
  cover: [4.55, 1.35],  // cover swings open (camera holds still)
  pages: [4.95, 0.26, 1.15], // [first start, stagger, duration] of 2 turning pages
  write: [6.5, 4.6],    // [start, duration] of all writing and drawing
  colorIn: 0.8,         // the picked sketch colours in
  pickPush: 1.7,        // then the camera glides into it
};
// Inside the writing window (seconds after TL.write[0]).
const WR = {
  title: [0, 1.6],
  stamp: 1.75,
  sketch: [1.95, 3.75], // the two pencil sketches draw themselves
  labels: [[3.3, 3.9], [3.55, 4.2]],
  pick: [4.1, 4.45],
};
const PICK_READY = TL.write[0] + 3.3;

// =============================================================================
// Small maths helpers
// =============================================================================
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const seg = (t, start, dur) => clamp((t - start) / dur); // progress of a time window
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);   // "power3.out"
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// Seeded random numbers so the textures look the same on every visit.
function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth "value noise" (used very lightly, for wood grain and paper tooth).
function makeNoise(rand) {
  const N = 256, tab = new Float32Array(N * N);
  for (let i = 0; i < tab.length; i++) tab[i] = rand();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    const a = tab[y0 * N + x0], b = tab[y0 * N + x1], c = tab[y1 * N + x0], d = tab[y1 * N + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Keyframe track with smooth (Hermite) interpolation.
// keys: [{ t, hold?, <field>: [x, y, z] }]. "hold" = ease to a full stop there.
function sampleTrack(keys, t, field) {
  if (t <= keys[0].t) return keys[0][field].slice();
  const last = keys[keys.length - 1];
  if (t >= last.t) return last[field].slice();
  let i = 0;
  while (t > keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const h = k1.t - k0.t, s = (t - k0.t) / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const tan = (j, c) => {
    const k = keys[j];
    if (k.hold || j === 0 || j === keys.length - 1) return 0;
    return 0.8 * (keys[j + 1][field][c] - keys[j - 1][field][c]) / (keys[j + 1].t - keys[j - 1].t);
  };
  return k0[field].map((v0, c) => h00 * v0 + h10 * h * tan(i, c) + h01 * k1[field][c] + h11 * h * tan(i + 1, c));
}

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// A rounded rectangle as a THREE.Shape (centred on 0,0). The spine side (left)
// can stay square.
function roundedRectShape(w, h, r, { roundLeft = true } = {}) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2, rl = roundLeft ? r : 0;
  s.moveTo(x + rl, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + rl, y + h);
  if (rl) s.quadraticCurveTo(x, y + h, x, y + h - rl);
  s.lineTo(x, y + rl);
  if (rl) s.quadraticCurveTo(x, y, x + rl, y);
  return s;
}

// =============================================================================
// Procedural textures
// =============================================================================

// Pale wood desk: soft, low-contrast grain running left to right.
function makeDeskTexture(W, H, rand) {
  const noise = makeNoise(rand);
  const [c, x] = canvas2d(W, H);
  const img = x.createImageData(W, H);
  const sc = 2048 / W, plankH = H / 4;
  for (let y = 0; y < H; y++) {
    const p = Math.floor(y / plankH), py = y - p * plankH, off = p * 71.3, fy = y * sc;
    const seam = Math.min(py, plankH - py) * sc;
    for (let xx = 0; xx < W; xx++) {
      const fx = xx * sc;
      const warp = noise(fx * 0.0018 + off, fy * 0.006) * 3;
      const grain = Math.sin(fy * 0.3 + warp * 5);
      const fibre = noise(fx * 0.05 + off, fy * 1.6) - 0.5;
      const broad = noise(fx * 0.001 + off, fy * 0.004) - 0.5;
      let v = grain * 0.035 + fibre * 0.05 + broad * 0.08;
      if (seam < 2) v -= 0.08;
      const i = (y * W + xx) * 4;
      img.data[i] = 236 + v * 120; img.data[i + 1] = 222 + v * 125; img.data[i + 2] = 202 + v * 130; img.data[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.repeat.set(3, 2.5);
  return t;
}

// Clipart sticker: white die-cut border, flat colour, soft navy outline.
function sticker(x, drawPath, fill, lw) {
  x.save(); x.lineJoin = 'round'; x.lineCap = 'round';
  drawPath(); x.strokeStyle = '#ffffff'; x.lineWidth = lw * 4.2; x.stroke();
  drawPath(); if (fill) { x.fillStyle = fill; x.fill(); }
  x.strokeStyle = C.ink; x.lineWidth = lw; x.stroke();
  x.restore();
}

// Lavender cloth cover with three stickers: a star, a sun and an olive branch.
function makeCoverTexture(W, H, rand) {
  const noise = makeNoise(rand);
  const [c, x] = canvas2d(W, H);
  const img = x.createImageData(W, H);
  const base = [220, 214, 242]; // #DCD6F2
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const weave = (Math.sin(xx * 1.4) * Math.sin(y * 1.4)) * 2.2 + (noise(xx * 0.4, y * 0.4) - 0.5) * 5; // faint linen
    const i = (y * W + xx) * 4;
    img.data[i] = base[0] + weave; img.data[i + 1] = base[1] + weave; img.data[i + 2] = base[2] + weave; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const s = W / 1024, lw = 7 * s;
  // star
  sticker(x, () => {
    x.beginPath();
    const cx = W * 0.27, cy = H * 0.2, R = 92 * s;
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? R * 0.5 : R;
      if (k) x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    x.closePath();
  }, '#ffe08f', lw);
  // sun: rays, then the face
  const sx = W * 0.8, sy = H * 0.15;
  sticker(x, () => {
    x.beginPath();
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12, rr = (k % 2 ? 68 : 92) * s;
      if (k) x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); else x.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    x.closePath();
  }, '#ffc98f', lw);
  sticker(x, () => { x.beginPath(); x.arc(sx, sy, 54 * s, 0, Math.PI * 2); }, '#ffe08f', lw);
  // olive branch
  const bx = W * 0.5, by = H * 0.76;
  const stem = (t) => [bx - 190 * s + t * 380 * s, by + 70 * s - t * 150 * s - Math.sin(t * Math.PI) * 40 * s];
  sticker(x, () => { x.beginPath(); for (let k = 0; k <= 20; k++) { const [px, py] = stem(k / 20); if (k) x.lineTo(px, py); else x.moveTo(px, py); } }, null, lw);
  for (let k = 0; k < 7; k++) {
    const [px, py] = stem((k + 0.6) / 7.4);
    for (const side of [-1, 1]) {
      const a = -0.35 + side * 0.95 + (rand() - 0.5) * 0.15;
      sticker(x, () => { x.beginPath(); x.ellipse(px + Math.cos(a) * 36 * s, py + Math.sin(a) * 36 * s, 40 * s, 15 * s, a, 0, Math.PI * 2); },
        side > 0 ? '#a9d38f' : '#c1e2a8', lw * 0.8);
    }
  }
  sticker(x, () => { x.beginPath(); x.ellipse(bx + 60 * s, by - 18 * s, 20 * s, 15 * s, 0.3, 0, Math.PI * 2); }, '#7f9e6c', lw * 0.8);
  // Israeli flag sticker
  const fx0 = W * 0.76, fy0 = H * 0.87, fw = 190 * s, fh = 136 * s;
  sticker(x, () => { x.beginPath(); x.rect(fx0 - fw / 2, fy0 - fh / 2, fw, fh); }, '#ffffff', lw);
  x.fillStyle = '#2f5fd0';
  x.fillRect(fx0 - fw / 2 + 6 * s, fy0 - fh / 2 + 16 * s, fw - 12 * s, 16 * s);
  x.fillRect(fx0 - fw / 2 + 6 * s, fy0 + fh / 2 - 32 * s, fw - 12 * s, 16 * s);
  x.strokeStyle = '#2f5fd0'; x.lineWidth = 6 * s;
  for (const flip of [1, -1]) {                  // Star of David: two triangles
    x.beginPath();
    for (let k = 0; k < 3; k++) { const a = flip * (-Math.PI / 2) + k * 2 * Math.PI / 3; const px = fx0 + Math.cos(a) * 30 * s, py = fy0 + Math.sin(a) * 30 * s; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
    x.closePath(); x.stroke();
  }
  // matkot: two wooden paddles and a ball
  for (const [mx, my, rot, col] of [[W * 0.2, H * 0.88, -0.5, '#f0b26b'], [W * 0.31, H * 0.9, 0.35, '#7cc0e8']]) {
    sticker(x, () => {
      x.beginPath();
      x.ellipse(mx, my, 60 * s, 70 * s, rot, 0, Math.PI * 2);
      x.moveTo(mx + Math.sin(-rot) * 0, my);
    }, col, lw);
    sticker(x, () => { x.beginPath(); x.save(); x.translate(mx, my); x.rotate(rot); x.rect(-14 * s, 62 * s, 28 * s, 70 * s); x.restore(); }, '#c98a4f', lw * 0.8);
  }
  sticker(x, () => { x.beginPath(); x.arc(W * 0.26, H * 0.79, 22 * s, 0, Math.PI * 2); }, '#ff7a59', lw * 0.8);
  const tex = canvasTex(c);
  // The title, written on a cream label in the middle of the cover, like a real notebook.
  // Drawn once the handwriting font is ready so it never falls back to a default font.
  const drawLabel = () => {
    x.save();
    x.translate(W * 0.47, H * 0.46);
    x.rotate(-0.03);
    const lwid = 760 * s, lhei = 400 * s;
    x.fillStyle = '#fffaf0';
    x.strokeStyle = '#3a4a6b'; x.lineWidth = 6 * s;
    x.beginPath(); x.roundRect(-lwid / 2, -lhei / 2, lwid, lhei, 26 * s); x.fill(); x.stroke();
    x.strokeStyle = 'rgba(140,170,220,0.45)'; x.lineWidth = 3 * s;          // faint ruled lines on the label
    for (const ly of [-50, 84]) { x.beginPath(); x.moveTo(-lwid / 2 + 30 * s, ly * s); x.lineTo(lwid / 2 - 30 * s, ly * s); x.stroke(); }
    x.fillStyle = '#3a4a6b'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.font = `${150 * s}px "Nanum Pen Script", "Patrick Hand", "Comic Sans MS", cursive`;
    x.fillText('How a Founder', 0, -60 * s);
    x.fillStyle = '#e0607e';                       // second line in a pop of color
    x.fillText('Is Made', 0, 72 * s);
    x.fillStyle = '#3a4a6b';
    // small pastel-blue rubber stamp
    x.rotate(-0.08);
    x.font = `600 ${34 * s}px "IBM Plex Mono", ui-monospace, monospace`;
    const tw = x.measureText('ISRAEL EDITION').width;
    x.strokeStyle = 'rgba(80,120,200,0.85)'; x.fillStyle = 'rgba(80,120,200,0.9)'; x.lineWidth = 4 * s;
    x.beginPath(); x.roundRect(-tw / 2 - 18 * s, 108 * s, tw + 36 * s, 54 * s, 8 * s); x.stroke();
    x.fillText('ISRAEL EDITION', 0, 148 * s);
    x.restore();
    tex.needsUpdate = true;
  };
  if (!document.fonts) drawLabel();
  if (document.fonts) {
    Promise.all([document.fonts.load('96px "Nanum Pen Script"'), document.fonts.load('600 34px "IBM Plex Mono"')])
      .then(drawLabel).catch(() => {});
  }
  return tex;
}

// Diary endpaper: cream with tiny lavender dots.
function makeEndpaperTexture() {
  const [c, x] = canvas2d(512, 700);
  x.fillStyle = '#fbf8f1'; x.fillRect(0, 0, 512, 700);
  x.fillStyle = 'rgba(190,180,230,0.55)';
  for (let y = 14, r = 0; y < 700; y += 28, r++) for (let xx = r % 2 ? 14 : 28; xx < 512; xx += 28) {
    x.beginPath(); x.arc(xx, y, 3.2, 0, Math.PI * 2); x.fill();
  }
  return canvasTex(c);
}

// Clean lined diary paper: cream, faint tooth, pastel blue rules, pink margin.
// ppu = canvas pixels per page unit, so the rules land in the same place at
// every resolution.
function paintPaper(ctx, W, H, rand, ppu) {
  const noise = makeNoise(rand);
  const img = ctx.createImageData(W, H);
  const sc = 1024 / W;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = (noise(x * sc * 2.2, y * sc * 2.2) - 0.5) * 4 + (noise(x * sc * 0.02, y * sc * 0.02) - 0.5) * 4;
    const i = (y * W + x) * 4;
    img.data[i] = C.paper[0] + v; img.data[i + 1] = C.paper[1] + v; img.data[i + 2] = C.paper[2] + v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = C.rule; ctx.lineWidth = Math.max(1.5, 0.0036 * ppu);
  for (let r = 0; ruleY(r) < PAGE_D - 0.1; r++) {
    const y = ruleY(r) * ppu;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.strokeStyle = C.margin; ctx.lineWidth = Math.max(1, 0.003 * ppu);
  ctx.beginPath(); ctx.moveTo(MARGIN_X * ppu, 0); ctx.lineTo(MARGIN_X * ppu, H); ctx.stroke();
  // soft shade where the page curves into the spine
  const g = ctx.createLinearGradient(0, 0, W * 0.07, 0);
  g.addColorStop(0, 'rgba(120,100,90,0.16)'); g.addColorStop(1, 'rgba(120,100,90,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// Page-edge texture: fine lines of stacked pages.
function makeEdgeTexture(rand) {
  const [c, x] = canvas2d(256, 256);
  x.fillStyle = '#f3ede1'; x.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    x.fillStyle = `rgba(170,150,120,${0.06 + rand() * 0.12})`;
    x.fillRect(0, y, 256, 1);
  }
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 6);
  return t;
}

// The key blade: polished gold with the line engraved into it.
// fontFace contains "SIZE", replaced with the font size in px.
function paintBlade(b, fontFace) {
  const { xMap, xBmp, W, H } = b;
  const g = xMap.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#d9b45f'); g.addColorStop(0.5, '#f6dc96'); g.addColorStop(1, '#d9b45f');
  xMap.fillStyle = g; xMap.fillRect(0, 0, W, H);
  xBmp.fillStyle = '#fff'; xBmp.fillRect(0, 0, W, H);
  const both = (draw) => {
    xMap.save(); xMap.strokeStyle = '#8a6a2a'; draw(xMap); xMap.restore();
    xBmp.save(); xBmp.strokeStyle = '#000'; draw(xBmp); xBmp.restore();
  };
  both((x) => { x.lineWidth = 3; x.beginPath(); if (x.roundRect) x.roundRect(30, 28, W - 60, H - 56, 18); else x.rect(30, 28, W - 60, H - 56); x.stroke(); });
  const setFont = (x, size) => { x.font = fontFace.replace('SIZE', size); };
  let fs = Math.round(H * 0.36);
  setFont(xMap, fs);
  const widest = () => Math.max(...KEY_LINES.map((l) => xMap.measureText(l).width));
  while (widest() > W - 200 && fs > 20) { fs -= 2; setFont(xMap, fs); }
  const lh = fs * 1.1, y0 = H / 2 - lh / 2 + fs * 0.04;
  const text = (x, dy, style) => {
    setFont(x, fs); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = style;
    KEY_LINES.forEach((l, i) => x.fillText(l, W / 2, y0 + i * lh + dy));
  };
  text(xMap, 1.5, 'rgba(255,246,214,0.6)'); // light on the lower lip of the cut
  text(xMap, 0, '#5b4216');                 // the cut itself
  text(xBmp, 0, '#000');
}

// =============================================================================
// Pencil sketch recorder.
// Every stroke is stored as a dense list of points so we can (a) draw it as
// pencil on the ink canvas and (b) draw it again into the "time" canvas, where
// each little piece gets the moment the pencil reaches it. That is what makes
// the sketches appear stroke by stroke instead of fading in.
// =============================================================================
function makeSketcher(rand, u) {
  const strokes = [];
  const jit = (v) => (rand() - 0.5) * v * u;
  const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1].map((c) => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
  };
  const dense = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / (5 * u)));
      for (let k = 0; k < n; k++) out.push(catmull(p0, p1, p2, p3, k / n));
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  const polyLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
  // add a stroke through points. Pencil strokes get 2 slightly different passes.
  const add = (pts, { w = 2.7, color = GRAPHITE, a = 0.95, passes = 2, wob = 1.3 } = {}) => {
    if (pts.length < 2) return;
    const ps = [];
    for (let p = 0; p < passes; p++) {
      const jp = pts.map(([x, y]) => [x + jit(wob), y + jit(wob)]);
      ps.push({ pts: dense(jp), w: w * u * (p ? 0.6 : 1), style: `rgba(${color},${a * (p ? 0.38 : 1)})` });
    }
    strokes.push({ passes: ps, len: polyLen(ps[0].pts) });
  };
  const S = {
    strokes,
    add,
    line(x1, y1, x2, y2, o = {}) {
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ov = (1 + rand() * 4) * u;
      const bow = (rand() - 0.5) * L * 0.03;
      add([[x1 - dx / L * ov, y1 - dy / L * ov], [(x1 + x2) / 2 - dy / L * bow, (y1 + y2) / 2 + dx / L * bow], [x2 + dx / L * ov, y2 + dy / L * ov]], o);
    },
    // a hand-drawn loop: ellipse with slightly wandering radius and an overlap
    circle(cx, cy, rx, ry, o = {}) {
      const a0 = rand() * Math.PI * 2, n = 16, pts = [];
      for (let k = 0; k <= n + 1; k++) {
        const a = a0 + (k / n) * Math.PI * 2, f = 1 + (rand() - 0.5) * 0.06;
        pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]);
      }
      add(pts, o);
    },
    arc(cx, cy, rx, ry, a0, a1, o = {}) {
      const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) * 4)), pts = [];
      for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * (k / n); pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
      add(pts, o);
    },
    // parallel hatching clipped to a convex polygon
    hatch(poly, angle, gap, o = {}) {
      const d = [Math.cos(angle), Math.sin(angle)], nrm = [-d[1], d[0]];
      const dots = poly.map((p) => p[0] * nrm[0] + p[1] * nrm[1]);
      const c = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
      for (let s = Math.min(...dots) + gap * 0.5; s < Math.max(...dots); s += gap * (0.8 + rand() * 0.4)) {
        const p0 = [nrm[0] * s, nrm[1] * s];
        let tmin = -1e9, tmax = 1e9;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          let ne = [b[1] - a[1], -(b[0] - a[0])];
          if (ne[0] * (c[0] - a[0]) + ne[1] * (c[1] - a[1]) > 0) ne = [-ne[0], -ne[1]];
          const num = ne[0] * (p0[0] - a[0]) + ne[1] * (p0[1] - a[1]), den = ne[0] * d[0] + ne[1] * d[1];
          if (Math.abs(den) < 1e-9) { if (num > 0) { tmin = 1; tmax = 0; } continue; }
          const t = -num / den;
          if (den > 0) tmax = Math.min(tmax, t); else tmin = Math.max(tmin, t);
        }
        if (tmax - tmin < 3 * u) continue;
        const sh = (tmax - tmin) * 0.06 * rand();
        add([[p0[0] + d[0] * (tmin + sh), p0[1] + d[1] * (tmin + sh)], [p0[0] + d[0] * (tmax - sh), p0[1] + d[1] * (tmax - sh)]],
          { w: 1.6, a: 0.5, passes: 1, wob: 0.8, ...o });
      }
    },
    rect(x, y, w, h, o = {}) {
      S.line(x, y, x + w, y, o); S.line(x + w, y, x + w, y + h, o); S.line(x + w, y + h, x, y + h, o); S.line(x, y + h, x, y, o);
    },
    curl(cx, cy, r, o = {}) { // a little spiral loop for curly hair
      const pts = [], a0 = rand() * Math.PI * 2;
      for (let k = 0; k <= 10; k++) { const a = a0 + k * 0.75, rr = r * (0.55 + k * 0.05); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      add(pts, { w: 2, ...o });
    },
  };
  return S;
}

// A child's face and shoulders (shared by both sketches).
function sketchKid(S, cx, cy, r, bottom, rand, hair) {
  const u = r / 94;
  if (hair === 'long') {
    // long wavy hair falling behind the shoulders (drawn first, sits behind)
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const pts = [], x0 = cx + side * r * (0.86 + k * 0.08), y0 = cy - r * 0.15 + k * r * 0.08;
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          pts.push([x0 + side * (t * r * 0.35 + Math.sin(t * 9 + k) * r * 0.09), y0 + t * r * (1.85 - k * 0.12)]);
        }
        S.add(pts, { w: 2 });
      }
    }
    S.arc(cx, cy - r * 0.05, r * 1.1, r * 1.12, Math.PI * 1.02, Math.PI * 1.98); // top of the hair
  }
  S.circle(cx, cy, r * 0.9, r, { w: 2.6 });                                     // head
  // ears
  S.arc(cx - r * 0.9, cy + r * 0.08, r * 0.14, r * 0.2, Math.PI * 0.5, Math.PI * 1.5, { w: 2 });
  S.arc(cx + r * 0.9, cy + r * 0.08, r * 0.14, r * 0.2, -Math.PI * 0.5, Math.PI * 0.5, { w: 2 });
  if (hair === 'curly') {
    for (let k = 0; k < 13; k++) { // ring of curls over the top
      const a = Math.PI * (1.02 + k * 0.96 / 12);
      S.curl(cx + Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 1.02, r * 0.22);
    }
    for (let k = 0; k < 6; k++) {
      const a = Math.PI * (1.2 + k * 0.6 / 5);
      S.curl(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.72, r * 0.18);
    }
  } else {
    for (let k = 0; k < 5; k++) { // bangs
      const x = cx - r * 0.55 + k * r * 0.26;
      S.add([[x - r * 0.05, cy - r * 0.92], [x + r * 0.06, cy - r * 0.6], [x + r * 0.18, cy - r * 0.42]], { w: 1.8 });
    }
  }
  // eyes, brows, nose, smile, cheeks
  for (const s of [-1, 1]) {
    S.circle(cx + s * r * 0.33, cy + r * 0.05, r * 0.065, r * 0.08, { w: 3, a: 0.9 });
    S.arc(cx + s * r * 0.33, cy - r * 0.12, r * 0.15, r * 0.08, Math.PI * 1.15, Math.PI * 1.85, { w: 1.8 });
    if (hair === 'long') S.line(cx + s * r * 0.42, cy - r * 0.02, cx + s * r * 0.5, cy - r * 0.08, { w: 1.4 }); // lashes
    S.circle(cx + s * r * 0.5, cy + r * 0.38, r * 0.1, r * 0.06, { w: 1.2, a: 0.35, passes: 1 });
  }
  S.add([[cx + r * 0.02, cy + r * 0.12], [cx - r * 0.06, cy + r * 0.3], [cx + r * 0.06, cy + r * 0.34]], { w: 1.8 });
  S.arc(cx, cy + r * 0.38, r * 0.3, r * 0.2, Math.PI * 0.15, Math.PI * 0.85, { w: 2.2 });
  if (hair === 'curly') for (let k = 0; k < 5; k++) S.circle(cx + (rand() - 0.5) * r * 0.5 + (k % 2 ? r * 0.35 : -r * 0.35), cy + r * 0.28 + rand() * r * 0.06, 1.6 * u, 1.6 * u, { w: 1.6, passes: 1 });
  // neck and shoulders
  const nY = cy + r * 0.95, sY = cy + r * 1.3;
  S.line(cx - r * 0.24, nY, cx - r * 0.26, sY, { w: 2 });
  S.line(cx + r * 0.24, nY, cx + r * 0.26, sY, { w: 2 });
  S.add([[cx - r * 0.26, sY], [cx - r * 1.0, sY + r * 0.22], [cx - r * 1.35, sY + r * 0.6], [cx - r * 1.45, bottom]], { w: 2.4 });
  S.add([[cx + r * 0.26, sY], [cx + r * 1.0, sY + r * 0.22], [cx + r * 1.35, sY + r * 0.6], [cx + r * 1.45, bottom]], { w: 2.4 });
  S.add([[cx - r * 0.3, sY - r * 0.02], [cx, sY + r * 0.3], [cx + r * 0.3, sY - r * 0.02]], { w: 2 }); // collar
}

// Left sketch: Omer, a boy with curly hair, white stone apartment blocks of Modiin.
function sketchOmer(S, X, Y, W, H, rand) {
  const u = W / 838, ground = Y + H * 0.86;
  const r = H * 0.13;
  sketchKid(S, X + W * 0.3, Y + H * 0.44, r, Y + H * 0.97, rand, 'curly');
  // white stone blocks: tall, many windows, little balconies, an arch
  const blocks = [[0.5, 0.32, 0.17], [0.65, 0.16, 0.18], [0.81, 0.36, 0.15]];
  for (const [bx, top, bw] of blocks) {
    const x = X + W * bx, w = W * bw, y = Y + H * top;
    S.line(x, ground, x, y); S.line(x + w, ground, x + w, y); S.line(x - 3 * u, y, x + w + 3 * u, y);
    S.line(x + 2 * u, y + 7 * u, x + w - 2 * u, y + 7 * u, { w: 1.4, a: 0.5 });
    const cols = 3, rows = Math.floor((ground - y - 30 * u) / (34 * u));
    for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
      const wx = x + w * (0.12 + c * 0.3), wy = y + 22 * u + rr * 34 * u, ww = w * 0.18, wh = 16 * u;
      if (rand() < 0.3) S.hatch([[wx, wy], [wx + ww, wy], [wx + ww, wy + wh], [wx, wy + wh]], -1.0, 3.5 * u, { a: 0.55 });
      else S.rect(wx, wy, ww, wh, { w: 1.3, a: 0.55, passes: 1 });
      if (c === 1 && rr % 2 === 0) S.line(wx - 6 * u, wy + wh + 5 * u, wx + ww + 6 * u, wy + wh + 5 * u, { w: 1.3, a: 0.5, passes: 1 });
    }
    // a few stone courses, kept light so the stone reads as white
    for (let k = 0; k < 5; k++) {
      const sy = y + rand() * (ground - y), sx = x + rand() * w * 0.7;
      S.line(sx, sy, sx + w * 0.18, sy, { w: 1, a: 0.28, passes: 1 });
    }
    S.hatch([[x + w * 0.8, y], [x + w, y], [x + w, ground], [x + w * 0.8, ground]], -1.1, 7 * u, { a: 0.25 });
  }
  S.arc(X + W * 0.74, ground, W * 0.04, H * 0.07, Math.PI, Math.PI * 2, { w: 2 }); // arch
  // an olive tree on the left
  const tx = X + W * 0.08;
  S.add([[tx, ground], [tx + 4 * u, ground - H * 0.12], [tx - 3 * u, ground - H * 0.22]], { w: 2.4 });
  for (let k = 0; k < 6; k++) S.circle(tx + (rand() - 0.5) * W * 0.09, ground - H * (0.28 + rand() * 0.1), W * 0.04, H * 0.035, { w: 1.6, a: 0.6 });
  // sun, birds, ground
  S.circle(X + W * 0.9, Y + H * 0.1, W * 0.035, W * 0.035, { w: 1.8, a: 0.5 });
  for (let k = 0; k < 3; k++) {
    const bx = X + W * (0.52 + k * 0.08), by = Y + H * (0.07 + rand() * 0.05), s = 9 * u;
    S.add([[bx - s, by - s * 0.4], [bx, by], [bx + s, by - s * 0.5]], { w: 1.5, a: 0.6 });
  }
  S.line(X + W * 0.46, ground, X + W * 0.98, ground, { w: 2.4 });
  S.line(X + W * 0.02, ground, X + W * 0.13, ground, { w: 2.2 });
}

// Right sketch: Shira, a girl with long wavy hair, a kibbutz in the Galilee:
// rolling hills, small houses with pitched roofs, a water tower, cypress trees.
function sketchShira(S, X, Y, W, H, rand) {
  const u = W / 838, ground = Y + H * 0.72;
  const r = H * 0.13;
  sketchKid(S, X + W * 0.7, Y + H * 0.44, r, Y + H * 0.97, rand, 'long');
  // hills of the Galilee
  for (let k = 0; k < 2; k++) {
    const pts = [];
    for (let j = 0; j <= 10; j++) pts.push([X + W * (0.02 + j * 0.054), Y + H * (0.36 + k * 0.1) + Math.sin(j * 0.8 + k * 2) * H * 0.04]);
    S.add(pts, { w: 1.8, a: 0.55 });
  }
  // water tower: a tank on four legs
  const wx = X + W * 0.42, wTop = Y + H * 0.14, tankH = H * 0.1, tankW = W * 0.1;
  S.rect(wx - tankW / 2, wTop, tankW, tankH, { w: 2.2 });
  S.arc(wx, wTop, tankW / 2, 6 * u, Math.PI, Math.PI * 2, { w: 1.8 });
  S.hatch([[wx + tankW * 0.15, wTop], [wx + tankW / 2, wTop], [wx + tankW / 2, wTop + tankH], [wx + tankW * 0.15, wTop + tankH]], -1, 4 * u);
  for (const s of [-1, -0.35, 0.35, 1]) S.line(wx + s * tankW * 0.42, wTop + tankH, wx + s * tankW * 0.6, ground, { w: 1.8 });
  S.line(wx - tankW * 0.5, wTop + tankH * 2.2, wx + tankW * 0.5, wTop + tankH * 2.2, { w: 1.4 });
  S.line(wx - tankW * 0.5, wTop + tankH * 2.2, wx + tankW * 0.55, ground - H * 0.02, { w: 1.2, a: 0.5 });
  // little houses with red roofs
  const houses = [[0.05, 0.11], [0.19, 0.12], [0.07, 0.1]];
  houses.forEach(([hx, hw], i) => {
    const x = X + W * hx + (i === 2 ? W * 0.1 : 0), w = W * hw, base = i === 2 ? ground + H * 0.13 : ground, h = H * 0.09, top = base - h;
    S.line(x, base, x, top); S.line(x + w, base, x + w, top); S.line(x, base, x + w, base, { w: 1.8 });
    const peak = [x + w / 2, top - h * 0.75];
    S.hatch([[x - 4 * u, top], peak, [x + w + 4 * u, top]], -0.6, 3.5 * u, { a: 0.5, w: 1.4 });
    S.line(x - 5 * u, top, peak[0], peak[1]);
    S.line(peak[0], peak[1], x + w + 5 * u, top);
    S.rect(x + w * 0.35, top + h * 0.3, w * 0.25, h * 0.3, { w: 1.2, a: 0.5, passes: 1 });
  });
  // cypress trees
  for (const tx of [0.33, 0.5]) {
    const x = X + W * tx;
    S.add([[x, ground], [x - W * 0.018, ground - H * 0.12], [x, ground - H * 0.26], [x + W * 0.018, ground - H * 0.12], [x, ground]], { w: 1.8 });
    S.hatch([[x, ground - H * 0.24], [x + W * 0.016, ground - H * 0.12], [x, ground]], -1.2, 4 * u, { a: 0.35 });
  }
  // fields: rows converging toward the bottom left
  for (let k = 0; k < 4; k++) S.line(X + W * (0.02 + k * 0.03), Y + H * 0.97, X + W * (0.3 + k * 0.06), ground + H * 0.02, { w: 1.3, a: 0.45, passes: 1 });
  S.line(X + W * 0.02, ground, X + W * 0.55, ground, { w: 2.2 });
  // a few birds over the hills
  for (let k = 0; k < 2; k++) {
    const bx = X + W * (0.2 + k * 0.1), by = Y + H * 0.12, s = 9 * u;
    S.add([[bx - s, by - s * 0.4], [bx, by], [bx + s, by - s * 0.5]], { w: 1.5, a: 0.6 });
  }
}

// Soft colour washes for the "colour in" moment when a path is picked. They
// follow the same shapes as the pencil sketches and sit UNDER the lines.
function paintWashes(i, x, X, Y, W, H) {
  const u = W / 838, r = H * 0.13;
  x.save();
  x.beginPath(); x.rect(X, Y, W, H); x.clip();
  if ('filter' in x) x.filter = 'blur(1.5px)';
  const fill = (c, draw) => { x.fillStyle = c; x.beginPath(); draw(); x.fill(); };
  const ell = (cx, cy, rx, ry) => () => x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  const poly = (pts) => () => { pts.forEach(([a, b], k) => (k ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); };
  const kid = (cx, cy, hair, shirt, hairCol) => {
    const sY = cy + r * 1.3, bottom = Y + H;
    if (hair === 'long') {
      fill(hairCol, ell(cx, cy - r * 0.05, r * 1.1, r * 1.12));
      fill(hairCol, poly([[cx - r * 1.1, cy], [cx + r * 1.1, cy], [cx + r * 1.3, cy + r * 1.75], [cx - r * 1.3, cy + r * 1.75]]));
    }
    fill(shirt, poly([[cx - r * 1.45, bottom + 4], [cx - r * 1.35, sY + r * 0.6], [cx - r * 1.0, sY + r * 0.22], [cx - r * 0.26, sY],
      [cx + r * 0.26, sY], [cx + r * 1.0, sY + r * 0.22], [cx + r * 1.35, sY + r * 0.6], [cx + r * 1.45, bottom + 4]]));
    fill(C.skin, () => x.rect(cx - r * 0.25, cy + r * 0.8, r * 0.5, r * 0.55));
    fill(C.skin, ell(cx, cy, r * 0.9, r));
    for (const s of [-1, 1]) fill(C.skin, ell(cx + s * r * 0.9, cy + r * 0.08, r * 0.14, r * 0.2));
    if (hair === 'curly') {
      for (let k = 0; k < 13; k++) { const a = Math.PI * (1.02 + k * 0.96 / 12); fill(hairCol, ell(cx + Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 1.02, r * 0.24, r * 0.24)); }
      fill(hairCol, ell(cx, cy - r * 0.68, r * 0.72, r * 0.36));
    } else {
      x.save(); x.beginPath(); x.rect(cx - r * 2, cy - r * 2, r * 4, r * 1.58); x.clip();
      fill(hairCol, ell(cx, cy, r * 0.93, r * 1.03)); x.restore();
    }
    for (const s of [-1, 1]) fill('rgba(242,150,150,0.45)', ell(cx + s * r * 0.5, cy + r * 0.38, r * 0.12, r * 0.08));
  };
  if (i === 0) {
    // Omer: blue sky, white stone blocks with blue windows, green olive tree
    const ground = Y + H * 0.86;
    fill('rgba(178,210,242,0.62)', () => x.rect(X, Y, W, ground - Y));
    fill('rgba(176,218,150,0.62)', () => x.rect(X, ground, W, Y + H - ground));
    fill('rgba(255,214,120,0.9)', ell(X + W * 0.9, Y + H * 0.1, W * 0.035, W * 0.035));
    for (const [bx, top, bw] of [[0.5, 0.32, 0.17], [0.65, 0.16, 0.18], [0.81, 0.36, 0.15]]) {
      const bx0 = X + W * bx, w = W * bw, y = Y + H * top;
      fill('rgba(251,245,232,0.97)', () => x.rect(bx0, y, w, ground - y));
      const rows = Math.floor((ground - y - 30 * u) / (34 * u));
      for (let rr = 0; rr < rows; rr++) for (let c = 0; c < 3; c++) {
        fill('rgba(150,190,232,0.85)', () => x.rect(bx0 + w * (0.12 + c * 0.3), y + 22 * u + rr * 34 * u, w * 0.18, 16 * u));
      }
    }
    fill('rgba(170,140,110,0.8)', () => x.rect(X + W * 0.075, ground - H * 0.22, 7 * u, H * 0.22));
    fill('rgba(150,200,122,0.8)', ell(X + W * 0.08, ground - H * 0.33, W * 0.075, H * 0.09));
    kid(X + W * 0.3, Y + H * 0.44, 'curly', 'rgba(140,182,232,0.92)', 'rgba(78,60,52,0.92)');
  } else {
    // Shira: sky, green Galilee hills, red roofs, water tower, cypresses
    const ground = Y + H * 0.72;
    fill('rgba(186,212,240,0.55)', () => x.rect(X, Y, W, H * 0.5));
    const hill = (k) => { const pts = []; for (let j = 0; j <= 10; j++) pts.push([X + W * (0.02 + j * 0.054), Y + H * (0.36 + k * 0.1) + Math.sin(j * 0.8 + k * 2) * H * 0.04]); return pts; };
    fill('rgba(176,218,150,0.62)', poly([[X, Y + H * 0.38], ...hill(0), [X + W * 0.75, Y + H * 0.36], [X + W, Y + H * 0.4], [X + W, Y + H], [X, Y + H]]));
    fill('rgba(140,198,118,0.45)', poly([[X, Y + H * 0.48], ...hill(1), [X + W * 0.75, Y + H * 0.47], [X + W, Y + H * 0.5], [X + W, Y + H], [X, Y + H]]));
    const wx = X + W * 0.42, wTop = Y + H * 0.14, tankH = H * 0.1, tankW = W * 0.1;
    fill('rgba(214,226,240,0.97)', () => x.rect(wx - tankW / 2, wTop - 4 * u, tankW, tankH + 4 * u));
    for (const tx of [0.33, 0.5]) { const cxp = X + W * tx; fill('rgba(110,172,110,0.85)', poly([[cxp, ground], [cxp - W * 0.018, ground - H * 0.12], [cxp, ground - H * 0.26], [cxp + W * 0.018, ground - H * 0.12]])); }
    [[0.05, 0.11], [0.19, 0.12], [0.07, 0.1]].forEach(([hx, hw], k) => {
      const hx0 = X + W * hx + (k === 2 ? W * 0.1 : 0), w = W * hw, base = k === 2 ? ground + H * 0.13 : ground, h = H * 0.09, top = base - h;
      fill('rgba(252,246,234,0.97)', () => x.rect(hx0, top, w, h));
      fill('rgba(232,112,92,0.92)', poly([[hx0 - 4 * u, top], [hx0 + w / 2, top - h * 0.75], [hx0 + w + 4 * u, top]]));
      fill('rgba(150,190,232,0.85)', () => x.rect(hx0 + w * 0.35, top + h * 0.3, w * 0.25, h * 0.3));
    });
    kid(X + W * 0.7, Y + H * 0.44, 'long', 'rgba(244,182,200,0.92)', 'rgba(150,100,72,0.92)');
  }
  x.restore();
}

// =============================================================================
// Ink: handwriting, stamp and drawings, plus the "time" map.
// Time map channels: R = when this pixel appears (0..250 across the writing
// window, 255 = never), G = how gently it fades in (0 = crisp, 255 = soft).
// =============================================================================
function buildInk({ W, ppu, font, paths, rand }) {
  const H = Math.round((INK_BOTTOM - INK_TOP) * ppu);
  const [cInk, xInk] = canvas2d(W, H);
  const PX = (x) => x * ppu, PY = (y) => (y - INK_TOP) * ppu; // page units -> ink px
  const R = new Uint8ClampedArray(W * H).fill(255), G = new Uint8ClampedArray(W * H);
  const toByte = (sec) => Math.round(clamp(sec / TL.write[1]) * 250);

  // --- handwriting: a clean left-to-right wipe, one line at a time ----------
  function writeText(lines, t0, t1) {
    const metas = lines.map((ln) => {
      xInk.font = `400 ${ln.fs}px ${font}`;
      const w = xInk.measureText(ln.text).width, x0 = ln.cx - w / 2;
      xInk.fillStyle = C.ink; xInk.textBaseline = 'alphabetic';
      xInk.fillText(ln.text, x0, ln.base);
      return { ...ln, x0, x1: x0 + w };
    });
    const linePause = 0.12;
    const total = metas.reduce((s, m) => s + (m.x1 - m.x0), 0);
    const speed = total / Math.max(0.2, t1 - t0 - linePause * (metas.length - 1)); // px per second
    let t = t0;
    for (const m of metas) {
      const yA = Math.max(0, Math.floor(m.base - m.fs)), yB = Math.min(H - 1, Math.ceil(m.base + m.fs * 0.45));
      const xA = Math.max(0, Math.floor(m.x0 - m.fs * 0.3)), xB = Math.min(W - 1, Math.ceil(m.x1 + m.fs * 0.3));
      const dur = (m.x1 - m.x0) / speed;
      for (let y = yA; y <= yB; y++) for (let x = xA; x <= xB; x++) {
        const k = y * W + x, b = toByte(t + clamp((x - m.x0) / speed, 0, dur));
        if (b < R[k]) { R[k] = b; G[k] = 40; }
      }
      t += dur + linePause;
    }
  }
  writeText(HAND_LINES.map((text, i) => ({ text, fs: PX(TITLE.fs), cx: PX(TITLE.cx) - (i ? PX(0.3) : 0), base: PY(ruleY(TITLE.rules[i])) - PX(0.008) })),
    WR.title[0], WR.title[1]);
  paths.forEach((p, i) => {
    if (!SHOWN(i)) return;
    const v = CARDS[i];
    const [name, place] = String(p.label || p.id).split(/\s*·\s*/);
    const lines = [{ text: name, fs: PX(LABEL.nameFs), cx: PX(v.x + v.w / 2), base: PY(ruleY(LABEL.nameRule)) - PX(0.008) }];
    if (place) lines.push({ text: place, fs: PX(LABEL.placeFs), cx: PX(v.x + v.w / 2), base: PY(ruleY(LABEL.placeRule)) - PX(0.008) });
    writeText(lines, WR.labels[i][0], WR.labels[i][1]);
  });
  if (!SHIRA_ONLY) writeText([{ text: PICK_TEXT, fs: PX(PICK.fs), cx: PX(PICK.cx), base: PY(ruleY(PICK.rule)) - PX(0.008) }], WR.pick[0], WR.pick[1]);

  // --- "ISRAEL EDITION": a clean pastel blue rubber stamp, slightly rotated --
  {
    const fs = PX(STAMP.fs), gap = fs * 0.24;
    const [, xm] = canvas2d(4, 4);
    xm.font = `600 ${fs}px "IBM Plex Mono", "Courier New", monospace`;
    const widths = [...STAMP_TEXT].map((ch) => xm.measureText(ch).width);
    const tw = widths.reduce((a, b) => a + b, 0) + gap * (STAMP_TEXT.length - 1);
    const sw = Math.ceil(tw + fs * 1.8), sh = Math.ceil(PX(STAMP.h));
    const col = `rgb(${C.stamp.join(',')})`;
    const box = (inset, r) => { xInk.beginPath(); if (xInk.roundRect) xInk.roundRect(-sw / 2 + inset, -sh / 2 + inset, sw - inset * 2, sh - inset * 2, r); else xInk.rect(-sw / 2 + inset, -sh / 2 + inset, sw - inset * 2, sh - inset * 2); };
    xInk.save();
    xInk.translate(PX(STAMP.cx), PY(STAMP.cy)); xInk.rotate(STAMP.rot);
    xInk.strokeStyle = col; xInk.fillStyle = col;
    xInk.lineWidth = PX(0.008); box(0, sh * 0.22); xInk.stroke();
    xInk.lineWidth = PX(0.0028); box(PX(0.016), sh * 0.16); xInk.stroke();
    xInk.font = xm.font; xInk.textBaseline = 'middle';
    let x = -tw / 2;
    [...STAMP_TEXT].forEach((ch, i) => { xInk.fillText(ch, x, fs * 0.04); x += widths[i] + gap; });
    xInk.restore();
    const b = toByte(WR.stamp), rad = Math.hypot(sw, sh) / 2 + 4, cx = PX(STAMP.cx), cy = PY(STAMP.cy);
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(H, cy + rad); y++) {
      for (let x2 = Math.max(0, Math.floor(cx - rad)); x2 < Math.min(W, cx + rad); x2++) {
        const k = y * W + x2; if (b < R[k]) { R[k] = b; G[k] = 110; }
      }
    }
  }

  // copy R/G into the time canvas; the drawings are painted on top of it
  const [cTime, xTime] = canvas2d(W, H);
  const tImg = xTime.createImageData(W, H);
  for (let k = 0; k < W * H; k++) { tImg.data[k * 4] = R[k]; tImg.data[k * 4 + 1] = G[k]; tImg.data[k * 4 + 3] = 255; }
  xTime.putImageData(tImg, 0, 0);

  // --- pencil sketches: drawn stroke by stroke (uncoloured on the page) ----
  const u = (CARDS[0].w * ppu) / 838; // sketch stroke scale
  const all = []; // { s: stroke, t0, t1 }
  CARDS.forEach((v, i) => {
    if (!SHOWN(i)) return;
    const S = makeSketcher(rand, u);
    const [X, Y, Wv, Hv] = [PX(v.x), PY(v.y), PX(v.w), v.h * ppu];
    (i === 0 ? sketchOmer : sketchShira)(S, X, Y, Wv, Hv, rand);
    S.rect(X, Y, Wv, Hv, { w: 1.4, a: 0.45 }); // a loose hand-drawn frame, drawn last
    // spread the strokes over the sketch window in drawing order
    const weights = S.strokes.map((st) => Math.pow(st.len, 0.6) + 6);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = WR.sketch[0] + i * 0.12;
    const span = WR.sketch[1] - WR.sketch[0] - 0.12;
    S.strokes.forEach((st, k) => { const d = (weights[k] / total) * span; all.push({ s: st, t0: t, t1: t + d * 0.85 }); t += d; });
  });
  xInk.lineCap = 'round'; xInk.lineJoin = 'round';
  for (const { s: st } of all) {
    for (const ps of st.passes) {
      xInk.strokeStyle = ps.style; xInk.lineWidth = ps.w;
      xInk.beginPath(); ps.pts.forEach(([x, y], k) => (k ? xInk.lineTo(x, y) : xInk.moveTo(x, y))); xInk.stroke();
    }
  }
  // the same strokes into the time canvas, latest first so the earliest wins
  xTime.lineCap = 'round';
  all.sort((a, b) => b.t0 - a.t0);
  for (const { s: st, t0, t1 } of all) {
    const pts = st.passes[0].pts;
    let L = 0; const cum = [0];
    for (let k = 1; k < pts.length; k++) { L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); cum.push(L); }
    xTime.lineWidth = st.passes[0].w + 5 * u;
    for (let k = pts.length - 1; k > 0; k--) {
      const b = toByte(t0 + (t1 - t0) * (cum[k - 1] / (L || 1)));
      xTime.strokeStyle = `rgb(${b},0,0)`;
      xTime.beginPath(); xTime.moveTo(pts[k - 1][0], pts[k - 1][1]); xTime.lineTo(pts[k][0], pts[k][1]); xTime.stroke();
    }
  }

  // --- colour layer: soft washes, only shown when a path is picked ----------
  // It covers just the box around both cards (to save memory).
  const VIS = CARDS.filter((c, i) => SHOWN(i));
  const box = {
    x0: Math.min(...VIS.map((c) => c.x)) - 0.02, x1: Math.max(...VIS.map((c) => c.x + c.w)) + 0.02,
    y0: Math.min(...VIS.map((c) => c.y)) - 0.02, y1: Math.max(...VIS.map((c) => c.y + c.h)) + 0.02,
  };
  const [cCol, xCol] = canvas2d(Math.ceil((box.x1 - box.x0) * ppu), Math.ceil((box.y1 - box.y0) * ppu));
  xCol.translate(-PX(box.x0), -PY(box.y0)); // so we can use the same coordinates as the ink canvas
  CARDS.forEach((v, i) => { if (SHOWN(i)) paintWashes(i, xCol, PX(v.x), PY(v.y), PX(v.w), v.h * ppu); });
  const colorTex = canvasTex(cCol);
  // the box in page UVs (v goes up): x0, y0 (bottom), x1, y1 (top)
  const colorBox = new THREE.Vector4(box.x0 / PAGE_W, 1 - box.y1 / PAGE_D, box.x1 / PAGE_W, 1 - box.y0 / PAGE_D);

  const inkTex = canvasTex(cInk);
  const timeTex = canvasTex(cTime, false);
  timeTex.generateMipmaps = false; timeTex.minFilter = THREE.LinearFilter;
  return { inkTex, timeTex, colorTex, colorBox };
}

// =============================================================================
// Overlay styles (injected once).
// =============================================================================
const STYLE_ID = 'vault-styles';
const CSS = `
.vault-root{--night:#0b0d12;--paper:#f7f1e6;--brass:#c9a25a;--blue:#1f44c9;--ink:#3a4a6b;
  position:absolute;inset:0;overflow:hidden;background:#f4ede3;color:var(--ink);
  font-family:'Rubik',system-ui,sans-serif;-webkit-tap-highlight-color:transparent;cursor:pointer;
  touch-action:none;user-select:none;-webkit-user-select:none}
.vault-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.vault-shade{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at 55% 50%,rgba(255,255,255,0) 55%,rgba(120,100,80,.12) 100%)}
.vault-scrim{display:none;position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,rgba(250,246,239,.92) 0%,rgba(250,246,239,.7) 28%,rgba(250,246,239,0) 52%);
  transition:opacity 1s ease}
.vault-copy{display:none;position:absolute;left:clamp(28px,7vw,112px);top:50%;transform:translateY(-52%);
  max-width:min(32rem,40vw);pointer-events:none}
.vault-title{font-family:'Fraunces',Georgia,serif;font-weight:500;font-variation-settings:'opsz' 144;
  font-size:clamp(2.6rem,4.6vw,5rem);line-height:1.02;letter-spacing:-.018em;margin:0;color:#2c3652;text-wrap:balance}
.vault-title em{font-style:italic;color:#6f86c4;display:block}
.vault-edition{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;font-weight:500;
  letter-spacing:.3em;text-transform:uppercase;color:#6f86c4;margin:1.6rem 0 0;display:flex;align-items:center;gap:1em}
.vault-edition::before{content:'';width:32px;height:1px;background:currentColor;opacity:.6}
.vault-credit{display:none;position:absolute;left:0;right:0;text-align:center;top:30px;bottom:auto;margin:0;font-size:13px!important;letter-spacing:.32em!important;
  font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;
  color:rgba(58,74,107,.55);pointer-events:none;opacity:0;transition:opacity 1.2s ease}
.vault-cue,.vault-hint{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);
  font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.28em;text-transform:uppercase;white-space:nowrap}
.vault-cue{display:flex;flex-direction:column;align-items:center;gap:14px;background:none;border:0;padding:8px 12px;
  color:rgba(58,74,107,.75);cursor:pointer}
.vault-cue:focus-visible{outline:1px solid #6f86c4;outline-offset:6px;border-radius:6px}
.vault-cue-line{position:relative;width:1px;height:42px;background:rgba(58,74,107,.18);overflow:hidden}
.vault-cue-line i{position:absolute;left:-1px;top:-14px;width:3px;height:14px;border-radius:2px;
  background:#6f86c4;animation:vault-drip 2.4s cubic-bezier(.65,0,.35,1) infinite}
@keyframes vault-drip{0%{transform:translateY(0);opacity:0}25%{opacity:1}75%{opacity:1}100%{transform:translateY(58px);opacity:0}}
.vault-copy>*,.vault-cue{opacity:0;transition:opacity 1.2s ease,transform 1.2s cubic-bezier(.16,1,.3,1)}
.vault-copy>*{transform:translateY(14px)}
.vault-root.is-ready .vault-title{opacity:1;transform:none;transition-delay:.3s}
.vault-root.is-ready .vault-edition{opacity:1;transform:none;transition-delay:.6s}
.vault-root.is-ready .vault-credit{opacity:1;transition-delay:1s}
.vault-root.is-ready .vault-cue{opacity:1;transition-delay:1.3s}
.vault-root.is-opening .vault-copy>*,.vault-root.is-opening .vault-cue,.vault-root.is-opening .vault-credit{
  opacity:0!important;transition-delay:0s!important;transition-duration:.7s}
.vault-root.is-opening .vault-copy>*{transform:translateY(-8px)}
.vault-root.is-opening .vault-cue{pointer-events:none;visibility:hidden;transition:opacity .7s,visibility 0s .7s}
.vault-root.is-opening .vault-scrim{opacity:0}
.vault-root.is-opening{cursor:default}
.vault-hint{left:auto;right:28px;transform:none;padding:10px 18px;border-radius:999px;color:#2c3652;background:rgba(255,255,255,.82);
  box-shadow:0 6px 24px rgba(58,74,107,.12);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
  opacity:0;pointer-events:none;transition:opacity .9s ease}
.vault-root.is-choosing .vault-hint{opacity:1;transition-delay:.6s}
.vault-pick{position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;border-radius:16px;
  background:transparent;cursor:pointer;visibility:hidden;pointer-events:none;color:transparent;font-size:0}
.vault-root.is-choosing .vault-pick{visibility:visible;pointer-events:auto}
.vault-pick:focus-visible{outline:2px solid #6f86c4;outline-offset:6px;box-shadow:0 0 0 8px rgba(111,134,196,.18)}
.vault-veil{position:absolute;inset:0;background:#fbf8f1;pointer-events:none;opacity:1;transition:opacity 1.4s ease}
.vault-root.is-ready .vault-veil{opacity:0}
.vault-root.is-veiled .vault-veil{opacity:1;transition-duration:.4s}
.vault-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width: 1000px){.vault-credit{display:none}}
@media (prefers-reduced-motion: reduce){
  .vault-copy>*,.vault-cue{transform:none!important;transition-duration:.6s}
  .vault-cue-line i{animation:none;top:14px;opacity:1}
}`;

// =============================================================================
// mountVault: builds everything and returns { open, destroy }
//   container  the full-screen element to draw into (required)
//   onOpen     called with the chosen path id ('omer' or 'shira') at the end
//   onSound    called with a cue name: whoosh, insert, clunk, clasp, page,
//              write, stamp, pick (no audio is played here)
//   paths      optional [{ id, label: 'Name · Place' }, {...}]
//   pageImage  no longer used (kept so old calls do not break)
// =============================================================================
export function mountVault({ container, onOpen = () => {}, onSound = () => {}, paths = DEFAULT_PATHS, pageImage = null } = {}) {
  if (!container) throw new Error('mountVault needs a container element');
  if (pageImage) console.info('[vault] pageImage is no longer used.');
  paths = [0, 1].map((i) => ({ ...DEFAULT_PATHS[i], ...((paths && paths[i]) || {}) }));
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isTouch = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  const sound = (name) => { try { onSound(name); } catch (e) { /* never let sound code break the intro */ } };

  // ---------------------------------------------------------------- DOM ----
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'vault-root';
  root.innerHTML = `
    <canvas class="vault-canvas" aria-hidden="true"></canvas>
    <div class="vault-shade"></div>
    <div class="vault-scrim"></div>
    <div class="vault-copy">
      <h1 class="vault-title">${COPY.titleA} <em>${COPY.titleB}</em></h1>
      <p class="vault-edition">${COPY.edition}</p>
    </div>
    <p class="vault-credit">${COPY.credit.replace('&', '&amp;')}</p>
    <button class="vault-cue" type="button" aria-label="Open the diary">
      <span>${COPY.cue}</span><span class="vault-cue-line"><i></i></span>
    </button>
    <button class="vault-pick" type="button"></button>
    <button class="vault-pick" type="button"></button>
    <p class="vault-hint">${isTouch ? COPY.hintTouch : COPY.hintMouse}</p>
    <p class="vault-sr" aria-live="polite"></p>
    <div class="vault-veil"></div>`;
  container.appendChild(root);
  const canvas = root.querySelector('canvas');
  const srLine = root.querySelector('.vault-sr');
  const pickBtns = [...root.querySelectorAll('.vault-pick')];
  pickBtns.forEach((b, i) => {
    b.setAttribute('aria-label', `Follow ${String(paths[i].label).replace(/\s*·\s*/, ', ')}`);
    b.tabIndex = -1;
  });

  // Lock page scrolling while the intro is up (the site unlocks it in onOpen).
  const html = document.documentElement, body = document.body;
  const prevOverflow = [html.style.overflow, body.style.overflow];
  html.style.overflow = 'hidden'; body.style.overflow = 'hidden';

  // ----------------------------------------------------------- renderer ----
  let renderer = null;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
  if (!renderer) return mountFallback(); // no WebGL: overlay + two plain buttons

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps pastel colours true
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;    // soft, blurry daylight shadows
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.fog = new THREE.Fog(C.bg, 9, 22);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.03, 60);
  camera.up.set(0, Math.SQRT1_2, -Math.SQRT1_2); // lets us look straight down at the page

  const textures = []; // disposed in destroy()
  const track = (t) => { textures.push(t); t.anisotropy = Math.min(8, maxAniso); return t; };
  let destroyed = false;

  // ------------------------------------------------------------- lights ----
  // Daylight from a window behind and to the left: the only shadow caster.
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
  sun.position.set(-4, 7, -3.5);
  sun.target.position.set(0, 0, 0.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 20 });
  sun.shadow.radius = 9; sun.shadow.blurSamples = 16; sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xf2f5ff, 0xf0dfcb, 0.85)); // soft sky + warm bounce
  const keyLight = new THREE.PointLight(0xfff2dc, 0, 0, 2);        // brightens the key close-up
  scene.add(keyLight);

  // ---------------------------------------------------------- textures ----
  const deskTex = track(makeDeskTexture(1024, 512, rng(11)));
  const coverTex = track(makeCoverTexture(1024, 1396, rng(21)));
  const endTex = track(makeEndpaperTexture());
  const edgeTex = track(makeEdgeTexture(rng(41)));
  const [cBlank, xBlank] = canvas2d(1024, Math.round(1024 * PAGE_D / PAGE_W));
  paintPaper(xBlank, cBlank.width, cBlank.height, rng(51), 1024 / PAGE_W);
  const blankTex = track(canvasTex(cBlank));
  // the page we write on
  const PW = 2048, PH = Math.round(PW * PAGE_D / PAGE_W), ppu = PW / PAGE_W;
  const [cPage, xPage] = canvas2d(PW, PH);
  paintPaper(xPage, PW, PH, rng(61), ppu);
  const pageTex = track(canvasTex(cPage));
  pageTex.anisotropy = Math.min(16, maxAniso);

  // ink and time textures arrive once the handwriting font is ready
  const writeU = { value: 0 };
  const hoverU = { value: new THREE.Vector2(0, 0) };
  const emptyInk = track(new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)); emptyInk.needsUpdate = true;
  const emptyTime = track(new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1)); emptyTime.needsUpdate = true;
  const inkU = { value: emptyInk }, inkTimeU = { value: emptyTime };
  const colorU = { value: emptyInk };                        // colour washes (shown on pick)
  const colorBoxU = { value: new THREE.Vector4(0, 0, 1, 1) };
  const colorPU = { value: new THREE.Vector2(0, 0) };        // colour-in progress per card
  const dimU = { value: new THREE.Vector2(0, 0) };           // fades the card that was not picked
  const cardRect = (v) => new THREE.Vector4(v.x / PAGE_W, 1 - (v.y + v.h) / PAGE_D, (v.x + v.w) / PAGE_W, 1 - v.y / PAGE_D);

  // key blade engraving
  const [bc1, bx1] = canvas2d(2048, 430), [bc2, bx2] = canvas2d(2048, 430);
  const blade = { xMap: bx1, xBmp: bx2, W: 2048, H: 430 };
  paintBlade(blade, '500 SIZEpx Georgia, serif');
  const bladeMap = track(canvasTex(bc1)), bladeBump = track(canvasTex(bc2, false));

  // ---------------------------------------------------------- materials ----
  const M = {
    desk: new THREE.MeshStandardMaterial({ map: deskTex, roughness: 0.72 }),
    cover: new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.85 }),
    coverSide: new THREE.MeshStandardMaterial({ color: C.coverEdge, roughness: 0.85 }),
    endpaper: new THREE.MeshStandardMaterial({ map: endTex, roughness: 0.9 }),
    edges: new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.95 }),
    page: new THREE.MeshLambertMaterial({ map: pageTex }), // matte paper: no sheen washing out the ink
    sheet: new THREE.MeshLambertMaterial({ map: blankTex, emissiveMap: blankTex, emissive: 0x3a3a3a, side: THREE.DoubleSide }),
    strap: new THREE.MeshStandardMaterial({ color: C.strap, roughness: 0.8 }),
    gold: new THREE.MeshPhysicalMaterial({ color: C.gold, metalness: 1, roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.15 }),
    blade: new THREE.MeshPhysicalMaterial({ map: bladeMap, bumpMap: bladeBump, bumpScale: 0.4, metalness: 1, roughness: 0.26, clearcoat: 0.4 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x3a3048 }),
    pencil: new THREE.MeshStandardMaterial({ color: 0xf7d77e, roughness: 0.6 }),
    pencilWood: new THREE.MeshStandardMaterial({ color: 0xf1d6b4, roughness: 0.8 }),
    eraser: new THREE.MeshStandardMaterial({ color: 0xf4b2bf, roughness: 0.8 }),
    mug: new THREE.MeshStandardMaterial({ color: 0xcdebdd, roughness: 0.35 }),
    tea: new THREE.MeshStandardMaterial({ color: 0xc89a6b, roughness: 0.15 }),
  };
  // Teach the page material to show ink that appears over time, and to make a
  // drawing "lift" (grow a little, cast a soft shadow) on hover.
  M.page.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uInk: inkU, uInkTime: inkTimeU, uWrite: writeU, uHover: hoverU,
      uColor: colorU, uColorBox: colorBoxU, uColorP: colorPU, uDim: dimU,
      uInkBand: { value: new THREE.Vector2(1 - INK_BOTTOM / PAGE_D, 1 - INK_TOP / PAGE_D) },
      uCard0: { value: cardRect(CARDS[0]) }, uCard1: { value: cardRect(CARDS[1]) },
    });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uInk; uniform sampler2D uInkTime; uniform float uWrite;
        uniform vec2 uInkBand; uniform vec2 uHover; uniform vec4 uCard0; uniform vec4 uCard1;
        uniform sampler2D uColor; uniform vec4 uColorBox; uniform vec2 uColorP; uniform vec2 uDim;
        // "marker fill": colour goes on in wavy rows, back and forth, like a kid
        // colouring with a felt-tip. q = position inside the card (0..1), p = progress.
        float marker(vec2 q, float p){
          float rows = 7.0;
          float rr = (1.0 - q.y) * rows + 0.22 * sin(q.x * 19.0 + q.y * 5.0);
          float band = clamp(floor(rr), 0.0, rows - 1.0);
          float x = mod(band, 2.0) < 0.5 ? q.x : 1.0 - q.x;
          float order = (band + x) / rows + 0.006 * sin(q.y * 140.0);
          return smoothstep(order, order + 0.035, p * 1.06 - 0.02);
        }
        vec2 cardQ(vec2 p, vec4 r){ return (p - r.xy) / (r.zw - r.xy); }
        vec4 inkAt(vec2 puv){
          float iy = (puv.y - uInkBand.x) / (uInkBand.y - uInkBand.x);
          vec2 iuv = vec2(puv.x, iy);
          vec4 ink = texture2D(uInk, iuv);
          vec4 tm = texture2D(uInkTime, iuv);
          float due = tm.r * (255.0 / 250.0);
          float fade = mix(0.008, 0.075, tm.g);           // outlines crisp, colours soft
          float inside = step(0.0, iy) * step(iy, 1.0);
          ink.a *= smoothstep(due, due + fade, uWrite) * inside;
          return ink;
        }
        float inRect(vec2 p, vec4 r, float pad){
          return step(r.x - pad, p.x) * step(p.x, r.z + pad) * step(r.y - pad, p.y) * step(p.y, r.w + pad);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 puv = vMapUv;
          float h0 = uHover.x * inRect(puv, uCard0, 0.04);
          float h1 = uHover.y * inRect(puv, uCard1, 0.04);
          float h = max(h0, h1);
          vec4 R = h0 >= h1 ? uCard0 : uCard1;
          vec2 c = 0.5 * (R.xy + R.zw);
          vec2 zuv = c + (puv - c) / (1.0 + 0.045 * h);            // grow a little
          // only use the "grown" position when it lands inside the card, so labels
          // and the stamp just outside it never get pulled in
          vec2 uv2 = mix(puv, zuv, step(0.001, h) * inRect(zuv, R, 0.0));
          vec4 ink = inkAt(uv2);
          ink.a *= 1.0 - uDim.x * inRect(uv2, uCard0, 0.0) - uDim.y * inRect(uv2, uCard1, 0.0);
          float shadow = inkAt(zuv + vec2(-0.004, 0.006) * h).a;    // soft shadow under the lifted lines
          vec2 q = cardQ(puv, R);
          float glow = h * smoothstep(0.75, 0.0, length(q - 0.5));  // warm light on the paper
          // colour washes under the pencil lines, revealed by the marker fill
          vec2 cuv = (uv2 - uColorBox.xy) / (uColorBox.zw - uColorBox.xy);
          vec4 col = texture2D(uColor, cuv) * step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
          float m = marker(cardQ(uv2, uCard0), uColorP.x) * inRect(uv2, uCard0, 0.0)
                  + marker(cardQ(uv2, uCard1), uColorP.y) * inRect(uv2, uCard1, 0.0);
          diffuseColor.rgb *= 1.0 - shadow * 0.25 * h;
          diffuseColor.rgb += vec3(0.06, 0.04, 0.0) * glow;
          diffuseColor.rgb = mix(diffuseColor.rgb, col.rgb, col.a * m);
          diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, ink.a);
          totalEmissiveRadiance += diffuseColor.rgb * 0.22; // a little self-light keeps matte paper bright, ink stays dark
        }`);
  };

  // --------------------------------------------------------------- desk ----
  const deskGeo = new THREE.PlaneGeometry(24, 20);
  deskGeo.rotateX(-Math.PI / 2);
  const desk = new THREE.Mesh(deskGeo, M.desk);
  desk.position.set(0, 0, -3);
  desk.receiveShadow = true;
  scene.add(desk);

  // --------------------------------------------------------------- book ----
  const book = new THREE.Group();
  scene.add(book);
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  // A flat slab with rounded corners lying on the desk: shape x -> world x,
  // shape y -> world -z, thickness up (+y). Caps use material 0, sides 1.
  // Cap UVs are set to 0..1 across the slab so textures fit exactly.
  const slab = (w, d, thick, r, x0) => {
    const bev = 0.008;
    const g = new THREE.ExtrudeGeometry(roundedRectShape(w, d, r, { roundLeft: false }), { depth: thick - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, bev);
    g.rotateX(-Math.PI / 2);
    g.translate(x0 + w / 2, 0, 0);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (y > thick - 1e-4 || y < 1e-4) uv.setXY(k, (pos.getX(k) - x0) / w, (-pos.getZ(k) + d / 2) / d);
    }
    uv.needsUpdate = true;
    return g;
  };
  const backBoard = shadowy(new THREE.Mesh(slab(BOOK_W, BOOK_D, BOARD, CORNER, -BOOK_W / 2), [M.coverSide, M.coverSide]));
  book.add(backBoard);
  // the page block: its top cap is the page we write on
  const blockH = BLOCK_TOP - BOARD;
  const blockGeo = slab(PAGE_W, PAGE_D, blockH, CORNER * 0.85, PAGE_X0);
  blockGeo.translate(0, BOARD, 0);
  const block = shadowy(new THREE.Mesh(blockGeo, [M.page, M.edges]));
  book.add(block);
  // soft rounded spine
  const spineR = BLOCK_TOP / 2 - 0.01; // the spine stays just below the pages (no bar in the gutter)
  const spineGeo = new THREE.CylinderGeometry(spineR, spineR, BOOK_D - 0.02, 40, 1, true, Math.PI, Math.PI);
  spineGeo.rotateX(Math.PI / 2);
  const spine = shadowy(new THREE.Mesh(spineGeo, M.coverSide));
  spine.position.set(-BOOK_W / 2, spineR, 0);
  book.add(spine);
  // front cover, hinged at the top-left corner of the page block
  const coverPivot = new THREE.Group();
  coverPivot.position.set(-BOOK_W / 2, BLOCK_TOP, 0);
  book.add(coverPivot);
  const coverBoard = shadowy(new THREE.Mesh(slab(BOOK_W, BOOK_D, BOARD, CORNER, 0), [M.cover, M.coverSide]));
  coverPivot.add(coverBoard);
  // endpaper on the inside of the cover
  const endGeo = new THREE.ShapeGeometry(roundedRectShape(BOOK_W - 0.08, BOOK_D - 0.08, CORNER * 0.8, { roundLeft: false }), 10);
  { // UVs 0..1 across the sheet
    const pos = endGeo.attributes.position, uv = endGeo.attributes.uv;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k) / (BOOK_W - 0.08) + 0.5, pos.getY(k) / (BOOK_D - 0.08) + 0.5);
  }
  endGeo.rotateX(Math.PI / 2);
  const endMesh = new THREE.Mesh(endGeo, M.endpaper);
  endMesh.position.set(BOOK_W / 2 + 0.02, -0.002, 0);
  coverPivot.add(endMesh);

  // the tiny gold heart lock, on the cover near the fore-edge
  const heart = new THREE.Shape();
  {
    const s = 0.125;
    heart.moveTo(0, -0.95 * s);
    heart.bezierCurveTo(0.35 * s, -0.6 * s, 1.0 * s, -0.25 * s, 0.95 * s, 0.28 * s);
    heart.bezierCurveTo(0.9 * s, 0.78 * s, 0.25 * s, 0.9 * s, 0, 0.45 * s);
    heart.bezierCurveTo(-0.25 * s, 0.9 * s, -0.9 * s, 0.78 * s, -0.95 * s, 0.28 * s);
    heart.bezierCurveTo(-1.0 * s, -0.25 * s, -0.35 * s, -0.6 * s, 0, -0.95 * s);
  }
  const heartGeo = new THREE.ExtrudeGeometry(heart, { depth: LOCK_TOP - 0.024, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 32 });
  heartGeo.translate(0, 0, 0.012);
  heartGeo.rotateX(-Math.PI / 2);
  const lockGroup = new THREE.Group();
  lockGroup.position.set(LOCK.x + BOOK_W / 2, BOARD, LOCK.z); // cover-local
  coverPivot.add(lockGroup);
  lockGroup.add(shadowy(new THREE.Mesh(heartGeo, M.gold)));
  const plug = new THREE.Group(); // the keyhole turns with the key
  plug.position.set(0, LOCK_TOP + 0.001, 0);
  lockGroup.add(plug);
  const holeShape = new THREE.Shape();
  {
    const r = 0.016, slot = 0.007, a = Math.asin(slot / r);
    holeShape.moveTo(-0.034, -slot); holeShape.lineTo(-r * Math.cos(a), -slot);
    holeShape.absarc(0, 0, r, Math.PI + a, Math.PI - a, false); holeShape.lineTo(-0.034, slot); holeShape.closePath();
  }
  const holeGeo = new THREE.ShapeGeometry(holeShape); holeGeo.rotateX(-Math.PI / 2);
  plug.add(new THREE.Mesh(holeGeo, M.dark));
  // the strap: from under the back cover, up the fore-edge, over to the heart
  const hasp = new THREE.Group();
  hasp.position.set(BOOK_W / 2 + 0.02, 0.03, 0);
  book.add(hasp);
  const strapH = BLOCK_TOP + BOARD - 0.01;
  const strapV = shadowy(new THREE.Mesh(new RoundedBoxGeometry(0.03, strapH, 0.26, 3, 0.012), M.strap));
  strapV.position.set(0.006, strapH / 2, 0);
  hasp.add(strapV);
  const strapLen = BOOK_W / 2 + 0.02 - LOCK.x + 0.04;
  // the top piece hinges where it folds over the edge, so the strap can lie out straight
  const strapEnd = new THREE.Group();
  strapEnd.position.set(0.006, strapH - 0.006, 0);
  hasp.add(strapEnd);
  const strapT = shadowy(new THREE.Mesh(new RoundedBoxGeometry(strapLen, 0.024, 0.26, 3, 0.011), M.strap));
  strapT.position.set(-strapLen / 2 + 0.014, 0, 0);
  strapEnd.add(strapT);

  // two pages that turn over when the diary opens (bent every frame)
  const SHEETS = 2, SEG = 28;
  const sheets = [];
  for (let i = 0; i < SHEETS; i++) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((SEG + 1) * 2 * 3), uv = new Float32Array((SEG + 1) * 2 * 2), idx = [];
    for (let j = 0; j <= SEG; j++) { uv[j * 2] = j / SEG; uv[j * 2 + 1] = 0; uv[(SEG + 1 + j) * 2] = j / SEG; uv[(SEG + 1 + j) * 2 + 1] = 1; }
    for (let j = 0; j < SEG; j++) { const a = j, b = j + 1, c = SEG + 1 + j, d = c + 1; idx.push(a, b, c, b, d, c); }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, M.sheet);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    book.add(m);
    sheets.push(m);
  }
  // angle 0 = lying on the right, PI = lying on the left. "lag" makes the free
  // edge trail gently behind the part near the spine.
  function bendSheet(mesh, angle, lag, lift) {
    const pos = mesh.geometry.attributes.position.array;
    const ds = (PAGE_W - 0.04) / SEG;
    let x = PAGE_X0, y = BLOCK_TOP + lift;
    for (let j = 0; j <= SEG; j++) {
      pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = PAGE_D / 2 - 0.03;
      const k = (SEG + 1 + j) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = -PAGE_D / 2 + 0.03;
      const s = (j + 0.5) / SEG, phi = angle - lag * s * s;
      x += Math.cos(phi) * ds; y += Math.sin(phi) * ds;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  // ---------------------------------------------------------------- key ----
  // Built pointing down -z (tip), the blade's flat faces looking along +x/-x.
  const key = new THREE.Group();
  key.visible = false;
  key.scale.setScalar(KEY_S);
  scene.add(key);
  const BLADE_L = 0.62, BLADE_H = 0.13, BLADE_T = 0.026;
  const bladeMesh = shadowy(new THREE.Mesh(new THREE.BoxGeometry(BLADE_T, BLADE_H, BLADE_L), [M.blade, M.blade, M.gold, M.gold, M.gold, M.gold]));
  bladeMesh.position.z = -BLADE_L / 2 - 0.03;
  key.add(bladeMesh);
  for (const [h, zc, len] of [[0.05, -0.6, 0.07], [0.034, -0.5, 0.07]]) { // the bit
    const b = shadowy(new THREE.Mesh(new RoundedBoxGeometry(BLADE_T, h, len, 2, 0.008), M.gold));
    b.position.set(0, -BLADE_H / 2 - h / 2 + 0.004, zc);
    key.add(b);
  }
  const cyl = (r, len, z) => {
    const g = new THREE.CylinderGeometry(r, r, len, 40); g.rotateX(Math.PI / 2);
    const m = shadowy(new THREE.Mesh(g, M.gold)); m.position.z = z; key.add(m);
  };
  cyl(0.045, 0.03, -0.015); cyl(0.03, 0.15, 0.07);
  // a rounded bow with a heart cut-out
  const bowShape = new THREE.Shape(); bowShape.absarc(0, 0, 0.12, 0, Math.PI * 2, false);
  {
    const hp = new THREE.Path(), s = 0.05;
    hp.moveTo(0, -0.85 * s);
    hp.bezierCurveTo(-0.35 * s, -0.55 * s, -1.0 * s, -0.2 * s, -0.95 * s, 0.3 * s);
    hp.bezierCurveTo(-0.9 * s, 0.8 * s, -0.25 * s, 0.9 * s, 0, 0.45 * s);
    hp.bezierCurveTo(0.25 * s, 0.9 * s, 0.9 * s, 0.8 * s, 0.95 * s, 0.3 * s);
    hp.bezierCurveTo(1.0 * s, -0.2 * s, 0.35 * s, -0.55 * s, 0, -0.85 * s);
    bowShape.holes.push(hp);
  }
  const bowGeo = new THREE.ExtrudeGeometry(bowShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 48 });
  bowGeo.translate(0, 0, -0.01);
  bowGeo.rotateY(Math.PI / 2);
  const bow = shadowy(new THREE.Mesh(bowGeo, M.gold));
  bow.position.z = 0.26;
  key.add(bow);

  // ------------------------------------------------------- desk props ----
  // a yellow pencil and a mint mug of tea
  const pencil = new THREE.Group();
  const pBody = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.25, 6), M.pencil));
  pBody.rotation.z = Math.PI / 2; pencil.add(pBody);
  const pTip = shadowy(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 6), M.pencilWood));
  pTip.rotation.z = -Math.PI / 2; pTip.position.x = 0.705; pencil.add(pTip);
  const pEr = shadowy(new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.08, 6, 12), M.eraser));
  pEr.rotation.z = Math.PI / 2; pEr.position.x = -0.68; pencil.add(pEr);
  pencil.position.set(1.85, 0.045, 0.75); pencil.rotation.y = 0.7;
  scene.add(pencil);
  const mugPts = [[0, 0], [0.3, 0], [0.32, 0.02], [0.33, 0.52], [0.3, 0.52], [0.29, 0.06], [0, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
  const mug = shadowy(new THREE.Mesh(new THREE.LatheGeometry(mugPts, 48), M.mug));
  mug.position.set(2.35, 0, -1.25);
  scene.add(mug);
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.29, 40), M.tea);
  tea.rotation.x = -Math.PI / 2; tea.position.set(2.35, 0.42, -1.25);
  scene.add(tea);
  const handle = shadowy(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 12, 32), M.mug));
  handle.position.set(2.7, 0.27, -1.25);
  scene.add(handle);

  // ------------------------------------------------------- camera shots ----
  let shots = null, keyKeys = null, tanH = 0.3;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const arr = (v) => [v.x, v.y, v.z];
  const pageToWorld = (px, py) => V(PAGE_X0 + px, BLOCK_TOP, -PAGE_D / 2 + py);
  const fit = (w, h) => Math.max(h / (2 * tanH), w / (2 * tanH * camera.aspect)); // distance to fill the view

  function buildShots(aspect) {
    camera.fov = 34;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const from = (look, dir, dist) => look.clone().addScaledVector(dir.clone().normalize(), dist);

    // 1. establishing: the closed diary, right of the title
    const estLook = V(0.1, 0.15, 0.12); // the diary is the whole poster now: centered and big
    const estDist = fit(5.8, 3.9);
    const est = from(estLook, V(0.08, 1.7, 0.75), estDist);
    // 2. key close-up, blade facing the camera
    const keyCentre = V(0.45, 1.1, 0.95);
    const keyOrigin = keyCentre.clone().add(V(-0.125 * KEY_S, 0, 0));
    const readDir = V(0.0, 0.5, 1);
    const readLook = keyCentre.clone().add(V(0.04, 0, 0));
    const readDist = fit(1.02, 0.42);
    const read1 = from(readLook, readDir, readDist);
    const read2 = from(readLook, readDir, readDist * 0.95);
    // 3. the lock
    const lockLook = V(KEYHOLE.x, KEYHOLE.y + 0.15, 0.02);
    const lock1 = from(lockLook, V(-0.3, 0.9, 1), fit(1.5, 0.9));
    // 4. watching the cover open (the camera holds still here)
    const spreadLook = V(-0.95, 0.3, 0.15);
    const spread = from(spreadLook, V(0.25, 1.15, 1.0), fit(6.3, 3.7));
    // 5. over the page: everything written must be visible (and clickable)
    const content = pageToWorld((MARGIN_X + PAGE_W) / 2 + 0.02, 1.24);
    const pageH = fit(2.4, 2.3);
    const pageView = V(content.x, BLOCK_TOP + pageH, content.z + pageH * 0.14);

    shots = [
      { t: 0, pos: arr(est), look: arr(estLook) },
      { t: TL.keyArrive, hold: true, pos: arr(read1), look: arr(readLook) },
      { t: TL.readEnd, hold: true, pos: arr(read2), look: arr(readLook) },
      { t: TL.aboveLock + 0.1, hold: true, pos: arr(lock1), look: arr(lockLook) },
      { t: TL.hasp[0] + 0.2, hold: true, pos: arr(lock1), look: arr(lockLook) },
      { t: TL.cover[0], hold: true, pos: arr(spread), look: arr(spreadLook) },
      { t: TL.cover[0] + TL.cover[1] + 0.25, hold: true, pos: arr(spread), look: arr(spreadLook) },
      { t: TL.write[0] + 0.5, hold: true, pos: arr(pageView), look: arr(content) },
    ];

    // key keyframes (world space), Euler XYZ. One gentle arc, no tumbling.
    const tilt = -Math.atan2(readDir.y, readDir.z);
    const kh = KEYHOLE, down = [-Math.PI / 2, 0, Math.PI / 2];
    keyKeys = [
      { t: 0, pos: arr(keyOrigin.clone().add(V(1.9, -0.25, 0.5))), rot: [tilt, -Math.PI / 2 - 0.5, 0.15] },
      { t: TL.keyArrive, hold: true, pos: arr(keyOrigin), rot: [tilt, -Math.PI / 2, 0] },
      { t: TL.readEnd, hold: true, pos: arr(keyOrigin), rot: [tilt, -Math.PI / 2, 0] },
      { t: TL.aboveLock, hold: true, pos: [kh.x, kh.y + 0.5, kh.z], rot: down },
      { t: TL.inserted, hold: true, pos: [kh.x, kh.y, kh.z], rot: down },
      { t: TL.keyOut[0], hold: true, pos: [kh.x, kh.y, kh.z], rot: down },
      { t: TL.keyOut[0] + TL.keyOut[1], hold: true, pos: [kh.x + 0.4, kh.y + 1.4, kh.z - 0.2], rot: down },
    ];
  }

  // Camera pose that fills the screen with one drawing (looking straight down).
  function fillPose(i) {
    const v = CARDS[i];
    const c = pageToWorld(v.x + v.w / 2, v.y + v.h / 2);
    // the whole sketch fits on screen (the other card fades away during the dive)
    const h = Math.max(v.h / (2 * tanH), v.w / (2 * tanH * camera.aspect)) * 1.04;
    return { pos: V(c.x, BLOCK_TOP + h, c.z + 0.0001), look: c };
  }

  // ------------------------------------------------------------- state ----
  // idle -> playing -> choosing -> picking -> done
  let state = 'idle';
  let T = 0, last = performance.now(), raf = 0;
  let debugPaused = false;
  let picked = -1, pickT = 0;
  const pickFrom = { pos: V(0, 0, 0), look: V(0, 0, 0) };
  const hoverTarget = [0, 0];
  const fired = new Set();
  const camPos = V(0, 0, 0), camLook = V(0, 0, 0);
  const qTurn = new THREE.Quaternion(), qBase = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'XYZ');
  const yAxis = V(0, 1, 0), tmp = V(0, 0, 0);

  const SOUND_CUES = [ // [seconds after the trigger, name]
    [0.02, 'whoosh'],
    [TL.inserted - 0.04, 'insert'],
    [TL.turn[0] + TL.turn[1], 'clunk'],
    [TL.hasp[0] + 0.02, 'clasp'],
    [TL.cover[0] + 0.05, 'page'],
    ...[0, 1].map((i) => [TL.pages[0] + i * TL.pages[1] + 0.3, 'page']),
    [TL.write[0], 'write'],
    [TL.write[0] + WR.stamp, 'stamp'],
    [TL.write[0] + WR.sketch[0], 'write'],
  ];

  // ------------------------------------------------- the main animation ----
  function update(t, dt) {
    const playing = state !== 'idle';

    // camera
    const p = sampleTrack(shots, t, 'pos'), l = sampleTrack(shots, t, 'look');
    camPos.set(p[0], p[1], p[2]); camLook.set(l[0], l[1], l[2]);
    const dive = pickT + (reduceMotion ? 0 : TL.colorIn - 0.1); // the camera starts once the colour is mostly in
    if (state === 'picking' || state === 'done') {
      const f = fillPose(picked);
      const e = easeInOutCubic(seg(t, dive, reduceMotion ? 0.001 : TL.pickPush));
      camPos.copy(pickFrom.pos).lerp(f.pos, e);
      camLook.copy(pickFrom.look).lerp(f.look, e);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    // key
    key.visible = playing && t > 0 && t < TL.keyOut[0] + TL.keyOut[1];
    const turn = easeOutCubic(seg(t, TL.turn[0], TL.turn[1])) * Math.PI / 2;
    if (key.visible) {
      const kp = sampleTrack(keyKeys, t, 'pos'), kr = sampleTrack(keyKeys, t, 'rot');
      key.position.set(kp[0], kp[1], kp[2]);
      qBase.setFromEuler(eul.set(kr[0], kr[1], kr[2], 'XYZ'));
      qTurn.setFromAxisAngle(yAxis, -turn);
      key.quaternion.copy(qTurn).multiply(qBase);
      // shrink away as it leaves, instead of flying through the frame
      const away = smooth(TL.keyOut[0] + 0.15, TL.keyOut[0] + TL.keyOut[1], t);
      key.scale.setScalar(KEY_S * (1 - 0.8 * away));
    }
    plug.rotation.y = -turn;

    // strap lifts away, then the cover swings open while the camera holds still
    // strap lifts off the lock, then falls flat onto the desk as the cover opens
    const fall = easeInOutCubic(seg(t, TL.cover[0], 0.9));
    hasp.rotation.z = -0.55 * easeOutCubic(seg(t, TL.hasp[0], TL.hasp[1])) - 0.99 * fall;
    strapEnd.rotation.z = -Math.PI / 2 * fall;
    coverPivot.rotation.z = easeInOutCubic(seg(t, TL.cover[0], TL.cover[1])) * COVER_OPEN;
    for (let i = 0; i < SHEETS; i++) {
      const e = easeInOutSine(seg(t, TL.pages[0] + i * TL.pages[1], TL.pages[2]));
      bendSheet(sheets[i], e * (COVER_OPEN - 0.012 * (i + 1)), Math.sin(e * Math.PI) * 0.7, 0.003 - i * 0.0012);
    }

    // writing clock (after a pick, finish any unwritten ink quickly)
    let w = seg(t, TL.write[0], TL.write[1]);
    if (picked >= 0) w = Math.max(w, seg(t, pickT, 0.4));
    writeU.value = w;

    // colour-in on the picked card, and fade the other one as we dive
    if (picked >= 0) {
      colorPU.value.setComponent(picked, reduceMotion ? 1 : seg(t, pickT, TL.colorIn));
      dimU.value.setComponent(1 - picked, reduceMotion ? 1 : smooth(dive, dive + 0.9, t));
      hoverTarget[picked] = t < dive ? 1 : 0; // stays lifted while it colours in
    }

    // hover eases toward its target
    const k = 1 - Math.exp(-(dt || 0.016) * 9);
    hoverU.value.x += (hoverTarget[0] - hoverU.value.x) * k;
    hoverU.value.y += (hoverTarget[1] - hoverU.value.y) * k;

    // a soft fill light for the key close-up
    keyLight.intensity = playing ? smooth(0.4, TL.keyArrive, t) * (1 - smooth(TL.keyOut[0], TL.keyOut[0] + 0.5, t)) * 1.2 : 0;
    keyLight.position.copy(camera.position).add(tmp.set(-0.3, 0.3, -0.1));

    // sounds
    if (playing && !reduceMotion) SOUND_CUES.forEach(([st, name], i) => { if (t >= st && !fired.has(i)) { fired.add(i); sound(name); } });

    if (state === 'playing' && t >= PICK_READY) startChoosing();
    if (state === 'choosing') placePickButtons();
  }

  // invisible buttons over each drawing (including its label underneath)
  function placePickButtons() {
    const w = root.clientWidth, h = root.clientHeight;
    CARDS.forEach((v, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [px, py] of [[v.x, v.y], [v.x + v.w, v.y], [v.x, v.y + v.h + 0.3], [v.x + v.w, v.y + v.h + 0.3]]) {
        const s = pageToWorld(px, py).project(camera);
        const sx = (s.x * 0.5 + 0.5) * w, sy = (-s.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      const b = pickBtns[i].style;
      if (!SHOWN(i)) { b.display = 'none'; return; }
      b.left = `${x0}px`; b.top = `${y0}px`; b.width = `${x1 - x0}px`; b.height = `${y1 - y0}px`;
    });
  }

  function startChoosing() {
    state = 'choosing';
    root.classList.add('is-choosing');
    pickBtns.forEach((b, i) => { b.tabIndex = SHOWN(i) ? 0 : -1; });
    srLine.textContent = SHIRA_ONLY ? `${HAND_LINES.join(' ')}. ${COPY.edition}. ${COPY.hintMouse}.` : `${HAND_LINES.join(' ')}. ${COPY.edition}. ${PICK_TEXT}: ${paths.map((p) => p.label).join(', or ')}.`;
  }

  function choose(i) {
    if (state !== 'choosing' || destroyed) return;
    picked = i;
    sound('pick');
    root.classList.remove('is-choosing');
    pickBtns.forEach((b) => { b.tabIndex = -1; b.blur(); });
    hoverTarget[0] = hoverTarget[1] = 0;
    hoverTarget[i] = 1;
    pickFrom.pos.copy(camera.position);
    pickFrom.look.copy(camLook);
    if (reduceMotion) { // short cross-fade instead of the camera glide
      root.classList.add('is-veiled');
      setTimeout(() => {
        if (destroyed) return;
        state = 'picking'; pickT = T;
        root.classList.remove('is-veiled');
        setTimeout(() => finish(), 700);
      }, 420);
      return;
    }
    state = 'picking';
    pickT = T;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state !== 'idle' && state !== 'done' && !debugPaused) T += dt;
    update(state === 'idle' ? 0 : T, dt);
    renderer.render(scene, camera);
    if (state === 'picking' && !reduceMotion && T >= pickT + TL.colorIn - 0.1 + TL.pickPush + 0.08 && !debugPaused) finish();
  }

  function finish() {
    if (state === 'done' || destroyed) return;
    state = 'done';
    hoverTarget[0] = hoverTarget[1] = 0;
    hoverU.value.set(0, 0);
    update(T, 0);
    renderer.render(scene, camera);
    cancelAnimationFrame(raf); raf = 0; // the last frame stays on the canvas for the site's cross-fade
    try { onOpen(paths[picked].id); } catch (e) { console.error(e); }
  }

  // ------------------------------------------------------------ resize ----
  function resize() {
    const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    buildShots(w / h);
    if (state === 'done') { update(T, 0); renderer.render(scene, camera); }
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(root);
  resize();

  // ------------------------------------------------------------- fonts ----
  // Repaint the blade and build the ink once the web fonts are ready.
  const fontsReady = (async () => {
    const timeout = new Promise((r) => setTimeout(() => r(null), 3000));
    let res = null;
    try {
      res = await Promise.race([
        Promise.all([document.fonts.load('500 80px "Fraunces"'), document.fonts.load('400 80px "Nanum Pen Script"'), document.fonts.load('600 40px "IBM Plex Mono"')]),
        timeout,
      ]);
    } catch (e) { res = null; }
    if (destroyed) return;
    if (res && res[0] && res[0].length) {
      paintBlade(blade, '500 SIZEpx "Fraunces", Georgia, serif');
      bladeMap.needsUpdate = bladeBump.needsUpdate = true;
    }
    const hasHand = !!(res && res[1] && res[1].length) || document.fonts.check('400 40px "Nanum Pen Script"');
    const ink = buildInk({
      W: PW, ppu, paths, rand: rng(91),
      font: hasHand ? '"Nanum Pen Script", "Patrick Hand", "Comic Sans MS", cursive' : '"Comic Sans MS", "Segoe Print", cursive',
    });
    track(ink.inkTex); track(ink.timeTex); track(ink.colorTex);
    ink.inkTex.anisotropy = Math.min(16, maxAniso);
    inkU.value = ink.inkTex; inkTimeU.value = ink.timeTex;
    colorU.value = ink.colorTex; colorBoxU.value.copy(ink.colorBox);
  })();

  // Compile shaders and upload textures before the first visible frame.
  renderer.compile(scene, camera);
  update(0, 0);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-ready')));

  // ------------------------------------------------------------- input ----
  let touchY = null;
  const onWheel = (e) => { e.preventDefault(); if (Math.abs(e.deltaY) + Math.abs(e.deltaX) > 1) open(); };
  const onTouchStart = (e) => { touchY = e.touches[0] ? e.touches[0].clientY : null; };
  const onTouchMove = (e) => { e.preventDefault(); if (touchY != null && e.touches[0] && Math.abs(e.touches[0].clientY - touchY) > 8) open(); };
  const onClick = (e) => { if (!e.target.closest('.vault-pick')) open(); };
  const onKey = (e) => {
    if (state !== 'idle') return; // let Enter/Space reach the pick buttons later
    if (['Enter', ' ', 'Spacebar', 'ArrowDown', 'PageDown'].includes(e.key)) { e.preventDefault(); open(); }
  };
  root.addEventListener('click', onClick);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('keydown', onKey);
  const pickHandlers = pickBtns.map((b, i) => {
    const on = () => { if (state === 'choosing') hoverTarget[i] = 1; };
    const off = () => { if (state === 'choosing' && document.activeElement !== b) hoverTarget[i] = 0; };
    const blur = () => { if (state === 'choosing') hoverTarget[i] = 0; };
    const click = (e) => { e.stopPropagation(); choose(i); };
    b.addEventListener('pointerenter', on); b.addEventListener('pointerleave', off);
    b.addEventListener('focus', on); b.addEventListener('blur', blur);
    b.addEventListener('click', click);
    return { b, on, off, blur, click };
  });
  function removeInput() {
    root.removeEventListener('click', onClick);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('keydown', onKey);
    pickHandlers.forEach(({ b, on, off, blur, click }) => {
      b.removeEventListener('pointerenter', on); b.removeEventListener('pointerleave', off);
      b.removeEventListener('focus', on); b.removeEventListener('blur', blur); b.removeEventListener('click', click);
    });
  }

  // ------------------------------------------------------------ public ----
  function open() {
    if (state !== 'idle' || destroyed) return;
    root.classList.add('is-opening');
    srLine.textContent = KEY_LINES.join(' ');
    if (reduceMotion) {
      // Short cross-fade: fade out, jump to the written page, fade back in.
      state = 'playing'; debugPaused = true;
      root.classList.add('is-veiled');
      setTimeout(() => {
        fontsReady.then(() => {
          if (destroyed) return;
          T = TL.write[0] + TL.write[1] + 0.01;
          update(T, 0);
          root.classList.remove('is-veiled');
          debugPaused = false;
        });
      }, 420);
      return;
    }
    state = 'playing';
    T = 0;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    removeInput();
    ro.disconnect();
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    Object.values(M).forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    envRT.dispose(); pmrem.dispose();
    renderer.dispose();
    root.remove();
    // only undo the scroll lock if nobody changed it in the meantime
    if (html.style.overflow === 'hidden') html.style.overflow = prevOverflow[0];
    if (body.style.overflow === 'hidden') body.style.overflow = prevOverflow[1];
  }

  return {
    open,
    destroy,
    // Testing helpers (not part of the contract): jump to a moment and freeze.
    _seek(t) {
      if (state === 'idle') { root.classList.add('is-opening'); state = 'playing'; }
      debugPaused = true; T = t;
    },
    _resume() { debugPaused = false; },
    _choose(i) { choose(i); },
  };

  // ---------------------------------------------------- no-WebGL fallback ----
  function mountFallback() {
    requestAnimationFrame(() => root.classList.add('is-ready'));
    let stage = 0;
    const go = () => {
      if (stage) return; stage = 1;
      root.classList.add('is-opening', 'is-choosing');
      pickBtns.forEach((b, i) => {
        Object.assign(b.style, { left: `calc(50% + ${i ? 12 : -252}px)`, top: '45%', width: '240px', height: '64px',
          color: C.ink, fontSize: '22px', fontFamily: '"Nanum Pen Script", "Patrick Hand", cursive', background: '#fbf8f1', border: `2px solid ${C.ink}` });
        b.textContent = paths[i].label; b.tabIndex = 0;
      });
    };
    const pick = (i) => () => { if (stage !== 1) return; stage = 2; root.classList.add('is-veiled'); setTimeout(() => { try { onOpen(paths[i].id); } catch (e) { console.error(e); } }, 500); };
    const picks = pickBtns.map((b, i) => { const f = pick(i); b.addEventListener('click', f); return f; });
    const wheel = (e) => { e.preventDefault(); go(); };
    const keyH = (e) => { if (!stage && ['Enter', ' ', 'ArrowDown', 'PageDown'].includes(e.key)) { e.preventDefault(); go(); } };
    const tm = (e) => { e.preventDefault(); go(); };
    const click = (e) => { if (!e.target.closest('.vault-pick')) go(); };
    root.addEventListener('click', click);
    window.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keyH);
    window.addEventListener('touchmove', tm, { passive: false });
    return {
      open: go,
      destroy() {
        root.removeEventListener('click', click);
        pickBtns.forEach((b, i) => b.removeEventListener('click', picks[i]));
        window.removeEventListener('wheel', wheel); window.removeEventListener('keydown', keyH); window.removeEventListener('touchmove', tm);
        root.remove();
        if (html.style.overflow === 'hidden') html.style.overflow = prevOverflow[0];
        if (body.style.overflow === 'hidden') body.style.overflow = prevOverflow[1];
      },
    };
  }
}
