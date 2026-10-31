/**
 * Concentration (world setting "Concentration automation", default on).
 *
 * - Casting a spell with "Concentration" ticked gives the caster the status "concentrating" (a marker, no roll
 *   effect) and remembers the spell in flags["ap-turm"].concentration. A second concentration spell keeps the
 *   status, replaces the spell and posts one line that the first one ends.
 * - Damage through "Apply to target" on a concentrating actor posts a CON save card for it:
 *   DC = max(10, floor(damage / 2)). A failed save takes the status away ("Concentration broken").
 * - Setting off: the tick is only shown (sheet tag, spell card), nothing is automated.
 * Hooked to chat.mjs through the system hooks "apTurm.spellCast" / "apTurm.damageApplied" (no import cycle).
 */
import { rollCheck, cardActions, socketActions, requestGm, displayNameOf, actorNameHtml } from "./chat.mjs";
import { concentrationDC, concentrationSaveDone, lockConcentrationSave, concentrationResultText } from "./qol.mjs";

const SYSTEM_ID = "ap-turm";
export const CONCENTRATION_SETTING = "concentrationAutomation";
export const CONCENTRATING = "concentrating";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export function registerConcentrationSetting() {
  game.settings.register(SYSTEM_ID, CONCENTRATION_SETTING, {
    name: "Concentration automation",
    hint: "Casting a concentration spell sets \"Concentrating\"; damage then asks for a CON save (DC max(10, half the damage)). Off: the checkbox is only shown.",
    scope: "world", config: true, type: Boolean, default: true
  });
}

const enabled = () => { try { return game.settings.get(SYSTEM_ID, CONCENTRATION_SETTING) !== false; } catch { return true; } };

function speaker(actor) {
  const s = ChatMessage.implementation.getSpeaker({ actor });
  const d = displayNameOf(actor);
  if (d) s.alias = d;
  return s;
}

function line(actor, html) {
  return ChatMessage.implementation.create({
    speaker: speaker(actor), content: `<div class="ap-turm-chat apt-applied apt-conc"><p>${html}</p></div>`,
    flags: { [SYSTEM_ID]: { type: "concentration" } }
  });
}

/** Cast of a concentration spell: set / keep the status, remember the spell, report the one that ends. */
async function onSpellCast(actor, item) {
  if (!enabled() || !item?.system?.concentration || !actor?.isOwner) return;
  const prev = actor.getFlag(SYSTEM_ID, "concentration");
  if (!actor.statuses?.has(CONCENTRATING)) await actor.toggleStatusEffect(CONCENTRATING, { active: true });
  await actor.setFlag(SYSTEM_ID, "concentration", { spell: item.name, itemId: item.id, t: Date.now() });
  if (prev?.spell && actor.statuses?.has(CONCENTRATING)) {
    await line(actor, `${actorNameHtml(actor)} starts concentrating on <b>${esc(item.name)}</b> - concentration on <b>${esc(prev.spell)}</b> ends.`);
  }
}

/** Damage on a concentrating actor: CON save card (DC max(10, damage / 2)). */
async function onDamageApplied(actor, { taken = 0, tokenDoc = null } = {}) {
  if (!enabled() || !(taken > 0) || !actor?.statuses?.has(CONCENTRATING)) return;
  const dc = concentrationDC(taken);
  const spell = actor.getFlag(SYSTEM_ID, "concentration")?.spell ?? "";
  const f = { type: "concentrationSave", actorUuid: actor.uuid, dc, spell, taken, whoHtml: actorNameHtml(actor, tokenDoc) };
  return ChatMessage.implementation.create({ speaker: speaker(actor), content: cardHtml(f), flags: { [SYSTEM_ID]: f } });
}

/** The save card: the button until the first roll, then the result in its place. */
function cardHtml(f) {
  const action = concentrationSaveDone(f)
    ? `<div class="apt-conc-result ${f.result.success === false ? "miss" : f.result.success ? "hit" : ""}">${esc(concentrationResultText(f))}</div>`
    : `<div class="apt-card-actions"><button type="button" data-action="concentrationSave" data-owner-uuid="${esc(f.actorUuid)}"><i class="fa-solid fa-dice-d20"></i> CON save (DC ${f.dc})</button></div>`;
  return `<div class="ap-turm-chat apt-card apt-conc-card">
    <header class="apt-card-h"><i class="fa-solid fa-brain"></i> <b>Concentration</b> <span class="sub">${f.whoHtml ?? ""}</span></header>
    <div class="apt-card-formula">${f.taken} damage · CON save DC ${f.dc}${f.spell ? ` to keep <b>${esc(f.spell)}</b>` : ""}</div>
    ${action}
  </div>`;
}

/** Lock the first result into the card (a client that may update the message: its author or the GM). */
async function writeResult(message, result) {
  const next = lockConcentrationSave(message.flags?.[SYSTEM_ID], result);
  if (!next) return null;
  return message.update({ content: cardHtml(next), [`flags.${SYSTEM_ID}`]: next });
}

/** Button on the save card: roll the CON save against the DC; a failure breaks concentration. */
async function onConcentrationSave(message, target, event) {
  const f = message.flags?.[SYSTEM_ID] ?? {};
  if (concentrationSaveDone(f)) { ui.notifications.info("This concentration save has already been rolled."); return null; }
  const actor = f.actorUuid ? (fromUuidSync(f.actorUuid) ?? await fromUuid(f.actorUuid)) : null;
  if (!actor) { ui.notifications.warn("Actor not found."); return null; }
  if (!actor.isOwner) { ui.notifications.warn(`You do not own ${actor.name}.`); return null; }
  if (target) target.disabled = true;                            // no second roll while this one runs
  const check = await rollCheck(actor, { kind: "save", key: "con" }, { event, dc: f.dc });
  if (!check) { if (target) target.disabled = false; return null; }   // dialog cancelled
  const cf = check.flags?.[SYSTEM_ID] ?? {};
  const result = { total: cf.autoFail ? null : (check.rolls?.[0]?.total ?? null), success: cf.success ?? null, autoFail: cf.autoFail ?? null };
  if (message.canUserModify(game.user, "update")) await writeResult(message, result);
  else requestGm("concentrationResult", { uuid: message.uuid, ...result },
    { warn: "No GM is online - your save is in the chat, but the concentration card was not updated." });
  if (result.success === false) await breakConcentration(actor);
  return check;
}

/** Take the status away and report it. */
export async function breakConcentration(actor) {
  const spell = actor.getFlag(SYSTEM_ID, "concentration")?.spell ?? "";
  if (actor.statuses?.has(CONCENTRATING)) await actor.toggleStatusEffect(CONCENTRATING, { active: false });
  if (actor.getFlag(SYSTEM_ID, "concentration")) await actor.unsetFlag(SYSTEM_ID, "concentration");
  await line(actor, `<b>Concentration broken</b>: ${actorNameHtml(actor)}${spell ? ` loses <b>${esc(spell)}</b>` : ""}.`);
}

export function registerConcentration() {
  cardActions.set("concentrationSave", onConcentrationSave);
  // GM side: lock the result into a card the rolling player may not update (only the actor's owner may ask)
  socketActions.set("concentrationResult", async (data) => {
    const message = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
    const user = game.users.get(data.userId);
    const f = message?.flags?.[SYSTEM_ID];
    if (!message || !user || f?.type !== "concentrationSave") return null;
    const actor = fromUuidSync(f.actorUuid) ?? await fromUuid(f.actorUuid);
    if (!actor?.testUserPermission(user, "OWNER")) return null;
    return writeResult(message, { total: data.total ?? null, success: data.success ?? null, autoFail: data.autoFail ?? null });
  });
  Hooks.on("apTurm.spellCast", (actor, item) => { onSpellCast(actor, item).catch(err => console.error(`${SYSTEM_ID} | concentration`, err)); });
  Hooks.on("apTurm.damageApplied", (actor, data) => { onDamageApplied(actor, data).catch(err => console.error(`${SYSTEM_ID} | concentration`, err)); });
  // the status taken away by hand ends the concentration too (so the next cast does not report a stale spell)
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    const actor = effect.parent;
    if (userId !== game.user.id || actor?.documentName !== "Actor" || !effect.statuses?.has(CONCENTRATING)) return;
    if (actor.getFlag(SYSTEM_ID, "concentration")) actor.unsetFlag(SYSTEM_ID, "concentration").catch(() => {});
  });
}
