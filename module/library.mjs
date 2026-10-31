/**
 * Item library (Paket D): a world compendium "AP-Turm Library" for recurring tower items.
 *
 * - Created on first use by a GM (not at every start), as a plain world pack of type Item. No system pack,
 *   it is the GM's own library and travels with the world backup. Players get read access (OBSERVER).
 * - In: "Save to library" (GM only) on a gear row, on the gear item sheet, in the Items sidebar, and the
 *   "Also save to library" box of a loot claim. A name that already exists asks Replace / Save as copy / Cancel.
 * - Out: Foundry's normal drag from the compendium, or "From library" on the character inventory (players
 *   too, the item is created on their own sheet). The origin stays as it was saved.
 */
const SYSTEM_ID = "ap-turm";
export const LIBRARY_NAME = "ap-turm-library";
export const LIBRARY_LABEL = "AP-Turm Library";
export const LIBRARY_OWNERSHIP = { PLAYER: "OBSERVER", ASSISTANT: "OWNER" };

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
// resolved lazily so the pure helpers can be imported in Node (test/rules.test.mjs)
const dialog = () => foundry.applications.api.DialogV2;

/* ============================================================
   Pure logic
   ============================================================ */

/** Names are compared trimmed and case-insensitive ("Heiltrank" = "heiltrank "). */
export const nameKey = (name) => String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The library entry with the same name, if any.
 * @param {Iterable<{_id?:string, id?:string, name:string}>} entries  pack index or documents
 * @param {string} name
 */
export function findByName(entries, name) {
  const key = nameKey(name);
  for (const e of entries || []) if (nameKey(e?.name) === key) return e;
  return null;
}

/**
 * Name for "Save as copy": "Heiltrank (2)", "(3)" ... - the first number not yet taken.
 * An existing number suffix is continued ("Heiltrank (2)" -> "Heiltrank (3)").
 * @param {string} name
 * @param {Iterable<string>} taken  names already in the library
 */
export function copyName(name, taken) {
  const used = new Set([...(taken || [])].map(nameKey));
  const base = String(name ?? "").trim().replace(/\s*\((\d+)\)$/, "") || "New Item";
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/**
 * What saving does with a given conflict answer.
 * @param {object|null} existing  library entry with the same name (from findByName)
 * @param {"replace"|"copy"|"cancel"|null} choice  answer of the conflict dialog (ignored without a conflict)
 * @param {string} name
 * @param {Iterable<string>} taken
 * @returns {{action:"create", name:string}|{action:"replace", id:string, name:string}|{action:"cancel"}}
 */
export function resolveConflict(existing, choice, name, taken) {
  if (!existing) return { action: "create", name };
  if (choice === "replace") return { action: "replace", id: existing._id ?? existing.id, name: existing.name };
  if (choice === "copy") return { action: "create", name: copyName(name, taken) };
  return { action: "cancel" };
}

/**
 * The data that goes into the library, or back onto an actor: name, type, img, the complete system data
 * and flags. Ids, ownership, folder, sort and document stats stay behind (they belong to the place the
 * item lives in, not to the item).
 * @param {object} source  item.toObject() (or plain data of the same shape)
 * @param {object} [opts]  {name: override the name}
 */
export function libraryData(source, { name } = {}) {
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const data = {
    name: name ?? source.name,
    type: source.type,
    system: clone(source.system ?? {}),
    flags: clone(source.flags ?? {})
  };
  if (source.img) data.img = source.img;
  if (Array.isArray(source.effects) && source.effects.length) {
    data.effects = clone(source.effects).map(e => { delete e._id; delete e._stats; return e; });
  }
  return data;
}

/** Entries of the picker filtered by a search text (all words, any order), sorted by name. */
export function filterEntries(entries, query) {
  const words = nameKey(query).split(" ").filter(Boolean);
  return [...(entries || [])]
    .filter(e => { const k = nameKey(e?.name); return words.every(w => k.includes(w)); })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/* ============================================================
   Foundry side: the pack
   ============================================================ */

/** The library pack if it exists (by its name, otherwise by its label). */
export function getLibrary() {
  return game.packs.get(`world.${LIBRARY_NAME}`)
    ?? game.packs.find(p => p.metadata.packageType === "world" && p.documentName === "Item" && p.metadata.label === LIBRARY_LABEL)
    ?? null;
}

/** The library, created on first use (GM only). */
async function ensureLibrary() {
  const existing = getLibrary();
  if (existing) return existing;
  if (!game.user.isGM) return null;
  const CC = foundry.documents.collections.CompendiumCollection;
  const pack = await CC.createCompendium({ name: LIBRARY_NAME, label: LIBRARY_LABEL, type: "Item" });
  if (!pack) return null;
  await pack.configure({ ownership: { ...LIBRARY_OWNERSHIP } });
  ui.notifications.info(`Compendium "${LIBRARY_LABEL}" created.`);
  return pack;
}

/** Replace / Save as copy / Cancel. */
function askConflict(name) {
  return dialog().wait({
    window: { title: "Save to library", icon: "fa-solid fa-book-bookmark" },
    content: `<p>The library already contains <b>${esc(name)}</b>.</p>`,
    buttons: [
      { action: "replace", label: "Replace", icon: "fa-solid fa-arrows-rotate" },
      { action: "copy", label: "Save as copy", icon: "fa-solid fa-copy", default: true },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
}

/**
 * Save a gear item to the library (GM only). Asks on a name conflict.
 * @param {Item|object} item   the item or its plain data
 * @param {object} [opts]      {notify: show a notification (default true)}
 * @returns {Promise<Item|null>}  the library entry, null when cancelled or not allowed
 */
export async function saveToLibrary(item, { notify = true } = {}) {
  if (!game.user.isGM) { ui.notifications.warn("Only the GM can save items to the library."); return null; }
  const source = typeof item?.toObject === "function" ? item.toObject() : foundry.utils.deepClone(item ?? {});
  if (source.type !== "gear") { ui.notifications.warn("Only items (gear) can be saved to the library."); return null; }
  const pack = await ensureLibrary();
  if (!pack) return null;
  if (pack.locked) { ui.notifications.warn(`${pack.title} is locked - unlock it in the Compendium tab first.`); return null; }
  const index = await pack.getIndex();
  const existing = findByName(index, source.name);
  const choice = existing ? await askConflict(existing.name) : null;
  const plan = resolveConflict(existing, choice, source.name, [...index].map(e => e.name));
  if (plan.action === "cancel") return null;
  const data = libraryData(source, { name: plan.name });
  const Item = foundry.utils.getDocumentClass("Item");
  let saved = null;
  if (plan.action === "replace") {
    const doc = await pack.getDocument(plan.id);
    // recursive:false swaps system and flags as a whole, so fields removed on the item do not linger
    saved = await doc?.update({ name: data.name, img: data.img ?? doc.img, system: data.system, flags: data.flags }, { recursive: false, diff: false });
    saved ??= doc;
  } else {
    [saved] = await Item.createDocuments([data], { pack: pack.collection });
  }
  if (saved && notify) {
    const how = plan.action === "replace" ? "replaced in" : "saved to";
    ui.notifications.info(`${data.name} ${how} ${pack.title}.`);
  }
  return saved ?? null;
}

/* ============================================================
   Foundry side: take an item out of the library
   ============================================================ */

/**
 * Create a library entry on an actor. The origin and every other field stay as saved.
 * @returns {Promise<Item|null>}
 */
export async function createFromLibrary(actor, id) {
  const pack = getLibrary();
  if (!pack || !actor?.isOwner) return null;
  const doc = await pack.getDocument(id);
  if (!doc) { ui.notifications.warn("This entry is no longer in the library."); return null; }
  const data = libraryData(doc.toObject());
  data._stats = { compendiumSource: doc.uuid };
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  if (created) ui.notifications.info(`${created.name} added to ${actor.name}.`);
  return created ?? null;
}

/** "From library": compact search list of the library; a click creates the item on the actor. */
export async function fromLibraryDialog(actor) {
  if (!actor?.isOwner) { ui.notifications.warn(`You do not own ${actor?.name ?? "this actor"}.`); return null; }
  const pack = getLibrary();
  if (!pack || !pack.visible) { ui.notifications.warn("There is no item library yet - the GM creates it with \"Save to library\"."); return null; }
  const index = await pack.getIndex({ fields: ["system.qty", "system.origin", "system.charges"] });
  const entries = [...index].filter(e => e.type === "gear");
  if (!entries.length) { ui.notifications.info(`${pack.title} is empty.`); return null; }
  const isTurm = actor.system?.mode === "turm";
  const row = (e) => {
    const s = e.system ?? {};
    const meta = [
      Number(s.qty) > 1 ? `×${Number(s.qty)}` : "",
      Number(s.charges) > 0 ? `${Number(s.charges)} ch.` : "",
      isTurm ? (s.origin === "tower" ? "tower" : "carried in") : ""
    ].filter(Boolean).join(" · ");
    return `<li><a class="apt-lib-entry" data-id="${e._id}"><img src="${esc(e.img)}" alt=""><span class="n">${esc(e.name)}</span><small>${esc(meta)}</small></a></li>`;
  };
  let chosen = null;
  await dialog().wait({
    window: { title: `From library: ${actor.name}`, icon: "fa-solid fa-book-open" },
    position: { width: 380 },
    content: `<div class="apt-lib-picker">
      <input type="search" name="q" placeholder="Search ${entries.length} items" autocomplete="off" autofocus>
      <ul class="apt-lib-list">${filterEntries(entries, "").map(row).join("")}</ul>
      <p class="hint apt-lib-none" hidden>No match.</p>
    </div>`,
    buttons: [{ action: "close", label: "Close", icon: "fa-solid fa-xmark" }],
    rejectClose: false,
    render: (event, dlg) => {
      const root = dlg.element;
      const input = root.querySelector("input[name=q]");
      const list = root.querySelector(".apt-lib-list");
      const none = root.querySelector(".apt-lib-none");
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.preventDefault(); });   // no submit
      input.addEventListener("input", () => {
        const hits = filterEntries(entries, input.value);
        list.innerHTML = hits.map(row).join("");
        none.hidden = hits.length > 0;
      });
      list.addEventListener("click", (ev) => {
        const a = ev.target.closest(".apt-lib-entry");
        if (!a) return;
        ev.preventDefault();
        chosen = a.dataset.id;
        dlg.close();
      });
    }
  });
  if (!chosen) return null;
  return createFromLibrary(actor, chosen);
}

/* ============================================================
   Registration
   ============================================================ */

/** "Save to library" in the context menu of gear items in the Items sidebar (GM only). */
export function registerLibrary() {
  Hooks.on("getItemContextOptions", (app, options) => {
    options.push({
      name: "Save to library",
      icon: '<i class="fa-solid fa-book-bookmark"></i>',
      condition: (li) => game.user.isGM && game.items.get(li.dataset.entryId)?.type === "gear",
      callback: (li) => {
        const item = game.items.get(li.dataset.entryId);
        if (item) saveToLibrary(item).catch(err => console.error(`${SYSTEM_ID} | library`, err));
      }
    });
  });
}

export const library = { saveToLibrary, fromLibraryDialog, createFromLibrary, getLibrary, findByName, copyName, resolveConflict, libraryData, filterEntries };
