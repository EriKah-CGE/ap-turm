/**
 * NPC item list (stats tab, collapsible "Items" box): the rows the sheet shows for the NPC's embedded items.
 * A flat list without carry limit or origin groups - it exists so that items dropped on an NPC are visible.
 * Pure, so the rows can be checked in Node (test/rules.test.mjs).
 */

/**
 * Rows for the "Items" box, in the items' sort order.
 * @param {Iterable<{id?:string, _id?:string, name:string, type:string, sort?:number, system?:object}>} items
 * @param {object} [opts]  {isGM: show "Save to library" on gear rows}
 * @returns {{id:string, name:string, type:string, isGear:boolean, qty:number, notes:string, canSave:boolean}[]}
 */
export function npcItemRows(items, { isGM = false } = {}) {
  return [...(items || [])]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)))
    .map(i => {
      const isGear = i.type === "gear";
      const sys = i.system ?? {};
      return {
        id: i.id ?? i._id,
        name: i.name,
        type: i.type,
        isGear,
        qty: isGear ? Math.max(1, Number(sys.qty) || 1) : 1,
        // gear keeps its notes in "notes", feats in "desc"; the box shows one line of it
        notes: String((isGear ? sys.notes : (sys.notes ?? sys.desc)) ?? "").replace(/\s+/g, " ").trim(),
        canSave: isGM && isGear
      };
    });
}
