/**
 * Rolls and chat cards (Foundry side). Formulas come from rolls.mjs / rules.mjs.
 * Cards carry flags["ap-turm"] so their buttons (data-action) can be resolved in renderChatMessageHTML.
 *
 * Modifier keys (dnd5e convention, see rollModeFromEvent): click = normal, Shift = advantage,
 * Ctrl/Alt = disadvantage, right-click = dialog with situational bonus. Every d20 roll carries the
 * exhaustion penalty (derived().exhPen) and is a real Roll object (Dice So Nice).
 */
import { ABILITIES, SKILLS, damageTypeColor } from "./config.mjs";
import { fmtMod } from "./rules.mjs";
import { buildAttack, itemRollPreset, buildDamage, buildNpcAttack, buildNpcDamage, entryAttackData, manualAdvantages, isUnassignedType, damageTotal, damageGroups, typedDamage, critRange, attackOutcome, damageTypeLabel, damageMultiplier,
  characterDefenses, defenseVerdict, applyDamage, adjustHp, ADV_FORMULA, MODE_LABEL, rollModeFromEvent, d20Formula, abilityCheckBonus,
  deathSaveOutcome, hitDieHealFormula, downedStatusId, downedTransition, downedPlan, downedLine, checkSuccess } from "./rolls.mjs";
import { rollModifiers, resolveMode, statusIdsOf, exhaustionLevel, exhaustionId, stepExhaustion, EXHAUSTION_MAX, EXHAUSTION_IDS } from "./conditions.mjs";
import { showHitFeedback, playHitFeedback, HIT_FX_ACTION } from "./hit-feedback.mjs";
import { playAttackFx, playCastFx } from "./fx.mjs";
import { publicName, canUndo, undoPlan, markUndone } from "./qol.mjs";
import { spellDescriptionParts } from "./dnd5e-convert.mjs";

const SYSTEM_ID = "ap-turm";
const TPL = "systems/ap-turm/templates/chat/";
// resolved lazily, so modules that only need the pure helpers of this file load in Node too
const DialogV2 = () => foundry.applications.api.DialogV2;
const render = (name, data) => foundry.applications.handlebars.renderTemplate(TPL + name + ".hbs", data);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/* ---------- NPC display names ----------
 * Cards are one HTML for everyone, so a name that differs for players is written as the display name with the
 * real one in data-apt-real; the GM's client swaps it back when the card renders (registerChatHooks). The
 * speaker alias carries the display name the same way. */

/** An NPC's display name ("" for characters and NPCs without one). */
export const displayNameOf = (actor) => (actor?.type === "npc" ? String(actor.system?.displayName ?? "").trim() : "");
/** Real name: the token's name if there is a token, else the actor's. */
export const realNameOf = (actor, token = null) => String(token?.name || actor?.name || "");
/** What players see. */
export const publicNameOf = (actor, token = null) => publicName({ type: actor?.type, name: realNameOf(actor, token), displayName: displayNameOf(actor) });
/** Name as card HTML: plain when both names agree, otherwise the display name with the real one for the GM. */
export function nameHtml(real, pub = real) {
  return !pub || real === pub ? esc(real) : `<span class="apt-dname" data-apt-real="${esc(real)}">${esc(pub)}</span>`;
}
/** Card HTML name of an actor / token. */
export const actorNameHtml = (actor, token = null) => nameHtml(realNameOf(actor, token), publicNameOf(actor, token));

/** Chat speaker; an NPC with a display name speaks under that name (the GM sees the real one, see the render hook). */
function speakerFor(actor) {
  const speaker = ChatMessage.implementation.getSpeaker({ actor });
  const d = displayNameOf(actor);
  if (d) speaker.alias = d;
  return speaker;
}

/* ---------- targets ---------- */

/** First targeted token of the current user (or null). */
export function currentTarget() {
  const t = game.user.targets.first?.() ?? [...game.user.targets][0];
  return t ?? null;
}

/** AC / save DC / actor of a token (default: the first current target). */
export function targetInfo(token = currentTarget()) {
  if (!token?.actor) return null;
  const a = token.actor;
  return {
    token, actor: a, name: token.name || a.name, pubName: publicNameOf(a, token), nameHtml: actorNameHtml(a, token),
    ac: Number(a.system.ac) || null,
    dc: a.type === "character" ? (a.system.derived?.spellDC ?? null) : (Number(a.system.dc) > 0 ? Number(a.system.dc) : null)
  };
}

/* ---------- dialogs ---------- */

const advOptions = (mode = "normal") => `
  <div class="form-group"><label>Roll</label><div class="form-fields apt-advgroup">
    <label><input type="radio" name="mode" value="advantage" ${mode === "advantage" ? "checked" : ""}> Advantage <small>2d20kh1</small></label>
    <label><input type="radio" name="mode" value="normal" ${mode === "normal" ? "checked" : ""}> Normal <small>1d20</small></label>
    <label><input type="radio" name="mode" value="disadvantage" ${mode === "disadvantage" ? "checked" : ""}> Disadvantage <small>2d20kl1</small></label>
  </div></div>
  <div class="form-group"><label>Situational bonus</label><div class="form-fields"><input type="number" name="situational" value="0" step="1" autofocus></div></div>`;

/** Advantage / situational (+ optional DC) prompt. Returns null when cancelled. */
async function promptD20({ title, mode = "normal", dc = null, withDc = false, hint = "" } = {}) {
  const dcField = withDc ? `<div class="form-group"><label>DC</label><div class="form-fields"><input type="number" name="dc" value="${dc ?? ""}" placeholder="—" step="1"></div></div>` : "";
  const hintRow = hint ? `<p class="hint apt-preset-hint">${esc(hint)}</p>` : "";
  const res = await DialogV2().prompt({
    window: { title }, content: hintRow + advOptions(mode) + dcField, rejectClose: false,
    ok: { label: "Roll", icon: "fa-solid fa-dice-d20", callback: (ev, button) => {
      const f = button.form.elements;
      return { mode: f.mode.value, situational: parseInt(f.situational.value) || 0, dc: withDc && f.dc.value !== "" ? parseInt(f.dc.value) : null };
    } }
  });
  return res ?? null;
}

/**
 * Roll options from a click event: modifier keys pick the mode directly, right-click opens the dialog.
 * Without an event (macro without keys, chat button) the dialog opens. Returns null when cancelled.
 */
export async function d20Options(event, { title, dc = null, withDc = false, preset = null } = {}) {
  const { mode, dialog } = rollModeFromEvent(event ?? { button: 2 });
  // items (adv / dis) preselect the mode; Shift / Ctrl on the click or the dialog choice still decide
  const keyed = !!(event && (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey));
  const base = keyed ? mode : (preset?.mode ?? mode);
  const presetLabel = preset?.label ?? "";
  if (!dialog) return { mode: base, situational: 0, dc, presetLabel: keyed ? "" : presetLabel };
  const res = await promptD20({ title, mode: base, dc, withDc, hint: presetLabel });
  return res ? { ...res, presetLabel: res.mode === preset?.mode ? presetLabel : "" } : null;
}

/* ---------- conditions ---------- */

function actorToken(actor) {
  return actor?.token?.object ?? actor?.getActiveTokens?.(true, false)?.[0] ?? null;
}
function tokenDistance(a, b) {
  try { if (!a || !b || !canvas?.grid) return null; return canvas.grid.measurePath([a.center, b.center]).distance; } catch { return null; }
}
/**
 * Condition modifiers for a roll of this actor. The exhaustion penalty is only handed over for NPCs
 * (characters carry it in derived(), NPCs in system.exhPen), so the pure helper never double-counts.
 *
 * The roller's own conditions (and only those) decide advantage, disadvantage and automatic failure:
 * they are read through statusIdsOf(actor), which returns a frozen copy of that one actor's status
 * ids. The target's list is read separately and is only ever used for attacks. No roll writes here.
 */
function conditionMods(actor, { type, ability = null, targetToken = null }) {
  const me = statusIdsOf(actor);
  const tg = statusIdsOf(targetToken?.actor);
  const distance = targetToken ? tokenDistance(actorToken(actor), targetToken) : null;
  const cm = rollModifiers({ statuses: me, targetStatuses: tg, type, ability, distance, exhaustion: 0 });
  // manual combat modifiers of an NPC (Pack Tactics -> attacks, Magic Resistance -> saves); Ctrl cancels them
  if (actor.type === "npc") cm.adv.push(...manualAdvantages(actor.system.adv, type));
  return cm;
}
/** Card text for condition sources. */
function conditionText(cm) {
  const out = [];
  for (const a of cm.adv) out.push(`advantage: ${a}`);
  for (const d of cm.dis) out.push(`disadvantage: ${d}`);
  if (cm.autoCrit) out.push(`critical hit: ${cm.autoCrit}`);
  out.push(...cm.notes);   // an automatic failure gets its own line on the card, not this one
  return out.join(" · ");
}

/** Evaluate a d20 roll and return the active natural die result. */
function naturalD20(roll) {
  const die = roll.dice.find(d => d.faces === 20);
  const r = die?.results.find(x => x.active) ?? die?.results[0];
  return r?.result ?? null;
}

/**
 * Every d20 of a roll with the mark whether it counts. With advantage / disadvantage both dice are
 * shown on the card, the kept one marked - the card never hides which die was dropped.
 * @returns {{result:number, active:boolean}[]}
 */
export function d20Results(roll) {
  const die = roll?.dice?.find(d => d.faces === 20);
  return (die?.results ?? []).map(r => ({ result: r.result, active: !!r.active }));
}

/* ---------- attack ---------- */

/**
 * Attack roll for a weapon item: modifier keys / dialog, roll, card with hit/miss vs. the target's AC.
 * @param {Actor} actor
 * @param {Item} item              weapon
 * @param {object} [opts]          {event, target: Token (default: first current target), opts: preset roll options}
 */
export async function rollAttack(actor, item, { event = null, target: targetToken = undefined, opts: preset = null } = {}) {
  if (item?.type !== "weapon") return null;
  const S = actor.system.appState, d = actor.system.derived;
  const opts = preset ?? await d20Options(event, { title: `Attack: ${item.name}`, preset: itemRollPreset(d, "attack") });
  if (!opts) return null;
  const target = targetToken === undefined ? targetInfo() : targetInfo(targetToken);
  const cm = conditionMods(actor, { type: "attack", targetToken: target?.token ?? null });
  if (opts.presetLabel) cm.notes.push(opts.presetLabel);
  const mode = resolveMode(opts.mode, cm);
  const atk = buildAttack(item.system, d, { ...opts, mode });
  const roll = await new Roll(atk.formula).evaluate();
  const d20 = naturalD20(roll);
  const range = critRange(S);
  let outcome = attackOutcome({ d20, total: roll.total, ac: target?.ac ?? null, critRange: range });
  if (cm.autoCrit && outcome === "hit") outcome = "crit";
  const crit = outcome === "crit";
  const content = await render("attack", {
    actorName: actor.name, weapon: item.name, formula: atk.formula, total: roll.total, d20, dice: d20Results(roll), critRange: range,
    parts: atk.parts.filter(p => p.value !== undefined).map(p => ({ label: p.label, value: fmtMod(p.value) })),
    mode, modeLabel: MODE_LABEL[mode], conditions: conditionText(cm),
    target: target ? { name: target.name, nameHtml: target.nameHtml, ac: target.ac } : null,
    outcome, crit, hit: outcome === "hit" || crit, miss: outcome === "miss" || outcome === "fumble", fumble: outcome === "fumble",
    dtype: damageTypeLabel(item.system.dtype), itemId: item.id
  });
  const msg = await ChatMessage.implementation.create({
    speaker: speakerFor(actor), rolls: [roll], content,
    flags: { [SYSTEM_ID]: { type: "attack", actorUuid: actor.uuid, itemId: item.id, crit, outcome, mode, targetName: target?.pubName ?? null } }
  });
  playAttackFx({ actor, target: target?.token ?? null, name: item.name, dtype: item.system.dtype, abil: item.system.abil, outcome });
  return msg;
}

/* ---------- NPC attacks (system.entries[index] with to-hit / damage) ---------- */

/** Attack roll for an NPC attack entry: printed bonus + exhaustion, conditions, target AC. */
export async function rollNpcAttack(actor, index, { event = null, target: targetToken = undefined, opts: preset = null } = {}) {
  const atk = entryAttackData(actor.system.entries?.[index]);
  if (!atk) return null;
  const opts = preset ?? await d20Options(event, { title: `Attack: ${atk.name}` });
  if (!opts) return null;
  const target = targetToken === undefined ? targetInfo() : targetInfo(targetToken);
  const cm = conditionMods(actor, { type: "attack", targetToken: target?.token ?? null });
  const mode = resolveMode(opts.mode, cm);
  const built = buildNpcAttack(atk, { mode, situational: opts.situational, exhPen: actor.system.exhPen || 0 });
  const roll = await new Roll(built.formula).evaluate();
  const d20 = naturalD20(roll);
  let outcome = attackOutcome({ d20, total: roll.total, ac: target?.ac ?? null, critRange: 20 });
  if (cm.autoCrit && outcome === "hit") outcome = "crit";
  const crit = outcome === "crit";
  const content = await render("attack", {
    actorName: actor.name, weapon: atk.name, formula: built.formula, total: roll.total, d20, dice: d20Results(roll), critRange: 20,
    parts: built.parts.filter(p => p.value !== undefined).map(p => ({ label: p.label, value: fmtMod(p.value) })),
    mode, modeLabel: MODE_LABEL[mode], conditions: conditionText(cm), range: atk.range,
    target: target ? { name: target.name, nameHtml: target.nameHtml, ac: target.ac } : null,
    outcome, crit, hit: outcome === "hit" || crit, miss: outcome === "miss" || outcome === "fumble", fumble: outcome === "fumble",
    dtype: damageTypeLabel(atk.dtype)
  });
  const msg = await ChatMessage.implementation.create({
    speaker: speakerFor(actor), rolls: [roll], content,
    flags: { [SYSTEM_ID]: { type: "attack", actorUuid: actor.uuid, attackIndex: index, crit, outcome, mode, targetName: target?.pubName ?? null } }
  });
  playAttackFx({ actor, target: target?.token ?? null, name: atk.name, dtype: atk.dtype, range: atk.range, outcome });
  return msg;
}

/** Damage roll for an NPC attack entry. Click = straight roll, right-click / chat button = dialog (crit, extra dice). */
export async function rollNpcDamage(actor, index, { crit = false, event = null, dialog = null } = {}) {
  const atk = entryAttackData(actor.system.entries?.[index]);
  if (!atk?.dice) { ui.notifications.warn("This entry has no damage."); return null; }
  const useDialog = dialog ?? rollModeFromEvent(event ?? { button: 2 }).dialog;
  let opts = { crit, extra: "" };
  if (useDialog) {
    const content = `
      <div class="form-group"><label>Critical hit</label><div class="form-fields"><input type="checkbox" name="crit" ${crit ? "checked" : ""}> <small>dice doubled</small></div></div>
      <div class="form-group"><label>Extra dice</label><div class="form-fields"><input type="text" name="extra" placeholder="e.g. 2d6"></div></div>`;
    opts = await DialogV2().prompt({
      window: { title: `Damage: ${atk.name}` }, content, rejectClose: false,
      ok: { label: "Roll", icon: "fa-solid fa-burst", callback: (ev, button) => ({ crit: !!button.form.elements.crit.checked, extra: button.form.elements.extra.value.trim() }) }
    });
    if (!opts) return null;
  }
  const dmg = buildNpcDamage(atk, opts);
  return postDamageCard(actor, { name: atk.name, dmg, flags: { attackIndex: index } });
}

/* ---------- NPC entries: save requests, use (legendary / recharge / uses), recharge on turn start ---------- */

/**
 * Save request card for an entry with a save DC: rolls the entry's damage once and lists the targeted tokens,
 * each with a "Roll save" button (success = half damage, failure = full damage, applied per target).
 */
export async function requestSave(actor, index) {
  const e = actor.system.entries?.[index];
  if (!e || e.saveDc === null) return null;
  const targets = [...game.user.targets];
  const rolls = [];
  let total = 0, parts = [];
  if (e.damage) {
    const dmg = buildNpcDamage({ name: e.name, dice: e.damage, dtype: e.dmgType });
    for (const p of dmg.parts) { const r = await new Roll(p.formula).evaluate(); p.rolled = r.total; rolls.push(r); }
    total = damageTotal(dmg.parts);
    parts = dmg.parts.map(p => ({ label: p.label, formula: p.formula, sum: p.rolled }));
  }
  const ability = e.saveAbility || "";
  const content = await render("save-request", {
    actorName: actor.name, actorNameHtml: actorNameHtml(actor), name: e.name, dc: e.saveDc, ability: ability.toUpperCase(), abilityLabel: ABILITIES[ability] ?? ability,
    total, hasDamage: !!e.damage, half: Math.floor(total / 2), dtype: damageTypeLabel(e.dmgType), dtypeColor: damageTypeColor(e.dmgType), parts,
    warnings: e.damage ? unassignedWarning(actor, e.dmgType) : [],
    text: e.text, targets: targets.map(t => ({ uuid: t.document.uuid, name: publicNameOf(t.actor, t), nameHtml: actorNameHtml(t.actor, t) }))
  });
  return ChatMessage.implementation.create({
    speaker: speakerFor(actor), rolls, content,
    flags: { [SYSTEM_ID]: { type: "saveRequest", actorUuid: actor.uuid, actorName: actor.name, actorPub: publicNameOf(actor), entryIndex: index, dc: e.saveDc, ability, total, dtype: e.dmgType, hasDamage: !!e.damage } }
  });
}

/** "Roll save" on a save request card: the token's owner rolls the save, the check card shows the damage to apply. */
async function rollRequestedSave(message, tokenUuid, event) {
  const f = message.flags?.[SYSTEM_ID] ?? {};
  const td = tokenUuid ? (fromUuidSync(tokenUuid) ?? await fromUuid(tokenUuid)) : null;
  const actor = td?.actor;
  if (!actor) { ui.notifications.warn("Target token not found."); return null; }
  if (!actor.isOwner) { ui.notifications.warn(`You do not own ${td.name}.`); return null; }
  const apply = f.hasDamage ? { tokenUuid, dtype: f.dtype, full: f.total, half: Math.floor(f.total / 2), sourceName: f.actorName, sourcePub: f.actorPub ?? f.actorName } : null;
  return rollCheck(actor, { kind: "save", key: f.ability }, { event, dc: f.dc, apply, label: publicNameOf(actor, td) });
}

/**
 * Use an entry: pays legendary cost / recharge / uses, then rolls the attack, sends the save request or posts
 * the entry text. Returns false when the entry could not be used.
 */
export async function useEntry(actor, index, { event = null } = {}) {
  const e = actor.system.entries?.[index];
  if (!e) return false;
  if (!(await actor.system.spendEntry(index))) return false;
  if (e.toHit !== null) return rollNpcAttack(actor, index, { event });
  if (e.saveDc !== null) return requestSave(actor, index);
  const content = await render("entry", { actorName: actor.name, actorNameHtml: actorNameHtml(actor), name: e.name, section: e.section, text: e.text, damage: e.damage, dtype: damageTypeLabel(e.dmgType), recharge: e.recharge, uses: e.uses, legendaryCost: e.legendaryCost });
  return ChatMessage.implementation.create({ speaker: speakerFor(actor), content, flags: { [SYSTEM_ID]: { type: "entry", actorUuid: actor.uuid, entryIndex: index } } });
}

/**
 * combatTurnChange: at the start of an NPC's turn the active GM rolls 1d6 for each spent recharge ability
 * (whispered to the GMs) and resets the NPC's legendary actions to their maximum.
 */
export function registerCombatHooks() {
  Hooks.on("combatTurnChange", (combat, previous, current) => {
    if (!game.user.isActiveGM || !current?.combatantId) return;
    if (previous?.combatantId === current.combatantId && previous?.round === current.round) return;
    const actor = combat.combatants.get(current.combatantId)?.actor;
    if (actor?.type !== "npc") return;
    startNpcTurn(actor).catch(err => console.error(`${SYSTEM_ID} | startNpcTurn`, err));
  });
}

/** Start of an NPC's turn: roll its spent recharge abilities, refill its legendary actions. */
export async function startNpcTurn(actor) {
  await actor.system.rollRecharges();
  const leg = actor.system.legendary.actions;
  if (leg.max > 0 && leg.value < leg.max) await actor.system.resetLegendary("actions");
  return true;
}

/** Turm mode: warning line for a damage type that no element has been assigned to (the roll still runs). */
function unassignedWarning(actor, dtype) {
  if (!isUnassignedType(dtype, actor.system.mode)) return [];
  return [`Damage type "${damageTypeLabel(dtype)}" is not assigned: resistances do not apply until a type is set on the NPC sheet.`];
}

/**
 * Defense chips of the targeted token and the verdict per damage type (shown on the damage card). Every type of the
 * roll (weapon, second line, elemental) is checked on its own; `groups` = [{type, amount}].
 */
function targetDefenseView(target, groups) {
  if (!target?.actor) return null;
  const pools = targetPools(target.actor);
  const mode = target.actor.system.mode ?? "ap";
  const verdicts = groups.map(g => ({ g, v: defenseVerdict(g.type, pools.defenses, { mode }) }));
  const chips = (verdicts[0]?.v.chips ?? defenseVerdict("", pools.defenses, { mode }).chips).map(c => ({
    ...c, hit: verdicts.some(x => x.v.chips.find(y => y.kind === c.kind && y.key === c.key)?.hit), color: damageTypeColor(c.key)
  }));
  const typed = typedDamage(groups, pools.defenses, { mode });
  const lines = verdicts.map(({ g, v }, i) => ({
    type: damageTypeLabel(g.type), color: damageTypeColor(g.type), amount: typed.lines[i].amount, taken: typed.lines[i].taken,
    mult: v.mult, label: v.label, reason: v.reason
  }));
  const act = lines.some(l => l.mult !== 1);
  return { name: target.name, nameHtml: target.nameHtml, chips, lines, multi: lines.length > 1, act, taken: typed.taken,
    mult: lines.length === 1 ? lines[0].mult : null, label: lines.length === 1 ? lines[0].label : "", reason: lines.length === 1 ? lines[0].reason : "" };
}

/** Roll every damage part (plus crit dice), render the damage card with the "apply" button. */
async function postDamageCard(actor, { name, dmg, flags = {} }) {
  const partTypes = [...new Set(dmg.parts.map(p => p.type ?? ""))];
  dmg.warnings = [...(dmg.warnings ?? []), ...partTypes.flatMap(t => unassignedWarning(actor, t))];
  const rolls = [];
  for (const p of dmg.parts) {
    const r = await new Roll(p.formula).evaluate();
    p.rolled = r.total; p.rollFormula = r.formula; rolls.push(r);
    if (p.critFormula) { const cr = await new Roll(p.critFormula).evaluate(); p.critRolled = cr.total; rolls.push(cr); }
  }
  const total = damageTotal(dmg.parts);
  const groups = damageGroups(dmg.parts);
  const cardParts = dmg.parts.map(p => ({
    label: p.label, formula: p.formula, rolled: p.rolled,
    critText: p.critFormula ? `+ ${p.critFormula} = ${p.critRolled}` : (p.critFlat ? `+ max ${p.critFlat}` : ""),
    sum: (p.rolled ?? 0) + (p.critRolled ?? 0) + (p.critFlat ?? 0), type: damageTypeLabel(p.type), color: damageTypeColor(p.type)
  }));
  const html = await render("damage", {
    actorName: actor.name, weapon: name, total, parts: cardParts, crit: dmg.crit, critMax: dmg.critMax && dmg.crit,
    // several damage types (second line, elemental): all of them in the header, the type on every row
    dtype: groups.length > 1 ? groups.map(g => damageTypeLabel(g.type)).join(" + ") : damageTypeLabel(dmg.dtype),
    dtypeColor: groups.length > 1 ? "" : damageTypeColor(dmg.dtype), multiType: groups.length > 1, warnings: dmg.warnings,
    target: targetDefenseView(targetInfo(), groups)
  });
  return ChatMessage.implementation.create({
    speaker: speakerFor(actor), rolls, content: html,
    flags: { [SYSTEM_ID]: { type: "damage", actorUuid: actor.uuid, actorName: actor.name, actorPub: publicNameOf(actor), total, dtype: dmg.dtype, groups, crit: dmg.crit, ...flags } }
  });
}

/* ---------- damage ---------- */

/**
 * Damage roll for a weapon item. Click = straight roll (Dueling as chosen, no extra dice);
 * right-click / chat button = dialog (crit, extra dice, Dueling). Rolls per part, card with "apply" button.
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} [opts]  {crit, event, dialog: force the dialog}
 */
export async function rollDamage(actor, item, { crit = false, event = null, dialog = null } = {}) {
  if (item?.type !== "weapon") return null;
  const S = actor.system.appState, d = actor.system.derived;
  const hasDueling = (S.bought.fightStyle || 0) > 0 && (S.choices.fightStyle || []).includes("dueling");
  const hasCritMax = (S.bought.critMax || 0) > 0;
  const useDialog = dialog ?? rollModeFromEvent(event ?? { button: 2 }).dialog;
  let opts = { crit, dueling: null, extra: "" };
  if (useDialog) {
    const content = `
      <div class="form-group"><label>Critical hit</label><div class="form-fields"><input type="checkbox" name="crit" ${crit ? "checked" : ""}> <small>${hasCritMax ? "extra dice maximized (Crit Max Dmg)" : "dice doubled"}</small></div></div>
      ${hasDueling ? `<div class="form-group"><label>Dueling +2</label><div class="form-fields"><input type="checkbox" name="dueling" checked> <small>one-handed weapon, no other weapon</small></div></div>` : ""}
      <div class="form-group"><label>Extra dice</label><div class="form-fields"><input type="text" name="extra" placeholder="e.g. 2d8 (Smite), 3d6 (Sneak Attack)"></div></div>`;
    opts = await DialogV2().prompt({
      window: { title: `Damage: ${item.name}` }, content, rejectClose: false,
      ok: { label: "Roll", icon: "fa-solid fa-burst", callback: (ev, button) => {
        const f = button.form.elements;
        return { crit: !!f.crit.checked, dueling: hasDueling ? !!f.dueling.checked : null, extra: f.extra.value.trim() };
      } }
    });
    if (!opts) return null;
  }
  const dmg = buildDamage(item.system, d, S, opts);
  return postDamageCard(actor, { name: item.name, dmg, flags: { itemId: item.id } });
}

/** HP pools and defenses of a target actor. */
export function targetPools(a) {
  const sys = a.system;
  if (a.type === "character") {
    const max = sys.hp.max ?? 0;
    return { hp: sys.hp.value ?? max, temp: sys.hp.temp || 0, max, defenses: characterDefenses(sys.appState) };
  }
  return { hp: sys.hp.value || 0, temp: sys.hp.temp || 0, max: sys.hp.max || 0,
    defenses: { resistances: sys.resistances ?? [], immunities: sys.immunities ?? [], vulnerabilities: sys.vulnerabilities ?? [] } };
}

/**
 * "Apply to target" from a damage card: temp HP first, then HP; resistance/immunity from the target.
 * With ownership the client applies it itself, otherwise the active GM is asked over the socket
 * (requestGmApply). Without a GM online nothing happens and the player is told why.
 * @param {ChatMessage} message
 * @param {object} [opts]  {token: apply to this token instead of the first current target}
 */
export async function applyDamageFromMessage(message, { token = undefined } = {}) {
  const flags = message.getFlag(SYSTEM_ID, "type") ? message.flags[SYSTEM_ID] : null;
  if (!flags) return;
  let f;
  if (flags.type === "damage") f = { total: flags.total, dtype: flags.dtype, groups: Array.isArray(flags.groups) ? flags.groups : null, actorName: flags.actorName, actorPub: flags.actorPub ?? flags.actorName, crit: !!flags.crit };
  else if (flags.type === "check" && flags.apply) {
    f = { total: flags.apply.amount, dtype: flags.apply.dtype, actorName: flags.apply.sourceName, actorPub: flags.apply.sourcePub ?? flags.apply.sourceName };
    if (token === undefined && flags.apply.tokenUuid) token = fromUuidSync(flags.apply.tokenUuid) ?? await fromUuid(flags.apply.tokenUuid);
  } else return;
  const target = token === undefined ? targetInfo() : targetInfo(token);
  if (!target) { ui.notifications.warn("No target selected. Target a token first."); return; }
  const tokenDoc = target.token?.document ?? (target.token?.documentName === "Token" ? target.token : null);
  if (!target.actor.isOwner) return requestGmApply({ uuid: tokenDoc?.uuid ?? target.actor.uuid, name: target.name, ...f });
  return applyDamageToActor(target.actor, { ...f, name: target.name, tokenDoc });
}

/**
 * Write the damage to an actor and post the result card. Runs on the client that owns the actor
 * (player or, after a socket request, the active GM).
 * @param {Actor} actor
 * @param {object} args  {total, dtype, actorName: source name, name: display name, tokenDoc, requestedBy, crit: bigger hit number}
 */
export async function applyDamageToActor(actor, { total, dtype, groups = null, actorName, actorPub = null, name = null, tokenDoc = null, requestedBy = "", requestedById = "", crit = false } = {}) {
  const who = name || actor.name;
  const whoHtml = nameHtml(who, publicName({ type: actor.type, name: who, displayName: displayNameOf(actor) }));
  const srcHtml = nameHtml(actorName, actorPub ?? actorName);
  const pools = targetPools(actor);
  const mode = actor.system.mode ?? "ap";
  // every damage type on its own (1.3.0): weapon line, second line and elemental dice each meet the defenses separately
  const typeGroups = Array.isArray(groups) && groups.length ? groups : [{ type: dtype, amount: total }];
  const typed = typedDamage(typeGroups, pools.defenses, { mode });
  const mult = typed.lines.length === 1 ? typed.lines[0].mult : 1;
  const res = applyDamage({ hp: pools.hp, temp: pools.temp }, typed.taken, 1);
  await actor.update({ "system.hp.value": res.hp, "system.hp.temp": res.temp });
  showHitFeedback({ tokenDoc, actor, taken: res.taken, fromTemp: res.fromTemp, dtype, mode, crit });
  const tr = await syncDownedStatus(actor, { before: pools.hp, after: res.hp });
  const multNote = (m, t) => isUnassignedType(t, mode) ? " · not assigned, no resistance"
    : m === 0 ? " · immune" : m === 0.5 ? " · resistant, halved" : m === 2 ? " · vulnerable, doubled" : "";
  const label = typed.lines.length === 1 ? damageTypeLabel(typed.lines[0].type)
    : typed.lines.map(l => `${l.taken} ${damageTypeLabel(l.type)}${multNote(l.mult, l.type)}`).join(", ");
  const note = typed.lines.length === 1 ? multNote(mult, typed.lines[0].type) : "";
  const tempNote = res.fromTemp ? ` (${res.fromTemp} Temp-HP)` : "";
  const via = requestedBy ? ` (requested by ${requestedBy})` : "";
  const line = `${srcHtml} hits ${whoHtml}: ${esc(`${res.taken} damage (${label})${note}${tempNote}, ${pools.hp} → ${res.hp} HP${via}`)}`;
  // the message id is fixed up front, so a token removal can store its backup on exactly this line (undo)
  const messageId = foundry.utils.randomID();
  const plan = tr.down ? planDefeatedToken(tokenDoc, actor.type, { messageId }) : null;
  const downed = tr.down ? `<p class="apt-downed">${esc(downedLine("\u0001", actor.type, plan)).replace("\u0001", whoHtml)}</p>` : "";
  const flags = {
    type: "applied", targetUuid: actor.uuid, tokenUuid: tokenDoc?.uuid ?? null, taken: res.taken, downed: tr.down, plan,
    before: { hp: pools.hp, temp: pools.temp }, after: { hp: res.hp, temp: res.temp },
    appliedBy: requestedById || game.user.id, line, downedHtml: downed
  };
  await ChatMessage.implementation.create({
    _id: messageId, speaker: speakerFor(actor), content: appliedContent(line, downed, flags),
    flags: { [SYSTEM_ID]: flags }
  }, { keepId: true });
  Hooks.callAll("apTurm.damageApplied", actor, { taken: res.taken, hpBefore: pools.hp, hpAfter: res.hp, tokenDoc, name: who });
  return res;
}

/** Content of an "applied" line: the text, the downed note and the undo button (or "undone"). */
function appliedContent(line, downed, f) {
  const tail = f.undone ? `<p class="apt-undone"><i class="fa-solid fa-rotate-left"></i> undone</p>`
    : `<div class="apt-card-actions apt-undo-row"><button type="button" data-action="undoDamage" title="Restore HP and temp HP from before this hit"><i class="fa-solid fa-rotate-left"></i> Undo</button></div>`;
  return `<div class="ap-turm-chat apt-applied"><p>${line}</p>${downed}${tail}</div>`;
}

/**
 * Undo an applied hit: HP / temp HP back to the stored "before" state; a token the defeat removed comes back
 * first (with its combatants). The HP change runs the downed sync, which takes the automation status away
 * again. Once only. GM: directly. The applier: directly when they own the target and nothing has to be
 * restored, otherwise through the GM socket.
 */
export async function undoApplied(message) {
  const f = message?.flags?.[SYSTEM_ID];
  if (!canUndo(f, { userId: game.user.id, isGM: game.user.isGM })) { ui.notifications.warn("This hit cannot be undone (already undone, or not yours)."); return false; }
  const plan = undoPlan(f);
  const target = f.targetUuid ? fromUuidSync(f.targetUuid) : null;
  if (!game.user.isGM && (plan.restoreToken || !target?.isOwner || !message.isOwner)) {
    return requestGm("undoDamage", { uuid: message.uuid }, { warn: "No GM is online - the hit cannot be undone right now." });
  }
  return performUndo(message, { by: game.user.name });
}

/** Carry out an undo (GM, or the applier with full rights). */
async function performUndo(message, { by = "" } = {}) {
  const f = message.flags[SYSTEM_ID];
  const plan = undoPlan(f);
  if (!plan) return false;
  // mark first: a second click (or a second GM request) finds it done
  const done = markUndone(f, { by });
  const downed = f.downedHtml ? f.downedHtml.replace('class="apt-downed"', 'class="apt-downed apt-struck"') : "";
  await message.update({ content: appliedContent(f.line ?? "", downed, done), [`flags.${SYSTEM_ID}`]: done });
  if (plan.restoreToken) await restoreDefeatedToken(f);
  const actor = f.targetUuid ? (fromUuidSync(f.targetUuid) ?? await fromUuid(f.targetUuid)) : null;
  if (!actor) { ui.notifications.warn("The target no longer exists - nothing to restore."); return false; }
  await actor.update({ "system.hp.value": plan.hp, "system.hp.temp": plan.temp });
  showHitFeedback({ tokenDoc: f.tokenUuid ? fromUuidSync(f.tokenUuid) : null, actor, healed: Math.max(0, plan.hp - (f.after?.hp ?? plan.hp)), mode: actor.system.mode ?? "ap" });
  return true;
}

/** Recreate a token the defeat removed, from the backup on the applied line, plus its combatants (GM only). */
async function restoreDefeatedToken(f) {
  if (!game.user.isGM) return false;
  const b = f.tokenBackup;
  const scene = game.scenes.get(b?.sceneId);
  if (!scene || !b?.token) { ui.notifications.warn("The removed token's scene is gone - only the HP are restored."); return false; }
  if (!scene.tokens.has(b.token._id)) await scene.createEmbeddedDocuments("Token", [b.token], { keepId: true });
  for (const c of b.combatants ?? []) {
    const combat = game.combats.get(c.combatId);
    if (combat && !combat.combatants.has(c.data._id)) await combat.createEmbeddedDocuments("Combatant", [{ ...c.data, defeated: false }], { keepId: true });
  }
  return true;
}

/**
 * Ask the active GM to apply damage to a token the requesting player does not own.
 * Without an active GM nothing is sent and the player is told so.
 * @param {object} req  {uuid, name, total, dtype, actorName}
 * @returns {boolean}   whether the request went out
 */
export function requestGmApply({ uuid, name, total, dtype, groups = null, actorName, actorPub = null, crit = false }) {
  if (!uuid) { ui.notifications.warn(`${name}: no token found, damage not applied.`); return false; }
  if (!game.users.activeGM) { ui.notifications.warn(`You do not own ${name} and no GM is online. The damage was not applied.`); return false; }
  game.socket.emit(`system.${SYSTEM_ID}`, { action: "applyDamage", uuid, total, dtype, groups, actorName, actorPub, crit: !!crit, userId: game.user.id });
  ui.notifications.info(`You do not own ${name} - the GM applies the damage.`);
  return true;
}

/**
 * Socket side (active GM only): resolve the target of an applyDamage request and apply it.
 * Requests are only carried out for a known user and a plain number of damage.
 * @param {object} data
 */
export async function handleApplyDamageRequest(data) {
  const user = game.users.get(data?.userId);
  const total = Number(data?.total);
  if (!user || !Number.isFinite(total)) return false;
  const doc = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
  const actor = doc?.documentName === "Token" ? doc.actor : (doc?.documentName === "Actor" ? doc : null);
  if (!actor) { ui.notifications.warn(`${user.name} tried to apply damage, but the target no longer exists.`); return false; }
  const tokenDoc = doc?.documentName === "Token" ? doc : null;
  await applyDamageToActor(actor, {
    total, dtype: String(data.dtype ?? ""), actorName: String(data.actorName ?? user.name),
    groups: Array.isArray(data.groups) ? data.groups.filter(g => g && Number.isFinite(Number(g.amount))).map(g => ({ type: String(g.type ?? ""), amount: Number(g.amount) })) : null,
    name: tokenDoc?.name ?? actor.name, tokenDoc, requestedBy: user.name, requestedById: user.id, crit: !!data.crit,
    actorPub: data.actorPub ? String(data.actorPub) : null
  });
  return true;
}

/**
 * Quick HP change (sheet -/+ buttons, token HUD): negative = damage (temp HP first, no resistances),
 * positive = healing up to max. Posts a chat line when `chat` is set.
 * @param {Actor} actor
 * @param {number} delta
 * @param {object} [opts]  {chat: boolean, name: display name (token name), token: TokenDocument (defeated NPC removal)}
 */
export async function applyHpDelta(actor, delta, { chat = false, name = null, token = null } = {}) {
  const n = Math.floor(Number(delta) || 0);
  if (!n) return null;
  if (!actor.isOwner) { ui.notifications.warn(`You do not own ${actor.name}.`); return null; }
  const pools = targetPools(actor);
  const res = adjustHp(pools, n);
  if (res.hp === pools.hp && res.temp === pools.temp) return null;
  await actor.update({ "system.hp.value": res.hp, "system.hp.temp": res.temp });
  showHitFeedback({ tokenDoc: token, actor, taken: res.taken, fromTemp: Math.max(0, pools.temp - res.temp), healed: res.healed, mode: actor.system.mode ?? "ap" });
  const tr = await syncDownedStatus(actor, { before: pools.hp, after: res.hp });
  if (chat) {
    const who = name || actor.name;
    const line = n < 0
      ? `${who}: ${res.taken} damage${res.temp !== pools.temp ? ` (${pools.temp - res.temp} Temp-HP)` : ""}, ${pools.hp} → ${res.hp} HP`
      : `${who}: healed ${res.healed}, ${pools.hp} → ${res.hp} HP`;
    const plan = tr.down ? planDefeatedToken(token, actor.type) : null;
    const downed = tr.down ? `<p class="apt-downed">${esc(downedLine(who, actor.type, plan))}</p>` : "";
    await ChatMessage.implementation.create({
      speaker: speakerFor(actor), content: `<div class="ap-turm-chat apt-applied"><p>${esc(line)}</p>${downed}</div>`,
      flags: { [SYSTEM_ID]: { type: "applied", targetUuid: actor.uuid, taken: res.taken, healed: res.healed, downed: tr.down, plan } }
    });
  }
  return res;
}

/* ---------- defeated NPC tokens: remove from the tracker and the scene ---------- */

export const DEFEATED_SETTING = "defeatedNpcTokens";
const REMOVE_DELAY = 1000;   // ms: the hit stays visible before the token disappears

/** World setting: defeated NPC tokens are removed (default) or only marked as defeated. */
export function registerSettings() {
  game.settings.register(SYSTEM_ID, DEFEATED_SETTING, {
    name: "AP_TURM.Settings.DefeatedTokens.Name", hint: "AP_TURM.Settings.DefeatedTokens.Hint",
    scope: "world", config: true, type: String, default: "remove",
    choices: { remove: "AP_TURM.Settings.DefeatedTokens.Remove", mark: "AP_TURM.Settings.DefeatedTokens.Mark" }
  });
}

/**
 * Decide what happens to a defeated NPC token and schedule it (after REMOVE_DELAY).
 * GM client: removes it directly. Player: asks the active GM via socket. No GM online: stays marked.
 * Characters are never removed (they go unconscious).
 * @param {TokenDocument|null} tokenDoc
 * @param {string} actorType
 * @returns {"remove"|"mark"|"nogm"}
 */
export function planDefeatedToken(tokenDoc, actorType, { messageId = null } = {}) {
  if (!tokenDoc || actorType === "character") return "mark";
  if (game.settings.get(SYSTEM_ID, DEFEATED_SETTING) !== "remove") return "mark";
  const uuid = tokenDoc.uuid;
  if (game.user.isGM) {
    setTimeout(() => removeDefeatedToken(uuid, { messageId }).catch(err => console.error(`${SYSTEM_ID} | removeDefeatedToken`, err)), REMOVE_DELAY);
    return "remove";
  }
  if (game.users.activeGM) {
    setTimeout(() => game.socket.emit(`system.${SYSTEM_ID}`, { action: "removeDefeatedToken", uuid, messageId, userId: game.user.id }), REMOVE_DELAY);
    return "remove";
  }
  return "nogm";
}

/** Remove the token's combatants from every combat and delete the token (GM only). The Actor in the directory stays. */
export async function removeDefeatedToken(uuid, { messageId = null } = {}) {
  if (!game.user.isGM) return false;
  const td = fromUuidSync(uuid) ?? await fromUuid(uuid);
  if (!td || td.documentName !== "Token") return false;
  if (td.actor?.type === "character") return false;
  const hp = td.actor?.system?.hp?.value;
  if (typeof hp === "number" && hp > 0) return false;   // healed in the meantime
  // backup for "Undo" on the applied line: the token as it is now and its combatants
  const combatants = [];
  for (const combat of game.combats) {
    for (const c of combat.combatants) if (c.tokenId === td.id && c.sceneId === td.parent?.id) combatants.push({ combatId: combat.id, data: c.toObject() });
  }
  // the applied line is created right after the removal is scheduled; give it a moment to arrive
  let message = null;
  for (let i = 0; messageId && !message && i < 15; i++) {
    message = game.messages.get(messageId) ?? null;
    if (!message) await new Promise(r => setTimeout(r, 200));
  }
  if (message && !message.flags?.[SYSTEM_ID]?.undone) {
    await message.update({ [`flags.${SYSTEM_ID}.tokenBackup`]: { sceneId: td.parent?.id, token: td.toObject(), combatants } });
  }
  for (const combat of game.combats) {
    const ids = combat.combatants.filter(c => c.tokenId === td.id && c.sceneId === td.parent?.id).map(c => c.id);
    if (ids.length) await combat.deleteEmbeddedDocuments("Combatant", ids);
  }
  await td.delete();
  return true;
}

/**
 * Socket actions other modules add (item transfer, group roll cards): name -> async (data) => any.
 * Every handler runs on the active GM only and has to check for itself that the requesting user
 * was allowed to ask for it (see transfer.mjs / request-roll.mjs).
 */
export const socketActions = new Map();

/**
 * Ask the active GM to run `action` for this user (the pattern of requestGmApply, generalized).
 * @returns {boolean} false when no GM is online; then nothing was sent and the user was told.
 */
export function requestGm(action, data, { warn = "No GM is online - nothing was changed." } = {}) {
  if (!game.users.activeGM) { ui.notifications.warn(warn); return false; }
  game.socket.emit(`system.${SYSTEM_ID}`, { action, userId: game.user.id, ...data });
  return true;
}

/** GM side of an undo a player asked for: only the user who applied the hit may ask. */
async function handleUndoRequest(data) {
  const user = game.users.get(data.userId);
  const message = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
  const f = message?.flags?.[SYSTEM_ID];
  if (!user || !canUndo(f, { userId: user.id, isGM: user.isGM })) return false;
  return performUndo(message, { by: user.name });
}

/** Socket listener (ready): only the active GM executes requests from players. */
export function registerSocket() {
  game.socket.on(`system.${SYSTEM_ID}`, (data) => {
    // hit feedback is a broadcast for every client, not a GM request
    if (data?.action === HIT_FX_ACTION) { playHitFeedback(data); return; }
    if (!data?.action || !data.uuid) return;
    if (!game.user.isGM || game.user !== game.users.activeGM) return;
    if (data.action === "removeDefeatedToken") {
      removeDefeatedToken(data.uuid, { messageId: data.messageId ?? null }).catch(err => console.error(`${SYSTEM_ID} | removeDefeatedToken (socket)`, err));
    } else if (data.action === "undoDamage") {
      handleUndoRequest(data).catch(err => console.error(`${SYSTEM_ID} | undoDamage (socket)`, err));
    } else if (data.action === "applyDamage") {
      handleApplyDamageRequest(data).catch(err => console.error(`${SYSTEM_ID} | applyDamage (socket)`, err));
    } else {
      const handler = socketActions.get(data.action);
      if (handler) Promise.resolve(handler(data)).catch(err => console.error(`${SYSTEM_ID} | ${data.action} (socket)`, err));
    }
  });
}

/* ---------- downed / defeated status ---------- */

/**
 * Flag on an ActiveEffect the HP automation set itself. Only flagged effects are taken away again, so a
 * status the GM set by hand survives every heal. Effects from older worlds carry no flag and therefore
 * count as set by hand.
 */
export const AUTO_STATUS_FLAG = "autoStatus";

/** Is this effect one the HP automation set? */
export const isAutoStatus = (effect) => !!effect?.flags?.[SYSTEM_ID]?.[AUTO_STATUS_FLAG];

/**
 * The document that is live right now. An unlinked token's actor is rebuilt whenever its delta is
 * written, so a reference captured before an update can carry a stale effect list - and a stale list
 * is what turns two syncs in a row into two identical status effects.
 */
const liveActor = (actor) => (actor?.uuid ? (fromUuidSync(actor.uuid) ?? actor) : actor);

/** Set a status as an automation effect (flagged, overlay), unless the actor already carries it. */
async function setAutoStatus(ref, id) {
  const actor = liveActor(ref);
  if (actor.statuses?.has(id)) return null;
  const cls = CONFIG.ActiveEffect.documentClass;
  const effect = await cls.fromStatusEffect(id);
  effect.updateSource({ "flags.core.overlay": true, [`flags.${SYSTEM_ID}.${AUTO_STATUS_FLAG}`]: true });
  return cls.implementation.create(effect, { parent: actor, keepId: true });
}

/**
 * Never leave more than one automation effect of the same status on an actor. An unlinked token writes
 * its effects into the token's delta, and a create issued right after a hit point change can end up
 * recorded twice there; the second copy is removed here. A status the GM set by hand is never touched.
 */
async function dedupeAutoStatus(ref, id) {
  const actor = liveActor(ref);
  const extra = actor.effects.filter(e => e.statuses?.has(id) && isAutoStatus(e)).slice(1).map(e => e.id);
  if (!extra.length) return null;
  return actor.deleteEmbeddedDocuments("ActiveEffect", extra);
}

/** Take a status away again, but only the effects the automation set itself. */
async function clearAutoStatus(ref, id) {
  const actor = liveActor(ref);
  const ids = actor.effects.filter(e => e.statuses?.has(id) && isAutoStatus(e)).map(e => e.id);
  if (!ids.length) return null;
  return actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/** One downed sync at a time per actor (HP updates and their hooks arrive faster than the round-trip). */
const downedQueue = new Map();
function queueDowned(actor, fn) {
  const key = actor.uuid;
  const prev = downedQueue.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  downedQueue.set(key, next);
  next.finally(() => { if (downedQueue.get(key) === next) downedQueue.delete(key); });
  return next;
}

/**
 * Keep status effects and combat tracker in line with the actor's hit points. Runs on every HP change,
 * not only on the damage and healing paths, and is idempotent (repeated calls change nothing).
 * NPC at HP <= 0: DEFEATED status ("dead") as overlay + combatant.defeated = true (token stays; deleting is the GM's call).
 * Character at HP <= 0: "unconscious" as overlay (death saves on the sheet).
 * At HP > 0 both statuses go again - but only when the automation set them (AUTO_STATUS_FLAG); a status
 * the GM set by hand is never touched by a heal.
 */
export async function syncDownedStatus(actor, { before, after } = {}) {
  return queueDowned(actor, () => syncDowned(actor, { before, after }));
}

async function syncDowned(ref, { before, after } = {}) {
  const actor = liveActor(ref);                  // read the state as it is now, not as it was when queued
  const tr = downedTransition(before, after);
  const dead = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
  const known = (id) => CONFIG.statusEffects.some(e => e.id === id);
  // what has to change is decided by the pure rule (tested in Node) from this actor's own statuses
  const statuses = actor.effects.filter(e => e.statuses?.size).flatMap(e => [...e.statuses].map(id => ({ id, auto: isAutoStatus(e) })));
  const plan = downedPlan({ type: actor.type, before, after, statuses, deadId: dead });
  try {
    if (plan.set && known(plan.set)) {
      await setAutoStatus(actor, plan.set);
      await dedupeAutoStatus(actor, plan.set);
    }
    for (const id of plan.clear) if (known(id)) await clearAutoStatus(actor, id);
    if (actor.type !== "character" && (tr.down || tr.up)) {
      for (const combat of game.combats) for (const c of combat.combatants) {
        if (c.actor?.uuid !== actor.uuid) continue;
        if (!!c.defeated === tr.isDown) continue;
        if (c.canUserModify(game.user, "update")) await c.update({ defeated: tr.isDown });
      }
    }
  } catch (err) { console.error(`${SYSTEM_ID} | syncDownedStatus`, err); }
  return tr;
}

/* ---------- exhaustion: sheet counter (characters) <-> exhaustion1..6 statuses (all actors) ---------- */

/**
 * Set exactly the status for the given level (0 = none) on an actor; level 6 also marks it dead.
 * The effects are written directly (not through toggleStatusEffect) so the change can be tagged with
 * `exhSync` — that keeps the effect hooks from writing the sheet counter back and racing this call.
 * Runs serialized per actor, so quick clicks on the chips or the quick bar cannot overlap.
 */
export async function syncExhaustionStatuses(actor, level) {
  return queueExhaustion(actor, async () => {
    const lvl = Math.max(0, Math.min(EXHAUSTION_MAX, Number(level) || 0));
    const opts = { [SYSTEM_ID]: { exhSync: true } };
    const wantId = lvl ? exhaustionId(lvl) : null;
    const current = actor.effects.filter(e => exhaustionLevel(e.statuses) > 0);
    let keep = wantId ? current.find(e => e.statuses.has(wantId)) : null;
    // a level change rewrites the existing effect in place (one atomic update, so the level never flickers)
    if (wantId && !keep && current.length) {
      const ActiveEffectCls = CONFIG.ActiveEffect.documentClass;
      const data = (await ActiveEffectCls.fromStatusEffect(wantId)).toObject();
      keep = current[0];
      await keep.update({ name: data.name, img: data.img, statuses: [wantId], description: data.description ?? "" }, opts);
    } else if (wantId && !keep) {
      const ActiveEffectCls = CONFIG.ActiveEffect.documentClass;
      const data = await ActiveEffectCls.fromStatusEffect(wantId);
      await ActiveEffectCls.create(data, { parent: actor, keepId: true, ...opts });
    }
    const remove = current.filter(e => e !== keep).map(e => e.id).filter(id => actor.effects.has(id));
    if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove, opts);
    // exhaustion 6 = dead; stepping back down only clears it while the actor still has hit points
    const dead = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
    const hasDead = actor.statuses?.has(dead);
    if (lvl >= EXHAUSTION_MAX && !hasDead) await actor.toggleStatusEffect(dead, { active: true, overlay: true });
    else if (lvl < EXHAUSTION_MAX && hasDead && (actor.system.hp?.value ?? 0) > 0) await actor.toggleStatusEffect(dead, { active: false });
    return lvl;
  });
}

/** One exhaustion change at a time per actor (clicks arrive faster than the document updates round-trip). */
const exhaustionQueue = new Map();
function queueExhaustion(actor, fn) {
  const prev = exhaustionQueue.get(actor.id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  exhaustionQueue.set(actor.id, next);
  next.finally(() => { if (exhaustionQueue.get(actor.id) === next) exhaustionQueue.delete(actor.id); });
  return next;
}

/** Exhaustion level of an actor: characters keep it on the sheet, NPCs only in their statuses. */
export function currentExhaustion(actor) {
  return actor.type === "character" ? Math.max(0, Number(actor.system.play?.exhaustion) || 0) : exhaustionLevel(actor.statuses ?? []);
}

/**
 * Set / clear one condition on an actor. Exhaustion goes through the level (characters keep their sheet
 * counter in sync); every other status is a plain toggle, so sheet chips, quick bar and token HUD agree.
 * @param {Actor} actor
 * @param {string} id       status id, or "exhaustion" for the level
 * @param {object} [opts]   {active: force a state, delta: exhaustion step (+1 / -1)}
 */
export async function toggleCondition(actor, id, { active = null, delta = 0 } = {}) {
  if (!actor?.isOwner) { ui.notifications.warn(`You do not own ${actor?.name ?? "this actor"}.`); return null; }
  if (id === "exhaustion" || EXHAUSTION_IDS.includes(id)) {
    const cur = currentExhaustion(actor);
    const lvl = delta ? stepExhaustion(cur, delta) : (active === false ? 0 : stepExhaustion(cur, 1));
    return setExhaustionLevel(actor, lvl);
  }
  const has = actor.statuses?.has(id);
  const want = active === null ? !has : active;
  if (want === !!has) return null;
  const overlay = id === (CONFIG.specialStatusEffects?.DEFEATED ?? "dead");
  return actor.toggleStatusEffect(id, { active: want, ...(overlay ? { overlay: true } : {}) });
}

/**
 * Set the exhaustion level. Characters store it on their sheet and get the statuses synced right here
 * (the update hook then finds nothing left to do), NPCs only carry the statuses.
 */
export async function setExhaustionLevel(actor, level) {
  const lvl = Math.max(0, Math.min(EXHAUSTION_MAX, Number(level) || 0));
  if (actor.type === "character" && actor.system.play.exhaustion !== lvl) {
    await actor.update({ "system.play.exhaustion": lvl }, { [SYSTEM_ID]: { exhSync: true } });
  }
  return syncExhaustionStatuses(actor, lvl);
}

/** Exhaustion set by hand (token HUD, effect editor): keep one level at a time and mirror it onto the sheet. */
async function onExhaustionEffectChange(actor, effect, created) {
  const lvl = exhaustionLevel(effect.statuses);
  if (!lvl) return;
  return queueExhaustion(actor, async () => {
    const opts = { [SYSTEM_ID]: { exhSync: true } };
    const level = created ? lvl : Math.max(0, ...actor.effects.map(e => exhaustionLevel(e.statuses)), 0);
    if (created) {
      const others = actor.effects.filter(e => e.id !== effect.id && exhaustionLevel(e.statuses) > 0).map(e => e.id).filter(id => actor.effects.has(id));
      if (others.length) await actor.deleteEmbeddedDocuments("ActiveEffect", others, opts);
    }
    if (actor.type === "character" && actor.system.play.exhaustion !== level) await actor.update({ "system.play.exhaustion": level }, opts);
    const dead = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
    const hasDead = actor.statuses?.has(dead);
    if (level >= EXHAUSTION_MAX && !hasDead) await actor.toggleStatusEffect(dead, { active: true, overlay: true });
    else if (level < EXHAUSTION_MAX && hasDead && (actor.system.hp?.value ?? 0) > 0) await actor.toggleStatusEffect(dead, { active: false });
  });
}

/** Actor hooks: clamp character HP at 0, remember the previous HP, sync statuses on any HP change (sheet, rest, apply). */
export function registerActorHooks() {
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id || actor.type !== "character" || options[SYSTEM_ID]?.exhSync) return;
    const lvl = foundry.utils.getProperty(changes, "system.play.exhaustion");
    if (lvl === undefined) return;
    syncExhaustionStatuses(actor, lvl).catch(err => console.error(`${SYSTEM_ID} | syncExhaustionStatuses`, err));
  });
  for (const [hook, created] of [["createActiveEffect", true], ["deleteActiveEffect", false]]) {
    Hooks.on(hook, (effect, options, userId) => {
      const actor = effect.parent;
      if (userId !== game.user.id || actor?.documentName !== "Actor" || options[SYSTEM_ID]?.exhSync) return;
      onExhaustionEffectChange(actor, effect, created).catch(err => console.error(`${SYSTEM_ID} | exhaustion effect`, err));
    });
  }
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    const hp = foundry.utils.getProperty(changes, "system.hp.value");
    if (hp === undefined) return;
    if (actor.type === "character" && hp !== null && Number(hp) < 0) foundry.utils.setProperty(changes, "system.hp.value", 0);
    options[SYSTEM_ID] = { ...(options[SYSTEM_ID] ?? {}), prevHp: actor.system.hp.value };
  });
  // every HP change syncs the status, no matter which path wrote it (sheet field, token bar, rest, damage).
  // The damage paths call syncDownedStatus themselves for their chat line; the second run is a no-op.
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    const o = options[SYSTEM_ID];
    if (!o || !("prevHp" in o)) return;
    syncDownedStatus(actor, { before: o.prevHp, after: actor.system.hp.value });
  });
}

/* ---------- saves / skills / ability checks / initiative ---------- */

/**
 * Saving throw, skill check or ability check. Modifier keys / dialog; DC prefilled from the target (spell DC).
 *
 * An automatic failure (stunned / paralyzed / unconscious on a STR or DEX save, read from this actor's
 * own conditions) is not rolled at all: no dialog, no dice, no total - the card only states the reason.
 * Success is `total >= dc`, so a total equal to the DC succeeds.
 * @param {Actor} actor
 * @param {{kind:"save"|"skill"|"ability", key:string}} what
 * @param {object} [opts]  {event, dc, apply, label, extraRolls: further Roll objects for this card,
 *                          consequence: one line of text printed under the result}
 */
export async function rollCheck(actor, { kind, key }, { event = null, dc: presetDc = null, apply = null, label: who = null, extraRolls = [], consequence = "" } = {}) {
  const sys = actor.system;
  const isChar = actor.type === "character";
  const d = isChar ? sys.derived : sys;
  let mod, label, prof = false;
  if (kind === "save") {
    if (!(key in ABILITIES)) return null;
    mod = isChar ? d.saveData[key]?.mod : (sys.saveMods[key] ?? 0) + (sys.exhPen || 0);
    label = `${ABILITIES[key]} Save`; prof = isChar ? !!d.saveData[key]?.prof : !!sys.saveProf?.[key];
  } else if (kind === "skill") {
    if (!isChar) return null;
    mod = d.skillData[key]?.mod; label = `${SKILLS[key]?.l ?? key} Check`; prof = !!d.skillData[key]?.prof;
  } else if (kind === "ability") {
    if (!(key in ABILITIES)) return null;
    mod = isChar ? abilityCheckBonus(d, key) : (sys.mods[key] ?? 0) + (sys.exhPen || 0);
    label = `${ABILITIES[key]} Check`;
  }
  if (mod === undefined) return null;
  // conditions of THIS actor, read once, before anything else - they decide whether a roll happens at all
  const cm = conditionMods(actor, { type: kind === "skill" ? "check" : kind, ability: key });
  const auto = cm.autoFail || null;
  let opts = { mode: "normal", situational: 0, dc: presetDc };
  let roll = null, formula = "", mode = "normal", d20 = null, dice = [];
  if (!auto) {
    const target = targetInfo();
    const itemPreset = isChar && (kind === "skill" || kind === "save") ? itemRollPreset(d, kind, key) : null;
    opts = await d20Options(event, { title: `${who ?? actor.name}: ${label}`, dc: presetDc ?? target?.dc ?? null, withDc: true, preset: itemPreset });
    if (!opts) return null;
    if (opts.presetLabel) cm.notes.push(opts.presetLabel);
    if (presetDc !== null && opts.dc === null) opts.dc = presetDc;
    mode = resolveMode(opts.mode, cm);
    formula = d20Formula(mod, { ...opts, mode }).formula;
    roll = await new Roll(formula).evaluate();
    d20 = naturalD20(roll);
    dice = d20Results(roll);
  }
  const dc = opts.dc ?? null;
  const success = auto ? false : checkSuccess(roll.total, dc);
  // save requested by an NPC ability with damage: half on success, full on failure, applied to this token
  let applyAmount = null, applyNote = "";
  if (apply && (success !== null)) {
    applyAmount = success ? apply.half : apply.full;
    applyNote = success ? `Success: half damage (${apply.half} ${damageTypeLabel(apply.dtype)})` : `Failure: full damage (${apply.full} ${damageTypeLabel(apply.dtype)})`;
  }
  const content = await render("check", {
    actorName: who ?? actor.name, label, rolled: !auto, formula, total: roll?.total ?? null, d20, dice,
    mod: fmtMod(mod), situational: opts.situational ? fmtMod(opts.situational) : "",
    modeLabel: MODE_LABEL[mode], conditions: conditionText(cm), dc, success, hasDc: !auto && dc !== null, prof,
    autoFail: auto, resultClass: success === null ? "" : (success ? "hit" : "miss"),
    note: "", consequence, applyNote, applyAmount, applyType: apply ? damageTypeLabel(apply.dtype) : ""
  });
  return ChatMessage.implementation.create({
    speaker: speakerFor(actor), rolls: roll ? [roll, ...extraRolls] : [...extraRolls], content,
    flags: { [SYSTEM_ID]: { type: "check", kind, key, dc, success, autoFail: auto, apply: applyAmount === null ? null : { tokenUuid: apply.tokenUuid, amount: applyAmount, dtype: apply.dtype, sourceName: apply.sourceName, sourcePub: apply.sourcePub ?? apply.sourceName } } }
  });
}

/** Initiative via Combat (creates combatants); modifier keys pick advantage/disadvantage. Without a scene: plain roll. */
export async function rollInitiative(actor, { event = null } = {}) {
  const opts = await d20Options(event, { title: "Initiative", preset: actor.type === "character" ? itemRollPreset(actor.system.derived, "init") : null });
  if (!opts) return null;
  const cm = conditionMods(actor, { type: "initiative", ability: "dex" });
  opts.mode = resolveMode(opts.mode, cm);
  const die = ADV_FORMULA[opts.mode] ?? ADV_FORMULA.normal;
  const sit = Number(opts.situational) || 0;
  const formula = `${die} + @init${sit ? (sit > 0 ? " + " : " - ") + Math.abs(sit) : ""}`;
  try {
    if (canvas?.scene) return await actor.rollInitiative({ createCombatants: true, rerollInitiative: true, initiativeOptions: { formula } });
  } catch (err) {
    console.warn("ap-turm | rollInitiative via Combat failed, rolling plain", err);
  }
  const roll = await new Roll(formula, actor.getRollData()).evaluate();
  return roll.toMessage({ speaker: speakerFor(actor), flavor: `Initiative${MODE_LABEL[opts.mode] ? " · " + MODE_LABEL[opts.mode] : ""}${opts.presetLabel ? " · " + opts.presetLabel : ""}` });
}

/* ---------- hit dice / death saves ---------- */

/** Spend one hit die: roll the current hit die + CON modifier and add the result to HP (capped at max). */
export async function rollHitDie(actor) {
  if (actor.type !== "character") return null;
  const S = actor.system.appState, d = actor.system.derived, sys = actor.system;
  if (sys.hitDice.value <= 0) { ui.notifications.warn("No hit dice left."); return null; }
  const formula = hitDieHealFormula(S, d);
  const roll = await new Roll(formula).evaluate();
  const heal = Math.max(0, roll.total);
  const pools = targetPools(actor);
  const res = adjustHp(pools, heal);
  await actor.update({
    "system.play.spentHitDice": (S.play.spentHitDice || 0) + 1,
    "system.hp.value": res.hp
  });
  await syncDownedStatus(actor, { before: pools.hp, after: res.hp });
  return roll.toMessage({
    speaker: speakerFor(actor),
    flavor: `Hit Die (${sys.hitDie.l}${d.mods.con ? " " + fmtMod(d.mods.con) + " CON" : ""}): ${pools.hp} → ${res.hp} HP · ${sys.hitDice.value - 1}/${sys.hitDice.max} left`
  });
}

/**
 * Death saving throw: d20 + exhaustion (modifier keys / dialog), >= 10 success, natural 20 = 1 HP,
 * natural 1 = two failures. Updates the counters on the sheet.
 */
export async function rollDeathSave(actor, { event = null } = {}) {
  if (actor.type !== "character") return null;
  const d = actor.system.derived, play = actor.system.play;
  const opts = await d20Options(event, { title: "Death Save", preset: itemRollPreset(d, "death") });
  if (!opts) return null;
  const bonus = d.exhPen || 0;
  const { formula } = d20Formula(bonus, opts);
  const roll = await new Roll(formula).evaluate();
  const d20 = naturalD20(roll);
  const out = deathSaveOutcome({ d20, total: roll.total, succ: play.deathSucc, fail: play.deathFail });
  const update = { "system.play.deathSucc": out.succ, "system.play.deathFail": out.fail };
  if (out.result === "revive") update["system.hp.value"] = out.hp;
  await actor.update(update);
  const text = {
    revive: "Natural 20: back on your feet with 1 HP.",
    success: out.succ >= 3 ? "Success: stable (3 successes)." : `Success (${out.succ}/3).`,
    fail: out.fail >= 3 ? "Failure: dead (3 failures)." : `Failure (${out.fail}/3).`,
    fail2: out.fail >= 3 ? "Natural 1: two failures, dead (3 failures)." : `Natural 1: two failures (${out.fail}/3).`
  }[out.result];
  const success = out.result === "success" || out.result === "revive";
  const content = await render("check", {
    actorName: actor.name, label: "Death Save", rolled: true, formula, total: roll.total, d20, dice: d20Results(roll),
    mod: fmtMod(bonus), situational: opts.situational ? fmtMod(opts.situational) : "",
    modeLabel: MODE_LABEL[opts.mode], dc: 10, success, hasDc: true, prof: false,
    resultClass: success ? "hit" : "miss", note: text
  });
  return ChatMessage.implementation.create({
    speaker: speakerFor(actor), rolls: [roll], content,
    flags: { [SYSTEM_ID]: { type: "deathSave", result: out.result, succ: out.succ, fail: out.fail } }
  });
}

/* ---------- spells ---------- */

/**
 * Cast a spell item: deduct spell points (rank) and, for rank 6+, one cast of that rank; then post the card.
 * Mode "ap": one slot of the rank. Cantrips are free. No save/damage automation.
 * @param {Actor} actor
 * @param {Item} item  spell
 */
export async function castSpell(actor, item) {
  if (item?.type !== "spell") return null;
  const S = actor.system.appState, d = actor.system.derived;
  const lvl = Number(item.system.lvl) || 0;
  const update = {};
  let cost = "";
  if (lvl > 0) {
    const slot = d.slots.find(s => s.L === lvl);
    const used = S.slotsUsed[lvl] || 0;
    if (S.mode === "turm") {
      if (lvl > d.spMaxRank) { ui.notifications.warn(`Rank ${lvl} exceeds your max rank (${d.spMaxRank || 0}).`); return null; }
      if (d.spLeft < lvl) { ui.notifications.warn(`Not enough spell points (${d.spLeft}/${d.spTotal}, need ${lvl}).`); return null; }
      update["system.resources.spUsed"] = S.spUsed + lvl;
      cost = `${lvl} spell point${lvl > 1 ? "s" : ""} (${d.spLeft - lvl}/${d.spTotal} left)`;
      if (lvl >= 6) {
        const total = slot?.total ?? 0;
        if (used >= total) { ui.notifications.warn(`No rank ${lvl} casts left until a long rest (${used}/${total}).`); return null; }
        update[`system.resources.slotsUsed.${lvl}`] = used + 1;
        cost += ` · rank ${lvl} cast ${used + 1}/${total}`;
      }
    } else {
      const total = slot?.total ?? 0;
      if (used >= total) { ui.notifications.warn(`No level ${lvl} slots left (${used}/${total}).`); return null; }
      update[`system.resources.slotsUsed.${lvl}`] = used + 1;
      cost = `level ${lvl} slot ${used + 1}/${total}`;
    }
    await actor.update(update);
  } else cost = "cantrip";
  const el = item.system.elem;
  const desc = spellDescriptionParts(item.system.description);
  const enrich = (h) => h ? foundry.applications.ux.TextEditor.implementation.enrichHTML(h, { relativeTo: item }) : "";
  const content = await render("spell", {
    actorName: actor.name, name: item.name, rank: lvl === 0 ? "Cantrip" : `Rank ${lvl}`, cost, concentration: !!item.system.concentration,
    elem: el ? damageTypeLabel(el) : "", elemColor: damageTypeColor(el), notes: item.system.notes,
    descHead: await enrich(desc.head), descBody: await enrich(desc.body)
  });
  const msg = await ChatMessage.implementation.create({
    speaker: speakerFor(actor), content, flags: { [SYSTEM_ID]: { type: "spell", actorUuid: actor.uuid, itemId: item.id, lvl } }
  });
  playCastFx({ actor, target: currentTarget(), elem: el });
  Hooks.callAll("apTurm.spellCast", actor, item, msg);
  return msg;
}

/* ---------- chat card buttons ---------- */

async function onCardAction(message, action, target, event) {
  const f = message.flags?.[SYSTEM_ID] ?? {};
  switch (action) {
    case "rollDamage": {
      const actor = f.actorUuid ? await fromUuid(f.actorUuid) : null;
      if (!actor) { ui.notifications.warn("Actor not found."); return; }
      if (!actor.isOwner) { ui.notifications.warn("You do not own this actor."); return; }
      const crit = target.dataset.crit === "true" || f.crit === true;
      if (f.attackIndex !== undefined && f.attackIndex !== null) return rollNpcDamage(actor, f.attackIndex, { crit, event });
      const item = actor.items.get(f.itemId);
      if (!item) { ui.notifications.warn("Weapon not found."); return; }
      return rollDamage(actor, item, { crit, event });
    }
    case "applyDamage": return applyDamageFromMessage(message);
    case "undoDamage": return undoApplied(message);
    case "rollRequestedSave": return rollRequestedSave(message, target.dataset.tokenUuid, event);
  }
  const handler = cardActions.get(action);
  if (handler) return handler(message, target, event);
}

/** Card actions other modules add: name -> (message, target, event) => any. */
export const cardActions = new Map();

/** Decorators for chat cards that are not ours (RollTable draws): (message, html) => void. */
export const chatDecorators = [];

/**
 * Register the renderChatMessageHTML listener (once, in init). A save button for a token the user does
 * not own is disabled instead of failing on click, so every player sees at a glance which save is theirs.
 */
export function registerChatHooks() {
  Hooks.on("preCreateChatMessage", (message, data) => { try { rememberRealSpeaker(message, data); } catch (err) { console.error(`${SYSTEM_ID} | real speaker`, err); } });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const decorate of chatDecorators) {
      try { decorate(message, html); } catch (err) { console.error(`${SYSTEM_ID} | chat decorator`, err); }
    }
    if (game.user.isGM) revealRealNames(message, html);
    if (!message.flags?.[SYSTEM_ID]) return;
    const f = message.flags[SYSTEM_ID];
    if (f.type === "applied" && !canUndo(f, { userId: game.user.id, isGM: game.user.isGM })) html.querySelectorAll(".apt-undo-row").forEach(el => el.remove());
    html.querySelectorAll(".ap-turm-chat [data-action]").forEach(el => {
      const foreign = (el.dataset.action === "rollRequestedSave" && !ownsToken(el.dataset.tokenUuid))
        || (el.dataset.ownerUuid && !ownsActor(el.dataset.ownerUuid));
      if (foreign) {
        el.disabled = true;
        el.classList.add("apt-foreign");
        el.title = el.dataset.ownerUuid ? "This is not your character." : "You do not own this token.";
        return;
      }
      const handler = (ev) => { ev.preventDefault(); onCardAction(message, el.dataset.action, el, ev); };
      el.addEventListener("click", handler);
      el.addEventListener("contextmenu", handler);
    });
  });
}

/** GM view of a card: display names back to the real ones (card body and the speaker line). */
function revealRealNames(message, html) {
  html.querySelectorAll("[data-apt-real]").forEach(el => { el.textContent = el.dataset.aptReal; el.classList.add("apt-real"); });
  const sender = html.querySelector(".message-sender");
  // stored when the message was created (the token may be gone by now, e.g. a removed defeated NPC)
  const stored = message.flags?.[SYSTEM_ID]?.realSpeaker;
  if (stored) { if (sender) sender.textContent = stored; return; }
  const sp = message.speaker ?? {};
  let actor = null;
  try { actor = ChatMessage.implementation.getSpeakerActor(sp); } catch { actor = null; }
  if (!displayNameOf(actor)) return;
  const token = sp.token && sp.scene ? game.scenes.get(sp.scene)?.tokens.get(sp.token) : null;
  if (sender) sender.textContent = realNameOf(actor, token);
}

/** A message spoken under an NPC's display name remembers the real speaker name for the GM. */
function rememberRealSpeaker(message, data) {
  const sp = data?.speaker ?? message.speaker ?? {};
  if (!sp.alias || message.flags?.[SYSTEM_ID]?.realSpeaker) return;
  let actor = null;
  try { actor = ChatMessage.implementation.getSpeakerActor(sp); } catch { return; }
  const d = displayNameOf(actor);
  if (!d || sp.alias !== d) return;
  const token = sp.token && sp.scene ? game.scenes.get(sp.scene)?.tokens.get(sp.token) : null;
  message.updateSource({ [`flags.${SYSTEM_ID}.realSpeaker`]: realNameOf(actor, token) });
}

/** Does the current user own the actor behind this token uuid? */
function ownsToken(uuid) {
  if (!uuid) return false;
  try { return !!(fromUuidSync(uuid)?.actor?.isOwner); } catch { return false; }
}

/** Does the current user own this actor (uuid)? Used to grey out foreign buttons on a group card. */
export function ownsActor(uuid) {
  if (!uuid) return false;
  try { return !!(fromUuidSync(uuid)?.isOwner); } catch { return false; }
}
