/**
 * Jukebox, pure part (tested in Node): mood tiles, folder import (file filter and names), combat coupling.
 * A tile is {id, playlistId, label, color, icon, combat}; the list lives in a world setting. Tiles only point at
 * Foundry playlists - deleting a tile never touches the playlist.
 */

/** Colour palette of the tile dialog. */
export const MOOD_COLORS = ["#7a5a2c", "#a3402a", "#c85a28", "#b08a1e", "#4e8a3e", "#2f7d74", "#3a6fa8", "#5b4a9a", "#8a3f7a", "#5a5a5a"];

/** Audio files the folder import picks up. */
export const AUDIO_EXTENSIONS = ["mp3", "ogg", "wav", "webm", "flac"];

/** Fade duration (ms) the jukebox gives a playlist that has none: crossfades and "Fade out" take ~2 s. */
export const FADE_MS = 2000;

/** Name of the playlist whose sounds make up the soundboard (case-insensitive). */
export const SOUNDBOARD_NAME = "soundboard";

const clean = (s) => String(s ?? "").trim();

/* ---------- tiles ---------- */

/** A tile with defaults filled in. */
export function makeTile({ id, playlistId = "", label = "", color = MOOD_COLORS[0], icon = "", combat = false } = {}) {
  return { id: String(id), playlistId: String(playlistId), label: clean(label), color: String(color || MOOD_COLORS[0]), icon: normalizeIcon(icon), combat: !!combat };
}

/** "dragon" / "fa-dragon" / "fa-solid fa-dragon" -> "fa-solid fa-dragon"; empty stays empty. */
export function normalizeIcon(icon) {
  const s = clean(icon);
  if (!s) return "";
  const parts = s.split(/\s+/).map(p => (p.startsWith("fa-") ? p : `fa-${p}`));
  const styles = ["fa-solid", "fa-regular", "fa-light", "fa-thin", "fa-duotone", "fa-brands", "fas", "far", "fab"];
  return parts.some(p => styles.includes(p)) ? parts.join(" ") : ["fa-solid", ...parts].join(" ");
}

/** Only one tile may be the combat tile: when `id` is it, every other one is not. */
function oneCombat(tiles, id) {
  return tiles.map(t => (t.id === id ? t : (t.combat ? { ...t, combat: false } : t)));
}

/** Append a tile (the new one wins the combat mark). */
export function addTile(tiles, tile) {
  const t = makeTile(tile);
  const out = [...(tiles || []), t];
  return t.combat ? oneCombat(out, t.id) : out;
}

/** Change fields of a tile (label, colour, icon, playlist, combat). Unknown id: unchanged list. */
export function updateTile(tiles, id, changes = {}) {
  let hit = false;
  const out = (tiles || []).map(t => {
    if (t.id !== id) return t;
    hit = true;
    return makeTile({ ...t, ...changes, id: t.id });
  });
  if (!hit) return [...(tiles || [])];
  return out.find(t => t.id === id)?.combat ? oneCombat(out, id) : out;
}

/** Rename; an empty label is refused (the tile keeps its name). */
export function renameTile(tiles, id, label) {
  const l = clean(label);
  return l ? updateTile(tiles, id, { label: l }) : [...(tiles || [])];
}

/** Move tile `fromId` in front of `toId` (null / unknown: to the end). */
export function reorderTiles(tiles, fromId, toId = null) {
  const list = [...(tiles || [])];
  const from = list.findIndex(t => t.id === fromId);
  if (from < 0 || fromId === toId) return list;
  const [moved] = list.splice(from, 1);
  const to = toId ? list.findIndex(t => t.id === toId) : -1;
  if (to < 0) list.push(moved); else list.splice(to, 0, moved);
  return list;
}

/** Remove a tile (the playlist stays). */
export function deleteTile(tiles, id) {
  return (tiles || []).filter(t => t.id !== id);
}

/** The combat tile, if any. */
export function combatTile(tiles) {
  return (tiles || []).find(t => t.combat) ?? null;
}

/** The tile of the playlist that plays (first match in tile order), or null. */
export function activeTile(tiles, playingIds) {
  const set = new Set(playingIds || []);
  return (tiles || []).find(t => set.has(t.playlistId)) ?? null;
}

/* ---------- folder import ---------- */

const lastSegment = (path) => {
  const s = String(path ?? "").replace(/[\\/]+$/, "");
  const seg = s.split(/[\\/]/).pop() ?? "";
  try { return decodeURIComponent(seg); } catch { return seg; }
};

/** Is this path an audio file the import takes? */
export function isAudioFile(path) {
  const m = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(String(path ?? ""));
  return !!m && AUDIO_EXTENSIONS.includes(m[1].toLowerCase());
}

/** The audio files of a folder listing, alphabetically by file name (numbers in natural order). */
export function audioFiles(paths) {
  return (paths || []).filter(isAudioFile)
    .sort((a, b) => lastSegment(a).localeCompare(lastSegment(b), undefined, { numeric: true, sensitivity: "base" }));
}

/** Playlist name for a folder: its last path segment. */
export function folderName(path) {
  return lastSegment(path) || "Imported";
}

/** Track name for a file: the file name without extension, underscores as spaces. */
export function trackName(path) {
  return lastSegment(path).replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim() || "Track";
}

/** Case-insensitive name match. */
export const sameName = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

/** "Name (2)", "(3)" ... - the first free name. */
export function freeName(name, taken) {
  const used = new Set([...(taken || [])].map(n => clean(n).toLowerCase()));
  const base = clean(name).replace(/\s*\((\d+)\)$/, "") || "Imported";
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
}

/**
 * What the import does with a name: create it, add to the playlist of that name, create under a free name, or
 * nothing. `choice` is the answer of the conflict dialog ("append" | "new" | "cancel"), only used on a conflict.
 * @returns {{action:"create", name:string}|{action:"append", name:string}|{action:"cancel"}}
 */
export function importPlan(existingNames, name, choice = null) {
  const n = clean(name) || "Imported";
  const conflict = (existingNames || []).some(e => sameName(e, n));
  if (!conflict) return { action: "create", name: n };
  if (choice === "append") return { action: "append", name: (existingNames || []).find(e => sameName(e, n)) };
  if (choice === "new") return { action: "create", name: freeName(n, existingNames) };
  return { action: "cancel" };
}

/** Files that are not in the playlist yet (append without duplicates). */
export function newPaths(existingPaths, paths) {
  const have = new Set((existingPaths || []).map(p => String(p)));
  return (paths || []).filter(p => !have.has(String(p)));
}

/* ---------- combat coupling ---------- */

/**
 * combatStart: switch to the combat tile and remember what played before - unless the setting is off, there is
 * no combat tile, or it already plays.
 * @returns {{play:string, remember:{prev:string|null, combat:string}}|null}
 */
export function combatStartPlan({ enabled = false, tiles = [], playingIds = [] } = {}) {
  const ct = combatTile(tiles);
  if (!enabled || !ct?.playlistId) return null;
  if ((playingIds || []).includes(ct.playlistId)) return null;
  const prev = activeTile(tiles, playingIds)?.playlistId ?? (playingIds || [])[0] ?? null;
  return { play: ct.playlistId, remember: { prev, combat: ct.playlistId } };
}

/**
 * Combat over: back to what played before - but only while the combat music is still on. A manual change during
 * the fight wins (nothing is forced back).
 * @returns {{play:string|null, stop:string}|null}  play null = just fade the combat music out
 */
export function combatEndPlan({ memory = null, playingIds = [] } = {}) {
  if (!memory?.combat) return null;
  if (!(playingIds || []).includes(memory.combat)) return null;
  return { play: memory.prev ?? null, stop: memory.combat };
}

/* ---------- import from the computer (upload into Data) ---------- */

/** Where uploaded music lands: Data/music/<playlist name>. */
export const UPLOAD_ROOT = "music";

/** A playlist name made safe as a folder name (no path or reserved characters, no trailing dots/spaces). */
export function safeDirName(name) {
  const s = String(name ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return s || "Imported";
}

/** Upload folder for a playlist name. */
export function uploadDir(name) {
  return `${UPLOAD_ROOT}/${safeDirName(name)}`;
}

/** The folder a browser folder selection came from (first segment of webkitRelativePath), or "". */
export function pickedFolderName(files) {
  for (const f of files || []) {
    const rel = String(f?.webkitRelativePath ?? f?.relativePath ?? "");
    if (rel.includes("/")) return rel.split("/")[0];
  }
  return "";
}

/**
 * The audio files of a selection from the computer (folder or multi-select, subfolders included): only
 * mp3 / ogg / wav / webm / flac, sorted by file name (natural order). Two files with the same name (from
 * different subfolders) would overwrite each other in the upload folder, so only the first one is kept.
 * @param {{name:string}[]} files  File objects (or plain {name})
 * @returns {{files:object[], ignored:string[], duplicates:string[]}}
 */
export function pickAudio(files) {
  const all = [...(files || [])];
  const ignored = [], duplicates = [], seen = new Set(), out = [];
  const audio = all.filter(f => { const ok = isAudioFile(f?.name); if (!ok) ignored.push(String(f?.name ?? "")); return ok; })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }));
  for (const f of audio) {
    const key = String(f.name).toLowerCase();
    if (seen.has(key)) { duplicates.push(f.name); continue; }
    seen.add(key);
    out.push(f);
  }
  return { files: out, ignored, duplicates };
}

/* ---------- library: transport, search, move / sort, volumes ---------- */

/** Foundry's playlist modes (CONST.PLAYLIST_MODES), so this file stays loadable in Node. */
export const MODES = { DISABLED: -1, SEQUENTIAL: 0, SHUFFLE: 1, SIMULTANEOUS: 2 };

/**
 * The track after `currentId` in the playback order (Foundry's playbackOrder: sorted, or the seeded shuffle).
 * Sequential and shuffle only; after the last track the first one when the playlist repeats, otherwise none.
 * @param {object} o  {mode, order: sound ids in playback order, currentId, repeat (default true, Foundry's own loop)}
 * @returns {string|null}
 */
export function upNext({ mode = MODES.SEQUENTIAL, order = [], currentId = null, repeat = true } = {}) {
  if (![MODES.SEQUENTIAL, MODES.SHUFFLE].includes(mode) || !order.length) return null;
  const idx = order.indexOf(currentId);
  if (idx === -1) return order[0];
  if (idx === order.length - 1) return repeat ? order[0] : null;
  return order[idx + 1];
}

/**
 * The track before `currentId`: from the first track back to the last one when the playlist repeats, otherwise
 * the first track again (it restarts).
 */
export function previousTrack({ mode = MODES.SEQUENTIAL, order = [], currentId = null, repeat = true } = {}) {
  if (![MODES.SEQUENTIAL, MODES.SHUFFLE].includes(mode) || !order.length) return null;
  const idx = order.indexOf(currentId);
  if (idx === -1) return order[0];
  if (idx === 0) return repeat ? order[order.length - 1] : order[0];
  return order[idx - 1];
}

/** Is `soundId` the last track of the order (where a non-repeating playlist stops)? */
export const isLastTrack = (order, soundId) => !!order?.length && order[order.length - 1] === soundId;

/**
 * Live search over playlist and track names (all words, any order, case-insensitive).
 * A playlist whose name matches shows all its tracks; otherwise only the matching tracks. Playlists with a
 * matching track are opened. An empty query shows everything and opens nothing.
 * @param {{id:string, name:string, sounds:{id:string, name:string}[]}[]} playlists
 * @param {string} query
 * @returns {{playlists: {id:string, nameHit:boolean, tracks:string[]}[], expand:string[]}}
 */
export function filterLibrary(playlists, query) {
  const words = clean(query).toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text) => { const t = String(text ?? "").toLowerCase(); return words.every(w => t.includes(w)); };
  const out = [], expand = [];
  for (const p of playlists || []) {
    const sounds = p.sounds || [];
    if (!words.length) { out.push({ id: p.id, nameHit: false, tracks: sounds.map(s => s.id) }); continue; }
    const nameHit = hit(p.name);
    const tracks = sounds.filter(s => hit(s.name) || hit(`${p.name} ${s.name}`)).map(s => s.id);
    if (!nameHit && !tracks.length) continue;
    out.push({ id: p.id, nameHit, tracks: nameHit && !tracks.length ? sounds.map(s => s.id) : (nameHit ? sounds.map(s => s.id) : tracks) });
    if (tracks.length && !nameHit) expand.push(p.id);
  }
  return { playlists: out, expand };
}

/** Sort values for an order: 100000, 200000, ... (Foundry's integer sort spacing). */
export const sortValues = (order) => Object.fromEntries(order.map((id, i) => [id, (i + 1) * 100000]));

/**
 * Plan a track drop.
 * - Same playlist: new order -> "sort" with the sort values that change.
 * - Other playlist: "move": create the track in the target at its slot, re-sort the target, remove it at the source.
 * - Nothing to do (dropped onto itself / same place): "none".
 * @param {object} o  {soundId, sourcePlaylistId, targetPlaylistId, beforeId: drop in front of this track (null = end),
 *                     targetOrder: target's sound ids in display order, currentSorts: {id: sort} of the target}
 * @returns {{action:"none"}|{action:"sort", order:string[], updates:{_id:string, sort:number}[]}|
 *           {action:"move", order:string[], sort:number, updates:{_id:string, sort:number}[]}}
 */
export function planTrackDrop({ soundId, sourcePlaylistId, targetPlaylistId, beforeId = null, targetOrder = [], currentSorts = {} } = {}) {
  if (!soundId || !targetPlaylistId) return { action: "none" };
  const same = sourcePlaylistId === targetPlaylistId;
  if (same && beforeId === soundId) return { action: "none" };
  const order = targetOrder.filter(id => id !== soundId);
  const at = beforeId ? order.indexOf(beforeId) : -1;
  if (at < 0) order.push(soundId); else order.splice(at, 0, soundId);
  if (same && order.join() === targetOrder.join() && Object.keys(currentSorts).length) {
    const want = sortValues(order);
    if (order.every(id => currentSorts[id] === want[id])) return { action: "none" };
  }
  const want = sortValues(order);
  const updates = order.filter(id => id !== soundId || same).filter(id => currentSorts[id] !== want[id]).map(id => ({ _id: id, sort: want[id] }));
  if (same) return { action: "sort", order, updates };
  return { action: "move", order, sort: want[soundId], updates: updates.filter(u => u._id !== soundId) };
}

/**
 * Master volume of a playlist = its loudest track. Moving the master scales every track by the same factor, so
 * the per-track levels keep their proportions. From silence (all 0) every track gets the new value.
 * @param {number[]} volumes  track volumes 0..1
 * @param {number} master     new master 0..1
 * @returns {number[]}
 */
export function scaleVolumes(volumes, master) {
  const m = Math.max(0, Math.min(1, Number(master) || 0));
  const top = Math.max(0, ...(volumes || []).map(v => Number(v) || 0));
  const round = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
  if (top <= 0) return (volumes || []).map(() => round(m));
  return (volumes || []).map(v => round((Number(v) || 0) * (m / top)));
}

/** The master value shown for a playlist: its loudest track. */
export const masterVolume = (volumes) => Math.max(0, ...(volumes || []).map(v => Number(v) || 0));

/** "3:07" for seconds (empty for unknown). */
export function fmtDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return "";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Seek position from a click on the progress bar: fraction of the width x duration, clamped. */
export function seekPosition(fraction, duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return null;
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return Math.min(d - 0.25, f * d);
}
