/**
 * Tower tracker: pure logic, no Foundry dependency (tested in Node).
 *
 * Rules of the table (from the user):
 * - The tower has 50 levels. Each level's element is rolled on a d20 over the 20 elements, in the order of the
 *   ELEMENTS table (1 = first entry). The GM may override the result.
 * - Every level quakes after certain times. After the third quake the level collapses and the group lands
 *   uncontrolled one level higher. The quakes themselves do not destroy the level.
 * - Time inside a level is booked by the GM. Time outside = one hour per level reached in this run
 *   (levelsReached = highest level of the run) plus a GM offset in hours for special cases.
 *
 * Every function returns a new run object; the input is never changed.
 */
import { ELEMENTS } from "./config.mjs";

export const TOWER_LEVELS = 50;
export const MAX_QUAKES = 3;
export const LOG_LIMIT = 1000;

/** Element keys in table order: d20 result n -> ELEMENT_ORDER[n - 1]. */
export const ELEMENT_ORDER = Object.keys(ELEMENTS);

/** Element key for a d20 result (1-20), "" outside the table. */
export function elementForD20(n) {
  const i = Math.trunc(Number(n)) - 1;
  return ELEMENT_ORDER[i] ?? "";
}

const int = (v, d = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; };
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const clampLevel = (n) => Math.max(1, Math.min(TOWER_LEVELS, int(n, 1)));

/** A run that is not active (the stored default). */
export function emptyRun() {
  return {
    active: false, startedAt: "", level: 1, element: "", levelsReached: 0, quakes: 0, quakeIntervalMinutes: 0,
    timeInsideMinutes: 0, timeOnLevelMinutes: 0, outsideOffsetHours: 0, journalId: "", seq: 0, log: []
  };
}

/** Fill gaps and clamp values of a stored run (old or hand-edited setting values). */
export function normalizeRun(raw) {
  const r = { ...emptyRun(), ...(raw && typeof raw === "object" ? raw : {}) };
  r.active = !!r.active;
  r.startedAt = String(r.startedAt ?? "");
  r.level = clampLevel(r.level);
  r.element = ELEMENTS[r.element] ? r.element : "";
  r.levelsReached = Math.max(0, Math.min(TOWER_LEVELS, int(r.levelsReached)));
  r.quakes = Math.max(0, Math.min(MAX_QUAKES, int(r.quakes)));
  r.quakeIntervalMinutes = Math.max(0, int(r.quakeIntervalMinutes));
  r.timeInsideMinutes = Math.max(0, int(r.timeInsideMinutes));
  r.timeOnLevelMinutes = Math.max(0, int(r.timeOnLevelMinutes));
  r.outsideOffsetHours = num(r.outsideOffsetHours);
  r.journalId = String(r.journalId ?? "");
  r.seq = Math.max(0, int(r.seq));
  r.log = Array.isArray(r.log) ? r.log.filter(e => e && typeof e === "object") : [];
  return r;
}

/* ---------- formatting ---------- */

/** Minutes as "Xd Yh Zm"; zero parts are left out, 0 -> "0m". */
export function formatDuration(minutes) {
  let m = Math.max(0, Math.round(Number(minutes) || 0));
  if (!m) return "0m";
  const d = Math.floor(m / 1440); m -= d * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ");
}

/** Hours outside: one per level reached in this run, plus the GM offset. */
export function outsideHours(run) {
  return Math.max(0, int(run?.levelsReached)) + num(run?.outsideOffsetHours);
}

/** Hours as text without trailing zeros ("7", "7.5"). */
export function formatHours(h) {
  const n = Math.round(num(h) * 100) / 100;
  return String(n);
}

/** "3 of 3" pips for the HUD: [{on:true}, {on:true}, {on:false}]. */
export function quakePips(quakes) {
  return Array.from({ length: MAX_QUAKES }, (_, i) => ({ on: i < quakes }));
}

/* ---------- log ---------- */

const snapshot = (r) => ({ element: r.element, quakes: r.quakes, timeInsideMinutes: r.timeInsideMinutes, timeOnLevelMinutes: r.timeOnLevelMinutes });

/**
 * Append the entries of one action as one group. `undoable` actions store the state before the action on the
 * group's first entry, so "Undo last" can restore it. Time stamp ts = minutes inside the tower at that moment.
 * @param {object} before   run before the action (source of the undo snapshot and of nothing else)
 * @param {object} after    run after the action (receives the entries)
 * @param {{type:string, text:string, level?:number}[]} entries   level: stamp of the entry (default: level after the action)
 */
export function withLog(before, after, entries, { undoable = false } = {}) {
  const seq = after.seq + 1;
  const list = entries.map((e, i) => ({
    g: seq, ts: after.timeInsideMinutes, level: e.level ?? after.level, type: e.type, text: e.text,
    ...(i === 0 && undoable ? { prev: snapshot(before) } : {})
  }));
  const log = [...after.log, ...list];
  return { ...after, seq, log: log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log };
}

/** Entries of the last group. */
export function lastGroup(run) {
  const last = run?.log?.at(-1);
  return last ? run.log.filter(e => e.g === last.g) : [];
}

/** The last group can be undone (time, quake, element) - never a level change, collapse landing or start. */
export function canUndo(run) {
  return !!(run?.active && lastGroup(run)[0]?.prev);
}

/** Restore the state before the last group and drop its entries. Returns {run, removed} (removed = [] if not possible). */
export function undoLast(run) {
  if (!canUndo(run)) return { run, removed: [] };
  const removed = lastGroup(run);
  const g = removed[0].g;
  return { run: { ...run, ...removed[0].prev, log: run.log.filter(e => e.g !== g) }, removed };
}

/* ---------- actions ---------- */

/** Start a run on `level` (1 by default): times 0, quakes 0, log empty. */
export function startRun({ level = 1, startedAt = "", journalId = "", quakeIntervalMinutes = 0 } = {}) {
  const lv = clampLevel(level);
  return { ...emptyRun(), active: true, startedAt: String(startedAt), level: lv, levelsReached: lv, journalId: String(journalId), quakeIntervalMinutes: Math.max(0, int(quakeIntervalMinutes)) };
}

/** Change the level: quakes 0, time on level 0, element unknown, levelsReached = max. Same level -> unchanged. */
export function setLevel(run, level) {
  const lv = clampLevel(level);
  if (lv === run.level) return run;
  return { ...run, level: lv, quakes: 0, timeOnLevelMinutes: 0, element: "", levelsReached: Math.max(run.levelsReached, lv) };
}

/** Set (or clear with "") the element of the current level. */
export function setElement(run, element) {
  return { ...run, element: ELEMENTS[element] ? element : "" };
}

/** One quake more (capped at 3). */
export function addQuake(run) {
  return { ...run, quakes: Math.min(MAX_QUAKES, run.quakes + 1) };
}

/**
 * Quakes caused by booking time: one per multiple of the interval that timeOnLevel reaches or passes,
 * capped by the quakes left until 3. Interval 0 = manual, no quakes.
 */
export function quakesFromTime(oldMinutes, newMinutes, interval, quakes = 0) {
  const i = int(interval);
  if (i <= 0) return 0;
  const crossed = Math.floor(int(newMinutes) / i) - Math.floor(int(oldMinutes) / i);
  return Math.max(0, Math.min(crossed, MAX_QUAKES - int(quakes)));
}

/**
 * Book minutes on the current level (and on the run). Returns the new run and the quake numbers that the
 * interval caused, e.g. [2, 3] for two quakes from quake 1.
 */
export function bookTime(run, minutes) {
  const m = Math.max(0, int(minutes));
  if (!m) return { run, quakes: [] };
  const n = quakesFromTime(run.timeOnLevelMinutes, run.timeOnLevelMinutes + m, run.quakeIntervalMinutes, run.quakes);
  const quakes = Array.from({ length: n }, (_, i) => run.quakes + i + 1);
  return {
    run: { ...run, timeOnLevelMinutes: run.timeOnLevelMinutes + m, timeInsideMinutes: run.timeInsideMinutes + m, quakes: run.quakes + n },
    quakes
  };
}

/** The level has collapsed (third quake). */
export const collapsed = (run) => run.quakes >= MAX_QUAKES;

/** Summary of a run for chat and journal. */
export function summary(run) {
  return {
    levelsReached: run.levelsReached,
    inside: formatDuration(run.timeInsideMinutes),
    outsideHours: formatHours(outsideHours(run))
  };
}
