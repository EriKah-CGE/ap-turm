/**
 * Generates the Map Builder starter set "ap-base" (tiles/ap-base/*.png + set.json).
 * Run: npm run tiles
 *
 * Everything is drawn here: no downloads, no foreign image files. 256 x 256 RGBA PNGs, written with node:zlib.
 * Floors tile seamlessly (all noise is periodic over 256 px); a faint darker rim marks the grid. Walls are solid
 * masonry blocks with a lit face on the sides that carry a wall. Props have a transparent background.
 * Colours: muted stone, wood and earth tones that sit well next to the sheet's Celestial theme.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const N = 256;
const OUT = new URL("../tiles/ap-base/", import.meta.url);

/* ---------- PNG ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(img) {
  const { w, h, px } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1); raw[o] = 1;                                   // filter: Sub
    for (let x = 0; x < w * 4; x++) {
      const v = Math.max(0, Math.min(255, Math.round(px[y * w * 4 + x])));
      const left = x >= 4 ? Math.max(0, Math.min(255, Math.round(px[y * w * 4 + x - 4]))) : 0;
      raw[o + 1 + x] = (v - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- image + drawing ---------- */
function image(w = N, h = N) { return { w, h, px: new Float32Array(w * h * 4) }; }
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const shade = (c, f) => c.map(v => v * f);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
/** Paint every pixel: fn(x, y) -> [r, g, b, a?] (a 0..1), alpha-blended over what is there. */
function paint(img, fn) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const c = fn(x + 0.5, y + 0.5); if (!c) continue;
    const a = c[3] ?? 1; if (a <= 0) continue;
    const i = (y * img.w + x) * 4, da = img.px[i + 3] / 255, oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) img.px[i + k] = oa ? (c[k] * a + img.px[i + k] * da * (1 - a)) / oa : 0;
    img.px[i + 3] = oa * 255;
  }
}
/** Shape from a signed distance function (negative inside), anti-aliased over one pixel. */
function shape(img, sdf, colorFn) {
  paint(img, (x, y) => { const d = sdf(x, y); if (d > 1) return null; const c = colorFn(x, y, d); return [c[0], c[1], c[2], (c[3] ?? 1) * clamp01(0.5 - d)]; });
}
const sdCircle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const sdBox = (cx, cy, hw, hh, r = 0) => (x, y) => { const dx = Math.abs(x - cx) - hw + r, dy = Math.abs(y - cy) - hh + r; return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r; };
const sdEllipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);

/* ---------- periodic noise (tiles seamlessly over 256 px) ---------- */
function hash(i, j, seed) { let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
/** Value noise with `cells` lattice cells across the tile, wrapping at the edges. */
function vnoise(x, y, cells, seed, cellsY = cells) {
  const gx = x / (N / cells), gy = y / (N / cellsY), i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
  const mx = (v) => ((v % cells) + cells) % cells, my = (v) => ((v % cellsY) + cellsY) % cellsY;
  const a = hash(mx(i), my(j), seed), b = hash(mx(i + 1), my(j), seed), c = hash(mx(i), my(j + 1), seed), d = hash(mx(i + 1), my(j + 1), seed);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, base = 4, oct = 4) { let v = 0, amp = 0.5, tot = 0; for (let o = 0; o < oct; o++) { v += vnoise(x, y, base << o, seed + o * 17) * amp; tot += amp; amp *= 0.5; } return v / tot; }
const grain = (x, y, seed) => hash(Math.floor(x), Math.floor(y), seed);

/** Faint darker rim so the grid stays readable on a filled floor. */
function rim(img, strength = 0.12, width = 3) {
  paint(img, (x, y) => { const d = Math.min(x, y, N - x, N - y); if (d > width) return null; return [0, 0, 0, strength * (1 - d / width) + 0.03]; });
}

/* ---------- palette ---------- */
const C = {
  stone: hex("#6d717b"), stoneDk: hex("#4e525c"), mortar: hex("#3a3d45"),
  wood: hex("#7b5a3d"), woodDk: hex("#5a3f29"), woodLt: hex("#97724d"),
  sand: hex("#b4a17c"), sandDk: hex("#9a8763"),
  grass: hex("#4d6a45"), grassDk: hex("#3a5235"), grassLt: hex("#6a8a58"),
  water: hex("#2c5068"), waterLt: hex("#4b7590"),
  crust: hex("#2b2523"), lava: hex("#b0522a"), lavaHot: hex("#d39440"),
  wall: hex("#474a55"), wallDk: hex("#33353e"), face: hex("#8b8f9b"), faceDk: hex("#6c707c"),
  iron: hex("#3b3e46"), ironLt: hex("#6a6e78"), gold: hex("#b8975a"),
  leaf: hex("#3f5e3a"), leafLt: hex("#5c7d4f"), bark: hex("#5a4330"),
  shadow: [0, 0, 0]
};

/* ---------- floors ---------- */
function floorStone() {
  const img = image();
  paint(img, (x, y) => {
    const n = fbm(x, y, 11, 4, 4), g = grain(x, y, 5);
    const sx = Math.floor(x / 128), sy = Math.floor(y / 128);
    const slab = hash(sx, sy, 9) * 0.12 - 0.06;                       // each slab its own tone
    const lx = x % 128, ly = y % 128, edge = Math.min(lx, ly, 128 - lx, 128 - ly);
    const mortar = 1 - smooth(1.5, 4, edge);
    const c = mix(mix(C.stone, C.stoneDk, n * 0.9), C.mortar, mortar);
    return shade(c, 1 + slab + (g - 0.5) * 0.08);
  });
  rim(img); return img;
}
function floorWood() {
  const img = image();
  paint(img, (x, y) => {
    const plank = Math.floor(y / 64), ly = y % 64;
    const off = [0, 96, 32, 160][plank % 4];                          // staggered end joints, periodic over 256
    const lx = (x + off) % 256;
    const seam = 1 - smooth(1, 3, Math.min(ly, 64 - ly));
    const joint = 1 - smooth(1, 2.5, Math.min(lx, 256 - lx));
    const g = vnoise(x, y, 4, 21 + plank, 64) * 0.6 + vnoise(x, y, 32, 29, 64) * 0.4;   // grain stretched along the plank
    const tone = hash(plank, Math.floor((x + off) / 256), 3) * 0.14 - 0.07;
    const c = mix(mix(C.wood, C.woodLt, g), C.woodDk, Math.max(seam, joint) * 0.85);
    return shade(c, 1 + tone + (grain(x, y, 7) - 0.5) * 0.05);
  });
  rim(img); return img;
}
function floorSand() {
  const img = image();
  paint(img, (x, y) => {
    const n = fbm(x, y, 31, 4, 5), ripple = Math.sin(((x * 6 + y * 2) / N + fbm(x, y, 33, 2, 2) * 0.5) * Math.PI * 2) * 0.5 + 0.5;
    const c = mix(C.sand, C.sandDk, n * 0.7 + ripple * 0.15);
    return shade(c, 1 + (grain(x, y, 35) - 0.5) * 0.12);
  });
  rim(img, 0.1); return img;
}
function floorGrass() {
  const img = image();
  paint(img, (x, y) => {
    const n = fbm(x, y, 41, 4, 5), blades = grain(x * 0.7, y * 0.35, 43);
    let c = mix(C.grass, C.grassDk, n);
    if (blades > 0.86) c = mix(c, C.grassLt, (blades - 0.86) * 5);
    return shade(c, 1 + (grain(x, y, 45) - 0.5) * 0.08);
  });
  rim(img, 0.1); return img;
}
function floorWater() {
  const img = image();
  paint(img, (x, y) => {
    const w1 = Math.sin((x / N) * Math.PI * 2 * 3 + fbm(x, y, 51, 2, 3) * 6), w2 = Math.sin((y / N) * Math.PI * 2 * 4 + fbm(x, y, 53, 2, 3) * 6);
    const n = fbm(x, y, 55, 4, 3);
    const crest = smooth(0.75, 0.98, (w1 * w2) * 0.5 + 0.5);
    return mix(mix(C.water, shade(C.water, 0.8), n), C.waterLt, crest * 0.6);
  });
  rim(img, 0.1); return img;
}
function floorLava() {
  const img = image();
  paint(img, (x, y) => {
    const n = fbm(x, y, 61, 4, 5);
    const crack = 1 - Math.abs(n - 0.5) * 2;                           // ridges where the noise crosses 0.5
    const glow = smooth(0.9, 0.985, crack);
    const c = mix(mix(C.crust, shade(C.crust, 1.3), fbm(x, y, 63, 8, 3)), C.lava, glow);
    return mix(c, C.lavaHot, smooth(0.95, 1, crack) * 0.8);
  });
  rim(img, 0.1); return img;
}

/* ---------- walls (solid blocks; `faces` = the sides that carry a wall) ---------- */
function masonry(img) {
  paint(img, (x, y) => {
    const row = Math.floor(y / 32), lx = (x + (row % 2) * 32) % 64, ly = y % 32;
    const joint = 1 - smooth(1, 3, Math.min(lx, 64 - lx, ly, 32 - ly));
    const tone = hash(Math.floor((x + (row % 2) * 32) / 64), row, 71) * 0.16 - 0.08;
    const c = mix(mix(C.wall, C.wallDk, fbm(x, y, 73, 8, 3) * 0.8), shade(C.wallDk, 0.8), joint);
    return shade(c, 1 + tone);
  });
}
/** Lit face band along a side, with a dark line where it meets the floor. */
function face(img, side, depth = 34) {
  paint(img, (x, y) => {
    const d = { n: y, s: N - y, w: x, e: N - x }[side];
    if (d > depth + 6) return null;
    if (d > depth) return [0, 0, 0, 0.35 * (1 - (d - depth) / 6)];      // shadow behind the face
    const along = side === "n" || side === "s" ? x : y;
    const blk = Math.floor(along / 48), la = along % 48;
    const joint = 1 - smooth(1, 2.5, Math.min(la, 48 - la));
    const lit = 1 - d / depth * 0.25;
    const c = mix(mix(C.face, C.faceDk, fbm(x, y, 81, 8, 3)), C.wallDk, joint * 0.7);
    const edge = d < 3 ? 0.55 : 1;                                       // dark line at the floor edge
    return shade(c, lit * edge * (1 + (hash(blk, side.charCodeAt(0), 83) - 0.5) * 0.1));
  });
}
function wallTile(faces) { const img = image(); masonry(img); for (const f of faces) face(img, f); return img; }
function pillar() {
  const img = image(); masonry(img);
  for (const f of ["n", "e", "s", "w"]) face(img, f, 26);
  shape(img, sdCircle(128, 128, 54), (x, y) => mix(C.face, C.faceDk, smooth(0, 1, Math.hypot(x - 110, y - 110) / 70)));
  shape(img, sdCircle(128, 128, 40), (x, y) => mix(shade(C.face, 1.08), C.faceDk, fbm(x, y, 91, 8, 2) * 0.6));
  return img;
}

/* ---------- doors (door on the north edge) ---------- */
function threshold(img) {
  paint(img, (x, y) => shade(mix(C.stone, C.stoneDk, fbm(x, y, 101, 4, 3)), 0.9 + (grain(x, y, 103) - 0.5) * 0.06));
  // jambs left and right: masonry stubs
  for (const [x0, x1] of [[0, 30], [226, 256]]) paint(img, (x, y) => x >= x0 && x < x1 ? shade(mix(C.wall, C.wallDk, fbm(x, y, 105, 8, 2)), 0.95) : null);
}
function doorLeaf(img, open) {
  const plank = (x, y) => { const lx = (x - 30) % 28; return mix(mix(C.wood, C.woodLt, vnoise(x * 3, y * 0.3, 32, 107)), C.woodDk, 1 - smooth(1, 3, Math.min(lx, 28 - lx))); };
  if (!open) {
    shape(img, sdBox(128, 22, 98, 18, 2), (x, y) => plank(x, y));
    for (const bx of [70, 186]) shape(img, sdBox(bx, 22, 6, 18), () => C.iron);
    shape(img, sdCircle(150, 26, 5), () => C.gold);
  } else {
    shape(img, sdBox(46, 120, 14, 96, 2), (x, y) => mix(mix(C.wood, C.woodLt, vnoise(x * 0.3, y * 3, 32, 109)), C.woodDk, 0.15));
    for (const by of [60, 180]) shape(img, sdBox(46, by, 14, 5), () => C.iron);
  }
}
function doorTile(kind) {
  const img = image(); threshold(img);
  if (kind === "portcullis") {
    shape(img, sdBox(128, 22, 98, 16), () => [...C.iron, 0.18]);
    for (let bx = 44; bx <= 212; bx += 24) shape(img, sdBox(bx, 22, 4, 18, 2), () => C.ironLt);
    shape(img, sdBox(128, 12, 98, 3), () => C.iron); shape(img, sdBox(128, 32, 98, 3), () => C.iron);
  } else doorLeaf(img, kind === "open");
  return img;
}

/* ---------- stairs (top of the stairs = north) ---------- */
function stairs(up) {
  const img = image();
  paint(img, (x, y) => {
    const step = Math.floor(y / 32), ly = y % 32;
    const t = up ? 1 - step / 7 : step / 7;                             // up: lighter towards the north
    const c = mix(shade(C.stone, 0.7), shade(C.stone, 1.15), t);
    const nose = ly < 4 ? 1.2 : ly > 28 ? 0.7 : 1;
    return shade(mix(c, C.stoneDk, fbm(x, y, 121, 8, 3) * 0.35), nose);
  });
  // side walls
  for (const [x0, x1] of [[0, 18], [238, 256]]) paint(img, (x, y) => x >= x0 && x < x1 ? mix(C.wall, C.wallDk, fbm(x, y, 123, 8, 2)) : null);
  // chevron pointing the way up (up) or down (down), engraved
  const dir = up ? -1 : 1;
  shape(img, (x, y) => { const dx = Math.abs(x - 128), yy = (y - 128) * dir; return Math.abs(yy - (40 - dx * 0.8)) - 5 + (dx > 46 ? 99 : 0); }, () => [...C.gold, 0.55]);
  rim(img, 0.08); return img;
}

/* ---------- props (transparent background) ---------- */
function dropShadow(img, sdf) { shape(img, (x, y) => sdf(x - 8, y - 10) - 4, () => [0, 0, 0, 0.35]); }
function crate() {
  const img = image(); const sd = sdBox(128, 128, 80, 80, 6); dropShadow(img, sd);
  shape(img, sd, (x, y) => { const ly = (y - 48) % 32; return mix(mix(C.wood, C.woodLt, vnoise(x * 0.3, y * 3, 32, 131)), C.woodDk, 1 - smooth(1, 3, Math.min(ly, 32 - ly))); });
  shape(img, (x, y) => Math.max(sdBox(128, 128, 80, 80)(x, y), 70 - Math.max(Math.abs(x - 128), Math.abs(y - 128))), () => C.woodDk);
  shape(img, (x, y) => Math.max(Math.abs((x - 128) - (y - 128)) / Math.SQRT2 - 7, sdBox(128, 128, 72, 72)(x, y)), () => C.woodLt);
  return img;
}
function barrel() {
  const img = image(); dropShadow(img, sdCircle(128, 128, 78));
  shape(img, sdCircle(128, 128, 78), (x, y) => mix(C.woodLt, C.woodDk, smooth(20, 80, Math.hypot(x - 110, y - 110))));
  for (const r of [72, 50]) shape(img, (x, y) => Math.abs(Math.hypot(x - 128, y - 128) - r) - 3.5, () => C.iron);
  shape(img, sdCircle(128, 128, 30), (x, y) => mix(C.wood, C.woodDk, vnoise(x * 2, y * 0.4, 16, 141) * 0.6));
  return img;
}
function table() {
  const img = image(); const sd = sdBox(128, 128, 100, 66, 10); dropShadow(img, sd);
  shape(img, sd, (x, y) => { const ly = (y - 62) % 33; return mix(mix(C.wood, C.woodLt, vnoise(x * 0.25, y * 4, 16, 151)), C.woodDk, (1 - smooth(1, 3, Math.min(ly, 33 - ly))) * 0.8); });
  shape(img, (x, y) => Math.abs(sd(x, y) + 4) - 2, () => C.woodDk);
  return img;
}
function chest() {
  const img = image(); const sd = sdBox(128, 132, 86, 58, 8); dropShadow(img, sd);
  shape(img, sd, (x, y) => mix(mix(C.wood, C.woodLt, vnoise(x * 0.3, y * 3, 32, 161)), C.woodDk, y < 118 ? 0.25 : 0));
  shape(img, sdBox(128, 118, 86, 4), () => C.iron);
  for (const bx of [66, 190]) shape(img, sdBox(bx, 132, 7, 58), () => C.iron);
  shape(img, sdBox(128, 128, 12, 14, 3), () => C.gold); shape(img, sdCircle(128, 130, 3.5), () => C.iron);
  return img;
}
function brazier() {
  const img = image(); dropShadow(img, sdCircle(128, 128, 70));
  shape(img, sdCircle(128, 128, 112), (x, y) => [...C.lavaHot, 0.18 * (1 - smooth(40, 112, Math.hypot(x - 128, y - 128)))]);
  shape(img, sdCircle(128, 128, 70), (x, y) => mix(C.ironLt, C.iron, smooth(20, 75, Math.hypot(x - 112, y - 112))));
  shape(img, sdCircle(128, 128, 54), (x, y) => { const n = fbm(x, y, 171, 16, 3); return mix(mix(C.crust, C.lava, smooth(0.45, 0.7, n)), C.lavaHot, smooth(0.7, 0.85, n) * (1 - Math.hypot(x - 128, y - 128) / 60)); });
  return img;
}
function rubble() {
  const img = image();
  const rocks = [[70, 80, 26, 20], [150, 60, 18, 14], [190, 140, 30, 22], [100, 170, 22, 18], [60, 140, 12, 10], [140, 120, 16, 12], [200, 200, 14, 11], [120, 220, 18, 12], [40, 210, 10, 9], [210, 80, 11, 9]];
  for (const [cx, cy, rx, ry] of rocks) shape(img, sdEllipse(cx + 5, cy + 6, rx, ry), () => [0, 0, 0, 0.3]);
  rocks.forEach(([cx, cy, rx, ry], i) => shape(img, (x, y) => sdEllipse(cx, cy, rx, ry)(x, y) + (vnoise(x, y, 32, 181 + i) - 0.5) * 6,
    (x, y) => mix(shade(C.stone, 1.1), C.stoneDk, smooth(0, 1, ((x - cx) + (y - cy)) / (rx + ry) + 0.5))));
  return img;
}
function tree() {
  const img = image();
  shape(img, sdCircle(140, 142, 104), () => [0, 0, 0, 0.3]);
  shape(img, sdCircle(128, 128, 18), () => C.bark);
  const blobs = [[128, 128, 92], [90, 100, 54], [170, 96, 52], [160, 168, 56], [92, 160, 50]];
  blobs.forEach(([cx, cy, r], i) => shape(img, (x, y) => sdCircle(cx, cy, r)(x, y) + (vnoise(x, y, 32, 191 + i) - 0.5) * 14,
    (x, y) => mix(mix(C.leafLt, C.leaf, smooth(0, 1, Math.hypot(x - cx + r * 0.3, y - cy + r * 0.3) / (r * 1.3))), C.grassDk, fbm(x, y, 197, 16, 2) * 0.35)));
  return img;
}
function rock() {
  const img = image();
  const sd = (x, y) => sdEllipse(128, 132, 86, 70)(x, y) + (fbm(x, y, 201, 4, 3) - 0.5) * 34;
  shape(img, (x, y) => sd(x - 9, y - 11), () => [0, 0, 0, 0.35]);
  shape(img, sd, (x, y) => mix(mix(shade(C.stone, 1.18), C.stoneDk, smooth(-60, 90, (x - 128) + (y - 128))), C.mortar, fbm(x, y, 203, 16, 3) * 0.3));
  shape(img, (x, y) => Math.max(sd(x, y), Math.abs((x - 128) * 0.6 - (y - 128)) - 2.5), () => [...C.mortar, 0.7]);   // a crack
  return img;
}

/* ---------- set ---------- */
const TILES = [
  ["floor-stone", "Stone floor", "floor", "none", floorStone, ["stone", "dungeon", "flagstone"]],
  ["floor-wood", "Wooden floor", "floor", "none", floorWood, ["wood", "planks", "house"]],
  ["floor-sand", "Sand", "floor", "none", floorSand, ["sand", "desert", "beach"]],
  ["floor-grass", "Grass", "floor", "none", floorGrass, ["grass", "outdoor", "meadow"]],
  ["floor-water", "Water", "floor", "none", floorWater, ["water", "river", "lake"]],
  ["floor-lava", "Lava", "floor", "none", floorLava, ["lava", "fire", "volcano"]],
  ["wall-straight", "Wall, straight", "wall", ["n"], () => wallTile(["n"]), ["wall", "stone"]],
  ["wall-corner", "Wall, corner", "wall", ["n", "e"], () => wallTile(["n", "e"]), ["wall", "corner", "stone"]],
  ["wall-end", "Wall, end", "wall", ["n", "e", "w"], () => wallTile(["n", "e", "w"]), ["wall", "end", "stone"]],
  ["wall-pillar", "Pillar", "wall", "box", pillar, ["pillar", "column", "stone"]],
  ["door-wood-closed", "Wooden door, closed", "door", "door", () => doorTile("closed"), ["door", "wood", "closed"], { door: "n" }],
  ["door-wood-open", "Wooden door, open", "door", "door", () => doorTile("open"), ["door", "wood", "open"], { door: "n", doorState: "open" }],
  ["door-portcullis", "Portcullis", "door", ["n"], () => doorTile("portcullis"), ["portcullis", "gate", "bars", "iron"], { wallType: "transparent" }],
  ["stairs-up", "Stairs up", "stairs", "none", () => stairs(true), ["stairs", "up"]],
  ["stairs-down", "Stairs down", "stairs", "none", () => stairs(false), ["stairs", "down"]],
  ["prop-crate", "Crate", "props", "none", crate, ["crate", "box", "wood"]],
  ["prop-barrel", "Barrel", "props", "none", barrel, ["barrel", "wood"]],
  ["prop-table", "Table", "props", "none", table, ["table", "furniture", "wood"]],
  ["prop-chest", "Chest", "props", "none", chest, ["chest", "treasure", "loot"]],
  ["prop-brazier", "Brazier", "props", "none", brazier, ["brazier", "fire", "light"]],
  ["prop-rubble", "Rubble", "props", "none", rubble, ["rubble", "debris", "stone"]],
  ["prop-tree", "Tree", "props", "none", tree, ["tree", "outdoor", "forest"]],
  ["prop-rock", "Rock", "props", "none", rock, ["rock", "boulder", "stone"]]
];

fs.mkdirSync(OUT, { recursive: true });
const set = {
  id: "ap-base", name: "AP-Turm Base", gridSize: 128,
  categories: [{ id: "floor", name: "Floor" }, { id: "wall", name: "Wall" }, { id: "door", name: "Door" }, { id: "stairs", name: "Stairs" }, { id: "props", name: "Props" }],
  tiles: []
};
let bytes = 0;
for (const [id, name, category, walls, draw, tags, extra = {}] of TILES) {
  const buf = png(draw());
  fs.writeFileSync(new URL(`${id}.png`, OUT), buf);
  bytes += buf.length;
  set.tiles.push({ id, name, file: `${id}.png`, category, w: 1, h: 1, walls, ...extra, tags });
}
fs.writeFileSync(new URL("set.json", OUT), JSON.stringify(set, null, 2) + "\n");
console.log(`tiles/ap-base: ${set.tiles.length} tiles, ${(bytes / 1024).toFixed(0)} KB`);
