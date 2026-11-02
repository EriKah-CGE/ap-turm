/**
 * World migration. The system version a world was last opened with is stored in a world setting and
 * compared with system.json on ready. Is it older, the GM first gets a backup hint; after confirming,
 * every step newer than the stored version runs, the new version is written and a chat report is posted.
 *
 * The data models migrate old shapes on every read (CharacterData/NpcData/items .migrateData), so nothing
 * is ever broken - a migration only persists that result, so the stored data matches the final shape.
 * The pure helpers (compareVersions, needsMigration, stepsFor, legacyMarkers) are tested in Node.
 */
import { DATA_VERSION } from "./rules.mjs";
import { whisperGmNotice } from "./importer.mjs";

const SYSTEM_ID = "ap-turm";
export const VERSION_SETTING = "systemVersion";

/* ---------- pure helpers ---------- */

/** Compare two "x.y.z" strings: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a, b) {
  const pa = String(a ?? "").split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b ?? "").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * What to do for a stored version vs. the current one.
 * @returns {"fresh"|"none"|"migrate"|"downgrade"}  fresh: no stored version (new world), none: equal,
 *   migrate: stored is older, downgrade: stored is newer than the running system
 */
export function needsMigration(stored, current) {
  if (!stored) return "fresh";
  const c = compareVersions(stored, current);
  return c === 0 ? "none" : c < 0 ? "migrate" : "downgrade";
}

/** Steps to run for a world stored at `stored` moving to `current`. */
export function stepsFor(stored, current, steps = MIGRATIONS) {
  return steps.filter(s => compareVersions(s.version, stored) > 0 && compareVersions(s.version, current) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Legacy shapes still present in a document's *stored* source data. The data models read all of these
 * correctly; this only finds what is worth writing back once.
 * @param {string} type      Document type: character, npc, weapon, spell, feat, gear
 * @param {object} source    The raw stored system data (doc._source.system)
 * @returns {string[]}       Names of the findings (empty when the source is already current)
 */
export function legacyMarkers(type, source) {
  const s = source ?? {};
  const out = [];
  if (type === "character") {
    if (Array.isArray(s.crystals)) {
      if (s.crystals.some(c => typeof c === "string")) out.push("crystals as text");
      if (s.crystals.some(c => c && typeof c === "object" && c.elem === "macht")) out.push("crystal element macht");
    }
    if (s.play && typeof s.play.inspiration === "boolean") out.push("inspiration as yes/no");
  } else if (type === "npc") {
    if (Array.isArray(s.attacks) && s.attacks.length) out.push("attacks list");
    if (typeof s.traits === "string" && s.traits.trim()) out.push("traits as text");
    if (typeof s.actions === "string" && s.actions.trim()) out.push("actions as text");
    if (s.legendary && "value" in s.legendary && !("actions" in s.legendary)) out.push("legendary counter");
    if (s.saves && ["str", "dex", "con", "int", "wis", "cha"].some(a => s.saves[a] === 0)) out.push("save bonus 0");
    if (Array.isArray(s.entries) && s.entries.some(e => e && typeof e === "object" && e.adv)) out.push("per-entry combat modifiers");
  } else if (type === "weapon") {
    if (s.dtype === "macht") out.push("damage type macht");
  } else if (type === "spell") {
    if (s.elem === "macht") out.push("element macht");
  }
  return out;
}

/* ---------- steps ---------- */

/**
 * Persist what the data models already migrate on read: element "macht" -> "arch", crystals as objects,
 * inspiration as a number, NPC attacks/traits/actions -> entries, legendary counters, save bonus 0 -> null.
 * Only documents whose stored data actually carries one of those shapes are written.
 * @returns {Promise<{actors:number, items:number, tokens:number, findings:string[]}>}
 */
export async function persistLegacyShapes() {
  const res = { actors: 0, items: 0, tokens: 0, findings: [] };
  const note = (marks) => { for (const m of marks) if (!res.findings.includes(m)) res.findings.push(m); };

  for (const actor of game.actors) {
    try {
      const marks = legacyMarkers(actor.type, actor._source.system);
      if (marks.length) {
        note(marks);
        await actor.update({ system: actor.system.toObject() }, { recursive: false, diff: false });
        res.actors++;
      }
      const itemUpdates = [];
      for (const item of actor.items) {
        const im = legacyMarkers(item.type, item._source.system);
        if (!im.length) continue;
        note(im);
        itemUpdates.push({ _id: item.id, system: item.system.toObject() });
      }
      if (itemUpdates.length) {
        await actor.updateEmbeddedDocuments("Item", itemUpdates, { recursive: false, diff: false });
        res.items += itemUpdates.length;
      }
    } catch (err) {
      console.error(`${SYSTEM_ID} | migration: actor "${actor.name}" could not be updated`, err);
      ui.notifications.warn(`AP-Turm: "${actor.name}" could not be migrated, see the console.`);
    }
  }

  for (const item of game.items) {
    try {
      const marks = legacyMarkers(item.type, item._source.system);
      if (!marks.length) continue;
      note(marks);
      await item.update({ system: item.system.toObject() }, { recursive: false, diff: false });
      res.items++;
    } catch (err) {
      console.error(`${SYSTEM_ID} | migration: item "${item.name}" could not be updated`, err);
    }
  }

  // Unlinked tokens keep their own copy of the data. They are only counted, never rewritten: writing the
  // whole system data into a token delta would cut the token off from its base actor for every field.
  for (const scene of game.scenes) {
    for (const td of scene.tokens) {
      if (td.actorLink || !td.delta?._source?.system) continue;
      const type = td.actor?.type ?? td.baseActor?.type;
      if (legacyMarkers(type, td.delta._source.system).length) res.tokens++;
    }
  }
  return res;
}

/**
 * Migration steps in ascending version order: { version, run: async () => report }.
 * Add a step when a data format changes; it runs once for worlds stored below that version.
 */
export const MIGRATIONS = [
  {
    version: "1.0.0",
    label: "Store legacy field shapes permanently",
    run: async () => {
      const r = await persistLegacyShapes();
      const parts = [];
      if (r.actors) parts.push(`${r.actors} Actor${r.actors === 1 ? "" : "s"}`);
      if (r.items) parts.push(`${r.items} Item${r.items === 1 ? "" : "s"}`);
      if (!parts.length) return "nothing to change, all data already in its final shape";
      const extra = r.tokens ? ` · ${r.tokens} unlinked token(s) still carry old values (they keep working, they are translated on load)` : "";
      return `${parts.join(", ")} updated (${r.findings.join(", ")})${extra}`;
    }
  },
  {
    version: "1.3.0",
    label: "Spell rule: Spellslot is the spell purchase, Learn Spell becomes Extra Spell",
    run: async () => {
      const r = await migrateSpellRule();
      if (!r.converted.length) return "no character had Learn Spell purchases to convert";
      return `${r.converted.length} character(s) converted: ${r.converted.map(c => `${c.name} (${c.delta} AP)`).join(", ")}`;
    }
  }
];

/**
 * Store a spell rule conversion and tell the GMs once. The conversion itself already happened in memory when the
 * source entered the client (APTActor.migrateData -> rules.migrateActorSpellRule) and left its notice text in
 * flags["ap-turm"].spellRulePending. This writes the converted system data and the flags without that marker in one
 * update, then whispers the notice (actor name + AP difference) to the GMs. No marker: nothing to do.
 * @param {Actor} actor
 * @returns {Promise<{name:string, text:string}|null>}  the settled conversion, or null
 */
export async function settleSpellRule(actor) {
  if (actor?.type !== "character") return null;
  const text = actor._source.flags?.[SYSTEM_ID]?.spellRulePending;
  if (!text) return null;
  const flags = foundry.utils.deepClone(actor._source.flags);
  delete flags[SYSTEM_ID].spellRulePending;
  flags[SYSTEM_ID].dataVersion = DATA_VERSION;
  // recursive:false replaces system and flags as a whole: the stored data matches the converted state in one write
  await actor.update({ system: foundry.utils.deepClone(actor._source.system), flags }, { recursive: false, diff: false });
  await whisperGmNotice(actor.name, text);
  return { name: actor.name, text };
}

/** Text of the AP difference inside a notice ("-9"), for reports. */
export function noticeDelta(text) { return (String(text ?? "").match(/changed by ([+-]?\d+)/) ?? [])[1] ?? "?"; }

/**
 * settleSpellRule for every character actor (ready of the active GM, world migration step 1.3.0).
 * @param {Iterable<Actor>} [actors]  all world actors by default
 * @returns {Promise<{converted:{name:string, delta:string}[]}>}
 */
export async function migrateSpellRule(actors = game.actors) {
  const res = { converted: [] };
  for (const actor of actors) {
    try {
      const r = await settleSpellRule(actor);
      if (r) res.converted.push({ name: r.name, delta: noticeDelta(r.text) });
    } catch (err) {
      console.error(`${SYSTEM_ID} | spell rule migration: "${actor.name}"`, err);
      ui.notifications.warn(`AP-Turm: "${actor.name}" could not be converted, see the console.`);
    }
  }
  return res;
}

/* ---------- Foundry side ---------- */

export function registerMigrationSetting() {
  game.settings.register(SYSTEM_ID, VERSION_SETTING, { scope: "world", config: false, type: String, default: "" });
}

/**
 * Backup hint before the first run after an update. "Later" postpones: the stored version stays untouched,
 * so the dialog comes back on the next start.
 * @returns {Promise<boolean>}  whether the migration may run
 */
export async function confirmMigration(stored, current, steps) {
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const list = steps.map(s => `<li>${esc(s.label ?? s.version)}</li>`).join("");
  const content = `<div class="apt-migration">
    <p><b>AP-Turm ${esc(stored)} &rarr; ${esc(current)}</b></p>
    <p>This world was last opened with an older system version. Before any data is written:
    <b>back up the Data folder</b> - at least <code>Data/worlds/${esc(game.world?.id ?? "")}</code> -
    or create a backup via <i>Backups</i> in the setup screen. The migration cannot be undone.</p>
    ${list ? `<p>To run:</p><ul>${list}</ul>` : "<p>No data changes are pending, only the version number is recorded.</p>"}
    <p class="hint">"Later" postpones the migration to the next start.</p>
  </div>`;
  return foundry.applications.api.DialogV2.wait({
    window: { title: "AP-Turm: Migrate world", icon: "fa-solid fa-database" },
    position: { width: 520 },
    content,
    rejectClose: false,
    buttons: [
      { action: "run", label: "Backup done, migrate", icon: "fa-solid fa-check", default: true, callback: () => true },
      { action: "later", label: "Later", icon: "fa-solid fa-clock", callback: () => false }
    ]
  }).then(v => v === true);
}

/** ready (active GM only): compare and migrate. */
export async function checkMigration() {
  if (!game.user.isActiveGM) return;
  const stored = game.settings.get(SYSTEM_ID, VERSION_SETTING);
  const current = game.system.version;
  const state = needsMigration(stored, current);
  if (state === "none") return;
  if (state === "downgrade") {
    ui.notifications.warn(`AP-Turm: this world was last opened with ${stored}, this is ${current}. Nothing was migrated.`, { permanent: true });
    return;
  }
  if (state === "fresh") {
    await game.settings.set(SYSTEM_ID, VERSION_SETTING, current);
    return;
  }
  const steps = stepsFor(stored, current);
  if (!(await confirmMigration(stored, current, steps))) {
    ui.notifications.info("AP-Turm: migration postponed. It is offered again on the next start.");
    return;
  }
  return migrateWorld(stored, current);
}

/** Run the migration steps from `stored` to `current`, store the version, post the chat report. */
export async function migrateWorld(stored = game.settings.get(SYSTEM_ID, VERSION_SETTING), current = game.system.version) {
  const steps = stepsFor(stored, current);
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const lines = [];
  for (const step of steps) {
    try {
      const report = await step.run();
      lines.push(`<li><b>${esc(step.version)}</b> ${esc(step.label ?? "")}: ${esc(report ?? "done")}</li>`);
    } catch (err) {
      console.error(`${SYSTEM_ID} | migration ${step.version} failed`, err);
      ui.notifications.error(`AP-Turm: migration ${step.version} failed, see the console. The version number stays at ${stored}.`, { permanent: true });
      return false;
    }
  }
  await game.settings.set(SYSTEM_ID, VERSION_SETTING, current);
  await ChatMessage.implementation.create({
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: `<div class="ap-turm-chat apt-applied"><p><b>AP-Turm migrated to ${esc(current)}</b>${stored ? ` (from ${esc(stored)})` : ""}.</p>`
      + (lines.length ? `<ul>${lines.join("")}</ul>` : "<p>No data changes were needed.</p>") + `</div>`,
    flags: { [SYSTEM_ID]: { type: "migration", from: stored, to: current } }
  });
  ui.notifications.info(`AP-Turm: world migrated to ${current}.`);
  return true;
}
