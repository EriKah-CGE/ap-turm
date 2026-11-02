/**
 * NPC sheet (Phase 4): lean, fully rollable, editable in place (form submitOnChange).
 * Tabs: Stats (abilities, saves, combat modifiers, legendary counters, defenses, statblock entries grouped by
 * section with options nested under their parent), Notes, Statblock (paste a 5e statblock, parse it into the fields).
 * Roll conventions as on the character sheet: click normal, Shift advantage, Ctrl/Alt disadvantage, right-click dialog.
 * Turm mode: imported D&D damage types are shown as yellow "not assigned" tags; a click opens the element dropdown.
 */
import { ABILITIES, ABBR, damageTypeChoices, damageTypeLabel, damageTypeColor, damageTypeOptions, ELEMENTS } from "../config.mjs";
import { fmtMod } from "../rules.mjs";
import { isUnassignedType, DEFENSE_ABBR } from "../rolls.mjs";
import { rollCheck, rollInitiative, rollNpcAttack, rollNpcDamage, requestSave, useEntry, applyHpDelta } from "../chat.mjs";
import { parseStatblock, statblockToUpdate, parseUsable, SECTIONS, emptyEntry, parseSkills, formatSkills } from "../statblock.mjs";
import { SECTION_ORDER } from "../data/npc.mjs";
import { SheetSizeMixin } from "./sizing.mjs";
import { chipClick, addConditionMenu, chipContext } from "./condition-chips.mjs";
import { guardWrites } from "./guard.mjs";
import { downloadNpcExport } from "../npc-transfer.mjs";
import { entryArea, placeEntryTemplate, SHAPE_LABELS } from "../area.mjs";
import { importAppJSONIntoActor } from "../importer.mjs";
import { saveToLibrary, fromLibraryDialog } from "../library.mjs";
import { npcItemRows } from "../npc-items.mjs";
import { portraitClick } from "./character-sheet.mjs";
import { placeCopiesDialog } from "../spawn.mjs";
import { rollPlainD20 } from "../dice-tray.mjs";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TPL = "systems/ap-turm/templates/actor/npc/";
const isRightClick = (ev) => ev?.button === 2 || ev?.type === "contextmenu";
const roll = (handler) => ({ handler, buttons: [0, 2] });
const DEFENSES = { resistances: "Resistances", immunities: "Immunities", vulnerabilities: "Vulnerabilities" };
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const LEG_RES_RE = /^Legendary Resistance/i;

export class ApTurmNpcSheet extends SheetSizeMixin(HandlebarsApplicationMixin(ActorSheetV2), "npc") {

  static DEFAULT_OPTIONS = {
    classes: ["ap-turm", "sheet", "actor", "npc"],
    position: { width: 720, height: 780 },
    window: {
      resizable: true,
      controls: [
        { action: "importNpcJson", icon: "fa-solid fa-file-import", label: "AP_TURM.Import.NpcControl", ownership: "OWNER" },
        { action: "exportNpcJson", icon: "fa-solid fa-file-export", label: "AP_TURM.Export.NpcControl", ownership: "OWNER" },
        { action: "placeCopies", icon: "fa-solid fa-clone", label: "Place copies", visible: () => game.user.isGM }
      ]
    },
    form: { submitOnChange: true, closeOnSubmit: false },
    // every action writes to the actor unless it is listed as read-only below
    actions: guardWrites({
      rollD20: ApTurmNpcSheet.#onRollD20,
      importNpcJson: ApTurmNpcSheet.#onImportNpcJson,
      exportNpcJson: ApTurmNpcSheet.#onExportNpcJson,
      placeCopies: ApTurmNpcSheet.#onPlaceCopies,
      rollAbility: roll(ApTurmNpcSheet.#onRollAbility),
      rollSave: roll(ApTurmNpcSheet.#onRollSave),
      rollInitiative: roll(ApTurmNpcSheet.#onRollInitiative),
      entryAttack: roll(ApTurmNpcSheet.#onEntryAttack),
      entryDamage: roll(ApTurmNpcSheet.#onEntryDamage),
      entrySave: ApTurmNpcSheet.#onEntrySave,
      entryTemplate: ApTurmNpcSheet.#onEntryTemplate,
      entryUse: roll(ApTurmNpcSheet.#onEntryUse),
      entryPrimary: roll(ApTurmNpcSheet.#onEntryPrimary),
      entryEdit: ApTurmNpcSheet.#onEntryEdit,
      entryDelete: ApTurmNpcSheet.#onEntryDelete,
      entryAdd: ApTurmNpcSheet.#onEntryAdd,
      entryRecharge: ApTurmNpcSheet.#onEntryRecharge,
      assignType: ApTurmNpcSheet.#onAssignType,
      hpAdjust: ApTurmNpcSheet.#onHpAdjust,
      conditionChip: { handler: ApTurmNpcSheet.#onConditionChip, buttons: [0, 2] },
      conditionAdd: ApTurmNpcSheet.#onConditionAdd,
      addDefense: ApTurmNpcSheet.#onAddDefense,
      removeDefense: ApTurmNpcSheet.#onRemoveDefense,
      legendaryPip: ApTurmNpcSheet.#onLegendaryPip,
      legendaryReset: ApTurmNpcSheet.#onLegendaryReset,
      longRest: ApTurmNpcSheet.#onLongRest,
      parseStatblock: ApTurmNpcSheet.#onParseStatblock,
      createItem: ApTurmNpcSheet.#onCreateItem,
      editItem: ApTurmNpcSheet.#onEditItem,
      deleteItem: ApTurmNpcSheet.#onDeleteItem,
      saveToLibrary: ApTurmNpcSheet.#onSaveToLibrary,
      fromLibrary: ApTurmNpcSheet.#onFromLibrary,
      portrait: { handler: ApTurmNpcSheet.#onPortrait, buttons: [0, 2] }
    }, ["rollD20", "portrait", "exportNpcJson", "placeCopies", "rollAbility", "rollSave", "rollInitiative", "entryAttack", "entryDamage", "entrySave", "editItem", "saveToLibrary"])
  };

  static PARTS = {
    header: { template: TPL + "header.hbs", templates: ["systems/ap-turm/templates/actor/conditions.hbs"] },
    tabs: { template: "systems/ap-turm/templates/actor/character/tabs.hbs" },
    stats: { template: TPL + "stats.hbs", templates: [TPL + "entry.hbs"], scrollable: [""] },
    text: { template: TPL + "text.hbs", scrollable: [""] },
    statblock: { template: TPL + "statblock.hbs", scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "stats", label: "Stats" },
        { id: "text", label: "Notes" },
        { id: "statblock", label: "Statblock" }
      ],
      initial: "stats"
    }
  };

  /** Collapsed entry sections (sheet-local UI state). */
  #collapsed = new Set();
  /** The "Items" box starts collapsed (sheet-local UI state). */
  #itemsOpen = false;

  /* ---------- context ---------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const mode = sys.mode;
    const isTurm = mode === "turm";
    const unassigned = (k) => isUnassignedType(k, mode);
    const abilities = Object.keys(ABILITIES).map(k => ({
      key: k, abbr: ABBR[k], label: ABILITIES[k], value: sys.abilities[k], mod: fmtMod(sys.mods[k]),
      save: sys.saves[k], saveMod: fmtMod(sys.saveMods[k]), saveProf: sys.saveProf[k], placeholder: fmtMod(sys.mods[k])
    }));
    const typeChoices = damageTypeChoices(mode);
    // ap mode: neutral chips (D&D types carry no color); turm mode: element color; imported D&D types yellow
    const defenses = Object.entries(DEFENSES).map(([kind, label]) => ({
      kind, label, abbr: DEFENSE_ABBR[kind],
      entries: sys[kind].map((v, index) => ({ index, value: v, label: damageTypeLabel(v), color: isTurm ? damageTypeColor(v) : "", unassigned: unassigned(v) })),
      options: Object.entries(typeChoices).filter(([k]) => !sys[kind].includes(k)).map(([value, label]) => ({ value, label }))
    }));
    const defenseChips = defenses.flatMap(d => d.entries.map(e => ({ ...e, abbr: d.abbr, kindLabel: d.label })));
    const pips = (c) => Array.from({ length: c.max }, (_, i) => ({ i: i + 1, used: i >= c.value }));
    const legendary = [
      { kind: "resist", label: "Legendary Resistances", value: sys.legendary.resist.value, max: sys.legendary.resist.max, pips: pips(sys.legendary.resist) },
      { kind: "actions", label: "Legendary Actions", value: sys.legendary.actions.value, max: sys.legendary.actions.max, pips: pips(sys.legendary.actions) }
    ];
    // statblock entries grouped by section, options nested under their parent (sharing its recharge / uses)
    const view = (e, index) => {
      const hi = sys.holderIndex(index), h = sys.entries[hi];
      const area = entryArea(e);
      const usable = e.section === "legendary" || !!h.recharge || h.uses.max > 0 || LEG_RES_RE.test(e.name);
      const spent = (h.recharge && h.rechargeUsed) || (h.uses.max > 0 && h.uses.value <= 0 && !LEG_RES_RE.test(e.name));
      return {
        index, name: e.name || "(unnamed)", text: e.text, isTrait: e.section === "traits", isChild: !!e.parent, children: [],
        toHit: e.toHit, toHitLabel: e.toHit === null ? "" : fmtMod(e.toHit), range: e.range,
        saveDc: e.saveDc, saveAbility: e.saveAbility ? ABBR[e.saveAbility] ?? e.saveAbility.toUpperCase() : "",
        damage: e.damage, dmgTypeLabel: damageTypeLabel(e.dmgType), dmgColor: damageTypeColor(e.dmgType), dmgUnassigned: unassigned(e.dmgType),
        area: area ? { ...area, label: `${area.size} ft ${SHAPE_LABELS[area.shape]}` } : null,
        recharge: h.recharge, rechargeUsed: h.rechargeUsed, rechargeFrom: hi !== index ? h.name : "",
        uses: h.uses, legendaryCost: e.legendaryCost, usable, spent,
        primary: e.toHit !== null ? "attack" : e.saveDc !== null ? "save" : usable ? "use" : ""
      };
    };
    const byKey = Object.fromEntries(SECTION_ORDER.map(k => [k, []]));
    const views = sys.entries.map(view);
    views.forEach((v, index) => {
      const e = sys.entries[index];
      const list = byKey[e.section] ?? byKey.actions;
      const parent = e.parent ? views.find((p, i) => i !== index && sys.entries[i].section === e.section && sys.entries[i].name === e.parent) : null;
      if (parent) parent.children.push(v); else { v.isChild = false; list.push(v); }
    });
    const sections = SECTION_ORDER.map(key => ({ key, label: SECTIONS[key], entries: byKey[key], count: byKey[key].length, open: !this.#collapsed.has(key) }))
      .filter(s => s.count || ["traits", "actions"].includes(s.key));
    const hpPct = sys.hp.max > 0 ? Math.max(0, Math.min(100, Math.round(100 * sys.hp.value / sys.hp.max))) : 0;
    const statuses = [...(actor.statuses ?? [])];
    const conditions = CONFIG.statusEffects.filter(e => statuses.includes(e.id)).map(e => e.name);
    return Object.assign(context, {
      actor, system: sys, fields: sys.schema.fields, editable: this.isEditable,
      name: actor.name, img: actor.img, isTurm,
      modeOptions: [{ value: "ap", label: "Standard (AP)", selected: !isTurm }, { value: "turm", label: "Turm", selected: isTurm }],
      elementOptions: [{ value: "", label: "—", selected: !sys.element }, ...Object.keys(ELEMENTS).map(k => ({ value: k, label: ELEMENTS[k].l, selected: sys.element === k }))],
      elementColor: damageTypeColor(sys.element),
      hp: sys.hp, hpPct, downed: sys.hp.value <= 0,
      init: fmtMod(sys.init), exhaustion: sys.exhaustion, speedEff: sys.speedEff, conditions: conditions.join(", "), conditionChips: chipContext(actor),
      skillsText: formatSkills(sys.skills), passivePerception: sys.passivePerception, unassigned: sys.unassigned,
      abilities, defenses, defenseChips, legendary, sections,
      items: npcItemRows(actor.items, { isGM: game.user.isGM }), itemsOpen: this.#itemsOpen,
      notesEnriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.notes, { secrets: actor.isOwner, relativeTo: actor })
    });
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  /** The "Skills" header field is typed as text ("Perception +11, Stealth +5") and stored as { perception: 11, ... }. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    if (data.skillsText !== undefined) {
      const skills = parseSkills(data.skillsText);
      delete data.skillsText;
      data.system ??= {};
      data.system.skills = { ...skills };
      for (const k of Object.keys(this.actor.system.skills)) if (!(k in skills)) data.system.skills[`-=${k}`] = null;
    }
    return data;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // remember collapsed entry sections across re-renders
    this.element.querySelectorAll("details.apt-entries").forEach(d => d.addEventListener("toggle", () => {
      if (d.open) this.#collapsed.delete(d.dataset.section); else this.#collapsed.add(d.dataset.section);
    }));
    this.element.querySelector("details.apt-npcitems")?.addEventListener("toggle", (ev) => { this.#itemsOpen = ev.currentTarget.open; });
    // damage box: picking a type in the dropdown adds it (the dropdown itself stays on its empty value)
    this.element.querySelectorAll("select[data-defense-select]").forEach(s => s.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const v = s.value; s.value = "";
      if (v) this.actor.system.addDefense(s.dataset.defenseSelect, v);
    }));
  }

  /* ---------- helpers ---------- */

  #index(t) { return +t.closest("[data-index]")?.dataset.index; }

  /** Entry editor dialog. Returns the entry data or null. */
  static async editEntryDialog(entry, mode, title, parents = []) {
    const sel = (opts, cur) => opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
    const sections = Object.entries(SECTIONS);
    const abil = [["", "—"], ...Object.entries(ABILITIES)];
    const types = [["", "—"], ...damageTypeOptions(mode, entry.dmgType).map(o => [o.value, o.label])];
    const per = [["", "—"], ["day", "per day"], ["short rest", "per short rest"], ["long rest", "per long rest"]];
    const parentOpts = [["", "—"], ...parents.filter(n => n && n !== entry.name).map(n => [n, n])];
    const g = (label, field) => `<div class="form-group"><label>${label}</label><div class="form-fields">${field}</div></div>`;
    const content = `
      ${g("Name", `<input type="text" name="name" value="${esc(entry.name)}" autofocus>`)}
      ${g("Section", `<select name="section">${sel(sections, entry.section)}</select>`)}
      ${g("Option of", `<select name="parent">${sel(parentOpts, entry.parent)}</select>`)}
      ${g("To hit", `<input type="number" name="toHit" value="${entry.toHit ?? ""}" placeholder="—" step="1"> <input type="text" name="range" value="${esc(entry.range)}" placeholder="reach / range">`)}
      ${g("Damage", `<input type="text" name="damage" value="${esc(entry.damage)}" placeholder="2d6 + 4"> <select name="dmgType">${sel(types, entry.dmgType)}</select>`)}
      ${g("Save", `DC <input type="number" name="saveDc" value="${entry.saveDc ?? ""}" placeholder="—" step="1"> <select name="saveAbility">${sel(abil, entry.saveAbility)}</select>`)}
      ${g("Recharge", `<input type="text" name="recharge" value="${esc(entry.recharge)}" placeholder="5-6 / 6 / rest">`)}
      ${g("Uses", `<input type="number" name="usesMax" value="${entry.uses.max || ""}" placeholder="—" min="0" step="1"> <select name="usesPer">${sel(per, entry.uses.per)}</select>`)}
      ${g("Legendary cost", `<input type="number" name="legendaryCost" value="${entry.legendaryCost || ""}" placeholder="—" min="0" step="1">`)}
      ${g("Text", `<textarea name="text" rows="5">${esc(entry.text)}</textarea>`)}`;
    const res = await DialogV2.prompt({
      window: { title }, content, rejectClose: false, position: { width: 520 },
      ok: { label: "Save", callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object }
    });
    if (!res) return null;
    const n = (v) => (v === "" || v === null || v === undefined) ? null : (Number.isFinite(+v) ? Math.trunc(+v) : null);
    const usesMax = Math.max(0, n(res.usesMax) ?? 0);
    return {
      name: String(res.name ?? "").trim(), section: res.section, parent: res.parent ?? "", text: String(res.text ?? "").trim(),
      toHit: n(res.toHit), range: String(res.range ?? "").trim(), damage: String(res.damage ?? "").trim(), dmgType: res.dmgType ?? "",
      saveDc: n(res.saveDc), saveAbility: res.saveAbility ?? "", recharge: String(res.recharge ?? "").trim(),
      uses: { value: Math.min(entry.uses.value ?? usesMax, usesMax), max: usesMax, per: res.usesPer ?? "" },
      legendaryCost: Math.max(0, n(res.legendaryCost) ?? 0)
    };
  }

  #parentNames(section) { return this.actor.system.entries.filter(e => e.section === section && !e.parent).map(e => e.name); }

  /* ---------- actions ---------- */

  static #onRollAbility(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return rollCheck(this.actor, { kind: "ability", key: t.dataset.key }, { event: ev }); }
  static #onRollSave(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return rollCheck(this.actor, { kind: "save", key: t.dataset.key }, { event: ev }); }
  static #onRollInitiative(ev) { if (isRightClick(ev)) ev.preventDefault(); return rollInitiative(this.actor, { event: ev }); }
  static #onEntryAttack(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return rollNpcAttack(this.actor, this.#index(t), { event: ev }); }
  static #onEntryDamage(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return rollNpcDamage(this.actor, this.#index(t), { event: ev }); }
  static #onEntrySave(ev, t) { return requestSave(this.actor, this.#index(t)); }
  /** Place the area of this entry as a MeasuredTemplate, target what it covers, send the save request. */
  static #onEntryTemplate(ev, t) { return placeEntryTemplate(this.actor, this.#index(t)); }
  static #onEntryUse(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return useEntry(this.actor, this.#index(t), { event: ev }); }
  /** Click on the entry name: attack, save request or use, whichever the entry offers. */
  static #onEntryPrimary(ev, t) {
    if (isRightClick(ev)) ev.preventDefault();
    const i = this.#index(t), sys = this.actor.system, e = sys.entries[i];
    if (!e) return;
    const h = sys.entries[sys.holderIndex(i)];
    const usable = e.section === "legendary" || !!h.recharge || h.uses.max > 0 || LEG_RES_RE.test(e.name);
    if (usable) return useEntry(this.actor, i, { event: ev });
    if (e.toHit !== null) return rollNpcAttack(this.actor, i, { event: ev });
    if (e.saveDc !== null) return requestSave(this.actor, i);
  }
  static async #onEntryEdit(ev, t) {
    const i = this.#index(t), e = this.actor.system.entries[i];
    if (!e) return;
    const data = await ApTurmNpcSheet.editEntryDialog(e, this.actor.system.mode, `Edit: ${e.name || "entry"}`, this.#parentNames(e.section));
    if (data) await this.actor.system.updateEntry(i, data);
  }
  static async #onEntryDelete(ev, t) {
    const i = this.#index(t), e = this.actor.system.entries[i];
    if (!e) return;
    const ok = await DialogV2.confirm({ window: { title: "Delete entry" }, content: `<p>Delete <b>${esc(e.name)}</b>?</p>`, rejectClose: false });
    if (ok) await this.actor.system.removeEntry(i);
  }
  static async #onEntryAdd(ev, t) {
    const section = t.dataset.section || "actions";
    const data = await ApTurmNpcSheet.editEntryDialog(emptyEntry(section), this.actor.system.mode, `New ${SECTIONS[section] ?? "entry"}`, this.#parentNames(section));
    if (data) await this.actor.system.addEntry(section, data);
  }
  /* ---------- actions: items box ---------- */

  #item(t) { return this.actor.items.get(t.closest("[data-item-id]")?.dataset.itemId); }
  static async #onCreateItem() {
    this.#itemsOpen = true;
    const item = await Item.implementation.create({ name: "New Item", type: "gear" }, { parent: this.actor });
    item?.sheet.render(true);
  }
  static #onEditItem(ev, t) { this.#item(t)?.sheet.render(true); }
  static async #onDeleteItem(ev, t) { const it = this.#item(t); if (it) await it.deleteDialog(); }
  /** "Save to library" on a gear row (GM only; writes the compendium, not the NPC). */
  static async #onSaveToLibrary(ev, t) { const it = this.#item(t); if (it) await saveToLibrary(it); }
  static #onPortrait(ev, t) { return portraitClick(this, ev, t); }
  static #onPlaceCopies() { return placeCopiesDialog(this.actor); }
  static async #onFromLibrary() { this.#itemsOpen = true; await fromLibraryDialog(this.actor); }

  static #onEntryRecharge(ev, t) { const i = this.#index(t), sys = this.actor.system; return sys.setEntryRecharge(i, !sys.entries[sys.holderIndex(i)]?.rechargeUsed); }
  /** Yellow "not assigned" tag (turm mode): swap it for an element dropdown in place; the choice replaces the D&D type. */
  static #onAssignType(ev, t) {
    const kind = t.dataset.kind, index = +t.dataset.index;
    const sel = document.createElement("select");
    sel.className = "apt-assign";
    sel.innerHTML = `<option value="">— choose element —</option>` + Object.entries(ELEMENTS).map(([k, v]) => `<option value="${k}">${esc(v.l)}</option>`).join("");
    t.after(sel); t.hidden = true; sel.focus();
    const close = () => { if (sel.isConnected) sel.remove(); t.hidden = false; };
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      const v = sel.value; close();
      if (!v) return;
      if (kind === "entry") this.actor.system.updateEntry(index, { dmgType: v });
      else this.actor.system.setDefense(kind, index, v);
    });
    sel.addEventListener("blur", close);
  }
  static #onHpAdjust(ev, t) { return applyHpDelta(this.actor, (+t.dataset.delta) * (ev.shiftKey ? 5 : 1)); }
  /** Condition chip: click removes it (exhaustion: one level down), right-click on exhaustion adds one. */
  static #onConditionChip(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return chipClick(this.actor, ev, t); }
  static #onConditionAdd(ev, t) { return addConditionMenu(this.actor, t); }
  static #onAddDefense(ev, t) {
    const kind = t.dataset.kind;
    const row = t.closest("[data-defense]");
    const custom = row.querySelector("input[type=text]");
    const key = custom?.value.trim();
    if (custom) custom.value = "";
    return this.actor.system.addDefense(kind, key);
  }
  static #onRemoveDefense(ev, t) { return this.actor.system.removeDefense(t.dataset.kind, +t.dataset.index); }
  static #onLegendaryPip(ev, t) { return this.actor.system.setLegendary(t.dataset.kind, +t.dataset.i); }
  static #onLegendaryReset(ev, t) { return this.actor.system.resetLegendary(t.dataset.kind || null); }
  static #onLongRest() { return this.actor.system.longRest(); }

  /** Parse the pasted statblock and write the recognized fields and entries; the text stays for a second pass. */
  static async #onExportNpcJson() { downloadNpcExport(this.actor); }

  static async #onImportNpcJson() { await importAppJSONIntoActor(this.actor); }

  static async #onParseStatblock() {
    const ta = this.element.querySelector("textarea[name='system.statblock']");
    const text = ta?.value ?? this.actor.system.statblock;
    if (!text?.trim()) { ui.notifications.warn("No text in the statblock field. Paste a statblock first."); return; }
    const parsed = parseStatblock(text);
    const usable = parseUsable(parsed);
    if (!usable.ok) { ui.notifications.error(`${usable.reason} ${this.actor.name} stays unchanged.`, { console: false }); return; }
    const update = statblockToUpdate(parsed);
    update.system.statblock = text;
    if (update.system.skills) for (const k of Object.keys(this.actor.system.skills)) if (!(k in update.system.skills)) update.system.skills[`-=${k}`] = null;
    await this.actor.update(update);
    const n = parsed.recognized.length, a = parsed.entries.length, u = this.actor.system.unassigned;
    ui.notifications.info(`Statblock: ${n} field group${n === 1 ? "" : "s"} recognized (${parsed.recognized.join(", ")}), ${a} entr${a === 1 ? "y" : "ies"}${u ? `, ${u} damage type${u === 1 ? "" : "s"} not assigned to an element` : ""}.`);
    this.changeTab("stats", "primary");
  }

  /** "Roll d20" in the header: plain d20 (Shift advantage, Ctrl/Alt disadvantage), speaker = this actor. */
  static #onRollD20(event) {
    return rollPlainD20(this.actor, event);
  }
}
