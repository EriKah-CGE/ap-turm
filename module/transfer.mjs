/**
 * Item transfer between characters (Paket B.2) and claiming loot from a RollTable card (Paket B.3).
 *
 * - Only gear can change hands; weapons and feats are personal, crystals stay the GM's business.
 * - Order: create at the receiver first, remove at the giver only when that worked. Both writes happen
 *   on one client: the giver when they own the receiver too, otherwise the active GM over the socket.
 * - Drop targets: another character's sheet, a token on the canvas, a row in the Actors sidebar.
 * - Claim: the "Claim" button on a RollTable draw creates the result as a gear item (or books a pure
 *   currency amount) and then marks that row as claimed for everyone.
 * - Party stash (Actor subtype "stash", owned by every player): items go in like to a character (give / drag),
 *   loot and currency can be claimed into it, and every player takes items out onto their OWN character
 *   ("Take" or drag). A player without owner rights on the stash is served by the active GM over the socket.
 */
import { CURRENCIES } from "./config.mjs";
import { socketActions, cardActions, chatDecorators, requestGm } from "./chat.mjs";
import { saveToLibrary, getLibrary, findByName, libraryData } from "./library.mjs";
import { STASH_TYPE, STASH_NAME, STASH_IMG, takePlan, takeLine, putLine, stashMode, currencyUpdate } from "./stash-logic.mjs";

const SYSTEM_ID = "ap-turm";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
// resolved lazily so the pure helpers above can be imported in Node (test/rules.test.mjs)
const dialog = () => foundry.applications.api.DialogV2;

/* ============================================================
   Pure logic
   ============================================================ */

/**
 * Split a stack for a partial transfer.
 * @param {number} qty   stack size of the item
 * @param {number} give  how many are handed over
 * @returns {{give:number, keep:number, whole:boolean}|null}  null when the amount is not usable
 */
export function splitStack(qty, give) {
  const total = Math.max(1, Math.floor(Number(qty) || 1));
  const n = Math.floor(Number(give));
  if (!Number.isFinite(n) || n < 1 || n > total) return null;
  return { give: n, keep: total - n, whole: n === total };
}

/**
 * Items counted against the Turm carry limit of 5: gear with origin "tower" (found in the tower).
 * The limit only applies when re-entering the tower - inside it and for "carried in" gear there is
 * no limit, so this is a reminder, never a block. Crystals are not items and never count.
 * @param {Iterable} items   Item documents or plain {type, system:{origin}} / {origin} objects
 * @param {object} [opts]    {extra: items that would be added on top}
 */
export function carryCount(items, { extra = 0 } = {}) {
  const origin = (i) => (i?.system?.origin ?? i?.origin ?? "city");
  const isGear = (i) => (i?.type ? i.type === "gear" : true);
  let n = 0;
  for (const i of items || []) if (isGear(i) && origin(i) === "tower") n++;
  return n + Math.max(0, Math.floor(Number(extra) || 0));
}

/** Currency keys of a mode, lowercase ("ku","br",... / "cp","sp",...). */
export function currencyKeys(mode) {
  return CURRENCIES[mode === "turm" ? "turm" : "ap"].map(([k]) => k);
}

/** Pure currency text ("50 GO", "20 gp", "50 GO, 20 SI") -> {amounts, label}, otherwise null. */
function currencyAmounts(text, mode) {
  const keys = currencyKeys(mode);
  const parts = String(text).split(/\s*(?:,|\+|&|\bund\b|\band\b)\s*/i).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const amounts = {};
  for (const part of parts) {
    const m = /^(\d{1,7})\s*([a-z]{2})$/i.exec(part);
    if (!m) return null;
    const key = m[2].toLowerCase();
    if (!keys.includes(key)) return null;
    amounts[key] = (amounts[key] || 0) + Number(m[1]);
  }
  const label = Object.entries(amounts).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(", ");
  return { amounts, label };
}

/**
 * What a loot result text becomes when it is claimed.
 * A pure amount in the mode's own currencies is booked as currency, everything else becomes a gear
 * item; a leading count ("3 Heiltraenke", "50 Goldmuenzen", "3x Torch") sets the quantity.
 * @param {string} text
 * @param {string} mode  "turm" or "ap" (decides which currency abbreviations count)
 * @returns {{kind:"currency", amounts:object, label:string}|{kind:"item", name:string, qty:number}|null}
 */
export function parseClaim(text, mode = "ap") {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const cur = currencyAmounts(raw, mode);
  if (cur) return { kind: "currency", amounts: cur.amounts, label: cur.label };
  const m = /^(\d{1,5})\s*(?:[x×]\s*)?(.+)$/.exec(raw);
  if (m && m[2].trim()) return { kind: "item", name: m[2].trim(), qty: Math.max(1, Number(m[1])) };
  return { kind: "item", name: raw, qty: 1 };
}

/** Chat line of a transfer: "Gades gives Heiltrank x2 to Markus." */
export function giveLine(fromName, itemName, count, toName) {
  return `${fromName} gives ${itemName}${count > 1 ? ` ×${count}` : ""} to ${toName}.`;
}

/* ============================================================
   Foundry side: item transfer
   ============================================================ */

/** Item types that may change hands. */
const GIVEABLE = ["gear"];

/** All characters except `exclude`, sorted by name. */
function otherCharacters(exclude) {
  return game.actors.filter(a => a.type === "character" && a.id !== exclude?.id).sort((a, b) => a.name.localeCompare(b.name));
}

function chat(content) {
  return ChatMessage.implementation.create({ content: `<div class="ap-turm-chat apt-applied"><p>${content}</p></div>`, flags: { [SYSTEM_ID]: { type: "transfer" } } });
}

/**
 * Do the transfer: create at the receiver, then remove at the giver. Runs on a client that owns both
 * (the giver, or the active GM after a socket request).
 * @returns {Promise<boolean>}
 */
async function transferItem(item, target, count, { requestedBy = "", line = null } = {}) {
  const source = item.parent;
  const split = splitStack(item.system.qty, count);
  if (!split) { ui.notifications.warn(`${item.name}: invalid amount.`); return false; }
  const data = item.toObject();
  delete data._id;
  data.system.qty = split.give;
  let created = null;
  try { [created] = await target.createEmbeddedDocuments("Item", [data]); }
  catch (err) { console.error(`${SYSTEM_ID} | give: create failed`, err); }
  if (!created) {
    ui.notifications.error(`${item.name} could not be created on ${target.name} - nothing was changed.`);
    return false;
  }
  if (split.whole) await item.delete();
  else await item.update({ "system.qty": split.keep });
  const via = requestedBy ? ` (requested by ${requestedBy})` : "";
  const text = line ?? (target.type === STASH_TYPE ? putLine(source?.name ?? "Someone", item.name, split.give, target.name)
    : giveLine(source?.name ?? "Someone", item.name, split.give, target.name));
  await chat(esc(text) + esc(via));
  return true;
}

/**
 * Give a gear item to another character. Players may only give from a sheet they own; when they do not
 * own the receiver, the active GM performs both writes.
 * @param {Item} item
 * @param {Actor} target
 * @param {object} [opts]  {qty: how many (default: the whole stack)}
 */
export async function giveItem(item, target, { qty = null } = {}) {
  if (!item || !GIVEABLE.includes(item.type)) { ui.notifications.warn("Only items can be given - weapons and feats stay with their character."); return false; }
  const source = item.parent;
  if (source?.documentName !== "Actor") { ui.notifications.warn("This item does not belong to a character."); return false; }
  if (!source.isOwner) { ui.notifications.warn(`You do not own ${source.name}.`); return false; }
  if (!target || !["character", STASH_TYPE].includes(target.type)) { ui.notifications.warn("Items can only be given to characters or the party stash."); return false; }
  if (target.id === source.id) return false;
  const count = qty ?? item.system.qty;
  if (!splitStack(item.system.qty, count)) { ui.notifications.warn(`${item.name}: invalid amount.`); return false; }
  if (target.isOwner) return transferItem(item, target, count);
  const sent = requestGm("giveItem", { uuid: target.uuid, sourceUuid: source.uuid, itemId: item.id, count },
    { warn: `No GM is online - ${item.name} stays with ${source.name}.` });
  if (sent) ui.notifications.info(`${target.name} is not yours - the GM hands the item over.`);
  return sent;
}

/** "Give to…": pick the receiver and, for a stack, the amount. */
export async function giveItemDialog(item) {
  if (!item || !GIVEABLE.includes(item.type)) { ui.notifications.warn("Only items can be given - weapons and feats stay with their character."); return false; }
  const source = item.parent;
  const stash = source?.type === STASH_TYPE ? null : getStash();
  const others = [...(stash ? [stash] : []), ...otherCharacters(source)];
  if (!others.length) { ui.notifications.warn("There is no other character to give to."); return false; }
  const stack = Math.max(1, Number(item.system.qty) || 1);
  const content = `
    <div class="apt-give-dialog">
      <p class="hint">${esc(item.name)}${stack > 1 ? ` (${stack} in stock)` : ""}</p>
      <div class="form-group"><label>Give to</label><div class="form-fields">
        <select name="target">${others.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
      </div></div>
      ${stack > 1 ? `<div class="form-group"><label>Amount</label><div class="form-fields">
        <input type="number" name="qty" value="${stack}" min="1" max="${stack}" step="1"></div></div>
      <p class="hint">The rest stays with ${esc(source?.name ?? "you")}.</p>` : ""}
    </div>`;
  const res = await dialog().prompt({
    window: { title: `Give ${item.name}`, icon: "fa-solid fa-hand-holding" },
    content, rejectClose: false,
    ok: {
      label: "Give", icon: "fa-solid fa-hand-holding",
      callback: (event, button) => ({
        id: button.form.querySelector("select[name=target]").value,
        qty: stack > 1 ? Math.round(Number(button.form.querySelector("input[name=qty]").value) || 0) : stack
      })
    }
  });
  if (!res?.id) return false;
  return giveItem(item, game.actors.get(res.id), { qty: res.qty });
}

/* ---------- drop targets ---------- */

/**
 * The dropped data describes a gear item that may move to `target`:
 * - from a character the user owns to another character or to the stash (give),
 * - from the stash onto a character the user owns (take).
 * @returns {{item:Item, take:boolean}|null}
 */
function droppedGive(data, target) {
  if (data?.type !== "Item" || !data.uuid || !["character", STASH_TYPE].includes(target?.type)) return null;
  let item = null;
  try { item = fromUuidSync(data.uuid); } catch { return null; }
  const source = item?.parent;
  if (!item || !GIVEABLE.includes(item.type)) return null;
  if (source?.documentName !== "Actor" || source.id === target.id) return null;
  if (source.type === STASH_TYPE) return target.type === "character" && target.isOwner ? { item, take: true } : null;
  if (source.type !== "character" || !source.isOwner) return null;
  return { item, take: false };
}

/** Start a drop transfer: a stack asks for the amount first, a single item goes straight over. */
function startDropGive(drop, target) {
  const { item, take } = drop;
  const run = take ? takeDialog(item, { target })
    : Number(item.system.qty) > 1 ? askAmountThenGive(item, target) : giveItem(item, target);
  return Promise.resolve(run).catch(err => console.error(`${SYSTEM_ID} | drop give`, err));
}

/** Drop of a stack: ask how many, then give to the drop target. */
async function askAmountThenGive(item, target) {
  const stack = Math.max(1, Number(item.system.qty) || 1);
  const qty = await dialog().prompt({
    window: { title: `Give ${item.name} to ${target.name}`, icon: "fa-solid fa-hand-holding" },
    content: `<div class="form-group"><label>Amount</label><div class="form-fields">
      <input type="number" name="qty" value="${stack}" min="1" max="${stack}" step="1" autofocus></div></div>
      <p class="hint">${stack} in stock, the rest stays with ${esc(item.parent?.name ?? "you")}.</p>`,
    rejectClose: false,
    ok: { label: "Give", icon: "fa-solid fa-hand-holding", callback: (e, b) => Math.round(Number(b.form.elements.qty.value) || 0) }
  });
  if (!qty) return false;
  return giveItem(item, target, { qty });
}

/* ============================================================
   Party stash
   ============================================================ */

/** The world's party stash (the first actor of type "stash"), or null. */
export function getStash() {
  return game.actors?.find(a => a.type === STASH_TYPE) ?? null;
}

/**
 * The party stash, created on first use (GM only; players ask the active GM over the socket).
 * @returns {Promise<Actor|null>}
 */
export async function ensureStash() {
  const found = getStash();
  if (found) return found;
  if (!game.user.isGM) return null;
  const mode = stashMode(game.actors.filter(a => a.type === "character").map(a => a.system.mode));
  const stash = await Actor.implementation.create({
    name: STASH_NAME, type: STASH_TYPE, img: STASH_IMG, system: { mode },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    prototypeToken: { actorLink: true, name: STASH_NAME, texture: { src: STASH_IMG } }
  });
  if (stash) ui.notifications.info(`${STASH_NAME} created - every player owns it.`);
  return stash;
}

/** Menu entry: open the stash (created on first use). */
export async function openStash() {
  const stash = await ensureStash();
  if (!stash) { ui.notifications.warn(`There is no ${STASH_NAME} yet - the GM creates it on first use.`); return null; }
  return stash.sheet.render(true);
}

/** Characters the user may take items onto: the GM all, a player their own. */
export function takeCandidates() {
  const all = game.actors?.filter(a => a.type === "character") ?? [];
  return (game.user.isGM ? all : all.filter(a => a.isOwner)).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Take an item from the stash onto a character the user owns. Runs locally when the user owns the stash too,
 * otherwise the active GM moves it.
 */
export async function takeFromStash(item, target, qty) {
  const stash = item?.parent;
  if (stash?.type !== STASH_TYPE || !GIVEABLE.includes(item.type)) return false;
  if (!target || target.type !== "character" || !target.isOwner) { ui.notifications.warn("Items from the stash go onto your own character."); return false; }
  const plan = takePlan(item.system.qty, qty);
  if (!plan) { ui.notifications.warn(`${item.name}: invalid amount.`); return false; }
  const line = takeLine(target.name, item.name, plan.take, stash.name);
  if (stash.isOwner) return transferItem(item, target, plan.take, { line });
  const sent = requestGm("stashTake", { uuid: stash.uuid, stashUuid: stash.uuid, itemId: item.id, targetUuid: target.uuid, count: plan.take },
    { warn: `No GM is online - ${item.name} stays in the ${stash.name}.` });
  if (sent) ui.notifications.info(`The GM hands ${item.name} over.`);
  return sent;
}

/** "Take": pick the character (when there is more than one) and the amount (for a stack). */
export async function takeDialog(item, { target = null } = {}) {
  const list = target ? [target] : takeCandidates();
  if (!list.length) { ui.notifications.warn("You have no character to take this onto."); return false; }
  const stack = Math.max(1, Number(item.system.qty) || 1);
  if (list.length === 1 && stack === 1) return takeFromStash(item, list[0], 1);
  const res = await dialog().prompt({
    window: { title: `Take ${item.name}`, icon: "fa-solid fa-hand-holding-hand" },
    content: `<div class="apt-give-dialog"><p class="hint">${esc(item.name)}${stack > 1 ? ` (${stack} in the stash)` : ""}</p>
      ${list.length > 1 ? `<div class="form-group"><label>Onto</label><div class="form-fields">
        <select name="target">${list.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div></div>` : ""}
      ${stack > 1 ? `<div class="form-group"><label>Amount</label><div class="form-fields">
        <input type="number" name="qty" value="1" min="1" max="${stack}" step="1" autofocus></div></div>` : ""}</div>`,
    rejectClose: false,
    ok: {
      label: "Take", icon: "fa-solid fa-hand-holding-hand",
      callback: (e, b) => ({
        id: list.length > 1 ? b.form.elements.target.value : list[0].id,
        qty: stack > 1 ? Math.round(Number(b.form.elements.qty.value) || 0) : 1
      })
    }
  });
  if (!res?.id) return false;
  return takeFromStash(item, game.actors.get(res.id), res.qty);
}

/** Token under a canvas drop position. */
function tokenAt(x, y) {
  const hit = (canvas?.tokens?.placeables ?? []).filter(t => {
    const b = t.bounds;
    return b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  });
  return hit.sort((a, b) => (b.document.sort ?? 0) - (a.document.sort ?? 0))[0] ?? null;
}

/* ============================================================
   Foundry side: claim loot from a RollTable card
   ============================================================ */

/** Characters the user may claim for: the GM picks from all, a player from their own. */
export function claimCandidates() {
  const all = game.actors.filter(a => a.type === "character");
  const list = game.user.isGM ? all : all.filter(a => a.isOwner);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pick the receiving character. A player with exactly one character gets no dialog; the GM always sees it,
 * because it carries the "Also save to library" box.
 * @returns {Promise<{actor:Actor, library:boolean}|null>}
 */
async function pickClaimActor(text) {
  const list = claimCandidates();
  const gm = game.user.isGM;
  const stash = getStash();
  // the stash is always offered first (the GM creates it on first use, a player's claim goes through the GM then)
  const withStash = stash || gm || game.users.activeGM;
  if (!list.length && !withStash) { ui.notifications.warn("You have no character to claim this for."); return null; }
  const res = await dialog().prompt({
    window: { title: "Claim loot", icon: "fa-solid fa-hand-sparkles" },
    content: `<div class="apt-claim-dialog"><p class="hint">${esc(text)}</p>
      <div class="form-group"><label>Goes to</label><div class="form-fields">
        <select name="actor">${withStash ? `<option value="stash">${esc(stash?.name ?? STASH_NAME)}</option>` : ""}${list.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
      </div></div>
      ${gm ? `<label class="apt-lib-check"><input type="checkbox" name="library"> Also save to library</label>` : ""}</div>`,
    rejectClose: false,
    ok: {
      label: "Claim", icon: "fa-solid fa-hand-sparkles",
      callback: (e, b) => ({ id: b.form.elements.actor.value, library: gm && !!b.form.elements.library?.checked })
    }
  });
  if (res?.id === "stash") return { stash: true, library: res.library };
  const actor = res?.id ? game.actors.get(res.id) : null;
  return actor ? { actor, library: res.library } : null;
}

/**
 * Book a claimed result on a character: pure currency goes into the purse, everything else becomes
 * a gear item (found in the tower while in Turm mode). With `library` (GM) the new item also goes into
 * the item library; a pure currency amount never does.
 * @returns {Promise<string|null>}  chat line, or null when nothing was booked
 */
export async function claimForActor(actor, text, { library = false, by = "" } = {}) {
  const mode = actor.system.mode ?? "ap";
  const res = parseClaim(text, mode);
  if (!res) return null;
  const into = actor.type === STASH_TYPE ? ` into the ${actor.name}` : "";
  const who = actor.type === STASH_TYPE ? (by || game.user.name) : actor.name;
  if (res.kind === "currency") {
    await actor.update(currencyUpdate(actor.system.currency, res.amounts));
    return `${who} claims ${res.label}${into}.`;
  }
  // an item of the same name in the item library is created from there, with its effects (1.3.0); amount and
  // origin come from the claim
  const origin = mode === "turm" ? "tower" : "city";
  let data = { name: res.name, type: "gear", system: { qty: res.qty, origin } };
  let fromLibrary = false;
  try {
    const pack = getLibrary();
    if (pack) {
      const hit = findByName([...(await pack.getIndex())].filter(e => e.type === "gear"), res.name);
      const doc = hit ? await pack.getDocument(hit._id ?? hit.id) : null;
      if (doc) {
        data = libraryData(doc.toObject());
        data.system = { ...data.system, qty: res.qty, origin };
        data._stats = { compendiumSource: doc.uuid };
        fromLibrary = true;
      }
    }
  } catch (err) { console.warn(`${SYSTEM_ID} | claim: library lookup failed`, err); }
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  if (created && library && !fromLibrary && game.user.isGM) {
    await saveToLibrary(created).catch(err => console.error(`${SYSTEM_ID} | library`, err));
  }
  return `${who} claims ${res.name}${res.qty > 1 ? ` ×${res.qty}` : ""}${into}.`;
}

/** Mark one result of a table card as claimed (for everyone). */
async function markClaimed(message, index, name) {
  const claims = { ...(message.flags?.[SYSTEM_ID]?.claims ?? {}) };
  if (claims[index]) return null;
  claims[index] = name;
  return message.update({ flags: { [SYSTEM_ID]: { type: "tableDraw", claims } } });
}

/** Click on "Claim" in a RollTable card. */
async function claimLoot(message, target) {
  const index = Number(target.dataset.index);
  const text = target.dataset.text ?? "";
  if (message.flags?.[SYSTEM_ID]?.claims?.[index]) { ui.notifications.info("This result has already been claimed."); return null; }
  const pick = await pickClaimActor(text);
  if (!pick) return null;
  if (pick.stash) return claimIntoStash(message, index, text, pick.library);
  const { actor } = pick;
  const line = await claimForActor(actor, text, { library: pick.library });
  if (!line) return null;
  await chat(esc(line));
  if (message.canUserModify(game.user, "update")) await markClaimed(message, index, actor.name);
  else requestGm("claimLoot", { uuid: message.uuid, index, name: actor.name },
    { warn: "No GM is online - the result is booked, but the card was not marked." });
  return actor;
}

/** Claim into the party stash: locally when the user owns it (the GM creates it first), else through the GM. */
async function claimIntoStash(message, index, text, library) {
  const stash = getStash() ?? (game.user.isGM ? await ensureStash() : null);
  if (stash?.isOwner) {
    const line = await claimForActor(stash, text, { library });
    if (!line) return null;
    await chat(esc(line));
    if (message.canUserModify(game.user, "update")) await markClaimed(message, index, stash.name);
    else requestGm("claimLoot", { uuid: message.uuid, index, name: stash.name },
      { warn: "No GM is online - the result is booked, but the card was not marked." });
    return stash;
  }
  const sent = requestGm("stashClaim", { uuid: message.uuid, index, text },
    { warn: "No GM is online - nothing was booked." });
  return sent ? (getStash() ?? true) : null;
}

/** Add a "Claim" button to every result of a RollTable draw (or show who took it). */
function decorateTableCard(message, html) {
  const draw = html.querySelector?.(".table-draw");
  if (!draw) return;
  const claims = message.flags?.[SYSTEM_ID]?.claims ?? {};
  const rows = draw.querySelectorAll("ul.table-results > li");
  rows.forEach((li, index) => {
    if (li.querySelector(".apt-claim")) return;
    const text = li.textContent.replace(/\s+/g, " ").trim();
    if (!text) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "apt-claim";
    if (claims[index]) {
      btn.disabled = true;
      btn.classList.add("apt-foreign");
      btn.innerHTML = `<i class="fa-solid fa-check" inert></i> ${esc(`Claimed by ${claims[index]}`)}`;
    } else {
      btn.innerHTML = `<i class="fa-solid fa-hand-sparkles" inert></i> Claim`;
      btn.dataset.index = String(index);
      btn.dataset.text = text;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        btn.disabled = true;                       // no double click while the dialog is open
        claimLoot(message, btn)
          .then(actor => { if (!actor) btn.disabled = false; })   // cancelled: the next player may try
          .catch(err => { console.error(`${SYSTEM_ID} | claim`, err); ui.notifications.error("Claim failed, see the console."); btn.disabled = false; });
      });
    }
    li.append(btn);
  });
}

/* ============================================================
   Registration
   ============================================================ */

export function registerTransfer() {
  chatDecorators.push(decorateTableCard);
  cardActions.set("claimLoot", claimLoot);

  // drop on another character's sheet
  Hooks.on("dropActorSheetData", (actor, sheet, data) => {
    const drop = droppedGive(data, actor);
    if (!drop) return;
    startDropGive(drop, actor);
    return false;                                  // the core copy must not run as well
  });

  // drop on a token
  Hooks.on("dropCanvasData", (canvasRef, data) => {
    if (data?.type !== "Item") return;
    const token = tokenAt(data.x, data.y);
    const drop = droppedGive(data, token?.actor);
    if (!drop) return;
    startDropGive(drop, token.actor);
    return false;
  });

  // GM side: hand an item over for a player who does not own the receiver
  socketActions.set("giveItem", async (data) => {
    const user = game.users.get(data.userId);
    const target = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
    const source = fromUuidSync(data.sourceUuid) ?? await fromUuid(data.sourceUuid);
    const item = source?.items?.get(data.itemId);
    if (!user || !target || !item || !["character", STASH_TYPE].includes(target.type)) return null;
    if (!source.testUserPermission(user, "OWNER")) return null;    // players give from their own sheet only
    return transferItem(item, target, Number(data.count), { requestedBy: user.name });
  });

  // GM side: take from the stash for a player without owner rights on it (onto the player's own character)
  socketActions.set("stashTake", async (data) => {
    const user = game.users.get(data.userId);
    const stash = fromUuidSync(data.stashUuid) ?? await fromUuid(data.stashUuid);
    const target = fromUuidSync(data.targetUuid) ?? await fromUuid(data.targetUuid);
    const item = stash?.items?.get(data.itemId);
    if (!user || stash?.type !== STASH_TYPE || !item || target?.type !== "character") return null;
    if (!target.testUserPermission(user, "OWNER")) return null;       // only onto the player's own character
    const plan = takePlan(item.system.qty, Number(data.count));
    if (!plan) return null;
    return transferItem(item, target, plan.take, { line: takeLine(target.name, item.name, plan.take, stash.name), requestedBy: user.name });
  });

  // GM side: claim a table result into the stash for a player (creates the stash on first use)
  socketActions.set("stashClaim", async (data) => {
    const user = game.users.get(data.userId);
    const message = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
    if (!user || !message || message.flags?.[SYSTEM_ID]?.claims?.[Number(data.index)]) return null;
    const stash = await ensureStash();
    if (!stash) return null;
    const line = await claimForActor(stash, String(data.text ?? ""), { by: user.name });
    if (!line) return null;
    await chat(esc(line));
    return markClaimed(message, Number(data.index), stash.name);
  });

  // GM side: mark a claimed result for a player without update rights on the card
  socketActions.set("claimLoot", async (data) => {
    const message = fromUuidSync(data.uuid) ?? await fromUuid(data.uuid);
    if (!message) return null;
    return markClaimed(message, Number(data.index), String(data.name ?? ""));
  });
}

/** Drop on a row of the Actors sidebar (called from the renderActorDirectory hook). */
export function registerDirectoryDrops(root) {
  root.querySelectorAll("li.directory-item[data-entry-id]").forEach(li => {
    if (li.dataset.aptDrop) return;
    li.dataset.aptDrop = "1";
    li.addEventListener("dragover", (ev) => { if (ev.dataTransfer?.types?.includes("text/plain")) ev.preventDefault(); });
    li.addEventListener("drop", (ev) => {
      let data = null;
      try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev); } catch { return; }
      const target = game.actors.get(li.dataset.entryId);
      const item = droppedGive(data, target);
      if (!item) return;
      ev.preventDefault();
      ev.stopPropagation();
      startDropGive(item, target);
    });
  });
}

export const transfer = { giveItem, giveItemDialog, claimForActor, claimCandidates, parseClaim, splitStack, carryCount, giveLine, currencyKeys, getStash, ensureStash, openStash, takeFromStash, takeDialog, takeCandidates };
