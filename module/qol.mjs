/**
 * QoL package, pure part (tested in Node): undo of an applied hit, NPC display names, the AP history log,
 * the concentration DC, who gets a turn notice and how much a token tooltip shows.
 */

/* ---------- undo "Apply to target" ---------- */

/**
 * Can this user undo the applied hit? Only once, only with a stored "before" state, only the GM or the user
 * who applied it.
 * @param {object} f  flags of the "applied" message
 * @param {{userId:string, isGM:boolean}} who
 */
export function canUndo(f, { userId = "", isGM = false } = {}) {
  if (!f || f.undone || !f.before) return false;
  return !!isGM || (!!f.appliedBy && f.appliedBy === userId);
}

/**
 * What an undo writes: HP and temp HP back to the state before the hit, and whether a deleted token has to
 * come back first. null when there is nothing (left) to undo.
 * @param {object} f  flags of the "applied" message
 * @returns {{hp:number, temp:number, restoreToken:boolean}|null}
 */
export function undoPlan(f) {
  if (!f || f.undone || !f.before) return null;
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  return { hp: n(f.before.hp), temp: n(f.before.temp), restoreToken: !!f.tokenBackup };
}

/** The flags after a successful undo: marked, so a second click does nothing. */
export function markUndone(f, { by = "" } = {}) {
  return { ...f, undone: true, undoneBy: by };
}

/* ---------- NPC display names ---------- */

/** The name players see: an NPC's display name when set, otherwise the real (token or actor) name. */
export function publicName({ type = "", name = "", displayName = "" } = {}) {
  const d = String(displayName ?? "").trim();
  return type === "npc" && d ? d : String(name ?? "");
}

/**
 * The name one viewer gets: the GM always the real name, a player the display name of an NPC.
 * @param {object} o  {type, name: real name (token name or actor name), displayName}
 * @param {{isGM:boolean}} viewer
 */
export function nameFor(o, { isGM = false } = {}) {
  return isGM ? String(o?.name ?? "") : publicName(o);
}

/* ---------- AP history ---------- */

export const HISTORY_CAP = 200;

/** Append one entry, keep at most `cap` (the oldest drop out). Never mutates the input. */
export function appendHistory(list, entry, cap = HISTORY_CAP) {
  const out = [...(Array.isArray(list) ? list : []), entry];
  return out.length > cap ? out.slice(out.length - cap) : out;
}

/** AP award (or correction): the amount actually applied, the reason and who gave it. */
export function awardHistoryEntry({ amount = 0, reason = "", by = "", t = Date.now() } = {}) {
  return { t, kind: "award", amount: Math.round(Number(amount) || 0), reason: String(reason ?? ""), by: String(by ?? "") };
}

/** Shop purchase: entry, the rank it reached, what it cost (and the pick for selector entries). */
export function buyHistoryEntry({ id = "", name = "", rank = 1, cost = 0, choice = "", t = Date.now() } = {}) {
  return { t, kind: "buy", id, entry: String(name || id), rank: Number(rank) || 0, cost: Number(cost) || 0, choice: String(choice ?? "") };
}

/** Shop sale: entry, the rank that was sold, the AP that came back (incl. entries that lost their prerequisite). */
export function sellHistoryEntry({ id = "", name = "", rank = 1, refund = 0, t = Date.now() } = {}) {
  return { t, kind: "sell", id, entry: String(name || id), rank: Number(rank) || 0, cost: -Math.abs(Number(refund) || 0) };
}

/** One display line of a history entry (the sheet adds the date). */
export function historyText(e) {
  if (!e) return "";
  if (e.kind === "award") {
    const sign = e.amount > 0 ? "+" : "";
    return `${sign}${e.amount} AP${e.reason ? ` · ${e.reason}` : ""}${e.by ? ` · by ${e.by}` : ""}`;
  }
  if (e.kind === "buy") return `Bought ${e.entry} (rank ${e.rank})${e.choice ? ` · ${e.choice}` : ""} · ${e.cost} AP`;
  if (e.kind === "sell") return `Sold ${e.entry} (rank ${e.rank}) · +${Math.abs(e.cost)} AP back`;
  return "";
}

/* ---------- concentration ---------- */

/** DC of the concentration save after taking `damage`: max(10, half the damage rounded down). */
export function concentrationDC(damage) {
  return Math.max(10, Math.floor(Math.max(0, Number(damage) || 0) / 2));
}

/* ---------- turn notice ---------- */

/**
 * What one client shows on a turn change: the banner for the owner of the active token, a small heads-up for
 * the owner of the next one. The GM gets neither.
 */
export function turnNotice({ isGM = false, ownsCurrent = false, ownsNext = false } = {}) {
  if (isGM) return { banner: false, next: false };
  return { banner: !!ownsCurrent, next: !!ownsNext && !ownsCurrent };
}

/**
 * The combatant after `turn` in turn order, skipping defeated ones (wraps into the next round).
 * @param {{defeated?:boolean}[]} turns
 * @param {number} turn
 */
export function nextTurnIndex(turns, turn) {
  const n = turns?.length ?? 0;
  if (!n) return null;
  for (let step = 1; step <= n; step++) {
    const i = (Number(turn) + step) % n;
    if (!turns[i]?.defeated) return i === Number(turn) ? null : i;
  }
  return null;
}

/* ---------- token tooltip ---------- */

/** "full" (values) for the GM and for tokens the user may observe, "limited" (name + condition icons) otherwise. */
export function tooltipLevel({ isGM = false, canObserve = false } = {}) {
  return isGM || canObserve ? "full" : "limited";
}

/* ---------- concentration save card: one roll only ---------- */

/** Has the save on this card been rolled already? */
export function concentrationSaveDone(f) {
  return !!f?.result;
}

/**
 * The card flags with the first result locked in, or null when a result is already there (the first roll
 * stands, a second click or a late socket request changes nothing).
 * @param {object} f  flags of the concentration save card
 * @param {{total:number|null, success:boolean|null, autoFail?:string|null}} r
 */
export function lockConcentrationSave(f, { total = null, success = null, autoFail = null } = {}) {
  if (!f || concentrationSaveDone(f)) return null;
  return { ...f, result: { total: total === null ? null : Number(total), success: success === null ? null : !!success, autoFail: autoFail || null } };
}

/** Result line that replaces the button. */
export function concentrationResultText(f) {
  const r = f?.result;
  if (!r) return "";
  const roll = r.autoFail ? `automatic failure (${r.autoFail})` : `CON save ${r.total ?? "—"} vs. DC ${f.dc}`;
  if (r.success === true) return `${roll}: SUCCESS - concentration holds`;
  if (r.success === false) return `${roll}: FAILURE - concentration broken`;
  return roll;
}
