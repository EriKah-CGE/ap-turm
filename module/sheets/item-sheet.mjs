/**
 * Item sheet (weapon / spell / feat / gear), editable. Fields mirror the app's edit modals.
 */
import { ABILITIES, ABBR, RECHARGE, GEAR_ORIGINS, WEAPON_ABILITY_LABELS, FEAT_EXTRA, SPELL_LEVELS, damageTypeOptions, damageTypeGroupOptions } from "../config.mjs";

import { SheetSizeMixin } from "./sizing.mjs";
import { saveToLibrary } from "../library.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

// remembered size per item type ("item.weapon" ...), defaults from SHEET_SIZES.item
export class ApTurmItemSheet extends SheetSizeMixin(HandlebarsApplicationMixin(ItemSheetV2), (o) => `item.${o.document?.type ?? "item"}`) {

  static DEFAULT_OPTIONS = {
    classes: ["ap-turm", "sheet", "item"],
    position: { width: 520, height: 560 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: { saveToLibrary: ApTurmItemSheet.#onSaveToLibrary }
  };

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
    }
    return Object.assign(context, ctx);
  }
}
