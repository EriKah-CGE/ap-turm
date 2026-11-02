/**
 * Item sheet (weapon / spell / feat / gear), editable. Fields mirror the app's edit modals.
 */
import { ABILITIES, ABBR, SKILLS, RECHARGE, GEAR_ORIGINS, WEAPON_ABILITY_LABELS, FEAT_EXTRA, SPELL_LEVELS, damageTypeOptions, damageTypeGroupOptions, damageTypeGroups, damageTypeLabel } from "../config.mjs";
import { ITEM_BON, compactEffects } from "../rules.mjs";

import { SheetSizeMixin } from "./sizing.mjs";
import { saveToLibrary } from "../library.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

// remembered size per item type ("item.weapon" ...), defaults from SHEET_SIZES.item
/** adv / dis view for the gear sheet: skills, saves and the three single rolls as checkbox options. */
function rollFxView(x) {
  return {
    skills: Object.keys(SKILLS).map(k => ({ value: k, label: SKILLS[k].l, selected: (x?.skills ?? []).includes(k) })),
    saves: Object.keys(ABILITIES).map(k => ({ value: k, label: ABILITIES[k], selected: (x?.saves ?? []).includes(k) })),
    attack: !!x?.attack, init: !!x?.init, death: !!x?.death
  };
}

/** Grouped options for a multi-select of damage types; stored values outside both lists stay selected. */
function damageTypeGroupOptionsMulti(mode, list) {
  const cur = new Set(list ?? []);
  const groups = damageTypeGroups(mode).map(g => ({ label: g.label, options: g.options.map(o => ({ ...o, selected: cur.has(o.value) })) }));
  const known = new Set(groups.flatMap(g => g.options.map(o => o.value)));
  const extra = [...cur].filter(v => !known.has(v)).map(v => ({ value: v, label: damageTypeLabel(v), selected: true }));
  return { extra, groups };
}

export class ApTurmItemSheet extends SheetSizeMixin(HandlebarsApplicationMixin(ItemSheetV2), (o) => `item.${o.document?.type ?? "item"}`) {

  static DEFAULT_OPTIONS = {
    classes: ["ap-turm", "sheet", "item"],
    position: { width: 520, height: 560 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: { saveToLibrary: ApTurmItemSheet.#onSaveToLibrary }
  };

  /** Gear "Effects" section open / closed (sheet-local; every change re-renders the sheet and keeps it). */
  #fxOpen = null;

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("details.apt-effects")?.addEventListener("toggle", (ev) => { this.#fxOpen = ev.currentTarget.open; });
  }

  /** "Save to library" in the header menu of a gear item (GM only) - on characters, NPCs and world items. */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    if (game.user.isGM && this.item.type === "gear" && !this.item.pack) {
      controls.push({ action: "saveToLibrary", icon: "fa-solid fa-book-bookmark", label: "Save to library" });
    }
    return controls;
  }

  static async #onSaveToLibrary() {
    await this.submit?.().catch(() => null);   // pending edits of the open sheet go along
    await saveToLibrary(this.item);
  }

  static PARTS = {
    sheet: { template: "systems/ap-turm/templates/item/item.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const sys = item.system;
    const actor = item.actor;
    const mode = actor ? actor.system.mode : "turm";
    const isTurm = mode === "turm";
    const opt = (map, sel, extra = []) => [...extra, ...Object.entries(map).map(([value, label]) => ({ value, label, selected: value === sel }))];

    const ctx = {
      item, system: sys, name: item.name, img: item.img, type: item.type,
      typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      isWeapon: item.type === "weapon", isSpell: item.type === "spell", isFeat: item.type === "feat", isGear: item.type === "gear",
      isTurm, pb: actor?.system.pb ?? 2
    };
    if (ctx.isWeapon) {
      // ap: D&D damage types; turm: D&D damage types and elements as two groups (1.3.0); other values stay selectable
      ctx.dtypeGroups = damageTypeGroupOptions(mode, sys.dtype);
      ctx.type2Groups = damageTypeGroupOptions(mode, sys.type2, { none: true, noneLabel: "— same as first line —" });
      ctx.grouped = isTurm;
      ctx.abilOptions = opt(WEAPON_ABILITY_LABELS, sys.abil);
    }
    if (ctx.isSpell) {
      ctx.lvlOptions = SPELL_LEVELS.map(l => ({ value: l, label: l === 0 ? "Cantrip" : "Level " + l, selected: Number(sys.lvl) === l }));
      ctx.elemOptions = [{ value: "", label: "— none —", selected: !sys.elem }, ...damageTypeOptions(mode, sys.elem)];
      ctx.descriptionField = sys.schema.fields.description;
      ctx.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? "", { relativeTo: item, secrets: item.isOwner });
    }
    if (ctx.isFeat) {
      ctx.bonAbilities = Object.keys(ABILITIES).map(k => ({ key: k, label: ABBR[k], value: sys.bon[k] || 0 }));
      ctx.bonExtra = Object.entries(FEAT_EXTRA).map(([k, l]) => ({ key: k, label: l, value: sys.bon[k] || 0 }));
    }
    if (ctx.isGear) {
      ctx.originOptions = opt(GEAR_ORIGINS, sys.origin);
      ctx.rechargeOptions = opt(RECHARGE, sys.recharge);
      // items with effects (1.3.0): only while equipped (and attuned if attunement is required)
      const fx = sys.effects;
      const sel = (list, key) => (list ?? []).includes(key);
      ctx.fx = {
        open: this.#fxOpen ?? !!compactEffects(fx),
        bon: Object.entries(ITEM_BON).map(([key, label]) => ({ key, label, value: fx.bon?.[key] || 0 })),
        saves: Object.keys(ABILITIES).map(k => ({ key: k, label: ABBR[k], bonus: fx.saveBon?.[k] || 0 })),
        skills: Object.keys(SKILLS).sort((a, b) => SKILLS[a].l.localeCompare(SKILLS[b].l)).map(k => ({ key: k, label: SKILLS[k].l, bonus: fx.skillBon?.[k] || 0 })),
        profSkills: Object.keys(SKILLS).map(k => ({ value: k, label: SKILLS[k].l, selected: sel(fx.prof?.skills, k) })),
        profSaves: Object.keys(ABILITIES).map(k => ({ value: k, label: ABILITIES[k], selected: sel(fx.prof?.saves, k) })),
        adv: rollFxView(fx.adv), dis: rollFxView(fx.dis),
        // defenses: turm mode both lists (D&D types and elements), ap mode D&D types
        res: damageTypeGroupOptionsMulti(mode, fx.res), imm: damageTypeGroupOptionsMulti(mode, fx.imm), vuln: damageTypeGroupOptionsMulti(mode, fx.vuln),
        grouped: isTurm, senses: fx.senses, note: fx.note
      };
    }
    return Object.assign(context, ctx);
  }
}
