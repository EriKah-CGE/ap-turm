/**
 * The "AP-Turm Rules" journal in the world: created by the active GM at the first world start, rebuilt whenever
 * the generated pages differ from the stored ones (system update, custom shop change) and on demand from the
 * AP-Turm sidebar menu ("Rebuild rules journal"). Players can read it (default ownership Observer).
 * The pages come from rules-journal-logic.mjs; manual edits are overwritten on the next rebuild.
 */
import { buildRulesPages, pagesHash, JOURNAL_NAME } from "./rules-journal-logic.mjs";

const SYSTEM_ID = "ap-turm";
const FLAG = "rulesJournal";

/** The system's rules journal (by flag, else by name). */
export function rulesJournal() {
  return game.journal?.find(j => j.getFlag(SYSTEM_ID, FLAG)) ?? game.journal?.getName(JOURNAL_NAME) ?? null;
}

const isActiveGM = () => game.user.isGM && (!game.users.activeGM || game.users.activeGM.id === game.user.id);

/**
 * Create or refresh the rules journal.
 * @param {object} [o]  {force: rebuild even when the stored pages are current}
 * @returns {Promise<JournalEntry|null>}
 */
export async function ensureRulesJournal({ force = false } = {}) {
  if (!isActiveGM()) return null;
  const pages = buildRulesPages();
  const hash = pagesHash(pages);
  const flags = { [SYSTEM_ID]: { [FLAG]: { hash, version: game.system.version } } };
  const pageData = pages.map((p, i) => ({ name: p.name, type: "text", sort: (i + 1) * 100000, text: { content: p.content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }));
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const journal = rulesJournal();
  if (!journal) {
    const created = await JournalEntry.implementation.create({ name: JOURNAL_NAME, ownership: { default: observer }, flags, pages: pageData });
    console.log(`${SYSTEM_ID} | rules journal created`);
    return created;
  }
  if (!force && journal.getFlag(SYSTEM_ID, FLAG)?.hash === hash) return journal;
  // same journal (links to it keep working), pages replaced
  const old = journal.pages.map(p => p.id);
  if (old.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", old);
  await journal.createEmbeddedDocuments("JournalEntryPage", pageData);
  await journal.update({ name: JOURNAL_NAME, "ownership.default": observer, flags });
  console.log(`${SYSTEM_ID} | rules journal rebuilt`);
  return journal;
}

/** Menu entry: rebuild now (overwrites manual edits). */
export async function rebuildRulesJournal() {
  if (!game.user.isGM) return null;
  const j = await ensureRulesJournal({ force: true });
  if (j) ui.notifications.info(`${JOURNAL_NAME} rebuilt.`);
  return j;
}

/** After a custom shop change (setting onChange on every client): the active GM regenerates the pages. */
export const scheduleRulesRebuild = foundry.utils.debounce(() => {
  ensureRulesJournal().catch(err => console.error(`${SYSTEM_ID} | rules journal`, err));
}, 500);
