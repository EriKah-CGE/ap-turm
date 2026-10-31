/**
 * Group roll requests (Paket B.1): the GM asks several characters for the same save, ability check
 * or skill check and collects the results on ONE chat card.
 *
 * - The card carries the rows in its flags; every row is either a "Roll" button or the finished result.
 * - Clicking rolls through rollCheck() on the player's own character, so bonuses, conditions and the
 *   modifier keys (click / Shift / Ctrl / right-click) behave exactly like on the sheet. The detail
 *   card of that roll still goes to the chat; the group card only collects total and success.
 * - The row is written with message.update() by the roller; without update rights on the message the
 *   active GM does it over the socket (same pattern as requestGmApply).
 * - Consequences (only with a DC): damage and / or a status on a failed roll. The damage is rolled
 *   once per recipient together with that recipient's check and is applied from the row by hand -
 *   half on success when "half damage on success" is set, full on a failure - through the same path
 *   as the NPC save cards, so resistances and immunities of the target apply.
 */
import { ABILITIES, SKILLS, damageTypeChoices, damageTypeLabel } from "./config.mjs";
import { rollCheck, socketActions, cardActions, requestGm, applyDamageToActor, requestGmApply, toggleCondition } from "./chat.mjs";

const SYSTEM_ID = "ap-turm";
const TPL = "systems/ap-turm/templates/chat/";
const render = (name, data) => foundry.applications.handlebars.renderTemplate(TPL + name + ".hbs", data);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/* ============================================================
   Pure logic
   ============================================================ */

/** The three roll kinds the dialog offers. */
export const ROLL_KINDS = { save: "Saving Throw", ability: "Ability Check", skill: "Skill Check" };

/** Value of the extra status entry that raises exhaustion by one level instead of setting a status. */
export const EXHAUSTION_STEP = "exhaustion+1";

/** Label of a requested roll, e.g. "Dexterity Save" or "Stealth Check". */
export function requestLabel(kind, key) {
  if (kind === "save") return `${ABILITIES[key] ?? key} Save`;
  if (kind === "ability") return `${ABILITIES[key] ?? key} Check`;
  if (kind === "skill") return `${SKILLS[key]?.l ?? key} Check`;
  return "";
}

/** Is this key valid for that kind? (the dialog and the socket handler check it). */
export function validRequest(kind, key) {
  if (kind === "save" || kind === "ability") return key in ABILITIES;
  if (kind === "skill") return key in SKILLS;
  return false;
}

/** One card row per recipient; total/success stay null until that player has rolled. */
export function requestRows(actors) {
  return [...(actors || [])].map(a => ({ actorUuid: a.uuid, name: a.name, total: null, success: null }));
}

/**
 * The damage list follows a mode, and a world runs one campaign: the mode most of its characters use
 * (ties and an empty world go to "turm", the campaign mode).
 * @param {{system?:{mode?:string}}[]} actors
 */
export function worldMode(actors) {
  let ap = 0, turm = 0;
  for (const a of actors ?? []) (a?.system?.mode === "ap" ? ap++ : turm++);
  return ap > turm ? "ap" : "turm";
}

/**
 * Damage one row applies: full on a failure, half (rounded down) on a success when the consequence
 * halves, nothing on a success otherwise. Without a rolled damage there is nothing to apply.
 * @param {{total:number|null, success:boolean|null, half:boolean}} o
 */
export function damageForRow({ total = null, success = null, half = true } = {}) {
  if (total === null || total === undefined) return 0;
  const t = Math.max(0, Math.floor(Number(total) || 0));
  if (!success) return t;
  return half ? Math.floor(t / 2) : 0;
}

/**
 * The consequence in the card's header, e.g. "on failure: 3d6 poison, poisoned".
 * Without a DC there is no failure to react to, so there is no consequence either.
 */
export function consequenceLine({ dc = null, dmg = null, statusLabel = "" } = {}) {
  if (dc === null || dc === undefined) return "";
  const bits = [];
  if (dmg?.formula) bits.push([dmg.formula, damageTypeLabel(dmg.dtype)].filter(Boolean).join(" "));
  if (statusLabel) bits.push(statusLabel);
  return bits.length ? `on failure: ${bits.join(", ")}` : "";
}

/** Row view for the template: finished rows show the result, open ones the button. */
export function rowView(rows, hasDc, dmg = null) {
  return (rows || []).map((r, index) => {
    const auto = !!r.autoFail;
    const rolled = r.total !== null || auto;
    const amount = damageForRow({ total: r.dmgTotal ?? null, success: r.success, half: dmg?.half !== false });
    return {
      ...r, index, rolled, autoFail: r.autoFail ?? null,
      totalText: auto ? "—" : r.total,
      verdict: hasDc && rolled ? (r.success ? "SUCCESS" : "FAILURE") : "",
      amount: r.applied ? 0 : amount,
      applied: !!r.applied
    };
  });
}

/* ============================================================
   Foundry side
   ============================================================ */

/** Card HTML for the current flag state. */
function cardContent(f) {
  return render("request-roll", {
    label: f.label, kindLabel: ROLL_KINDS[f.kind] ?? "", dc: f.dc, hasDc: f.dc !== null,
    consequence: consequenceLine({ dc: f.dc, dmg: f.dmg, statusLabel: f.statusLabel }),
    dtypeLabel: f.dmg ? damageTypeLabel(f.dmg.dtype) : "",
    rows: rowView(f.rows, f.dc !== null, f.dmg)
  });
}

/** All player characters, sorted by name. */
function characters() {
  return game.actors.filter(a => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
}

/** Characters of the currently targeted tokens (the dialog preselects them when there are any). */
function targetedCharacters() {
  const out = [];
  for (const t of game.user.targets) if (t.actor?.type === "character") out.push(t.actor);
  return [...new Set(out)];
}

/** The statuses the dialog offers: everything in CONFIG.statusEffects plus "Exhaustion +1". */
function statusChoices() {
  const list = (CONFIG.statusEffects ?? []).map(e => ({ id: e.id, name: game.i18n.localize(e.name ?? e.id) }));
  list.push({ id: EXHAUSTION_STEP, name: "Exhaustion +1" });
  return list;
}

/** Name of a chosen status (for the card header and the row note). */
export function statusLabelOf(id) {
  if (!id) return "";
  if (id === EXHAUSTION_STEP) return "Exhaustion +1";
  return statusChoices().find(s => s.id === id)?.name ?? id;
}

/**
 * Post the group card.
 * @param {Actor[]} actors
 * @param {object} req  {kind, key, dc, dmg: {formula, dtype, half}|null, status}
 */
export async function postRequest(actors, { kind, key, dc = null, dmg = null, status = "" } = {}) {
  if (!game.user.isGM) { ui.notifications.warn("Only the GM can request rolls."); return null; }
  const list = [...(actors || [])].filter(a => a?.type === "character");
  if (!list.length) { ui.notifications.warn("No character selected."); return null; }
  if (!validRequest(kind, key)) { ui.notifications.warn("Pick what should be rolled."); return null; }
  const theDc = Number.isFinite(Number(dc)) && dc !== null && dc !== "" ? Math.round(Number(dc)) : null;
  // consequences only exist relative to a DC: without one, nothing can fail
  const theDmg = theDc !== null && dmg?.formula ? { formula: String(dmg.formula), dtype: String(dmg.dtype ?? ""), half: dmg.half !== false } : null;
  const theStatus = theDc !== null ? String(status ?? "") : "";
  const f = {
    type: "requestRoll", kind, key, dc: theDc,
    label: requestLabel(kind, key), rows: requestRows(list),
    dmg: theDmg, status: theStatus, statusLabel: statusLabelOf(theStatus), sourceName: game.user.name
  };
  const content = await cardContent(f);
  const message = await ChatMessage.implementation.create({ content, flags: { [SYSTEM_ID]: f } });
  ui.notifications.info(`${f.label} requested from ${list.length} character${list.length === 1 ? "" : "s"}.`);
  return message;
}

/** Write one finished row into the card (runs on a client that may update the message). */
async function writeRow(message, index, data) {
  const f = foundry.utils.duplicate(message.flags?.[SYSTEM_ID] ?? {});
  if (f.type !== "requestRoll" || !f.rows?.[index]) return null;
  const row = f.rows[index];
  if (data.applied) {
    if (row.applied) return null;
    f.rows[index] = { ...row, applied: true };
  } else {
    if (row.total !== null || row.autoFail) return null;          // already rolled: first result stands
    f.rows[index] = {
      ...row, total: data.total ?? null, success: data.success ?? null, autoFail: data.autoFail ?? null,
      dmgTotal: data.dmgTotal ?? null, status: data.status ?? null
    };
  }
  const content = await cardContent(f);
  return message.update({ content, flags: { [SYSTEM_ID]: f } });
}

/** Resolve an actor uuid (sync where possible). */
async function actorOf(uuid) {
  const doc = fromUuidSync(uuid) ?? await fromUuid(uuid);
  return doc?.documentName === "Actor" ? doc : null;
}

/** The token document of an actor, if it has one on the canvas (only used for the damage log). */
function tokenOf(actor) {
  return actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
}

/**
 * Set the consequence status on the actor of this row. The roller owns that actor, so it writes it
 * itself; only if that is refused does the active GM do it over the socket. Rolls never take a status
 * away - this is the one place in the roll path that touches conditions, and only on a failure.
 */
async function applyRowStatus(message, index, actor, statusId) {
  if (!statusId) return null;
  try {
    if (actor.isOwner) {
      if (statusId === EXHAUSTION_STEP) return await toggleCondition(actor, "exhaustion", { delta: 1 });
      return await toggleCondition(actor, statusId, { active: true });
    }
  } catch (err) {
    console.error(`${SYSTEM_ID} | request roll status`, err);
  }
  requestGm("requestRollStatus", { uuid: message.uuid, index, status: statusId },
    { warn: "No GM is online - the status from the failed roll was not set." });
  return null;
}

/** "Roll" on a group card: rolls for that row's character and puts the result into the card. */
async function rollRequested(message, target, event) {
  const f = message.flags?.[SYSTEM_ID] ?? {};
  const index = Number(target.dataset.index);
  const row = f.rows?.[index];
  if (!row) return null;
  if (row.total !== null || row.autoFail) { ui.notifications.info(`${row.name} has already rolled.`); return null; }
  const actor = await actorOf(row.actorUuid);
  if (!actor) { ui.notifications.warn(`${row.name} no longer exists.`); return null; }
  if (!actor.isOwner) { ui.notifications.warn(`You do not own ${actor.name}.`); return null; }
  // the consequence damage is rolled once for this recipient, before the check, and rides along on
  // its card so Dice So Nice shows it; how much of it lands is decided by the check's result
  let dmgRoll = null, consequence = "";
  if (f.dmg?.formula) {
    try { dmgRoll = await new Roll(f.dmg.formula).evaluate(); }
    catch (err) { console.error(`${SYSTEM_ID} | consequence damage`, err); ui.notifications.warn(`Damage formula "${f.dmg.formula}" could not be rolled.`); }
    if (dmgRoll) {
      const label = damageTypeLabel(f.dmg.dtype);
      const half = f.dmg.half !== false;
      // neutral wording: the card names the rolled damage, the row decides how much of it lands
      consequence = `Consequence damage: ${dmgRoll.total} ${label} on a failure, ${half ? `${Math.floor(dmgRoll.total / 2)} ${label}` : "none"} on a success - apply it from the request card.`;
    }
  }
  const card = await rollCheck(actor, { kind: f.kind, key: f.key },
    { event, dc: f.dc, extraRolls: dmgRoll ? [dmgRoll] : [], consequence });
  if (!card) return null;                                        // dialog cancelled
  const cf = card.flags?.[SYSTEM_ID] ?? {};
  const total = cf.autoFail ? null : (card.rolls?.[0]?.total ?? null);
  const success = cf.success ?? null;
  if (total === null && !cf.autoFail) return null;
  const data = { total, success, autoFail: cf.autoFail ?? null, dmgTotal: dmgRoll?.total ?? null, status: null };
  if (success === false && f.status) {
    await applyRowStatus(message, index, actor, f.status);
    data.status = f.statusLabel || statusLabelOf(f.status);
  }
  if (message.canUserModify(game.user, "update")) return writeRow(message, index, data);
  requestGm("requestRollRow", { uuid: message.uuid, index, ...data },
    { warn: "No GM is online - your roll is in the chat, but the group card was not updated." });
  return card;
}

/** "Apply" on a finished row: the row's damage onto that row's own character (resistances included). */
async function applyRequestDamage(message, target, event) {
  const f = message.flags?.[SYSTEM_ID] ?? {};
  const index = Number(target.dataset.index);
  const row = f.rows?.[index];
  if (!row || row.applied || !f.dmg) return null;
  const amount = damageForRow({ total: row.dmgTotal ?? null, success: row.success, half: f.dmg.half !== false });
  if (!amount) return null;
  const actor = await actorOf(row.actorUuid);
  if (!actor) { ui.notifications.warn(`${row.name} no longer exists.`); return null; }
  const tokenDoc = tokenOf(actor);
  const source = f.sourceName || "The GM";
  if (actor.isOwner) await applyDamageToActor(actor, { total: amount, dtype: f.dmg.dtype, actorName: source, name: tokenDoc?.name ?? actor.name, tokenDoc });
  else if (!requestGmApply({ uuid: tokenDoc?.uuid ?? actor.uuid, name: actor.name, total: amount, dtype: f.dmg.dtype, actorName: source })) return null;
  if (message.canUserModify(game.user, "update")) return writeRow(message, index, { applied: true });
  requestGm("requestRollApplied", { uuid: message.uuid, index },
    { warn: "No GM is online - the damage was applied, but the group card still offers the button." });
  return null;
}

/* ---------- dialog ---------- */

/** GM dialog "Request Roll"; resolves with the posted card or null. */
export async function requestRollDialog() {
  if (!game.user.isGM) { ui.notifications.warn("Only the GM can request rolls."); return null; }
  const chars = characters();
  if (!chars.length) { ui.notifications.warn("No characters in this world."); return null; }
  const preset = new Set(targetedCharacters().map(a => a.id));
  const checked = (a) => (preset.size ? preset.has(a.id) : true);
  const opts = (obj, label) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}">${esc(label(v))}</option>`).join("");
  const types = damageTypeChoices(worldMode(chars));
  const content = `
    <div class="apt-request-dialog">
      <div class="form-group"><label>Roll</label><div class="form-fields">
        <select name="kind">${Object.entries(ROLL_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      </div></div>
      <div class="form-group" data-for="ability"><label>Ability</label><div class="form-fields">
        <select name="ability">${opts(ABILITIES, v => v)}</select>
      </div></div>
      <div class="form-group" data-for="skill" hidden><label>Skill</label><div class="form-fields">
        <select name="skill">${opts(SKILLS, v => v.l)}</select>
      </div></div>
      <div class="form-group"><label>DC</label><div class="form-fields">
        <input type="number" name="dc" value="" placeholder="— (no DC)" step="1">
      </div></div>
      <fieldset class="apt-consequence" data-for="consequence" hidden>
        <legend>On failure</legend>
        <div class="form-group"><label>Damage</label><div class="form-fields">
          <input type="text" name="dmgFormula" placeholder="e.g. 3d6">
          <select name="dmgType">${opts(types, v => v)}</select>
        </div></div>
        <div class="form-group"><label>Half on success</label><div class="form-fields">
          <label class="apt-check"><input type="checkbox" name="dmgHalf" checked> <small>half damage on a successful roll</small></label>
        </div></div>
        <div class="form-group"><label>Status</label><div class="form-fields">
          <select name="status"><option value="">— none —</option>${statusChoices().map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select>
        </div></div>
      </fieldset>
      <div class="form-group stacked"><label>Recipients</label>
        <div class="apt-award-list">${chars.map(a => `
          <label class="apt-award-row"><input type="checkbox" name="actor" value="${a.id}" ${checked(a) ? "checked" : ""}>
            <span class="nm">${esc(a.name)}</span></label>`).join("")}</div>
      </div>
      ${preset.size ? `<p class="hint">Preselected from the ${preset.size} targeted token${preset.size === 1 ? "" : "s"}.</p>` : ""}
    </div>`;
  return foundry.applications.api.DialogV2.wait({
    window: { title: "Request Roll", icon: "fa-solid fa-dice-d20" },
    position: { width: 480 },
    content, rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const kind = root.querySelector("select[name=kind]");
      const dc = root.querySelector("input[name=dc]");
      const sync = () => {
        const skill = kind.value === "skill";
        root.querySelector('[data-for="ability"]').hidden = skill;
        root.querySelector('[data-for="skill"]').hidden = !skill;
        // consequences need something to fail against
        root.querySelector('[data-for="consequence"]').hidden = dc.value.trim() === "";
      };
      kind.addEventListener("change", sync);
      dc.addEventListener("input", sync);
      sync();
    },
    buttons: [
      {
        action: "request", label: "Request", icon: "fa-solid fa-dice-d20", default: true,
        callback: async (event, button) => {
          const form = button.form;
          const kind = form.querySelector("select[name=kind]").value;
          const key = kind === "skill" ? form.querySelector("select[name=skill]").value : form.querySelector("select[name=ability]").value;
          const dcRaw = form.querySelector("input[name=dc]").value.trim();
          const formula = form.querySelector("input[name=dmgFormula]").value.trim();
          if (formula && !Roll.validate(formula)) { ui.notifications.warn(`"${formula}" is not a valid damage formula.`); return null; }
          const ids = [...form.querySelectorAll('input[name="actor"]:checked')].map(i => i.value);
          return postRequest(ids.map(id => game.actors.get(id)).filter(Boolean), {
            kind, key, dc: dcRaw === "" ? null : Number(dcRaw),
            dmg: formula ? { formula, dtype: form.querySelector("select[name=dmgType]").value, half: form.querySelector("input[name=dmgHalf]").checked } : null,
            status: form.querySelector("select[name=status]").value
          });
        }
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ]
  }).then(r => (r && typeof r === "object" && r.documentName === "ChatMessage" ? r : null));
}

/* ---------- registration ---------- */

/** The row's own actor, but only when the requesting user owns it (checked on the GM side). */
async function ownedRowActor(f, index, user) {
  const row = f?.rows?.[index];
  if (!row) return null;
  const actor = await actorOf(row.actorUuid);
  return actor?.testUserPermission(user, "OWNER") ? actor : null;
}

export function registerRequestRoll() {
  cardActions.set("rollRequested", rollRequested);
  cardActions.set("applyRequestDamage", applyRequestDamage);
  // GM side: fill a row for a player who may not update the message himself
  socketActions.set("requestRollRow", async (data) => {
    const message = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
    const user = game.users.get(data.userId);
    const f = message?.flags?.[SYSTEM_ID];
    if (!message || !user || f?.type !== "requestRoll") return null;
    if (!(await ownedRowActor(f, data.index, user))) return null;   // only that row's owner may fill it
    return writeRow(message, data.index, {
      total: data.total ?? null, success: data.success ?? null, autoFail: data.autoFail ?? null,
      dmgTotal: data.dmgTotal ?? null, status: data.status ?? null
    });
  });
  // GM side: mark a row as applied for a player who may not update the message himself
  socketActions.set("requestRollApplied", async (data) => {
    const message = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
    const user = game.users.get(data.userId);
    const f = message?.flags?.[SYSTEM_ID];
    if (!message || !user || f?.type !== "requestRoll") return null;
    if (!(await ownedRowActor(f, data.index, user))) return null;
    return writeRow(message, data.index, { applied: true });
  });
  // GM side: set the consequence status of a failed row (only the status the card itself carries)
  socketActions.set("requestRollStatus", async (data) => {
    const message = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
    const user = game.users.get(data.userId);
    const f = message?.flags?.[SYSTEM_ID];
    if (!message || !user || f?.type !== "requestRoll") return null;
    if (!f.status || f.status !== data.status) return null;
    const actor = await ownedRowActor(f, data.index, user);
    if (!actor) return null;
    if (f.status === EXHAUSTION_STEP) return toggleCondition(actor, "exhaustion", { delta: 1 });
    return toggleCondition(actor, f.status, { active: true });
  });
}

export const requestRoll = { requestRollDialog, postRequest, requestLabel, requestRows, rowView, validRequest, damageForRow, consequenceLine, worldMode, ROLL_KINDS };
