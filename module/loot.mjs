/**
 * Loot table importer, pure part (tested in Node): text pasted from Word or Excel, or an uploaded
 * .json / .txt file -> entries with ranges / weights, a roll formula, problems (gaps, overlaps) and
 * the data of a native RollTable.
 *
 * Line formats:
 *   "01–05 <Tab> 50 Goldmünzen"   Excel: range cell + text cell
 *   "3 <Tab> Heiltrank"           Excel: a single number without a range = weight
 *   "01–05 50 Goldmünzen"         range at the start of the text (separators - – − bis :)
 *   "1-5: Heiltrank", "7: Zauberstab", "97+ Artefakt" (open range up to the die maximum)
 *   "• Heiltrank", "- Heiltrank", "1. Heiltrank"   Word list bullets are stripped; no range = weight 1
 * Empty lines and header lines ("d100", "Wurf | Loot", "Roll <Tab> Result") are skipped.
 *
 * JSON files (parseLootJsonText): a Foundry RollTable export, a plain list of strings or of
 * {text, range, weight} objects, or our own {format:"ap-turm-loot", entries:[...]} export.
 */

const BULLET_RE = /^(?:[•\-–—*·▪◦►▸o]|\d{1,3}[.)])\s+/;
const HEADER_WORDS = /^(?:d\d+|w\d+|wurf|roll|w[uü]rfel|loot|ergebnis|result|bereich|range|gewicht|weight|text|eintrag|entry|item|beute|nr\.?|no\.?|#)$/i;
const RANGE_RE = /^(\d{1,4})\s*(?:[-–—−]|bis|to)\s*(\d{1,4})\s*[:.]?\s*(.*)$/i;   // "01-05 text", "1 bis 5: text"
const OPEN_RE = /^(\d{1,4})\s*\+\s*[:.]?\s*(.*)$/;                                 // "97+ text"
const SINGLE_RE = /^(\d{1,4})\s*:\s*(.*)$/;                                          // "7: text" (single value)
const NUMBER_RE = /^\d{1,4}$/;

const clean = (s) => String(s ?? "").replace(/[ \t]+/g, " ").replace(/\s+/g, " ").trim();

/** Header line? ("d100", "Wurf | Loot", "Roll\tResult", "|---|---|") */
export function isHeaderLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (/^\|?\s*:?-{2,}/.test(t) && !/[a-z]/i.test(t)) return true;   // markdown separator
  const cells = t.split(/\t|\s*\|\s*/).map(c => c.trim()).filter(Boolean);
  return cells.length > 0 && cells.every(c => HEADER_WORDS.test(c));
}

/**
 * Parse one line. Returns null for empty / header lines.
 * @returns {{text: string, range: number[]|null, open: boolean, weight: number}|null}
 */
export function parseLootLine(raw) {
  let line = String(raw ?? "").replace(/\r/g, "").trim();
  if (!line || isHeaderLine(line)) return null;
  if (line.startsWith("|")) line = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim()).join("\t");
  line = line.replace(BULLET_RE, "").trim();
  const cells = line.split("\t").map(c => c.trim()).filter(Boolean);
  let first = cells[0] ?? "", rest = cells.slice(1).join(" ");
  let m;
  if (cells.length > 1) {
    // Excel: first cell is a range, an open range, or a weight
    if ((m = RANGE_RE.exec(first)) && !m[3]) return { text: clean(rest), range: [+m[1], +m[2]], open: false, weight: 1 };
    if ((m = OPEN_RE.exec(first)) && !m[2]) return { text: clean(rest), range: [+m[1], +m[1]], open: true, weight: 1 };
    if (NUMBER_RE.test(first)) return { text: clean(rest), range: null, open: false, weight: Math.max(1, +first) };
    line = cells.join(" ");
  }
  if ((m = RANGE_RE.exec(line)) && m[3]) return { text: clean(m[3]), range: [+m[1], +m[2]], open: false, weight: 1 };
  if ((m = OPEN_RE.exec(line)) && m[2]) return { text: clean(m[2]), range: [+m[1], +m[1]], open: true, weight: 1 };
  if ((m = SINGLE_RE.exec(line)) && m[2]) return { text: clean(m[2]), range: [+m[1], +m[1]], open: false, weight: 1 };
  return { text: clean(line), range: null, open: false, weight: 1 };
}

/**
 * Parse pasted text into a table.
 * @param {string} text
 * @returns {{entries: object[], formula: string, max: number, hasRanges: boolean, problems: object[]}}
 *   entries: {text, range:[lo,hi], weight, given:boolean (range came from the text)}
 *   problems: {type: "gap"|"overlap"|"noRange", from, to, index?, text}
 */
export function parseLootTable(text) {
  const lines = String(text ?? "").split("\n");
  const parsed = lines.map(parseLootLine).filter(Boolean);
  const entries = parsed.map(p => ({ text: p.text, range: p.range ? [Math.min(...p.range), Math.max(...p.range)] : null, open: p.open, weight: p.weight, given: !!p.range }));
  return buildLootTable(entries);
}

/**
 * Ranges, roll formula and problems for already normalized entries; shared by the text and the JSON path.
 * @param {object[]} entries   {text, range:[lo,hi]|null, open?:boolean, weight:number, given:boolean}
 * @param {number} [maxHint]   die size stated by the file (1dN); the ranges are checked against it
 * @returns {{entries: object[], formula: string, max: number, hasRanges: boolean, problems: object[]}}
 */
export function buildLootTable(entries, maxHint = 0) {
  const hasRanges = entries.some(e => e.given);
  const problems = [];
  let max;
  if (!hasRanges) {
    // no ranges: consecutive ranges from the weights (all 1 -> 1d<count>)
    let pos = 1;
    for (const e of entries) { e.range = [pos, pos + e.weight - 1]; pos += e.weight; }
    max = Math.max(0, pos - 1);
  } else {
    const given = entries.filter(e => e.given);
    let hi = Math.max(...given.map(e => e.range[1]));
    max = maxHint > 0 ? Math.max(maxHint, hi) : (hi <= 100 ? 100 : hi);
    for (const e of given) if (e.open) e.range = [e.range[0], Math.max(e.range[0], max)];
    // entries without a range are appended after the highest range (weight = width)
    let pos = Math.max(hi, ...given.map(e => e.range[1])) + 1;
    for (const [index, e] of entries.entries()) {
      if (e.given) continue;
      e.range = [pos, pos + e.weight - 1]; pos += e.weight;
      problems.push({ type: "noRange", index, from: e.range[0], to: e.range[1], text: e.text });
    }
    if (pos - 1 > max) max = pos - 1;
    // gaps and overlaps over the sorted ranges
    const sorted = entries.map((e, index) => ({ ...e, index })).sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
    let covered = 0;
    for (const e of sorted) {
      if (e.range[0] > covered + 1) problems.push({ type: "gap", from: covered + 1, to: e.range[0] - 1 });
      if (e.range[0] <= covered && covered > 0) {
        const other = sorted.find(o => o !== e && o.range[1] >= e.range[0] && o.range[0] <= e.range[0]);
        problems.push({ type: "overlap", from: e.range[0], to: Math.min(e.range[1], covered), index: e.index, text: e.text, with: other?.text ?? "" });
      }
      covered = Math.max(covered, e.range[1]);
    }
    if (covered < max) problems.push({ type: "gap", from: covered + 1, to: max });
  }
  for (const e of entries) delete e.open;
  return { entries, formula: max > 0 ? `1d${max}` : "1d1", max, hasRanges, problems };
}

/* ---------- JSON files ---------- */

const LOOT_FORMAT = "ap-turm-loot";

/** Die size of a plain "1dN" / "dN" formula, 0 when it is anything else. */
function formulaMax(formula) {
  const m = /^\s*1?d(\d{1,4})\s*$/i.exec(String(formula ?? ""));
  return m ? Number(m[1]) : 0;
}

/** One row of a JSON file -> normalized entry, or null when it carries no text. */
function jsonEntry(row) {
  if (typeof row === "string" || typeof row === "number") {
    const text = clean(row);
    return text ? { text, range: null, open: false, weight: 1, given: false } : null;
  }
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const text = clean(row.text ?? row.name ?? row.description ?? row.result ?? "");
  if (!text) return null;
  const r = Array.isArray(row.range) ? row.range.map(Number).filter(Number.isFinite) : [];
  const range = r.length >= 2 ? [Math.min(r[0], r[1]), Math.max(r[0], r[1])]
    : r.length === 1 ? [r[0], r[0]] : null;
  const w = Math.floor(Number(row.weight));
  return { text, range, open: false, weight: Number.isFinite(w) && w > 0 ? w : 1, given: !!range };
}

/**
 * Build a table from already parsed JSON. Recognized shapes:
 *  (a) Foundry RollTable export: {name?, formula?, results: [{range, text|name, weight}, ...]}
 *  (b) plain list: ["Healing potion", ...] or [{text, range?: [from, to], weight?}, ...]
 *  (c) our own export: {format: "ap-turm-loot", name?, formula?, entries: [...]}
 * Unknown fields are ignored. Nothing is created when the structure does not fit.
 * @param {*} data
 * @returns {{ok:true, parsed:object, name:string, source:string}|{ok:false, reason:string}}
 */
export function parseLootJson(data) {
  if (data === null || data === undefined) return { ok: false, reason: "The file contains no data." };
  let rows = null, name = "", formula = "", source = "";
  if (Array.isArray(data)) { rows = data; source = "list"; }
  else if (typeof data === "object") {
    name = clean(data.name ?? "");
    formula = String(data.formula ?? "").trim();
    if (Array.isArray(data.results)) { rows = data.results; source = "Foundry RollTable export"; }
    else if (Array.isArray(data.entries)) { rows = data.entries; source = data.format === LOOT_FORMAT ? "AP-Turm export" : "entry list"; }
    else {
      const keys = Object.keys(data).slice(0, 6);
      return { ok: false, reason: `No loot table in this JSON: neither "results" nor "entries" is a list${keys.length ? ` (found ${keys.join(", ")})` : ", the object is empty"}.` };
    }
  } else return { ok: false, reason: `The file contains ${typeof data === "string" ? "plain text" : "no loot table"} (JSON ${typeof data}).` };

  if (!rows.length) return { ok: false, reason: "The list in the file is empty." };
  const entries = rows.map(jsonEntry).filter(Boolean);
  if (!entries.length) return { ok: false, reason: `${rows.length} row${rows.length === 1 ? "" : "s"} found, but none of them carries a text.` };
  const parsed = buildLootTable(entries, formulaMax(formula));
  // an exotic formula from the file ("2d10", "1d4+1") is kept as it is
  if (formula && !formulaMax(formula)) parsed.formula = formula;
  return { ok: true, parsed, name, source, skipped: rows.length - entries.length };
}

/**
 * Text of an uploaded .json file -> table, with a readable cause on failure.
 * @param {string} text
 * @returns {{ok:true, parsed:object, name:string, source:string}|{ok:false, reason:string}}
 */
export function parseLootJsonText(text) {
  const raw = String(text ?? "").replace(/^﻿/, "").trim();
  if (!raw) return { ok: false, reason: "The file is empty." };
  let data;
  try { data = JSON.parse(raw); }
  catch (err) { return { ok: false, reason: `The file is not valid JSON: ${err.message}` }; }
  return parseLootJson(data);
}

/** Export data of a table in our own format (the counterpart parseLootJson reads back). */
export function lootToJson(parsed, name = "Loot") {
  return {
    format: LOOT_FORMAT, v: 1,
    name: String(name || "Loot").trim() || "Loot",
    formula: parsed.formula,
    entries: parsed.entries.map(e => ({ text: e.text, range: [e.range[0], e.range[1]], weight: e.weight }))
  };
}

/** Human line for a problem (preview). */
export function problemLabel(p) {
  const span = p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`;
  if (p.type === "gap") return `Gap: ${span} hits no entry`;
  if (p.type === "overlap") return `Overlap at ${span}: "${p.text}"${p.with ? ` and "${p.with}"` : ""}`;
  if (p.type === "noRange") return `Without a range, appended as ${span}: "${p.text}"`;
  return "";
}

/** Creation data of a native RollTable (results of type "text"). */
export function lootToRollTable(parsed, name = "Loot") {
  return {
    name: String(name || "Loot").trim() || "Loot",
    formula: parsed.formula,
    replacement: true,
    displayRoll: true,
    results: parsed.entries.map(e => ({ type: "text", name: e.text, description: "", weight: e.weight, range: [e.range[0], e.range[1]], drawn: false }))
  };
}
