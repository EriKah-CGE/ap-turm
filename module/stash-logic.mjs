/**
 * Party stash: the pure part (tested in Node).
 * The stash is its own Actor subtype "stash" - a lean document with a purse and embedded items, owned by every
 * player. Taking an item moves it with the ordinary transfer (create at the character, then remove / reduce at the
 * stash); a stash has no carry limit, and its "found in the tower" items count against nobody's personal limit,
 * because the limit only counts the items of a character.
 */
import { CURRENCIES } from "./config.mjs";

export const STASH_TYPE = "stash";
export const STASH_NAME = "Party Stash";
export const STASH_IMG = "icons/svg/chest.svg";

/** Every currency key of both modes (the stash keeps all ten, the sheet shows the ones of its mode). */
export const ALL_CURRENCY_KEYS = [...CURRENCIES.turm, ...CURRENCIES.ap].map(([k]) => k);

/**
 * Taking from a stack in the stash.
 * @param {number} qty   stack size in the stash
 * @param {number} want  how many are taken
 * @returns {{take:number, left:number, whole:boolean}|null}  null when the amount is not usable
 */
export function takePlan(qty, want) {
  const total = Math.max(1, Math.floor(Number(qty) || 1));
  const n = Math.floor(Number(want));
  if (!Number.isFinite(n) || n < 1 || n > total) return null;
  return { take: n, left: total - n, whole: n === total };
}

/**
 * Add a claimed amount to a purse.
 * @param {object} purse    current currency {ku:.., br:.., ...}
 * @param {object} amounts  claimed {key: amount}
 * @returns {object}        update paths {"system.currency.go": 60, ...}
 */
export function currencyUpdate(purse, amounts) {
  const out = {};
  for (const [k, v] of Object.entries(amounts || {})) {
    if (!ALL_CURRENCY_KEYS.includes(k)) continue;
    out[`system.currency.${k}`] = (Number(purse?.[k]) || 0) + (Number(v) || 0);
  }
  return out;
}

/** Chat line: "Gades takes 2× Heiltrank from the Party Stash." */
export function takeLine(who, itemName, count, stashName = STASH_NAME) {
  return `${who} takes ${count > 1 ? `${count}× ` : ""}${itemName} from the ${stashName}.`;
}

/** Chat line: "Gades puts 2× Heiltrank into the Party Stash." */
export function putLine(who, itemName, count, stashName = STASH_NAME) {
  return `${who} puts ${count > 1 ? `${count}× ` : ""}${itemName} into the ${stashName}.`;
}

/** The mode a new stash gets: the mode most characters play in (ties and no characters: "turm"). */
export function stashMode(characterModes) {
  let turm = 0, ap = 0;
  for (const m of characterModes || []) { if (m === "ap") ap++; else turm++; }
  return ap > turm ? "ap" : "turm";
}
