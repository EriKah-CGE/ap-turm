/**
 * Jukebox: a GM music desk on top of Foundry's own playlists. No audio code of its own - every play, pause,
 * stop and fade is a playlist / playlist-sound update (Playlist#playAll / stopAll / playSound, the native `fade`
 * duration), so every client hears the same and the Playlists sidebar keeps working unchanged.
 *
 * - Now Playing: playlist + track, progress, play / pause / stop, volume of the running playlist, "Fade out".
 * - Moods: tiles pointing at playlists (world setting). Click = crossfade (the running music fades out over ~2 s
 *   and stops, the new playlist fades in); click on the active tile = pause / resume.
 * - Soundboard: the sounds of the playlist named "Soundboard", each a one-shot over the running music.
 * - Combat music (world setting, default off): combatStart switches to the combat tile, combat end fades back to
 *   what played before - unless the GM changed the music during the fight.
 * - "Import folder as playlist": a folder of audio files becomes a playlist.
 * - Transport: previous / next, seek by clicking the progress bar, "Up next", Repeat (flag noRepeat) and Shuffle.
 * - Library: every playlist (without the soundboard), expandable; play a playlist or one track, per-track volume,
 *   rename / delete / add file / mood tile, drag tracks to sort or move them, live search.
 * A crossfade needs a fade duration on the playlists involved; a playlist without one gets FADE_MS the first time
 * the jukebox fades it (visible in its playlist configuration).
 */
import { SheetSizeMixin } from "./sheets/sizing.mjs";
import {
  MOOD_COLORS, SOUNDBOARD_NAME, addTile, updateTile, deleteTile, reorderTiles, activeTile, combatTile,
  audioFiles, folderName, importPlan, combatStartPlan, combatEndPlan, sameName, FADE_MS, trackName, pickAudio, uploadDir,
  MODES, upNext, previousTrack, isLastTrack, filterLibrary, planTrackDrop, scaleVolumes, masterVolume, fmtDuration, seekPosition
} from "./jukebox-logic.mjs";
import {
  askImportConflict, createOrAppend, importFromComputerDialog, isFileDrag, filesFromDrop, uploadFiles, reportUploadErrors
} from "./jukebox-upload.mjs";

const SYSTEM_ID = "ap-turm";
export const TILES_SETTING = "jukeboxTiles";
export const COMBAT_MUSIC_SETTING = "combatMusic";
const MEMORY_SETTING = "jukeboxCombatMemory";
const UI_SETTING = "jukeboxUi";
export const CONTROL_NAME = "ap-turm-jukebox";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;

export function registerJukeboxSettings() {
  game.settings.register(SYSTEM_ID, TILES_SETTING, { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(SYSTEM_ID, MEMORY_SETTING, { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(SYSTEM_ID, UI_SETTING, { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(SYSTEM_ID, COMBAT_MUSIC_SETTING, {
    name: "Combat music", hint: "When a combat starts, the jukebox crossfades to the mood tile marked \"Combat\" and back when it ends.",
    scope: "world", config: true, type: Boolean, default: false
  });
}

/**
 * Repeat off: Foundry v13 always loops sequential and shuffle playlists after the last track. With the flag
 * `ap-turm.noRepeat` (the jukebox's Repeat toggle) the playlist stops there instead. Everything else stays
 * Foundry's own behaviour; without the flag nothing changes.
 */
export function registerPlaylistClass() {
  const Base = CONFIG.Playlist.documentClass;
  class ApTurmPlaylist extends Base {
    async _onSoundEnd(sound) {
      if (this.getFlag(SYSTEM_ID, "noRepeat") && [MODES.SEQUENTIAL, MODES.SHUFFLE].includes(this.mode) && isLastTrack(this.playbackOrder, sound.id)) {
        return this.update({ playing: false, sounds: this.sounds.map(s => ({ _id: s.id, playing: false, pausedTime: null })) });
      }
      return super._onSoundEnd(sound);
    }
  }
  CONFIG.Playlist.documentClass = ApTurmPlaylist;
}

/* ============================================================
   Playlist helpers (every call guarded by the caller)
   ============================================================ */

const tiles = () => { try { return foundry.utils.deepClone(game.settings.get(SYSTEM_ID, TILES_SETTING) ?? []); } catch { return []; } };
const saveTiles = (list) => game.settings.set(SYSTEM_ID, TILES_SETTING, list);

/** The soundboard playlist (name "Soundboard", any case). */
export const soundboard = () => game.playlists.find(p => sameName(p.name, SOUNDBOARD_NAME)) ?? null;
const isBoard = (p) => !!p && sameName(p.name, SOUNDBOARD_NAME);
/** Music playlists that play right now (the soundboard is not music). */
const playingMusic = () => game.playlists.filter(p => p.playing && !isBoard(p));
/** A music playlist that is paused (a sound with a paused time, nothing playing). */
const pausedMusic = () => game.playlists.find(p => !p.playing && !isBoard(p) && p.sounds.some(s => s.pausedTime));

/** Give a playlist a fade duration if it has none (the crossfade uses Foundry's native fade). */
async function ensureFade(playlist) {
  if (!(Number(playlist.fade) > 0)) await playlist.update({ fade: FADE_MS });
}

/**
 * Stop a playlist and forget a paused position (Playlist#stopAll keeps it). With the paused time cleared the
 * native fade applies on every client: PlaylistSound#sync stops with the fade unless a paused time is set.
 */
async function stopPlaylist(playlist) {
  await playlist.update({ playing: false, sounds: playlist.sounds.map(s => ({ _id: s.id, playing: false, pausedTime: null })) });
}

/** Fade a playlist out (native fade on stop) and stop it. */
export async function fadeOut(playlist) {
  if (!playlist) return;
  await ensureFade(playlist);
  await stopPlaylist(playlist);
}

/** Crossfade: every running music playlist fades out and stops, `target` fades in (resuming a paused track). */
export async function crossfadeTo(target) {
  if (!target) return;
  for (const p of [...playingMusic(), pausedMusic()].filter(Boolean)) if (p.id !== target.id) await fadeOut(p);
  await ensureFade(target);
  if (!target.playing) await target.playAll();
}

/** Pause the running tracks of a playlist (native pause: stop at the current time, resume from there). */
async function pausePlaylist(playlist) {
  const updates = playlist.sounds.filter(s => s.playing).map(s => ({ _id: s.id, playing: false, pausedTime: s.sound?.currentTime ?? 0 }));
  if (updates.length) await playlist.update({ playing: false, sounds: updates });
}

/* ============================================================
   Window
   ============================================================ */

let instance = null;
/** The scene control group that was active before (the jukebox group never stays active). */
let lastControl = "tokens";

/** Client UI state: open playlists in the library, open top sections. */
const ui_ = () => { try { return foundry.utils.deepClone(game.settings.get(SYSTEM_ID, UI_SETTING) ?? {}); } catch { return {}; } };
const saveUi = (patch) => game.settings.set(SYSTEM_ID, UI_SETTING, foundry.utils.mergeObject(ui_(), patch, { inplace: false }));

/** Does this playlist repeat after its last track? (Foundry's own loop; the jukebox can switch it off.) */
export const repeats = (p) => !p?.getFlag?.(SYSTEM_ID, "noRepeat");

/** Sounds of a playlist in display order (Foundry's own order: alphabetical or manual). */
const orderedSounds = (p) => p.sounds.contents.sort((a, b) => p._sortSounds(a, b));

/** The sound that plays (or is paused) in a playlist. */
const currentSound = (p) => p?.sounds.find(s => s.playing) ?? p?.sounds.find(s => s.pausedTime) ?? null;

/** Play exactly this track: the other music fades out, the track fades in (sequential / shuffle: the only one). */
export async function playTrack(sound) {
  const p = sound?.parent;
  if (!p) return;
  for (const other of [...playingMusic(), pausedMusic()].filter(Boolean)) if (other.id !== p.id) await fadeOut(other);
  await ensureFade(p);
  if (sound.playing) return;
  // a stale paused position of another track must not be resumed: start from the beginning
  if (sound.pausedTime && currentSound(p)?.id !== sound.id) await sound.update({ pausedTime: null });
  await p.playSound(sound);
}

/** Next / previous track by the playlist's own order; without repeat the playlist stops after its last track. */
async function stepTrack(p, direction) {
  const cur = currentSound(p);
  const args = { mode: p.mode, order: p.playbackOrder, currentId: cur?.id ?? null, repeat: repeats(p) };
  const id = direction > 0 ? upNext(args) : previousTrack(args);
  if (!id) return fadeOut(p);
  const s = p.sounds.get(id);
  if (!s) return;
  if (s.id === cur?.id) return seekTo(s, 0);                // single track / restart
  await ensureFade(p);
  await p.update({ playing: true, sounds: p.sounds.map(x => ({ _id: x.id, playing: x.id === s.id, pausedTime: null })) });
}

/**
 * Seek: stop at the new position (paused time), then play again - PlaylistSound#sync starts every client at the
 * paused position, so all players jump together.
 */
export async function seekTo(sound, seconds) {
  if (!sound) return;
  const wasPlaying = sound.playing;
  await sound.update({ playing: false, pausedTime: Math.max(0, seconds) });
  if (wasPlaying) await sound.update({ playing: true });
}

export class JukeboxApp extends SheetSizeMixin(HandlebarsApplicationMixin(ApplicationV2), "jukebox") {
  static DEFAULT_OPTIONS = {
    id: "ap-turm-jukebox",
    classes: ["ap-turm", "apt-jukebox"],
    window: { title: "Jukebox", icon: "fa-solid fa-music", resizable: true },
    position: { width: 600, height: 780 },
    actions: {
      play: JukeboxApp.#onPlay, pause: JukeboxApp.#onPause, stop: JukeboxApp.#onStop, fadeOut: JukeboxApp.#onFadeOut,
      prev: JukeboxApp.#onPrev, next: JukeboxApp.#onNext, toggleRepeat: JukeboxApp.#onToggleRepeat, toggleShuffle: JukeboxApp.#onToggleShuffle,
      tilePlay: JukeboxApp.#onTilePlay, tileEdit: JukeboxApp.#onTileEdit, tileDelete: JukeboxApp.#onTileDelete,
      addMood: JukeboxApp.#onAddMood, boardPlay: JukeboxApp.#onBoardPlay, importFolder: JukeboxApp.#onImportFolder,
      importComputer: JukeboxApp.#onImportComputer, newPlaylist: JukeboxApp.#onNewPlaylist,
      plToggle: JukeboxApp.#onPlToggle, plPlay: JukeboxApp.#onPlPlay, trackPlay: JukeboxApp.#onTrackPlay
    }
  };

  static PARTS = {
    now: { template: "systems/ap-turm/templates/apps/jukebox-now.hbs" },
    top: { template: "systems/ap-turm/templates/apps/jukebox-top.hbs", scrollable: [".apt-jb-top"] },
    search: { template: "systems/ap-turm/templates/apps/jukebox-search.hbs" },
    library: { template: "systems/ap-turm/templates/apps/jukebox-library.hbs", scrollable: [".apt-jb-lib"] }
  };

  static COMPACT_HEIGHT = 700;

  #timer = null;
  #dropBound = false;
  #menus = false;
  #query = "";
  #compact = null;
  #compactOpen = {};

  /** The playlist the Now Playing zone shows: a running one, else a paused one. */
  #nowPlaylist() { return playingMusic()[0] ?? pausedMusic() ?? null; }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const now = this.#nowPlaylist();
    const state = ui_();
    let nowCtx = null;
    if (now) {
      const sound = currentSound(now);
      const AH = foundry.audio.AudioHelper;
      const nextId = upNext({ mode: now.mode, order: now.playbackOrder, currentId: sound?.id ?? null, repeat: repeats(now) });
      const stepping = [MODES.SEQUENTIAL, MODES.SHUFFLE].includes(now.mode);
      nowCtx = {
        id: now.id, playlist: now.name, track: sound?.name ?? "", paused: !now.playing, stepping,
        volume: AH.volumeToInput(masterVolume(now.sounds.map(s => s.volume))),
        upNext: stepping ? (nextId ? now.sounds.get(nextId)?.name ?? "" : "— (end of playlist)") : "",
        repeat: repeats(now), shuffle: now.mode === MODES.SHUFFLE, ...progressOf(sound)
      };
    }
    const playingIds = playingMusic().map(p => p.id);
    const act = activeTile(tiles(), playingIds) ?? (now ? tiles().find(t => t.playlistId === now.id) : null);
    const moods = tiles().map(t => {
      const p = game.playlists.get(t.playlistId);
      return { ...t, missing: !p, active: t.id === act?.id, paused: t.id === act?.id && !!p && !p.playing, title: p ? `${p.name}${t.combat ? " · combat music" : ""}` : "Playlist missing" };
    });
    const board = soundboard();
    const AH = foundry.audio.AudioHelper;
    const library = game.playlists.filter(p => !isBoard(p)).sort((a, b) => a.name.localeCompare(b.name)).map(p => ({
      id: p.id, name: p.name, count: p.sounds.size, playing: p.playing, paused: !p.playing && p.sounds.some(s => s.pausedTime),
      expanded: !!state.expanded?.[p.id], mode: p.mode,
      sounds: orderedSounds(p).map(s => ({
        id: s.id, name: s.name, path: s.path, playing: s.playing, paused: !s.playing && !!s.pausedTime,
        duration: fmtDuration(durationOf(s)), volume: AH.volumeToInput(s.volume ?? 0.5), volumePct: Math.round((s.volume ?? 0) * 100)
      }))
    }));
    return Object.assign(ctx, {
      now: nowCtx, moods, library, query: this.#query,
      moodsOpen: this.#compact ? !!this.#compactOpen.moodsOpen : state.moodsOpen !== false,
      boardOpen: this.#compact ? !!this.#compactOpen.boardOpen : state.boardOpen !== false,
      board: board ? { name: board.name, sounds: board.sounds.contents.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(s => ({ id: s.id, name: s.name, playing: s.playing })) } : null,
      combatMusic: game.settings.get(SYSTEM_ID, COMBAT_MUSIC_SETTING)
    });
  }

  /** Below COMPACT_HEIGHT the moods and the soundboard fold up first (the minimum height is in SHEET_SIZES). */
  _onPosition(position) {
    super._onPosition(position);
    const compact = Number(position.height) < JukeboxApp.COMPACT_HEIGHT;
    if (compact === this.#compact) return;
    this.#compact = compact;
    this.#compactOpen = {};
    this.element?.classList.toggle("apt-jb-compact", compact);
    const state = ui_();
    this.element?.querySelectorAll("details.apt-jb-sec").forEach(d => { d.open = compact ? false : state[d.dataset.key] !== false; });
  }

  /** Listeners per rendered part (a hook re-render redraws some parts; the others keep their listeners). */
  _attachPartListeners(partId, el, options) {
    super._attachPartListeners(partId, el, options);
    if (partId === "now") {
      // master volume: scales every track of the playing playlist (levels keep their proportions); on release only
      el.querySelector("input.apt-jb-volume")?.addEventListener("change", (ev) => {
        const p = this.#nowPlaylist();
        if (!p) return;
        const master = foundry.audio.AudioHelper.inputToVolume(Number(ev.currentTarget.value));
        const sounds = p.sounds.contents;
        const vols = scaleVolumes(sounds.map(s => s.volume), master);
        p.updateEmbeddedDocuments("PlaylistSound", sounds.map((s, i) => ({ _id: s.id, volume: vols[i] }))).catch(err => console.error(`${SYSTEM_ID} | jukebox volume`, err));
      });
      // progress bar: click = seek (for everyone)
      el.querySelector(".apt-jb-progress")?.addEventListener("click", (ev) => {
        const s = currentSound(this.#nowPlaylist());
        const pos = seekPosition((ev.clientX - ev.currentTarget.getBoundingClientRect().left) / ev.currentTarget.clientWidth, s?.sound?.duration);
        if (s && pos !== null) guard("seek", () => seekTo(s, pos));
      });
    }
    if (partId === "top") {
      // sections: remember open / closed (client setting); in the compact window only for this session
      el.querySelectorAll("details.apt-jb-sec").forEach(d => d.addEventListener("toggle", () => {
        if (this.#compact) this.#compactOpen[d.dataset.key] = d.open;
        else if ((ui_()[d.dataset.key] !== false) !== d.open) saveUi({ [d.dataset.key]: d.open }).catch(() => {});
      }));
      this.#bindTiles(el);
    }
    if (partId === "search") {
      // search: filters in place, no re-render
      const search = el.querySelector("input.apt-jb-search");
      search?.addEventListener("input", () => { this.#query = search.value; this.#applyFilter(); });
    }
    if (partId === "library") {
      // track volume sliders (persisted on the sound)
      el.querySelectorAll("input.apt-jb-tvol").forEach(inp => inp.addEventListener("change", () => {
        const s = this.#soundOf(inp);
        if (s) s.update({ volume: foundry.audio.AudioHelper.inputToVolume(Number(inp.value)) }).catch(err => console.error(`${SYSTEM_ID} | track volume`, err));
      }));
      this.#bindTrackDrag(el);
      probeDurations(el);
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.classList.toggle("apt-jb-compact", !!this.#compact);
    this.#applyFilter();
    if (!this.#menus) { this.#menus = true; this.#createMenus(); }
    if (!this.#dropBound) this.#bindFileDrop();
    if (!this.#timer) this.#timer = setInterval(() => this.#tick(), 500);
  }

  /** The PlaylistSound a library element belongs to. */
  #soundOf(el) {
    const row = el.closest("[data-sound-id]");
    return game.playlists.get(row?.closest("[data-playlist-id]")?.dataset.playlistId)?.sounds.get(row?.dataset.soundId) ?? null;
  }
  #playlistOf(el) { return game.playlists.get(el.closest("[data-playlist-id]")?.dataset.playlistId) ?? null; }

  /** Live search: hide what does not match, open playlists with a matching track (stored open state untouched). */
  #applyFilter() {
    const root = this.element;
    if (!root) return;
    const lists = [...root.querySelectorAll(".apt-jb-pl[data-playlist-id]")];
    const data = lists.map(el => ({ id: el.dataset.playlistId, name: el.dataset.name, sounds: [...el.querySelectorAll("[data-sound-id]")].map(t => ({ id: t.dataset.soundId, name: t.dataset.name })) }));
    const res = filterLibrary(data, this.#query);
    const show = new Map(res.playlists.map(p => [p.id, new Set(p.tracks)]));
    const searching = !!this.#query.trim();
    for (const el of lists) {
      const tracks = show.get(el.dataset.playlistId);
      el.hidden = !tracks;
      el.classList.toggle("search-open", searching && res.expand.includes(el.dataset.playlistId));
      el.querySelectorAll("[data-sound-id]").forEach(t => { t.hidden = !!tracks && !tracks.has(t.dataset.soundId); });
    }
    const none = root.querySelector(".apt-jb-nohit");
    if (none) none.hidden = !searching || res.playlists.length > 0;
  }

  /** Mood tiles: drag to reorder. */
  #bindTiles(root) {
    root.querySelectorAll(".apt-jb-tile[data-tile-id]").forEach(el => {
      el.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/apt-tile", el.dataset.tileId); ev.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
      el.addEventListener("dragover", (ev) => { if (ev.dataTransfer.types.includes("text/apt-tile")) { ev.preventDefault(); el.classList.add("dropzone"); } });
      el.addEventListener("dragleave", () => el.classList.remove("dropzone"));
      el.addEventListener("drop", (ev) => {
        const from = ev.dataTransfer.getData("text/apt-tile");
        el.classList.remove("dropzone");
        if (!from || from === el.dataset.tileId) return;
        ev.preventDefault();
        saveTiles(reorderTiles(tiles(), from, el.dataset.tileId)).then(() => this.render({ parts: ["top"] })).catch(err => console.error(`${SYSTEM_ID} | jukebox reorder`, err));
      });
    });
  }

  /** Library tracks: drag onto a track (goes in front of it) or onto a playlist head (goes to its end). */
  #bindTrackDrag(root) {
    const TYPE = "text/apt-sound";
    // the name is the handle (a draggable row would also drag when the volume slider is moved)
    root.querySelectorAll(".apt-jb-track[data-sound-id] .nm").forEach(handle => {
      const el = handle.closest(".apt-jb-track");
      handle.addEventListener("dragstart", (ev) => {
        ev.stopPropagation();
        ev.dataTransfer.setData(TYPE, JSON.stringify({ playlistId: this.#playlistOf(el)?.id, soundId: el.dataset.soundId }));
        ev.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
      });
      handle.addEventListener("dragend", () => el.classList.remove("dragging"));
    });
    root.querySelectorAll(".apt-jb-track[data-sound-id], .apt-jb-pl-head").forEach(el => {
      el.addEventListener("dragover", (ev) => { if (ev.dataTransfer.types.includes(TYPE)) { ev.preventDefault(); el.classList.add("dropzone"); } });
      el.addEventListener("dragleave", () => el.classList.remove("dropzone"));
      el.addEventListener("drop", (ev) => {
        el.classList.remove("dropzone");
        const raw = ev.dataTransfer.getData(TYPE);
        if (!raw) return;
        ev.preventDefault(); ev.stopPropagation();
        let src; try { src = JSON.parse(raw); } catch { return; }
        const target = this.#playlistOf(el);
        const beforeId = el.classList.contains("apt-jb-track") ? el.dataset.soundId : null;
        guard("move track", () => moveTrack(src, target, beforeId));
      });
    });
  }

  /** Context menus of playlists and tracks: right-click on the row, or the ⋮ button. */
  #createMenus() {
    const CM = foundry.applications.ux.ContextMenu.implementation;
    const plItems = [
      { name: "Rename", icon: '<i class="fa-solid fa-i-cursor"></i>', callback: (el) => renameDoc(this.#playlistOf(el), "playlist") },
      { name: "Add file…", icon: '<i class="fa-solid fa-file-circle-plus"></i>', callback: (el) => guard("add file", () => addFileDialog(this.#playlistOf(el))) },
      { name: "Create mood tile", icon: '<i class="fa-solid fa-table-cells-large"></i>', callback: (el) => guard("mood tile", () => moodTileFor(this.#playlistOf(el))) },
      { name: "Delete", icon: '<i class="fa-solid fa-trash"></i>', callback: (el) => deleteDoc(this.#playlistOf(el), "playlist") }
    ];
    const trItems = [
      { name: "Rename", icon: '<i class="fa-solid fa-i-cursor"></i>', callback: (el) => renameDoc(this.#soundOf(el), "track") },
      { name: "Delete", icon: '<i class="fa-solid fa-trash"></i>', callback: (el) => deleteDoc(this.#soundOf(el), "track") }
    ];
    new CM(this.element, ".apt-jb-pl-head", plItems, { jQuery: false, fixed: true });
    new CM(this.element, ".apt-jb-pl-menu", plItems, { jQuery: false, fixed: true, eventName: "click" });
    new CM(this.element, ".apt-jb-track", trItems, { jQuery: false, fixed: true });
    new CM(this.element, ".apt-jb-tr-menu", trItems, { jQuery: false, fixed: true, eventName: "click" });
  }

  /** Audio files / a folder from the explorer dropped on the window -> "Import from computer". */
  #bindFileDrop() {
    this.#dropBound = true;
    const win = this.element;
    win.addEventListener("dragover", (ev) => { if (!isFileDrag(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; win.classList.add("apt-jb-dropping"); });
    win.addEventListener("dragleave", (ev) => { if (ev.target === win || !win.contains(ev.relatedTarget)) win.classList.remove("apt-jb-dropping"); });
    win.addEventListener("drop", (ev) => {
      win.classList.remove("apt-jb-dropping");
      if (!isFileDrag(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pending = filesFromDrop(ev.dataTransfer);          // entries are read now, while the event is live
      guard("drop import", async () => importFromComputerDialog(await pending));
    });
  }

  #tick() {
    try {
      const root = this.element;
      if (!root) return;
      const s = currentSound(this.#nowPlaylist());
      const pr = progressOf(s);
      const bar = root.querySelector(".apt-jb-progress .bar");
      if (bar) bar.style.width = `${pr.pct}%`;
      const t = root.querySelector(".apt-jb-time");
      if (t) t.textContent = pr.time;
    } catch (err) { console.error(`${SYSTEM_ID} | jukebox progress`, err); }
  }

  async _onClose(options) {
    clearInterval(this.#timer);
    this.#timer = null;
    instance = null;
    return super._onClose(options);
  }

  /* ---------- actions ---------- */

  static async #onPlay() { await guard("play", async () => { const p = this.#nowPlaylist(); if (p && !p.playing) await p.playAll(); }); }
  static async #onPause() { await guard("pause", async () => { const p = playingMusic()[0]; if (p) await pausePlaylist(p); }); }
  static async #onStop() { await guard("stop", async () => { for (const p of [...playingMusic(), pausedMusic()].filter(Boolean)) await stopPlaylist(p); }); }
  static async #onFadeOut() { await guard("fade out", async () => { for (const p of playingMusic()) await fadeOut(p); }); }
  static async #onPrev() { await guard("previous", async () => { const p = this.#nowPlaylist(); if (p) await stepTrack(p, -1); }); }
  static async #onNext() { await guard("next", async () => { const p = this.#nowPlaylist(); if (p) await stepTrack(p, 1); }); }
  static async #onToggleRepeat() { await guard("repeat", async () => { const p = this.#nowPlaylist(); if (p) await p.setFlag(SYSTEM_ID, "noRepeat", repeats(p)); }); }
  static async #onToggleShuffle() {
    // the mode changes on the document; the running track keeps playing
    await guard("shuffle", async () => { const p = this.#nowPlaylist(); if (p) await p.update({ mode: p.mode === MODES.SHUFFLE ? MODES.SEQUENTIAL : MODES.SHUFFLE }); });
  }

  static async #onTilePlay(ev, target) {
    await guard("mood", async () => {
      const t = tiles().find(x => x.id === target.closest("[data-tile-id]")?.dataset.tileId);
      const p = t ? game.playlists.get(t.playlistId) : null;
      if (!p) { ui.notifications.warn("The playlist of this tile no longer exists - edit or delete the tile."); return; }
      return playOrToggle(p, this.#nowPlaylist());
    });
  }

  static async #onPlPlay(ev, target) {
    await guard("playlist", async () => { const p = this.#playlistOf(target); if (p) await playOrToggle(p, this.#nowPlaylist()); });
  }

  static async #onTrackPlay(ev, target) {
    await guard("track", async () => {
      const s = this.#soundOf(target);
      if (!s) return;
      if (s.playing) return pausePlaylist(s.parent);          // the running track: pause
      if (s.pausedTime && currentSound(s.parent)?.id === s.id) return s.parent.playSound(s);   // paused: resume
      return playTrack(s);
    });
  }

  static async #onPlToggle(ev, target) {
    const el = target.closest("[data-playlist-id]");
    const id = el?.dataset.playlistId;
    if (!id) return;
    const open = !el.classList.contains("open");
    el.classList.toggle("open", open);
    await saveUi({ expanded: { [id]: open } });
  }

  static async #onTileEdit(ev, target) {
    const id = target.closest("[data-tile-id]")?.dataset.tileId;
    const t = tiles().find(x => x.id === id);
    if (!t) return;
    const data = await tileDialog(t);
    if (data) { await saveTiles(updateTile(tiles(), id, data)); this.render({ parts: ["top"] }); }
  }

  static async #onTileDelete(ev, target) {
    const id = target.closest("[data-tile-id]")?.dataset.tileId;
    const t = tiles().find(x => x.id === id);
    if (!t) return;
    const ok = await DialogV2.confirm({ window: { title: "Delete mood" }, content: `<p>Delete the tile <b>${esc(t.label)}</b>? The playlist stays.</p>`, rejectClose: false });
    if (ok) { await saveTiles(deleteTile(tiles(), id)); this.render({ parts: ["top"] }); }
  }

  static async #onAddMood() {
    const data = await tileDialog(null);
    if (data) { await saveTiles(addTile(tiles(), { ...data, id: foundry.utils.randomID() })); this.render({ parts: ["top"] }); }
  }

  static async #onBoardPlay(ev, target) {
    await guard("soundboard", async () => {
      const board = soundboard();
      const s = board?.sounds.get(target.closest("[data-sound-id]")?.dataset.soundId);
      if (!s) return;
      // one-shots need Foundry's "Soundboard Only" mode; in a sequential playlist the next sound would follow
      const M = CONST.PLAYLIST_MODES;
      if (board.mode !== M.DISABLED) await board.update({ mode: M.DISABLED, playing: false, sounds: board.sounds.map(x => ({ _id: x.id, playing: false, pausedTime: null })) });
      if (s.playing) await s.update({ playing: false, pausedTime: null });   // restart a one-shot that still runs
      await board.playSound(s);
    });
  }

  static async #onImportFolder() { await importFolderDialog(); }
  static async #onImportComputer() { await guard("import from computer", () => importFromComputerDialog()); }
  static async #onNewPlaylist() { await guard("new playlist", () => newPlaylistDialog()); }
}

/**
 * Track durations for the library. A loaded sound knows its duration; for the others only the file's metadata
 * is read (an audio element with preload "metadata", never played) and kept per path for this session.
 */
const durations = new Map();
const probing = new Set();
const durationOf = (s) => (Number(s.sound?.duration) > 0 ? s.sound.duration : durations.get(s.path));

function probeDurations(root) {
  root.querySelectorAll(".apt-jb-track[data-path]").forEach(li => {
    const path = li.dataset.path;
    if (!path || durations.has(path) || probing.has(path) || li.querySelector(".dur")?.textContent) return;
    probing.add(path);
    const a = new Audio();
    a.preload = "metadata";
    const done = () => { probing.delete(path); a.removeAttribute("src"); };
    a.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(a.duration)) {
        durations.set(path, a.duration);
        instance?.element?.querySelectorAll(".apt-jb-track[data-path]").forEach(x => {
          if (x.dataset.path === path) { const d = x.querySelector(".dur"); if (d) d.textContent = fmtDuration(a.duration); }
        });
      }
      done();
    }, { once: true });
    a.addEventListener("error", () => { durations.set(path, NaN); done(); }, { once: true });
    a.src = path;
  });
}

/** Tile / playlist play button: the running playlist pauses, a paused one resumes, any other crossfades in. */
async function playOrToggle(p, now) {
  if (p.playing) return pausePlaylist(p);
  if (p.sounds.some(s => s.pausedTime) && now?.id === p.id) return p.playAll();
  return crossfadeTo(p);
}

/** Move / re-sort a track (drag in the library). Across playlists: create at the target, then remove at the source. */
async function moveTrack(src, target, beforeId) {
  const source = game.playlists.get(src?.playlistId);
  const sound = source?.sounds.get(src?.soundId);
  if (!sound || !target) return;
  const order = orderedSounds(target).map(s => s.id);
  const currentSorts = Object.fromEntries(target.sounds.map(s => [s.id, s.sort]));
  const plan = planTrackDrop({ soundId: sound.id, sourcePlaylistId: source.id, targetPlaylistId: target.id, beforeId, targetOrder: order, currentSorts });
  if (plan.action === "none") return;
  // a hand-made order needs Foundry's manual sorting (the default is alphabetical)
  const manual = target.sorting === "m" ? {} : { sorting: "m" };
  if (plan.action === "sort") {
    if (plan.updates.length) await target.updateEmbeddedDocuments("PlaylistSound", plan.updates);
    if (manual.sorting) await target.update(manual);
    return;
  }
  const data = sound.toObject();
  delete data._id;
  Object.assign(data, { sort: plan.sort, playing: false, pausedTime: null });
  const [created] = await target.createEmbeddedDocuments("PlaylistSound", [data]);
  if (!created) throw new Error("the track could not be created in the target playlist");
  if (plan.updates.length) await target.updateEmbeddedDocuments("PlaylistSound", plan.updates);
  if (manual.sorting) await target.update(manual);
  await source.deleteEmbeddedDocuments("PlaylistSound", [sound.id]);
  ui.notifications.info(`${created.name} moved to ${target.name}.`);
}

/** Rename a playlist or a track. */
async function renameDoc(doc, what) {
  if (!doc) return;
  const name = await DialogV2.prompt({
    window: { title: `Rename ${what}` },
    content: `<div class="form-group"><label>Name</label><div class="form-fields"><input type="text" name="name" value="${esc(doc.name)}" autofocus></div></div>`,
    rejectClose: false,
    ok: { label: "Rename", callback: (ev, button) => button.form.elements.name.value.trim() }
  });
  if (name && name !== doc.name) await guard("rename", () => doc.update({ name }));
}

/** Delete a playlist or a track (asks first). */
async function deleteDoc(doc, what) {
  if (!doc) return;
  const extra = what === "playlist" ? ` with its ${doc.sounds.size} track${doc.sounds.size === 1 ? "" : "s"} (the audio files stay on disk)` : " (the audio file stays on disk)";
  const ok = await DialogV2.confirm({ window: { title: `Delete ${what}` }, content: `<p>Delete the ${what} <b>${esc(doc.name)}</b>${extra}?</p>`, rejectClose: false });
  if (!ok) return;
  await guard("delete", async () => {
    if (what === "playlist") { await doc.delete(); await saveTiles(tiles().filter(t => t.playlistId !== doc.id)); }
    else await doc.parent.deleteEmbeddedDocuments("PlaylistSound", [doc.id]);
  });
}

/** "Create mood tile" for a playlist: a tile with the playlist's name, straight away. */
async function moodTileFor(p) {
  if (!p) return;
  const used = new Set(tiles().map(t => t.color));
  const color = MOOD_COLORS.find(c => !used.has(c)) ?? MOOD_COLORS[0];
  await saveTiles(addTile(tiles(), { id: foundry.utils.randomID(), playlistId: p.id, label: p.name, color }));
  instance?.render({ parts: ["top"] });
  ui.notifications.info(`Mood tile "${p.name}" created.`);
}

/** "+ New playlist": an empty playlist (sequential, with the jukebox fade). */
async function newPlaylistDialog() {
  const name = await DialogV2.prompt({
    window: { title: "New playlist", icon: "fa-solid fa-list" },
    content: `<div class="form-group"><label>Name</label><div class="form-fields"><input type="text" name="name" placeholder="e.g. Dungeon ambience" autofocus></div></div>`,
    rejectClose: false,
    ok: { label: "Create", callback: (ev, button) => button.form.elements.name.value.trim() }
  });
  if (!name) return null;
  const pl = await Playlist.implementation.create({ name, mode: MODES.SEQUENTIAL, fade: FADE_MS });
  await saveUi({ expanded: { [pl.id]: true } });
  return pl;
}

/** "Add file…": one file from Foundry's data (FilePicker) or files from the computer (upload) into this playlist. */
async function addFileDialog(p) {
  if (!p) return null;
  const how = await DialogV2.wait({
    window: { title: `Add file: ${p.name}`, icon: "fa-solid fa-file-circle-plus" },
    content: `<p>Where does the file come from?</p><p class="hint">Files from the computer are copied into Foundry's data folder (Data/music/${esc(p.name)}/) so all players can hear them.</p>`,
    buttons: [
      { action: "data", label: "Foundry data", icon: "fa-solid fa-folder-tree", default: true },
      { action: "computer", label: "This computer", icon: "fa-solid fa-upload" },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  const add = async (paths) => {
    const have = new Set(p.sounds.map(s => s.path));
    const fresh = paths.filter(x => !have.has(x));
    if (fresh.length) await p.createEmbeddedDocuments("PlaylistSound", fresh.map(path => ({ name: trackName(path), path, repeat: false, volume: 0.5 })));
    ui.notifications.info(`${fresh.length} track${fresh.length === 1 ? "" : "s"} added to ${p.name}.`);
  };
  if (how === "data") {
    const FPC = foundry.applications.apps.FilePicker.implementation;
    return new FPC({ type: "audio", callback: (path) => { guard("add file", () => add([path])); } }).render({ force: true });
  }
  if (how === "computer") {
    const files = await pickLocalFiles();
    const sel = pickAudio(files);
    if (!sel.files.length) { if (files.length) ui.notifications.warn("No audio files (mp3, ogg, wav, webm, flac) chosen."); return null; }
    const { paths, errors } = await uploadFiles(sel.files, uploadDir(p.name));
    if (paths.length) await add(paths);
    await reportUploadErrors(errors, sel.files.length);
  }
  return null;
}

/** The browser's own file dialog (several audio files). */
function pickLocalFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".mp3,.ogg,.wav,.webm,.flac,audio/*";
    input.addEventListener("change", () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}

/** Progress of a playlist sound: {pct, time}. */
function progressOf(sound) {
  const snd = sound?.sound;
  const dur = Number(snd?.duration);
  const cur = sound?.playing ? Number(snd?.currentTime) : Number(sound?.pausedTime);
  if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(cur)) return { pct: 0, time: "" };
  return { pct: Math.max(0, Math.min(100, (cur / dur) * 100)), time: `${fmtDuration(cur)} / ${fmtDuration(dur)}` };
}

/** Run an audio action; a failing Audio / playlist call ends up in the console, never breaks the window. */
async function guard(label, fn) {
  try { return await fn(); } catch (err) { console.error(`${SYSTEM_ID} | jukebox ${label}`, err); ui.notifications.warn(`Jukebox: ${label} failed, see the console.`); return null; }
}

/* ============================================================
   Dialogs
   ============================================================ */

/** Add / edit a mood tile: playlist, label, colour, icon, combat. */
async function tileDialog(tile) {
  const lists = game.playlists.filter(p => !isBoard(p)).sort((a, b) => a.name.localeCompare(b.name));
  if (!lists.length) { ui.notifications.warn("There is no playlist yet - create one (or import a folder) first."); return null; }
  const cur = tile ?? { playlistId: lists[0].id, label: "", color: MOOD_COLORS[0], icon: "", combat: false };
  const content = `<div class="apt-jb-dialog">
    <div class="form-group"><label>Playlist</label><div class="form-fields"><select name="playlistId">${lists.map(p => `<option value="${p.id}" ${p.id === cur.playlistId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div>
    <div class="form-group"><label>Label</label><div class="form-fields"><input type="text" name="label" value="${esc(cur.label)}" placeholder="the playlist's name"></div></div>
    <div class="form-group"><label>Colour</label><div class="form-fields apt-jb-swatches">${MOOD_COLORS.map(c => `<label class="sw" style="--sw:${c}"><input type="radio" name="color" value="${c}" ${c === cur.color ? "checked" : ""}><span></span></label>`).join("")}</div></div>
    <div class="form-group"><label>Icon</label><div class="form-fields"><input type="text" name="icon" value="${esc(cur.icon)}" placeholder="e.g. fa-dragon, fa-tree, fa-skull"></div></div>
    <div class="form-group"><label>Combat</label><div class="form-fields"><input type="checkbox" name="combat" ${cur.combat ? "checked" : ""}> <small>played when a combat starts (only one tile)</small></div></div>
  </div>`;
  return DialogV2.prompt({
    window: { title: tile ? `Edit mood: ${tile.label}` : "Add mood", icon: "fa-solid fa-music" },
    position: { width: 420 },
    content, rejectClose: false,
    ok: {
      label: tile ? "Save" : "Add", icon: "fa-solid fa-check",
      callback: (ev, button) => {
        const f = button.form.elements;
        const playlistId = f.playlistId.value;
        return {
          playlistId, label: f.label.value.trim() || game.playlists.get(playlistId)?.name || "Mood",
          color: button.form.querySelector("input[name=color]:checked")?.value ?? MOOD_COLORS[0],
          icon: f.icon.value, combat: !!f.combat.checked
        };
      }
    }
  });
}

/** "Import folder as playlist": pick a folder, name + shuffle, then create (or add to) the playlist. */
export async function importFolderDialog() {
  const picker = new foundry.applications.elements.HTMLFilePickerElement();
  Object.assign(picker, { type: "folder", noupload: true });
  picker.setAttribute("name", "folder");
  const res = await DialogV2.prompt({
    window: { title: "Import folder as playlist", icon: "fa-solid fa-folder-music" },
    position: { width: 460 },
    content: `<div class="apt-jb-dialog">
      <p class="hint">Every audio file of the folder (mp3, ogg, wav, webm, flac) becomes a track, in alphabetical order.</p>
      <div class="form-group"><label>Folder</label><div class="form-fields">${picker.outerHTML}</div></div>
      <div class="form-group"><label>Playlist name</label><div class="form-fields"><input type="text" name="name" placeholder="the folder's name"></div></div>
      <div class="form-group"><label>Shuffle</label><div class="form-fields"><input type="checkbox" name="shuffle"></div></div>
    </div>`,
    rejectClose: false,
    ok: {
      label: "Import", icon: "fa-solid fa-file-import",
      callback: async (ev, button) => {
        const el = button.form.querySelector("file-picker");
        const fp = el?.picker;
        const folder = el?.value || fp?.target;
        if (!folder) return { error: "Choose a folder first." };
        const listing = await (fp ? fp.browse(folder, { type: "audio", render: false }) : foundry.applications.apps.FilePicker.implementation.browse("data", folder));
        const files = audioFiles((listing?.result ?? listing)?.files ?? []);
        return { folder, files, name: button.form.elements.name.value.trim() || folderName(folder), shuffle: !!button.form.elements.shuffle.checked };
      }
    }
  });
  if (!res) return null;
  if (res.error) { ui.notifications.warn(res.error); return null; }
  if (!res.files.length) { ui.notifications.warn(`No audio files in ${res.folder}.`); return null; }
  const names = game.playlists.map(p => p.name);
  const choice = names.some(n => sameName(n, res.name)) ? await askImportConflict(res.name) : null;
  const plan = importPlan(names, res.name, choice);
  if (plan.action === "cancel") return null;
  const { playlist, added } = await createOrAppend(plan, res.files, { shuffle: res.shuffle });
  ui.notifications.info(plan.action === "append"
    ? `${added} track${added === 1 ? "" : "s"} added to ${playlist.name}.`
    : `Playlist ${playlist.name} created with ${added} track${added === 1 ? "" : "s"}.`);
  return playlist;
}

/* ============================================================
   Combat coupling, open, registration
   ============================================================ */

async function onCombatStart() {
  if (!game.user.isGM) return;
  const plan = combatStartPlan({ enabled: game.settings.get(SYSTEM_ID, COMBAT_MUSIC_SETTING), tiles: tiles(), playingIds: playingMusic().map(p => p.id) });
  if (!plan) return;
  await game.settings.set(SYSTEM_ID, MEMORY_SETTING, plan.remember);
  await crossfadeTo(game.playlists.get(plan.play));
}

async function onCombatEnd() {
  if (!game.user.isActiveGM) return;
  const memory = game.settings.get(SYSTEM_ID, MEMORY_SETTING);
  const plan = combatEndPlan({ memory, playingIds: playingMusic().map(p => p.id) });
  await game.settings.set(SYSTEM_ID, MEMORY_SETTING, {});
  if (!plan) return;
  const back = plan.play ? game.playlists.get(plan.play) : null;
  if (back) await crossfadeTo(back);
  else await fadeOut(game.playlists.get(plan.stop));
}

/** Open (or bring to front) the jukebox. GM only. */
export function openJukebox() {
  if (!game.user.isGM) { ui.notifications.warn("The jukebox is for the GM."); return null; }
  instance ??= new JukeboxApp();
  if (instance.rendered) instance.bringToFront?.();
  else instance.render({ force: true }).catch(err => console.error(`${SYSTEM_ID} | jukebox`, err));
  return instance;
}

// playlist changes redraw transport, tiles and library; the search field stays (no lost focus / input)
const rerender = foundry.utils.debounce(() => { if (instance?.rendered) instance.render({ parts: ["now", "top", "library"] }).catch?.(() => {}); }, 150);

export function registerJukebox() {
  for (const h of ["createPlaylist", "updatePlaylist", "deletePlaylist", "createPlaylistSound", "updatePlaylistSound", "deletePlaylistSound"]) {
    Hooks.on(h, () => { try { rerender(); } catch (err) { console.error(`${SYSTEM_ID} | jukebox`, err); } });
  }
  Hooks.on("combatStart", () => { onCombatStart().catch(err => console.error(`${SYSTEM_ID} | combat music`, err)); });
  Hooks.on("deleteCombat", () => { onCombatEnd().catch(err => console.error(`${SYSTEM_ID} | combat music`, err)); });
  // Own group in the main (left) scene control bar, below Foundry's groups, GM only. A group has no button mode in
  // v13 - a click would make it the active group - so the click on its button is taken before Foundry sees it:
  // the jukebox opens and the active group / canvas layer stay as they are. It has no layer of its own.
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM || !controls) return;
    const open = { name: "open", order: 1, title: "AP-Turm Jukebox", icon: "fa-solid fa-record-vinyl", button: true, onChange: () => openJukebox() };
    controls[CONTROL_NAME] = {
      name: CONTROL_NAME, order: 100, title: "AP-Turm Jukebox", icon: "fa-solid fa-record-vinyl", visible: game.user.isGM,
      tools: { open }, activeTool: "open",
      // fallback if the group gets activated another way (keyboard): open, then back to the group before
      onChange: (event, active) => {
        if (!active) return;
        openJukebox();
        const back = lastControl && lastControl !== CONTROL_NAME ? lastControl : "tokens";
        setTimeout(() => ui.controls?.activate({ control: back }), 0);
      }
    };
  });
  Hooks.on("renderSceneControls", (app) => {
    const current = app.control?.name;
    if (current && current !== CONTROL_NAME) lastControl = current;
    const btn = app.element?.querySelector(`button[data-control="${CONTROL_NAME}"]`);
    if (!btn || btn.dataset.aptJukebox) return;
    btn.dataset.aptJukebox = "1";
    btn.dataset.tooltip = "AP-Turm Jukebox";
    btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); openJukebox(); }, { capture: true });
  });
}

export const jukebox = { open: openJukebox, crossfadeTo, fadeOut, importFolderDialog, soundboard };
