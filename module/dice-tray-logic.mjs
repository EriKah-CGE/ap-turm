/**
 * Dice tray: pure formula logic (no Foundry globals, tested in Node).
 * State: {counts: {faces: n}, mod: number, adv: "normal"|"advantage"|"disadvantage", reroll: boolean}
 */
export const TRAY_DICE = [4, 6, 8, 10, 12, 20, 100];

/**
 * "Reroll 1s" for hit-die rolls. The app's rollHitDie() rerolls each die until it is not a 1
 * (do { r = 1 + floor(random * d) } while (r === 1)), which is Foundry's recursive reroll "rr1";
 * "r1" would reroll only once.
 */
export const REROLL_MOD = "rr1";

export const ADV_TERM = { advantage: "2d20kh1", disadvantage: "2d20kl1" };

export function emptyTray() {
  return { counts: {}, mod: 0, adv: "normal", reroll: false };
}

/** Left click: one more die of this size. */
export function addDie(state, faces) {
  const counts = { ...state.counts, [faces]: (state.counts[faces] || 0) + 1 };
  return { ...state, counts };
}

/** Right click: one die less (never below 0). */
export function removeDie(state, faces) {
  const n = Math.max(0, (state.counts[faces] || 0) - 1);
  const counts = { ...state.counts };
  if (n) counts[faces] = n; else delete counts[faces];
  return { ...state, counts };
}

/** Advantage / disadvantage toggle: pressing the active mode again switches back to normal. */
export function toggleAdv(state, mode) {
  return { ...state, adv: state.adv === mode ? "normal" : mode };
}

export function toggleReroll(state) {
  return { ...state, reroll: !state.reroll };
}

export function setMod(state, value) {
  const n = Math.trunc(Number(String(value ?? "").replace(/\s+/g, "")) || 0);
  return { ...state, mod: n };
}

function modText(mod) {
  if (!mod) return "";
  return mod > 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;
}

/**
 * Formula from the tray state, dice in fixed order d4 ... d100.
 * Advantage/disadvantage turns each d20 into 2d20kh1 / 2d20kl1; with the toggle on and no d20 clicked,
 * one d20 is implied. "Reroll 1s" adds rr1 to every die term (2d20rr1kh1 for the d20 with advantage).
 * Only a modifier, no dice: the plain number.
 */
export function trayFormula(state) {
  const rr = state.reroll ? REROLL_MOD : "";
  const terms = [];
  for (const faces of TRAY_DICE) {
    let n = state.counts[faces] || 0;
    if (faces === 20 && ADV_TERM[state.adv]) {
      n = Math.max(1, n);
      const keep = state.adv === "advantage" ? "kh1" : "kl1";
      for (let i = 0; i < n; i++) terms.push(`2d20${rr}${keep}`);
      continue;
    }
    if (n) terms.push(`${n}d${faces}${rr}`);
  }
  if (!terms.length) return state.mod ? String(state.mod) : "";
  return terms.join(" + ") + modText(state.mod);
}

/** Shift-click on a die button: exactly this one die, independent of the tray state. */
export function singleDieFormula(faces) {
  return `1d${faces}`;
}

/** "Roll d20" on the sheets: plain d20, Shift = advantage, Ctrl/Alt/Meta = disadvantage. */
export function plainD20Formula(mode) {
  return ADV_TERM[mode] ?? "1d20";
}
