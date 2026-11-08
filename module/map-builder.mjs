/**
 * Map Builder (GM): put a map together from tiles without drawing every wall by hand.
 *
 * - Tile sets: tiles/<set-id>/set.json in the system folder (and, if present, Data/ap-turm-tiles/<set-id>/), read
 *   once on ready; broken sets are skipped with one console warning each. Format: see map-builder-logic.mjs.
 * - Window (button "Map Builder" in the Tiles scene controls): palette with set, category tabs, search, thumbnails.
 * - Placing: drag a thumbnail onto the scene, or click a thumbnail and click / drag on the scene (stamp mode). Tiles
 *   snap to the grid, floors go below everything else. R / Shift+R rotate, F mirrors, Esc stops; right-click on a
 *   placed tile removes it. Ctrl+Z undoes the last 50 steps (tiles plus the walls they made).
 * - Auto walls: a tile's walls (rotated / mirrored with it) become Wall documents; a segment on an edge that already
 *   has one is shared (flag owners), so removing a tile only removes the walls no other tile needs.
 * - Room / Corridor tools, "New scene from set".
 * Foundry's own tile selection is left alone: the canvas is only intercepted while a builder tool is active.
 */
import * as L from "./map-builder-logic.mjs";

const SYSTEM_ID = "ap-turm";
const TPL = "systems/ap-turm/templates/";
const DRAG_TYPE = "APTurmMapTile";
export const MB_REMEMBER = "mapBuilderRemember";
const MB_LAST = "mapBuilderLast";
const SET_ROOTS = ["systems/ap-turm/tiles", "ap-turm-tiles"];
const FLOOR_SORT = 0, OBJECT_SORT = 100;

const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;
const T = (key, data) => data ? game.i18n.format(`AP_TURM.MapBuilder.${key}`, data) : game.i18n.localize(`AP_TURM.MapBuilder.${key}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/* ============================================================
   State
   ============================================================ */

const state = {
  sets: [],                 // validated sets
  loaded: null,             // Promise of the set loading
  setId: null, category: null, query: "",
  tile: null,               // selected tile definition
  rot: 0, flip: false,
  mode: null,               // null | "tile" | "room" | "corridor"
  autoWalls: true,
  history: [],              // undo steps: arrays of transactions
  stroke: null,             // left button held in stamp mode: { group, cells:Set }
  drag: null,               // { start: cell, current: cell } room / corridor rectangle
  dragging: null,           // tile being dragged from the palette (HTML5 drag)
  rightDown: null,
  corridorWidth: 2,
  preview: null             // PIXI objects on the canvas
};
const currentSet = () => state.sets.find(s => s.id === state.setId) ?? state.sets[0] ?? null;
const findTile = (setId, tileId) => state.sets.find(s => s.id === setId)?.tiles.find(t => t.id === tileId) ?? null;
const builderOpen = () => !!MapBuilder.instance?.rendered;
const squareGrid = () => !!canvas?.ready && !!canvas.grid?.isSquare;

/* Every document operation of the builder runs one after another, so wall sharing always sees the latest state. */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(err => { console.error(`${SYSTEM_ID} | map builder`, err); ui.notifications.error(T("Error")); });
  return run;
}

/* ============================================================
   Tile sets
   ============================================================ */

/** Read every set.json below the set folders once. Broken sets are skipped with one console warning each. */
export function loadTileSets({ force = false } = {}) {
  if (state.loaded && !force) return state.loaded;
  state.loaded = (async () => {
    const FP = foundry.applications.apps.FilePicker.implementation;
    const dirs = [];
    for (const root of SET_ROOTS) {
      try { dirs.push(...((await FP.browse("data", root)).dirs ?? [])); }
      catch { if (root === SET_ROOTS[0]) dirs.push(`${root}/ap-base`); }   // no browse permission: the starter set
    }
    const sets = [];
    for (const dir of dirs) {
      try {
        const json = await foundry.utils.fetchJsonWithTimeout(`${dir}/set.json`);
        const { set, errors } = L.validateSet(json, dir);
        if (!set) { console.warn(`${SYSTEM_ID} | Map Builder: tile set "${dir}" skipped: ${errors.join("; ")}`); continue; }
        if (errors.length) console.warn(`${SYSTEM_ID} | Map Builder: tile set "${set.id}": ${errors.join("; ")}`);
        if (sets.some(s => s.id === set.id)) { console.warn(`${SYSTEM_ID} | Map Builder: tile set "${dir}" skipped: id "${set.id}" already loaded`); continue; }
        sets.push(set);
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Map Builder: tile set "${dir}" skipped: ${err?.message ?? err}`);
      }
    }
    state.sets = sets;
    return sets;
  })();
  return state.loaded;
}

/* ============================================================
   Settings, last tile
   ============================================================ */

function readLast() { try { return game.settings.get(SYSTEM_ID, MB_LAST) ?? {}; } catch { return {}; } }
function saveLast() {
  const last = { autoWalls: state.autoWalls };
  if (game.settings.get(SYSTEM_ID, MB_REMEMBER) && state.tile) Object.assign(last, { set: state.setId, tile: state.tile.id, rot: state.rot, flip: state.flip, category: state.category });
  game.settings.set(SYSTEM_ID, MB_LAST, last).catch(() => {});
}
function restoreLast() {
  if (state.restored) return;
  state.restored = true;
  const last = readLast();
  if (typeof last.autoWalls === "boolean") state.autoWalls = last.autoWalls;
  if (!game.settings.get(SYSTEM_ID, MB_REMEMBER) || state.tile) return;
  const tile = findTile(last.set, last.tile);
  if (!tile) return;
  Object.assign(state, { setId: last.set, tile, rot: L.normalizeRot(last.rot), flip: !!last.flip, category: last.category ?? tile.category });
}

/* ============================================================
   Documents: tiles and their walls
   ============================================================ */

const mbFlag = (doc) => doc?.flags?.[SYSTEM_ID]?.mb ?? null;

/** Wall data for a kind. A portcullis ("transparent") blocks movement only. */
function kindData(kind) {
  const N = CONST.WALL_SENSE_TYPES.NORMAL, NONE = CONST.WALL_SENSE_TYPES.NONE;
  const base = { move: CONST.WALL_MOVEMENT_TYPES.NORMAL, sight: N, light: N, sound: N, door: CONST.WALL_DOOR_TYPES.NONE, ds: CONST.WALL_DOOR_STATES.CLOSED };
  if (kind === "transparent") return { ...base, sight: NONE, light: NONE, sound: NONE };
  if (kind === "door" || kind === "door-open") return { ...base, door: CONST.WALL_DOOR_TYPES.DOOR, ds: kind === "door-open" ? CONST.WALL_DOOR_STATES.OPEN : CONST.WALL_DOOR_STATES.CLOSED };
  return base;
}
const WALL_FIELDS = ["move", "sight", "light", "sound", "door", "ds"];

/** Builder walls of the scene by edge key. */
function wallIndex(scene) {
  const m = new Map();
  for (const w of scene.walls) { const f = mbFlag(w); if (f?.key) m.set(f.key, w); }
  return m;
}
/** A transaction: what one operation created, deleted and changed, so it can be undone. */
const newTx = () => ({ scene: canvas.scene.id, created: { Tile: [], Wall: [] }, deleted: { Tile: [], Wall: [] }, updated: [] });

/** Is the same tile already lying exactly there? */
function duplicateAt(scene, set, p) {
  return scene.tiles.some(t => { const f = mbFlag(t); return f && f.set === set.id && f.tile === p.tile.id && f.x === p.x && f.y === p.y && f.rot === (p.rot ?? 0) && !!f.flip === !!p.flip; });
}

/**
 * Create tiles (and with auto walls their walls) for placements {tile, x, y, rot, flip, edges?}.
 * @returns {Promise<object|null>} the transaction, null when nothing was placed
 */
async function placeTiles(set, placements) {
  const scene = canvas.scene;
  if (!scene || !squareGrid()) { ui.notifications.warn(T("SquareOnly")); return null; }
  const size = canvas.grid.size;
  const list = placements.filter(p => p.tile && !duplicateAt(scene, set, p));
  if (!list.length) return null;
  const data = list.map(p => {
    const rot = L.normalizeRot(p.rot);
    const rect = L.tileRect({ ...p, rot }, p.tile.w, p.tile.h, size);
    const floor = L.isFloor(p.tile);
    return {
      texture: { src: p.tile.file, scaleX: p.flip ? -1 : 1, scaleY: 1 },
      ...rect, sort: floor ? FLOOR_SORT : OBJECT_SORT, elevation: 0,
      flags: { [SYSTEM_ID]: { mb: { set: set.id, tile: p.tile.id, x: p.x, y: p.y, rot, flip: !!p.flip, w: p.tile.w, h: p.tile.h, floor, ...(p.edges ? { edges: p.edges } : {}) } } }
    };
  });
  const tx = newTx();
  const tiles = await scene.createEmbeddedDocuments("Tile", data, { apturmMB: true });
  tx.created.Tile.push(...tiles.map(t => t.id));
  if (state.autoWalls) await addWalls(scene, tiles.map((doc, i) => ({ doc, placement: list[i] })), tx, size);
  return tx;
}

/** Walls for freshly created tiles: new segments are created, segments on an edge with a builder wall are shared. */
async function addWalls(scene, pairs, tx, size) {
  const index = wallIndex(scene);
  const creates = new Map(), updates = new Map();
  for (const { doc, placement } of pairs) {
    for (const seg of L.tileWallSegments(placement.tile, { ...placement, rot: L.normalizeRot(placement.rot) })) {
      const owner = { id: doc.id, kind: seg.kind };
      const ex = index.get(seg.key);
      if (ex) {
        const u = updates.get(ex.id) ?? { doc: ex, owners: [...(mbFlag(ex).owners ?? [])] };
        u.owners.push(owner); updates.set(ex.id, u);
      } else {
        const c = creates.get(seg.key) ?? { c: seg.c, owners: [] };
        c.owners.push(owner); creates.set(seg.key, c);
      }
    }
  }
  if (creates.size) {
    const data = [...creates].map(([key, v]) => ({
      c: v.c.map(n => n * size), ...kindData(L.resolveKind(v.owners.map(o => o.kind))),
      flags: { [SYSTEM_ID]: { mb: { key, owners: v.owners } } }
    }));
    const walls = await scene.createEmbeddedDocuments("Wall", data, { apturmMB: true });
    tx.created.Wall.push(...walls.map(w => w.id));
  }
  if (updates.size) await updateWallOwners(scene, [...updates.values()], tx);
}

/** Set new owner lists (and the resulting kind) on builder walls, remembering the previous state in the tx. */
async function updateWallOwners(scene, list, tx) {
  const data = list.map(({ doc, owners }) => {
    tx?.updated.push({ _id: doc.id, mb: foundry.utils.deepClone(mbFlag(doc)), ...Object.fromEntries(WALL_FIELDS.map(k => [k, doc[k]])) });
    return { _id: doc.id, [`flags.${SYSTEM_ID}.mb.owners`]: owners, ...kindData(L.resolveKind(owners.map(o => o.kind))) };
  });
  await scene.updateEmbeddedDocuments("Wall", data, { apturmMB: true });
}

/** Walls owned by the given tiles: delete those no other tile owns, hand the rest to the remaining owners. */
async function releaseWalls(scene, tileIds, tx) {
  const ids = new Set(tileIds);
  const del = [], upd = [];
  for (const w of scene.walls) {
    const f = mbFlag(w); if (!f?.owners?.some(o => ids.has(o.id))) continue;
    const rest = f.owners.filter(o => !ids.has(o.id));
    if (rest.length) upd.push({ doc: w, owners: rest }); else del.push(w);
  }
  if (upd.length) await updateWallOwners(scene, upd, tx);
  if (del.length) {
    tx?.deleted.Wall.push(...del.map(w => w.toObject()));
    await scene.deleteEmbeddedDocuments("Wall", del.map(w => w.id), { apturmMB: true });
  }
}

/** Remove builder tiles and the walls only they needed. */
async function removeTiles(ids) {
  const scene = canvas.scene; if (!scene || !ids.length) return null;
  const tx = newTx();
  const docs = ids.map(id => scene.tiles.get(id)).filter(Boolean);
  if (!docs.length) return null;
  await releaseWalls(scene, docs.map(d => d.id), tx);
  tx.deleted.Tile.push(...docs.map(d => d.toObject()));
  await scene.deleteEmbeddedDocuments("Tile", docs.map(d => d.id), { apturmMB: true });
  return tx;
}

/** Undo one transaction: changed walls back, created documents away, deleted documents back (same ids). */
async function undoTx(tx) {
  const scene = game.scenes.get(tx.scene); if (!scene) return;
  const back = tx.updated.filter(u => scene.walls.has(u._id)).reverse().map(u => {
    const { _id, mb, ...fields } = u; return { _id, [`flags.${SYSTEM_ID}.mb`]: mb, ...fields };
  });
  if (back.length) await scene.updateEmbeddedDocuments("Wall", back, { apturmMB: true });
  for (const type of ["Wall", "Tile"]) {
    const ids = tx.created[type].filter(id => scene.getEmbeddedCollection(type).has(id));
    if (ids.length) await scene.deleteEmbeddedDocuments(type, ids, { apturmMB: true });
  }
  for (const type of ["Tile", "Wall"]) {
    const data = tx.deleted[type].filter(d => !scene.getEmbeddedCollection(type).has(d._id));
    if (data.length) await scene.createEmbeddedDocuments(type, data, { keepId: true, apturmMB: true });
  }
}

function record(group) {
  const txs = (Array.isArray(group) ? group : [group]).filter(Boolean);
  if (!txs.length) return;
  L.pushHistory(state.history, txs);
  rerender();
}
/** Ctrl+Z */
export function undo() {
  const step = state.history.pop();
  if (!step) { ui.notifications.info(T("NothingToUndo")); return Promise.resolve(); }
  return serial(async () => { for (const tx of [...step].reverse()) await undoTx(tx); }).finally(rerender);
}

/** Topmost builder tile under a cell. */
function builderTileAt(cell) {
  const hits = canvas.scene.tiles.filter(t => {
    const f = mbFlag(t); if (!f) return false;
    return L.coveredCells({ x: f.x, y: f.y, rot: f.rot }, f.w ?? 1, f.h ?? 1).some(c => c.x === cell.x && c.y === cell.y);
  });
  hits.sort((a, b) => (b.elevation - a.elevation) || (b.sort - a.sort) || ((b._stats?.createdTime ?? 0) - (a._stats?.createdTime ?? 0)));
  return hits[0] ?? null;
}

/* ============================================================
   Canvas: preview and pointer handling
   ============================================================ */

function clearPreview() {
  const p = state.preview; state.preview = null;
  if (p) { p.container?.parent?.removeChild(p.container); p.container?.destroy({ children: true }); }
}
function ensurePreview() {
  if (state.preview?.container && !state.preview.container.destroyed) return state.preview;
  const container = new PIXI.Container();
  container.eventMode = "none";
  container.zIndex = 10000;
  const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY); sprite.anchor.set(0.5); sprite.alpha = 0.55;
  const gfx = new PIXI.Graphics();
  container.addChild(gfx, sprite);
  canvas.interface.addChild(container);
  state.preview = { container, sprite, gfx, src: null };
  return state.preview;
}
/** Half-transparent tile at the grid position under the pointer. */
async function showTilePreview(tile, point) {
  if (!tile || !squareGrid()) return clearPreview();
  const size = canvas.grid.size;
  const p = ensurePreview();
  if (p.src !== tile.file) {
    p.src = tile.file;
    const tex = await foundry.canvas.loadTexture(tile.file).catch(() => null);
    if (state.preview !== p || p.src !== tile.file) return;
    p.sprite.texture = tex ?? PIXI.Texture.WHITE;
  }
  const cell = L.anchorCell(L.cellFromPoint(point.x, point.y, size), tile.w, tile.h, state.rot);
  const r = L.tileRect({ ...cell, rot: state.rot }, tile.w, tile.h, size);
  p.sprite.visible = true;
  p.sprite.width = r.width; p.sprite.height = r.height;
  if (state.flip) p.sprite.scale.x = -Math.abs(p.sprite.scale.x); else p.sprite.scale.x = Math.abs(p.sprite.scale.x);
  p.sprite.position.set(r.x + r.width / 2, r.y + r.height / 2);
  p.sprite.angle = state.rot;
  p.gfx.clear();
  // the walls it will make
  if (state.autoWalls) {
    p.gfx.lineStyle(Math.max(3, size / 20), 0xf0c060, 0.9);
    for (const s of L.tileWallSegments(tile, { ...cell, rot: state.rot, flip: state.flip })) {
      if (s.kind.startsWith("door")) p.gfx.lineStyle(Math.max(3, size / 20), 0x7fc8ff, 0.95); else p.gfx.lineStyle(Math.max(3, size / 20), 0xf0c060, 0.9);
      p.gfx.moveTo(s.c[0] * size, s.c[1] * size).lineTo(s.c[2] * size, s.c[3] * size);
    }
  }
}
/** Outline of a room rectangle or a corridor. */
function showAreaPreview() {
  const d = state.drag; if (!d) return;
  const size = canvas.grid.size, p = ensurePreview();
  p.sprite.visible = false;
  p.gfx.clear();
  p.gfx.lineStyle(Math.max(2, size / 32), 0xf0c060, 0.95).beginFill(0xf0c060, 0.15);
  const cells = state.mode === "room"
    ? (({ x, y, w, h }) => { const out = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push({ x: x + i, y: y + j }); return out; })(L.normalizeRect(d.start, d.current))
    : L.corridorCells(d.start, d.current, state.corridorWidth);
  for (const c of cells) p.gfx.drawRect(c.x * size, c.y * size, size, size);
  p.gfx.endFill();
}

const onBoard = (ev) => !!canvas?.ready && ev.target === canvas.app?.view;
const pointCell = (ev) => { const pt = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY }); return { pt, cell: L.cellFromPoint(pt.x, pt.y, canvas.grid.size) }; };

/** Stamp the selected tile at a cell (once per cell during a stroke). */
function stampAt(cell) {
  const tile = state.tile, set = currentSetOf(tile); if (!tile || !set) return;
  const at = L.anchorCell(cell, tile.w, tile.h, state.rot);
  const covered = L.coveredCells({ ...at, rot: state.rot }, tile.w, tile.h);
  const stroke = state.stroke;
  if (stroke && covered.some(c => stroke.cells.has(`${c.x},${c.y}`))) return;
  if (stroke) covered.forEach(c => stroke.cells.add(`${c.x},${c.y}`));
  const group = stroke?.group;
  serial(async () => {
    const tx = await placeTiles(set, [{ tile, ...at, rot: state.rot, flip: state.flip }]);
    if (!tx) return;
    if (group) { group.push(tx); if (!state.history.includes(group)) record(group); else rerender(); }
    else record(tx);
  });
}
function currentSetOf(tile) { return state.sets.find(s => s.tiles.includes(tile)) ?? null; }

/** Cells on the way from a to b (so a fast drag does not leave gaps). */
function cellsBetween(a, b) {
  const out = []; const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 1; i <= n; i++) out.push({ x: Math.round(a.x + (b.x - a.x) * i / n), y: Math.round(a.y + (b.y - a.y) * i / n) });
  return out;
}

function onPointerDown(ev) {
  if (!state.mode || !builderOpen() || !onBoard(ev) || !squareGrid()) return;
  if (ev.button === 2) { state.rightDown = { x: ev.clientX, y: ev.clientY }; return; }
  if (ev.button !== 0) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const { cell } = pointCell(ev);
  if (state.mode === "tile") {
    if (!state.tile) return;
    state.stroke = { group: [], cells: new Set(), last: cell };
    stampAt(cell);
  } else {
    state.drag = { start: cell, current: cell };
    showAreaPreview();
  }
}
function onPointerMove(ev) {
  if (!state.mode || !builderOpen() || !canvas?.ready || !squareGrid()) return;
  if (!onBoard(ev) && !state.stroke && !state.drag) return;
  const { pt, cell } = pointCell(ev);
  if (state.mode === "tile") {
    showTilePreview(state.tile, pt);
    const s = state.stroke;
    if (s && (ev.buttons & 1) && (cell.x !== s.last.x || cell.y !== s.last.y)) { for (const c of cellsBetween(s.last, cell)) stampAt(c); s.last = cell; }
  } else if (state.drag && (cell.x !== state.drag.current.x || cell.y !== state.drag.current.y)) {
    state.drag.current = cell; showAreaPreview();
  }
}
function onPointerUp(ev) {
  if (ev.button === 2 && state.rightDown) {
    const moved = Math.hypot(ev.clientX - state.rightDown.x, ev.clientY - state.rightDown.y);
    state.rightDown = null;
    if (moved < 5 && state.mode && builderOpen() && onBoard(ev)) {
      const doc = builderTileAt(pointCell(ev).cell);
      if (doc) { ev.stopImmediatePropagation(); serial(async () => record(await removeTiles([doc.id]))); }
    }
    return;
  }
  if (ev.button !== 0) return;
  if (state.stroke) { state.stroke = null; return; }
  const d = state.drag; if (!d) return;
  state.drag = null;
  clearPreview();
  if (state.mode === "room") roomDialog(L.normalizeRect(d.start, d.current));
  else if (state.mode === "corridor") corridorDialog(d.start, d.current);
}
function onDragOver(ev) {
  if (!state.dragging || !onBoard(ev) || !squareGrid()) return;
  showTilePreview(state.dragging, pointCell(ev).pt);
}

/** Drop of a palette tile on the canvas: place it, then keep it selected (stamp mode). */
function onDropCanvasData(cnv, data) {
  if (data?.type !== DRAG_TYPE) return;
  const tile = findTile(data.set, data.tile);
  state.dragging = null;
  clearPreview();
  if (!tile || !game.user.isGM) return false;
  selectTile(data.set, tile);
  setMode("tile");
  stampAt(L.cellFromPoint(data.x, data.y, canvas.grid.size));
  return false;
}

/* ============================================================
   Tools
   ============================================================ */

function selectTile(setId, tile) {
  if (state.tile !== tile) { state.tile = tile; }
  state.setId = setId; state.category = tile.category;
  saveLast();
}
function setMode(mode) {
  state.mode = mode;
  state.drag = null; state.stroke = null;
  clearPreview();
  rerender();
}
export function rotate(dir = 1) { if (state.mode !== "tile" || !state.tile) return false; state.rot = L.normalizeRot(state.rot + 90 * dir); saveLast(); refreshPreview(); rerender(); return true; }
export function mirror() { if (state.mode !== "tile" || !state.tile) return false; state.flip = !state.flip; saveLast(); refreshPreview(); rerender(); return true; }
export function cancel() { if (!state.mode) return false; setMode(null); return true; }
let lastPointer = null;
function refreshPreview() { if (lastPointer && state.mode === "tile") showTilePreview(state.tile, lastPointer); }

const edgeLabel = (e) => T(`Edge.${e}`);
const tileOptions = (set, cats, selected) => set.tiles.filter(t => cats.includes(t.category))
  .map(t => `<option value="${esc(t.id)}" ${t.id === selected ? "selected" : ""}>${esc(t.name)}</option>`).join("");
const pick = (set, cat, prefer) => (prefer && prefer.category === cat ? prefer.id : set.tiles.find(t => t.category === cat)?.id) ?? "";

async function roomDialog(rect) {
  const set = currentSet(); if (!set) return;
  const cats = set.categories.map(c => c.id);
  const floorCats = set.tiles.filter(L.isFloor).map(t => t.category);
  const content = `<div class="apt-mb-dialog">
    <p>${esc(T("RoomSize", { w: rect.w, h: rect.h }))}</p>
    <div class="form-group"><label>${esc(T("FloorTile"))}</label><select name="floor">${tileOptions(set, [...new Set(floorCats)], pick(set, "floor", state.tile))}</select></div>
    <div class="form-group"><label>${esc(T("WallTile"))}</label><select name="wall">${tileOptions(set, cats, pick(set, "wall", state.tile))}</select></div>
    <div class="form-group"><label>${esc(T("DoorEdge"))}</label><select name="door"><option value="">${esc(T("NoDoor"))}</option>${L.EDGES.map(e => `<option value="${e}" ${e === "s" ? "selected" : ""}>${esc(edgeLabel(e))}</option>`).join("")}</select></div>
    <div class="form-group"><label>${esc(T("DoorTile"))}</label><select name="doorTile"><option value="">${esc(T("WallBecomesDoor"))}</option>${tileOptions(set, cats, pick(set, "door", null))}</select></div>
    <p class="hint">${esc(T("RoomHint"))}</p></div>`;
  const res = await DialogV2.wait({
    window: { title: T("Room"), icon: "fa-solid fa-vector-square" }, position: { width: 420 }, content, rejectClose: false,
    buttons: [{ action: "ok", label: T("Build"), icon: "fa-solid fa-check", default: true, callback: (ev, b) => { const f = b.form.elements; return { floor: f.floor.value, wall: f.wall.value, door: f.door.value, doorTile: f.doorTile.value }; } },
      { action: "cancel", label: T("Cancel") }]
  });
  if (!res || typeof res !== "object") return;
  const t = (id) => set.tiles.find(x => x.id === id) ?? null;
  const floor = t(res.floor), wall = t(res.wall);
  if (!floor || !wall) return;
  const placements = L.roomPlacements(rect, { floor, wall, door: res.door || null, doorTile: t(res.doorTile) });
  serial(async () => record(await placeTiles(set, placements)));
}

async function corridorDialog(p1, p2) {
  const set = currentSet(); if (!set) return;
  const floorCats = [...new Set(set.tiles.filter(L.isFloor).map(t => t.category))];
  const content = `<div class="apt-mb-dialog">
    <div class="form-group"><label>${esc(T("Width"))}</label><input type="number" name="width" min="1" max="10" step="1" value="${state.corridorWidth}"></div>
    <div class="form-group"><label>${esc(T("FloorTile"))}</label><select name="floor">${tileOptions(set, floorCats, pick(set, "floor", state.tile))}</select></div>
    <p class="hint">${esc(T("CorridorHint"))}</p></div>`;
  const res = await DialogV2.wait({
    window: { title: T("Corridor"), icon: "fa-solid fa-route" }, position: { width: 400 }, content, rejectClose: false,
    buttons: [{ action: "ok", label: T("Build"), icon: "fa-solid fa-check", default: true, callback: (ev, b) => ({ width: Number(b.form.elements.width.value), floor: b.form.elements.floor.value }) },
      { action: "cancel", label: T("Cancel") }]
  });
  if (!res || typeof res !== "object") return;
  const floor = set.tiles.find(x => x.id === res.floor); if (!floor) return;
  state.corridorWidth = Math.max(1, Math.min(10, Math.floor(res.width) || 1));
  serial(async () => record(await placeTiles(set, L.corridorPlacements(p1, p2, state.corridorWidth, floor))));
}

async function newSceneDialog() {
  const set = currentSet(); if (!set) return;
  const content = `<div class="apt-mb-dialog">
    <div class="form-group"><label>${esc(T("SceneName"))}</label><input type="text" name="name" value="${esc(set.name)}"></div>
    <div class="form-group"><label>${esc(T("SceneSize"))}</label><div class="form-fields"><input type="number" name="cols" min="1" max="200" value="30"> × <input type="number" name="rows" min="1" max="200" value="30"></div></div>
    <p class="hint">${esc(T("SceneHint", { size: set.gridSize }))}</p></div>`;
  const res = await DialogV2.wait({
    window: { title: T("NewScene"), icon: "fa-solid fa-map" }, position: { width: 400 }, content, rejectClose: false,
    buttons: [{ action: "ok", label: T("Create"), icon: "fa-solid fa-check", default: true, callback: (ev, b) => { const f = b.form.elements; return { name: f.name.value.trim(), cols: Number(f.cols.value), rows: Number(f.rows.value) }; } },
      { action: "cancel", label: T("Cancel") }]
  });
  if (!res || typeof res !== "object") return;
  const n = (v) => Math.max(1, Math.min(200, Math.floor(v) || 30));
  const gs = set.gridSize;
  const scene = await Scene.implementation.create({
    name: res.name || set.name, width: n(res.cols) * gs, height: n(res.rows) * gs, backgroundColor: "#15151b",
    grid: { type: CONST.GRID_TYPES.SQUARE, size: gs }, tokenVision: true
  });
  await scene?.view();
}

/* ============================================================
   Window
   ============================================================ */

let rerenderTimer = null;
function rerender() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => { if (builderOpen()) MapBuilder.instance.render({ parts: ["head", "grid"] }); }, 30);
}

export class MapBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;
  static DEFAULT_OPTIONS = {
    id: "ap-turm-map-builder",
    classes: ["ap-turm", "apt-mapbuilder"],
    window: { title: "AP_TURM.MapBuilder.Title", icon: "fa-solid fa-chess-board", resizable: true },
    position: { width: 340, height: 640, left: 110, top: 80 },
    actions: {
      mbMode: MapBuilder.#onMode,
      mbCategory: MapBuilder.#onCategory,
      mbPick: MapBuilder.#onPick,
      mbUndo: () => undo(),
      mbNewScene: () => newSceneDialog(),
      mbRotate: () => { if (!rotate(1)) ui.notifications.info(T("PickFirst")); },
      mbMirror: () => { if (!mirror()) ui.notifications.info(T("PickFirst")); }
    }
  };
  static PARTS = {
    head: { template: TPL + "map-builder.hbs" },
    grid: { template: TPL + "map-builder-grid.hbs", scrollable: [".apt-mb-grid"] }
  };

  async _prepareContext(options) {
    await loadTileSets();
    restoreLast();
    const set = currentSet();
    if (set && !state.setId) state.setId = set.id;
    if (set && !set.categories.some(c => c.id === state.category)) state.category = set.categories[0].id;
    const query = state.query.trim();
    const tiles = set ? L.filterTiles(set, { category: query ? null : state.category, query }) : [];
    const sel = state.tile;
    return {
      ...(await super._prepareContext(options)),
      hasSets: state.sets.length > 0,
      sets: state.sets.map(s => ({ id: s.id, name: s.name, selected: s.id === set?.id })),
      categories: (set?.categories ?? []).map(c => ({ ...c, active: !query && c.id === state.category })),
      query: state.query,
      tiles: tiles.map(t => ({ id: t.id, name: t.name, file: t.file, selected: t === sel, size: t.w > 1 || t.h > 1 ? `${t.w}×${t.h}` : "" })),
      rot: state.rot, flip: state.flip, mode: state.mode,
      modeTile: state.mode === "tile", modeRoom: state.mode === "room", modeCorridor: state.mode === "corridor",
      autoWalls: state.autoWalls,
      undoCount: state.history.length,
      selectedName: sel?.name ?? "",
      squareGrid: !canvas?.ready || squareGrid(),
      status: !state.mode ? T("StatusIdle") : state.mode === "tile" ? (sel ? T("StatusTile", { name: sel.name, rot: state.rot, flip: state.flip ? T("Mirrored") : "" }) : T("PickFirst"))
        : state.mode === "room" ? T("StatusRoom") : T("StatusCorridor")
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    const setSel = root.querySelector("select[data-mb=set]");
    if (setSel && !setSel.dataset.bound) {
      setSel.dataset.bound = "1";
      setSel.addEventListener("change", () => { state.setId = setSel.value; state.category = null; this.render({ parts: ["head", "grid"] }); });
    }
    const q = root.querySelector("input[data-mb=query]");
    if (q && !q.dataset.bound) {
      q.dataset.bound = "1";
      const upd = foundry.utils.debounce(() => { state.query = q.value; this.render({ parts: ["grid"] }); }, 150);
      q.addEventListener("input", upd);
    }
    const auto = root.querySelector("input[data-mb=autoWalls]");
    if (auto && !auto.dataset.bound) {
      auto.dataset.bound = "1";
      auto.addEventListener("change", () => { state.autoWalls = auto.checked; saveLast(); refreshPreview(); });
    }
    for (const el of root.querySelectorAll(".apt-mb-tile[draggable]")) {
      if (el.dataset.bound) continue;
      el.dataset.bound = "1";
      el.addEventListener("dragstart", (ev) => {
        const set = currentSet(); const tile = set?.tiles.find(t => t.id === el.dataset.tile);
        if (!tile) return;
        state.dragging = tile;
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, set: set.id, tile: tile.id }));
        ev.dataTransfer.effectAllowed = "copy";
      });
      el.addEventListener("dragend", () => { state.dragging = null; clearPreview(); });
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    state.mode = null; state.drag = null; state.stroke = null;
    clearPreview();
    MapBuilder.instance = null;
  }

  static #onMode(ev, target) {
    const mode = target.dataset.mode;
    if (state.mode === mode) return setMode(null);
    if (mode === "tile" && !state.tile) { ui.notifications.info(T("PickFirst")); return; }
    setMode(mode);
  }
  static #onCategory(ev, target) { state.category = target.dataset.cat; state.query = ""; this.render({ parts: ["head", "grid"] }); }
  static #onPick(ev, target) {
    const set = currentSet(); const tile = set?.tiles.find(t => t.id === target.dataset.tile); if (!tile) return;
    if (state.tile === tile && state.mode === "tile") return setMode(null);
    selectTile(set.id, tile);
    setMode("tile");
  }
}

export async function openMapBuilder() {
  if (!game.user.isGM) return null;
  if (canvas?.ready && !squareGrid()) ui.notifications.warn(T("SquareOnly"));
  MapBuilder.instance ??= new MapBuilder();
  await MapBuilder.instance.render({ force: true });
  MapBuilder.instance.bringToFront?.();
  return MapBuilder.instance;
}

/* ============================================================
   Registration (init)
   ============================================================ */

export function registerMapBuilder() {
  game.settings.register(SYSTEM_ID, MB_REMEMBER, {
    name: "AP_TURM.MapBuilder.Remember.Name", hint: "AP_TURM.MapBuilder.Remember.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, MB_LAST, { scope: "client", config: false, type: Object, default: {} });

  const kb = game.keybindings, P = CONST.KEYBINDING_PRECEDENCE.PRIORITY;
  const active = () => game.user.isGM && builderOpen();
  kb.register(SYSTEM_ID, "mapBuilderRotate", { name: "Map Builder: rotate tile clockwise", editable: [{ key: "KeyR" }], restricted: true, precedence: P, onDown: () => active() && rotate(1) });
  kb.register(SYSTEM_ID, "mapBuilderRotateBack", { name: "Map Builder: rotate tile counter-clockwise", editable: [{ key: "KeyR", modifiers: ["Shift"] }], restricted: true, precedence: P, onDown: () => active() && rotate(-1) });
  kb.register(SYSTEM_ID, "mapBuilderMirror", { name: "Map Builder: mirror tile", editable: [{ key: "KeyF" }], restricted: true, precedence: P, onDown: () => active() && mirror() });
  kb.register(SYSTEM_ID, "mapBuilderCancel", { name: "Map Builder: stop placing", editable: [{ key: "Escape" }], restricted: true, precedence: P, onDown: () => active() && cancel() });
  kb.register(SYSTEM_ID, "mapBuilderUndo", {
    name: "Map Builder: undo", hint: "Only while the Map Builder is open; otherwise Foundry's own undo.",
    editable: [{ key: "KeyZ", modifiers: ["Control"] }], restricted: true, precedence: P,
    onDown: () => { if (!active()) return false; undo(); return true; }
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    const tiles = controls.tiles; if (!tiles?.tools || !game.user.isGM) return;
    tiles.tools.apturmMapBuilder = {
      name: "apturmMapBuilder", order: Object.keys(tiles.tools).length + 20, title: "AP_TURM.MapBuilder.Title",
      icon: "fa-solid fa-chess-board", button: true, visible: game.user.isGM, onChange: () => openMapBuilder()
    };
  });
  Hooks.on("dropCanvasData", onDropCanvasData);
  Hooks.on("canvasTearDown", () => { clearPreview(); state.drag = null; state.stroke = null; });
  Hooks.on("canvasReady", () => rerender());
  // a builder tile deleted some other way (Delete key, Foundry's undo): its walls go with it
  Hooks.on("deleteTile", (doc, options, userId) => {
    if (options?.apturmMB || userId !== game.user.id || !mbFlag(doc) || !doc.parent) return;
    serial(() => releaseWalls(doc.parent, [doc.id], null));
  });
  Hooks.once("ready", () => {
    if (!game.user.isGM) return;
    loadTileSets().catch(err => console.error(`${SYSTEM_ID} | map builder sets`, err));
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", (ev) => { if (onBoard(ev) && canvas.ready) lastPointer = pointCell(ev).pt; onPointerMove(ev); }, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    window.addEventListener("dragover", onDragOver, { capture: true });
  });
}

/** Place tiles by script (macros, tests): placements as in map-builder-logic (tile = definition from the set). */
function place(setId, placements) {
  const set = state.sets.find(s => s.id === setId);
  if (!set) return Promise.resolve(null);
  return serial(async () => { const tx = await placeTiles(set, placements); record(tx); return tx; });
}
function remove(ids) { return serial(async () => { const tx = await removeTiles(ids); record(tx); return tx; }); }

export const mapBuilder = { open: openMapBuilder, loadTileSets, undo, place, remove, state, logic: L };
