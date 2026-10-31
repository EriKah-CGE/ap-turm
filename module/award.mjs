/**
 * GM tools: awarding AP and Turmwissen (Paket A).
 *
 * - awardEffects() / progressionAt() are pure (no Foundry), so the consequence list is tested in Node
 *   against the app's derived() (test/rules.test.mjs).
 * - The dialogs are GM only. They only write `system.ap.earned` resp. append to `system.turmwissen`;
 *   milestone choice and hit-die rolls stay with the player on their own sheet (the sheet marks a level
 *   whose hit die has not been rolled yet).
 * - Entry points: buttons in the Actors sidebar header (ap-turm.mjs) and the system macros (macros.mjs).
 */
import { appendHistory, awardHistoryEntry } from "./qol.mjs";

const SYSTEM_ID = "ap-turm";
const TPL = "systems/ap-turm/templates/chat/";
const render = (name, data) => foundry.applications.handlebars.renderTemplate(TPL + name + ".hbs", data);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/* ============================================================
   Pure logic
   ============================================================ */

/** The four AP thresholds of derived(): level per 10, PB and milestone per 75, cantrip tier per 100. */
export function progressionAt(earned) {
  const e = Math.max(0, Math.round(Number(earned) || 0));
  return {
    earned: e,
    level: Math.max(1, Math.floor(e / 10) + 1),
    pb: 2 + Math.floor(e / 75),
    milestones: Math.floor(e / 75),
    cantripTier: 1 + Math.floor(e / 100)
  };
}

/**
 * Consequences of adding `delta` AP to `earnedBefore`. Negative deltas are corrections; earned AP never
 * drops below 0 (schema minimum), so `applied` can be smaller in magnitude than `delta`.
 * @returns {{before:number, after:number, delta:number, applied:number, from:object, to:object,
 *            newLevels:number[], lines:string[]}}
 */
export function awardEffects(earnedBefore, delta) {
  const before = Math.max(0, Math.round(Number(earnedBefore) || 0));
  const d = Math.round(Number(delta) || 0);
  const after = Math.max(0, before + d);
  const from = progressionAt(before), to = progressionAt(after);
  const lines = [];
  if (to.level !== from.level) lines.push(`Level ${from.level} → ${to.level}`);
  if (to.milestones > from.milestones) {
    for (let i = from.milestones + 1; i <= to.milestones; i++) lines.push(`Milestone ${i} available — +2 ability points or a feat`);
  } else if (to.milestones < from.milestones) {
    for (let i = from.milestones; i > to.milestones; i--) lines.push(`Milestone ${i} lost`);
  }
  if (to.pb !== from.pb) lines.push(`Proficiency bonus +${from.pb} → +${to.pb}`);
  if (to.cantripTier !== from.cantripTier) lines.push(`Cantrip tier ${from.cantripTier} → ${to.cantripTier}`);
  const newLevels = [];
  for (let l = from.level + 1; l <= to.level; l++) newLevels.push(l);
  return { before, after, delta: d, applied: after - before, from, to, newLevels, lines };
}

/** Append one rank to a turmwissen list (rank = index + 1, no gaps). Returns a new array. */
export function appendTurmwissen(list, trigger) {
  const prev = (list || []).map(t => ({ trigger: String(t?.trigger ?? "") }));
  return [...prev, { trigger: String(trigger ?? "").trim() }];
}

/** Levels of a character whose hit die has not been rolled yet (app: hpRolls[i] empty for i < level). */
export function pendingHitDieLevels(hpRolls, level) {
  const out = [];
  for (let i = 0; i < level; i++) if (!(Number((hpRolls || [])[i]) > 0)) out.push(i + 1);
  return out;
}

/* ============================================================
   Foundry side
   ============================================================ */

function requireGM(what) {
  if (game.user.isGM) return true;
  ui.notifications.warn(`Only the GM can ${what}.`);
  return false;
}

/** All player characters, sorted by name; `turmOnly` keeps only those in Turm mode. */
export function awardableCharacters({ turmOnly = false } = {}) {
  return game.actors
    .filter(a => a.type === "character" && (!turmOnly || a.system.mode === "turm"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** GM users plus the (non-GM) owners of `actor`, as user ids — the whisper list of a private card. */
function whisperFor(actor) {
  const gms = ChatMessage.implementation.getWhisperRecipients("GM").map(u => u.id);
  const owners = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
  return [...new Set([...gms, ...owners])];
}

/**
 * Add `amount` AP to every actor and post one public card with the consequences.
 * @param {Actor[]} actors
 * @param {number} amount   may be negative (correction)
 * @param {object} [opts]   {reason}
 */
export async function awardAp(actors, amount, { reason = "" } = {}) {
  if (!requireGM("award AP")) return null;
  const list = [...(actors || [])].filter(a => a?.type === "character");
  if (!list.length) { ui.notifications.warn("No character selected."); return null; }
  const n = Math.round(Number(amount) || 0);
  if (!n) { ui.notifications.warn("Enter an AP value other than 0."); return null; }

  const results = [];
  for (const actor of list) {
    const eff = awardEffects(actor.system.ap.earned, n);
    if (eff.applied !== 0) await actor.update({
      "system.ap.earned": eff.after,
      "system.history": appendHistory(actor.system.history, awardHistoryEntry({ amount: eff.applied, reason, by: game.user.name }))
    });
    results.push({ actor, eff });
  }

  const who = list.length === 1 ? list[0].name : "The party";
  const verb = n > 0 ? "gains" : "loses";
  const headline = `${who} ${verb} ${Math.abs(n)} AP${reason ? ` (${reason})` : ""}`;
  const content = await render("award", {
    headline,
    entries: results.map(r => ({
      name: r.actor.name,
      apLabel: `${r.eff.before} → ${r.eff.after} AP`,
      clamped: r.eff.applied !== r.eff.delta,
      lines: r.eff.lines
    }))
  });
  await ChatMessage.implementation.create({
    content,
    flags: { [SYSTEM_ID]: { type: "award", amount: n, reason, actorIds: list.map(a => a.id) } }
  });
  ui.notifications.info(`${n > 0 ? "+" : ""}${n} AP for ${list.length} character${list.length === 1 ? "" : "s"}.`);
  return results;
}

/**
 * Append one Turmwissen rank with `trigger` to every actor and whisper one card per character
 * to the GMs and that character's owners.
 */
export async function awardTurmwissen(actors, trigger) {
  if (!requireGM("grant Turmwissen")) return null;
  const list = [...(actors || [])].filter(a => a?.type === "character");
  if (!list.length) { ui.notifications.warn("No character selected."); return null; }
  const text = String(trigger ?? "").trim();
  if (!text) { ui.notifications.warn("Enter a trigger."); return null; }

  const results = [];
  for (const actor of list) {
    const next = appendTurmwissen(actor.system.turmwissen, text);
    await actor.update({ "system.turmwissen": next });
    const rank = next.length;
    const content = await render("turmwissen", { name: actor.name, rank, trigger: text });
    await ChatMessage.implementation.create({
      content, whisper: whisperFor(actor),
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flags: { [SYSTEM_ID]: { type: "turmwissen", actorUuid: actor.uuid, rank } }
    });
    results.push({ actor, rank });
  }
  ui.notifications.info(`Turmwissen granted to ${list.length} character${list.length === 1 ? "" : "s"}.`);
  return results;
}

/* ---------- dialogs ---------- */

/** Checkbox list of characters (all checked), with their current earned AP / Turmwissen rank. */
function characterList(chars, note) {
  return `<div class="apt-award-list">${chars.map(a => `
    <label class="apt-award-row"><input type="checkbox" name="actor" value="${a.id}" checked>
      <span class="nm">${esc(a.name)}</span><span class="ap">${esc(note(a))}</span></label>`).join("")}</div>`;
}

/** GM dialog "Award AP". Resolves with the award results or null. */
export async function awardApDialog() {
  if (!requireGM("award AP")) return null;
  const chars = awardableCharacters();
  if (!chars.length) { ui.notifications.warn("No characters in this world."); return null; }
  const content = `
    <div class="apt-award-dialog">
      <div class="form-group stacked"><label>Characters</label>${characterList(chars, a => `${a.system.ap.earned} AP`)}</div>
      <div class="form-group"><label>AP</label><div class="form-fields">
        <input type="number" name="amount" value="0" step="1" autofocus></div></div>
      <p class="hint">Negative values correct an earlier award. Earned AP never drop below 0.</p>
      <div class="form-group"><label>Reason</label><div class="form-fields">
        <input type="text" name="reason" value="" placeholder="optional"></div></div>
    </div>`;
  return foundry.applications.api.DialogV2.wait({
    window: { title: "Award AP", icon: "fa-solid fa-star" },
    position: { width: 480 },
    content, rejectClose: false,
    buttons: [
      {
        action: "award", label: "Award", icon: "fa-solid fa-star", default: true,
        callback: async (event, button) => {
          const form = button.form;
          const ids = [...form.querySelectorAll('input[name="actor"]:checked')].map(i => i.value);
          const amount = Math.round(Number(form.querySelector('input[name="amount"]').value) || 0);
          const reason = form.querySelector('input[name="reason"]').value.trim();
          return awardAp(ids.map(id => game.actors.get(id)).filter(Boolean), amount, { reason });
        }
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ]
  }).then(r => (Array.isArray(r) ? r : null));
}

/** GM dialog "Grant Turmwissen" (Turm mode characters only). Resolves with the results or null. */
export async function awardTurmwissenDialog() {
  if (!requireGM("grant Turmwissen")) return null;
  const chars = awardableCharacters({ turmOnly: true });
  if (!chars.length) { ui.notifications.warn("No character in Turm mode."); return null; }
  const content = `
    <div class="apt-award-dialog">
      <div class="form-group stacked"><label>Characters</label>${characterList(chars, a => `Rank ${a.system.turmwissen.length}`)}</div>
      <div class="form-group"><label>Trigger</label><div class="form-fields">
        <input type="text" name="trigger" value="" placeholder="What triggered the knowledge?" autofocus></div></div>
      <p class="hint">Appends one new rank to every selected character. The card is whispered to the GM and the affected players only.</p>
    </div>`;
  return foundry.applications.api.DialogV2.wait({
    window: { title: "Grant Turmwissen", icon: "fa-solid fa-book" },
    position: { width: 480 },
    content, rejectClose: false,
    buttons: [
      {
        action: "award", label: "Grant", icon: "fa-solid fa-book", default: true,
        callback: async (event, button) => {
          const form = button.form;
          const ids = [...form.querySelectorAll('input[name="actor"]:checked')].map(i => i.value);
          const trigger = form.querySelector('input[name="trigger"]').value;
          return awardTurmwissen(ids.map(id => game.actors.get(id)).filter(Boolean), trigger);
        }
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ]
  }).then(r => (Array.isArray(r) ? r : null));
}

export const award = { awardAp, awardTurmwissen, awardApDialog, awardTurmwissenDialog, awardableCharacters, awardEffects, progressionAt, appendTurmwissen, pendingHitDieLevels };
