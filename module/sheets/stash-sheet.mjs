/**
 * Party stash sheet: the items (open list, draggable onto one's own sheet, "Take" per row), the purse of the
 * stash's mode and "From library" for the GM. Every player owns the stash; there is no carry limit here.
 */
import { CURRENCIES, MODES } from "../config.mjs";
import { npcItemRows } from "../npc-items.mjs";
import { SheetSizeMixin } from "./sizing.mjs";
import { saveToLibrary, fromLibraryDialog } from "../library.mjs";
import { takeDialog, takeCandidates } from "../transfer.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class ApTurmStashSheet extends SheetSizeMixin(HandlebarsApplicationMixin(ActorSheetV2), "stash") {
  static DEFAULT_OPTIONS = {
    classes: ["ap-turm", "sheet", "actor", "stash"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      take: ApTurmStashSheet.#onTake,
      createItem: ApTurmStashSheet.#onCreateItem,
      editItem: ApTurmStashSheet.#onEditItem,
      deleteItem: ApTurmStashSheet.#onDeleteItem,
      saveToLibrary: ApTurmStashSheet.#onSaveToLibrary,
      fromLibrary: ApTurmStashSheet.#onFromLibrary
    }
  };

  static PARTS = { main: { template: "systems/ap-turm/templates/actor/stash/stash.hbs", scrollable: [".apt-stash-items"] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const mode = actor.system.mode;
    const canTake = takeCandidates().length > 0;
    return Object.assign(context, {
      actor, system: actor.system, isGM: game.user.isGM, owner: actor.isOwner, canTake,
      modes: Object.entries(MODES).map(([value, label]) => ({ value, label, selected: value === mode })),
      currency: CURRENCIES[mode === "ap" ? "ap" : "turm"].map(([key, abbr, title]) => ({ key, abbr, title, value: actor.system.currency[key] ?? 0 })),
      items: npcItemRows(actor.items, { isGM: game.user.isGM })
    });
  }

  #item(t) { return this.actor.items.get(t.closest("[data-item-id]")?.dataset.itemId); }

  static async #onTake(ev, t) { const it = this.#item(t); if (it) await takeDialog(it); }
  static async #onCreateItem() {
    const item = await Item.implementation.create({ name: "New Item", type: "gear", system: { origin: this.actor.system.mode === "turm" ? "tower" : "city" } }, { parent: this.actor });
    item?.sheet.render(true);
  }
  static #onEditItem(ev, t) { this.#item(t)?.sheet.render(true); }
  static async #onDeleteItem(ev, t) { const it = this.#item(t); if (it) await it.deleteDialog(); }
  static async #onSaveToLibrary(ev, t) { const it = this.#item(t); if (it) await saveToLibrary(it); }
  static async #onFromLibrary() { await fromLibraryDialog(this.actor); }
}
