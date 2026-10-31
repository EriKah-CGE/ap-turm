/**
 * NPC exchange between worlds: an NPC actor as a small, self-describing JSON file.
 *
 * The format is the system's own (not the app's, which only knows characters):
 *   { format: "ap-turm-npc", v: 1, system: "ap-turm", name, img, token: {…}, data: {…NpcData source…} }
 * `data` is the NPC's plain system data, so a re-import runs through NpcData.migrateData() like any
 * other document and older files keep working.
 *
 * The pure functions (exportNpcData / isNpcExport / validateNpcExport / npcImportData) have no Foundry
 * globals and are tested in Node; the rest is the Foundry UI.
 */

export const NPC_FORMAT = "ap-turm-npc";
export const NPC_FORMAT_VERSION = 1;

const str = (v, d = "") => (typeof v === "string" ? v : d);
const num = (v, d) => { const x = Number(v); return Number.isFinite(x) ? Math.trunc(x) : d; };

/**
 * Build the export object for an NPC.
 * @param {object} args
 * @param {string} args.name
 * @param {string} [args.img]
 * @param {object} args.system            NpcData source data (actor.system.toObject())
 * @param {object} [args.prototypeToken]  Prototype token source data
 * @returns {object}
 */
export function exportNpcData({ name, img, system, prototypeToken }) {
  const t = prototypeToken || {};
  return {
    format: NPC_FORMAT,
    v: NPC_FORMAT_VERSION,
    system: "ap-turm",
    name: str(name, "NPC"),
    img: str(img),
    token: {
      width: num(t.width, 1), height: num(t.height, 1),
      disposition: num(t.disposition, -1),
      texture: str(t.texture?.src)
    },
    data: structuredClone(system ?? {})
  };
}

/** File name for an NPC export: ap_npc_<name>.json */
export function npcFileName(name) {
  const safe = String(name || "npc").replace(/[^\w\-]+/g, "_").toLowerCase();
  return `ap_npc_${safe}.json`;
}

/** Does this parsed JSON look like an NPC export of this system? */
export function isNpcExport(data) {
  return !!data && typeof data === "object" && !Array.isArray(data) && data.format === NPC_FORMAT;
}

/**
 * Check an NPC export before anything is created.
 * @param {*} data  Parsed JSON
 * @returns {{ok:boolean, reason?:string}}
 */
export function validateNpcExport(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "The file contains no JSON object." };
  if (data.format !== NPC_FORMAT) return { ok: false, reason: `Not an AP-Turm NPC export (field "format" is ${JSON.stringify(data.format ?? null)}, expected "${NPC_FORMAT}").` };
  if (num(data.v, 0) > NPC_FORMAT_VERSION) return { ok: false, reason: `The file comes from a newer system version (format ${data.v}, known here: ${NPC_FORMAT_VERSION}).` };
  if (!data.data || typeof data.data !== "object" || Array.isArray(data.data)) return { ok: false, reason: 'Field "data" is missing or not an object.' };
  if (!str(data.name).trim()) return { ok: false, reason: 'Field "name" is missing.' };
  return { ok: true };
}

/**
 * Convert an NPC export into Actor creation / update data. Validate first.
 * @param {object} data
 * @returns {{name:string, type:"npc", img?:string, prototypeToken:object, system:object}}
 */
export function npcImportData(data) {
  const out = {
    name: str(data.name, "NPC"),
    type: "npc",
    system: structuredClone(data.data ?? {}),
    prototypeToken: {
      width: Math.max(0.5, num(data.token?.width, 1)),
      height: Math.max(0.5, num(data.token?.height, 1)),
      disposition: num(data.token?.disposition, -1)
    }
  };
  if (str(data.img)) out.img = data.img;
  if (str(data.token?.texture)) out.prototypeToken.texture = { src: data.token.texture };
  return out;
}

/* ---------- Foundry UI ---------- */

/**
 * Export data for a live NPC actor.
 * @param {Actor} actor
 */
export function exportNpc(actor) {
  return exportNpcData({
    name: actor.name,
    img: actor.img,
    system: actor.system.toObject(),
    prototypeToken: actor.prototypeToken?.toObject?.() ?? {}
  });
}

/** Download the NPC as JSON. */
export function downloadNpcExport(actor) {
  if (actor.type !== "npc") { ui.notifications.warn("This export is for NPCs only."); return null; }
  const data = exportNpc(actor);
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", npcFileName(actor.name));
  ui.notifications.info(game.i18n.format("AP_TURM.Export.NpcDone", { name: actor.name }));
  return data;
}

/**
 * Create a new NPC actor from an export.
 * @param {object} data
 * @returns {Promise<Actor>}
 */
export async function createNpcFromExport(data) {
  const check = validateNpcExport(data);
  if (!check.ok) throw new Error(check.reason);
  const actor = await Actor.implementation.create(npcImportData(data));
  ui.notifications.info(`NPC "${actor.name}" imported (${actor.system.entries.length} entries).`);
  return actor;
}

/**
 * Replace an existing NPC's data with an export. The system data is written with recursive:false so
 * stale entries and defenses disappear instead of merging.
 * @param {Actor} actor
 * @param {object} data
 * @returns {Promise<Actor>}
 */
export async function importNpcIntoActor(actor, data) {
  if (actor.type !== "npc") throw new Error("Import target must be an npc actor");
  const check = validateNpcExport(data);
  if (!check.ok) throw new Error(check.reason);
  const d = npcImportData(data);
  await actor.update({ name: d.name, system: d.system }, { recursive: false });
  ui.notifications.info(`${actor.name} replaced from NPC JSON (${actor.system.entries.length} entries).`);
  return actor;
}
