/**
 * Spell and Monster libraries: one world compendium per source and kind ("Spells — SRD 2014", "Monsters — DDB
 * terra-nova" ...), filled from the dnd5e import bundles in Data/ap-turm-import (spells-<source>.json /
 * monsters-<source>.json, written by tools/dnd5e-extract.mjs).
 *
 * - The same name may exist in several compendia, one per version; the GM / player chooses case by case.
 * - Spell compendia: players may read (Observer). Monster compendia: GM only, folders by CR band.
 * - Import in batches with a progress bar; a document that fails is skipped and listed, never stops the run;
 *   importing a source again only adds what is missing. The report is whispered to the GM.
 * - "From library" in the Spells box searches all spell compendia together; every hit shows its source tag.
 * - Transfer to another installation: "Export bundles" packs all bundles (written back from the compendia when the
 *   files are missing) and every local image they use into ap-turm-libraries.zip; "Import from bundle file" reads
 *   that zip (or single bundle JSONs), puts the images in place and builds the same compendia - the recipient needs
 *   neither dnd5e nor tools/.
 */
import { filterEntries } from "./library.mjs";
import {
  LIBRARY_SOURCES, libraryPackDef, bundleFile, mergeSpellEntries, LIBRARY_ZIP, bundleKeyOfFile, bundleProblem, portableBundle,
  imageTargetOfEntry, bundleDocData, bundleFromPack, libraryZipFiles
} from "./dnd5e-convert.mjs";
import { zipDeflated, unzipEntries } from "./backup.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const dialog = () => foundry.applications.api.DialogV2;
export const IMPORT_DIR = "ap-turm-import";
const BATCH = 50;

/** The compendium of a kind and source, if it exists. */
export function getLibraryPack(kind, key) {
  const def = libraryPackDef(kind, key);
  return game.packs.get(`world.${def.name}`) ?? game.packs.find(p => p.metadata.packageType === "world" && p.metadata.label === def.label && p.documentName === def.type) ?? null;
}

/** All existing compendia of a kind: [{key, pack}] in source order. */
export function libraryPacks(kind) {
  return LIBRARY_SOURCES.map(s => ({ key: s.key, pack: getLibraryPack(kind, s.key) })).filter(x => x.pack);
}

async function ensureLibraryPack(kind, key) {
  const found = getLibraryPack(kind, key);
  if (found) return found;
  const def = libraryPackDef(kind, key);
  const CC = foundry.documents.collections.CompendiumCollection;
  const pack = await CC.createCompendium({ name: def.name, label: def.label, type: def.type });
  await pack.configure({ ownership: { ...def.ownership } });
  return pack;
}

/** Progress bar (v13 notifications with progress). */
function progress(label) {
  const n = ui.notifications.info(label, { progress: true });
  return {
    set: (pct, msg) => { try { n.update({ pct, message: msg ?? label }); } catch {} },
    done: () => { try { n.update({ pct: 1 }); } catch {} }
  };
}

/**
 * Import one bundle into its compendium (created on first use; only missing names are added).
 * @param {"spells"|"monsters"} kind
 * @param {string} key   source key (LIBRARY_SOURCES)
 */
export async function importBundle(kind, key) {
  if (!game.user.isGM) return null;
  const res = await fetch(`${IMPORT_DIR}/${bundleFile(kind, key)}?v=${Date.now()}`);
  if (!res.ok) { ui.notifications.warn(`${IMPORT_DIR}/${bundleFile(kind, key)} not found - run tools/dnd5e-extract.mjs first.`); return null; }
  const bundle = await res.json();
  const problem = bundleProblem(bundle, kind, key);
  if (problem) { ui.notifications.error(`${bundleFile(kind, key)}: ${problem}.`); return null; }
  return importBundleData(bundle);
}

/**
 * Import a bundle object into the compendium of its kind and source (created on first use with the same rights,
 * folders and tag as always; only missing names are added).
 */
export async function importBundleData(bundle) {
  if (!game.user.isGM) return null;
  const { kind, source: key } = bundle;
  const def = libraryPackDef(kind, key);
  const pack = await ensureLibraryPack(kind, key);
  if (pack.locked) await pack.configure({ locked: false });
  const cls = foundry.utils.getDocumentClass(def.type);
  const index = await pack.getIndex();
  const existing = new Set([...index].map(e => String(e.name).trim().toLowerCase()));
  const folderIds = {};
  for (const band of [...new Set(bundle.docs.map(d => d.folder).filter(Boolean))]) {
    let f = pack.folders.find(x => x.name === band);
    if (!f) [f] = await Folder.implementation.createDocuments([{ name: band, type: def.type, sorting: "a" }], { pack: pack.collection });
    folderIds[band] = f?.id ?? null;
  }
  const todo = bundle.docs.filter(d => !existing.has(String(d.data.name).trim().toLowerCase()));
  const report = {
    label: def.label, created: 0, skippedExisting: bundle.docs.length - todo.length, failed: [],
    duplicates: bundle.report?.duplicates?.length ?? 0, conversionErrors: bundle.report?.conversionErrors ?? [],
    images: bundle.report?.images ?? { kept: 0, web: 0, copied: 0, fallback: [] }, inPack: bundle.sources?.[0]?.count ?? bundle.docs.length
  };
  const bar = progress(`${def.label}: importing ${todo.length} …`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH).map(d => ({ ...d.data, folder: d.folder ? folderIds[d.folder] ?? null : null }));
    try {
      report.created += (await cls.createDocuments(chunk, { pack: pack.collection })).length;
    } catch (err) {
      for (const one of chunk) {                       // find the culprit(s); every failure is skipped and listed
        try { await cls.createDocuments([one], { pack: pack.collection }); report.created++; }
        catch (e) { report.failed.push({ name: one.name, error: String(e?.message ?? e).slice(0, 200) }); }
      }
    }
    bar.set(Math.min(1, (i + BATCH) / Math.max(1, todo.length)), `${def.label}: ${Math.min(todo.length, i + BATCH)} / ${todo.length}`);
  }
  bar.done();
  return report;
}

async function whisperReports(reports, { copied = null, present = 0, imageErrors = [], problems = [] } = {}) {
  const list = (arr, fmt, max = 15) => arr.length ? `<ul>${arr.slice(0, max).map(x => `<li>${fmt(x)}</li>`).join("")}${arr.length > max ? `<li>… ${arr.length - max} more</li>` : ""}</ul>` : "";
  const block = (r) => `<h4>${esc(r.label)}</h4>
    <p><b>${r.created}</b> imported · ${r.skippedExisting} already there · ${r.duplicates} duplicate names within the source skipped · ${r.failed.length + r.conversionErrors.length} failed (${r.inPack} in the source)</p>
    ${list(r.failed, x => `${esc(x.name)}: ${esc(x.error)}`)}${list(r.conversionErrors, x => `${esc(x.name)}: ${esc(x.error)}`)}
    <p>Images: ${r.images.kept} kept · ${r.images.web} web addresses kept · ${r.images.copied} copied · ${r.images.fallback.length} default</p>
    ${list(r.images.fallback, x => `${esc(x.owner)}: ${esc(x.src)} (${esc(x.why)})`, 8)}`;
  const extra = (copied !== null ? `<p>Bundle file: ${copied} image${copied === 1 ? "" : "s"} copied into Data${present ? `, ${present} already there` : ""}</p>` : "")
    + list(imageErrors, x => esc(x)) + (problems.length ? `<p>Skipped:</p>${list(problems, x => esc(x))}` : "");
  const content = `<div class="ap-turm-chat apt-card"><header class="apt-card-h"><i class="fa-solid fa-book"></i> <b>dnd5e libraries: import report</b></header>${reports.map(block).join("")}${extra}</div>`;
  await ChatMessage.implementation.create({ content, whisper: game.users.filter(u => u.isGM).map(u => u.id), speaker: { alias: "AP-Turm" } });
}

/**
 * Menu dialog: one checkbox per bundle found in Data/ap-turm-import (default: all) and "Import"; next to it
 * "Export bundles" (sender) and "Import from bundle file" (recipient). Opens also without bundles on disk.
 */
export async function importLibrariesDialog() {
  if (!game.user.isGM) return null;
  const rows = [];
  for (const kind of ["spells", "monsters"]) {
    for (const s of LIBRARY_SOURCES) {
      let ok = false;
      try { ok = (await fetch(`${IMPORT_DIR}/${bundleFile(kind, s.key)}`, { method: "HEAD" })).ok; } catch {}
      if (!ok) continue;
      const def = libraryPackDef(kind, s.key);
      const pack = getLibraryPack(kind, s.key);
      rows.push({ kind, key: s.key, label: def.label, count: pack?.index?.size ?? null });
    }
  }
  const content = `<div class="apt-import5e">${rows.length
    ? `<p>One compendium per source. Importing a source again only adds what is missing.</p>
    ${rows.map((r, i) => `<label class="apt-import5e-row"><input type="checkbox" name="src${i}" checked> <b>${esc(r.label)}</b>${r.count !== null ? ` <small>(${r.count} in the compendium)</small>` : " <small>(new)</small>"}</label>`).join("")}`
    : `<p>No import bundles in <code>Data/${IMPORT_DIR}</code>.</p>`}
    <p class="hint"><b>Export bundles</b> packs all libraries into ${LIBRARY_ZIP} for another Foundry installation.
    <b>Import from bundle file</b> reads such a zip (or single bundle JSON files); dnd5e is not needed.</p></div>`;
  const buttons = [
    ...(rows.length ? [{ action: "import", label: "Import", icon: "fa-solid fa-file-import", default: true,
      callback: (e, b) => ({ action: "import", picked: rows.filter((r, i) => b.form.elements[`src${i}`]?.checked) }) }] : []),
    { action: "export", label: "Export bundles", icon: "fa-solid fa-file-zipper", callback: () => ({ action: "export" }) },
    { action: "bundle", label: "Import from bundle file", icon: "fa-solid fa-file-arrow-up", callback: () => ({ action: "bundle" }) }
  ];
  const choice = await dialog().wait({
    window: { title: "Import dnd5e libraries", icon: "fa-solid fa-book" },
    position: { width: 560 },
    content, buttons, rejectClose: false
  });
  if (choice?.action === "export") return exportBundles();
  if (choice?.action === "bundle") return importFromBundleFileDialog();
  if (choice?.action !== "import" || !choice.picked?.length) return null;
  const reports = [];
  for (const r of choice.picked) { const rep = await importBundle(r.kind, r.key); if (rep) reports.push(rep); }
  if (reports.length) await whisperReports(reports);
  return reports;
}

/* ---------- transfer: Export bundles / Import from bundle file ---------- */

const FP = () => foundry.applications.apps.FilePicker.implementation;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", json: "application/json" };

const knownDirs = new Set();
const dataUrl = (path) => path.split("/").map(encodeURIComponent).join("/");

/** Create a folder in Data step by step (existing folders are fine). */
async function ensureDataDir(dir) {
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part;
    if (knownDirs.has(cur)) continue;
    try { await FP().createDirectory("data", cur, {}); }
    catch (err) { if (!/exist/i.test(String(err?.message ?? err))) throw err; }
    knownDirs.add(cur);
  }
}

/** Run `fn` over `items` with a few requests at a time. */
async function inParallel(items, fn, width = 6) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

/** Write a file to Data (path relative to Data), overwriting it. */
async function writeDataFile(path, bytes) {
  const i = path.lastIndexOf("/");
  const dir = path.slice(0, i), name = path.slice(i + 1);
  await ensureDataDir(dir);
  const type = MIME[name.split(".").pop().toLowerCase()] ?? "application/octet-stream";
  const res = await FP().upload("data", dir, new File([bytes], name, { type }), {}, { notify: false });
  if (!res?.path) throw new Error(`${path} could not be written`);
  return res.path;
}

/** A bundle rebuilt from its world compendium (documents with their CR folder names). */
async function bundleFromCompendium(kind, key) {
  const pack = getLibraryPack(kind, key);
  if (!pack) return null;
  const docs = await pack.getDocuments();
  return bundleFromPack(kind, key, docs.map(d => ({ folder: d.folder?.name ?? null, data: bundleDocData(d.toObject()) })));
}

/**
 * "Export bundles": every bundle in Data/ap-turm-import (a missing file is first written back from its world
 * compendium) plus every local image the bundles use (portableBundle: Data files keep their path, images inside
 * systems/, modules/ or worlds/ move to ap-turm-import/images), in one ap-turm-libraries.zip (download).
 * Report whispered to the GM.
 * @param {{download?: boolean}} [options]  download: false only returns the zip bytes
 */
export async function exportBundles({ download = true } = {}) {
  if (!game.user.isGM) return null;
  const bundles = [], rebuilt = [], imageSrc = new Map();
  const bar = progress("Export bundles …");
  for (const kind of ["spells", "monsters"]) {
    for (const s of LIBRARY_SOURCES) {
      const file = bundleFile(kind, s.key);
      let bundle = null, text = null;
      try {
        const res = await fetch(`${IMPORT_DIR}/${file}?v=${Date.now()}`);
        if (res.ok) { text = await res.text(); const b = JSON.parse(text); if (!bundleProblem(b, kind, s.key)) bundle = b; }
      } catch {}
      if (!bundle) {
        bundle = await bundleFromCompendium(kind, s.key);
        if (!bundle) continue;
        text = JSON.stringify(bundle);
        await writeDataFile(`${IMPORT_DIR}/${file}`, new TextEncoder().encode(text));
        rebuilt.push(file);
      }
      const portable = portableBundle(bundle);
      if (portable.changed) text = JSON.stringify(portable.bundle);
      for (const img of portable.images) imageSrc.set(img.path, img.src);
      bundles.push({ kind, key: s.key, text, count: bundle.docs.length, label: libraryPackDef(kind, s.key).label });
      bar.set(bundles.length / (LIBRARY_SOURCES.length * 2), `Export bundles: ${file}`);
    }
  }
  if (!bundles.length) { bar.done(); ui.notifications.warn(`Nothing to export: no bundles in Data/${IMPORT_DIR} and no library compendia.`); return null; }
  const images = [], missing = [];
  const wanted = [...imageSrc].map(([path, src]) => ({ path, src }));
  await inParallel(wanted, async ({ path, src }, i) => {
    try {
      const res = await fetch(dataUrl(src));
      if (!res.ok) throw new Error(String(res.status));
      images.push({ path, bytes: new Uint8Array(await res.arrayBuffer()) });
    } catch { missing.push(src); }
    if (i % 100 === 0) bar.set(0.5 + 0.4 * (i / wanted.length), `Export bundles: images ${i} / ${wanted.length}`);
  });
  images.sort((a, b) => a.path.localeCompare(b.path));
  bar.set(0.95, `Export bundles: packing ${LIBRARY_ZIP}`);
  const zip = await zipDeflated(libraryZipFiles(bundles, images));
  bar.done();
  if (download) foundry.utils.saveDataToFile(zip, "application/zip", LIBRARY_ZIP);
  const li = (arr) => `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  await ChatMessage.implementation.create({
    content: `<div class="ap-turm-chat apt-card"><header class="apt-card-h"><i class="fa-solid fa-file-zipper"></i> <b>Libraries exported: ${LIBRARY_ZIP}</b></header>
      ${li(bundles.map(b => `${b.label}: ${b.count}`))}
      <p>${images.length} local image${images.length === 1 ? "" : "s"} included (web images stay web addresses) · ${(zip.length / 1048576).toFixed(1)} MB</p>
      ${rebuilt.length ? `<p>Written back from the compendia because the file was missing:</p>${li(rebuilt)}` : ""}
      ${missing.length ? `<p>Images not found (left out):</p>${li(missing.slice(0, 15))}` : ""}</div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id), speaker: { alias: "AP-Turm" }
  });
  return { name: LIBRARY_ZIP, bytes: zip, bundles: bundles.map(b => bundleFile(b.kind, b.key)), rebuilt, images: images.map(i => i.path), missing };
}

/**
 * Bundles and images from files: ap-turm-libraries.zip (or any zip with bundle files) and/or single bundle JSONs.
 * @param {(File|{name:string, bytes:Uint8Array})[]} files
 * @returns {Promise<{bundles:object[], images:{path, bytes}[], problems:string[]}>}
 */
export async function readBundleFiles(files) {
  const bundles = [], images = [], problems = [];
  const takeJson = (name, bytes) => {
    const key = bundleKeyOfFile(name);
    let obj;
    try { obj = JSON.parse(new TextDecoder().decode(bytes)); } catch { problems.push(`${name}: not valid JSON`); return; }
    const problem = bundleProblem(obj, key?.kind, key?.key);
    if (problem) problems.push(`${name}: ${problem}`); else bundles.push(obj);
  };
  for (const f of files) {
    const bytes = f.bytes ?? new Uint8Array(await f.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B;
    if (!isZip) { takeJson(f.name, bytes); continue; }
    let entries;
    try { entries = await unzipEntries(bytes); } catch (err) { problems.push(`${f.name}: ${err.message}`); continue; }
    for (const e of entries) {
      if (!e.crcOk) { problems.push(`${f.name} / ${e.name}: damaged (CRC)`); continue; }
      if (bundleKeyOfFile(e.name)) takeJson(e.name, e.bytes);
      else { const target = imageTargetOfEntry(e.name); if (target) images.push({ path: target, bytes: e.bytes }); }
    }
  }
  const order = (b) => (b.kind === "spells" ? 0 : 10) + LIBRARY_SOURCES.findIndex(s => s.key === b.source);
  bundles.sort((a, b) => order(a) - order(b));
  return { bundles, images, problems };
}

/**
 * Import bundles from files: the images first go to their place in Data (a file that is already there with the same
 * size is left alone), then every bundle into its compendium.
 */
export async function importFromBundleFiles(files) {
  if (!game.user.isGM) return null;
  const { bundles, images, problems } = await readBundleFiles(files);
  if (!bundles.length) {
    ui.notifications.warn(`No AP-Turm library bundle in the chosen file(s).${problems.length ? " " + problems.slice(0, 3).join("; ") : ""}`);
    return null;
  }
  let copied = 0, present = 0, done = 0;
  const imageErrors = [];
  if (images.length) {
    const bar = progress(`Copying ${images.length} images …`);
    await inParallel(images, async (img) => {
      try {
        const head = await fetch(dataUrl(img.path), { method: "HEAD" }).catch(() => null);
        if (head?.ok && Number(head.headers.get("content-length")) === img.bytes.length) present++;
        else { await writeDataFile(img.path, img.bytes); copied++; }
      } catch (err) { imageErrors.push(`${img.path}: ${err.message}`); }
      if (++done % 25 === 0 || done === images.length) bar.set(done / images.length, `Images: ${done} / ${images.length}`);
    });
    bar.done();
  }
  const reports = [];
  for (const b of bundles) { const rep = await importBundleData(b); if (rep) reports.push(rep); }
  if (reports.length) await whisperReports(reports, { copied, present, imageErrors, problems });
  return { reports, copied, present, imageErrors, problems };
}

/** "Import from bundle file": file selection (zip or JSON, several allowed), then importFromBundleFiles. */
export async function importFromBundleFileDialog() {
  if (!game.user.isGM) return null;
  const files = await dialog().prompt({
    window: { title: "Import from bundle file", icon: "fa-solid fa-file-arrow-up" },
    position: { width: 480 },
    content: `<div class="apt-import5e"><p>Choose <b>${LIBRARY_ZIP}</b> or single bundle files (spells-&lt;source&gt;.json,
      monsters-&lt;source&gt;.json). The compendia are created as with the source import: one per source, same rights,
      CR folders; entries already there stay, only missing ones are added. The images in the zip go to the same
      place in the Data folder as at the sender (e.g. <code>ddb-images/...</code>, <code>${IMPORT_DIR}/images/...</code>).</p>
      <input type="file" name="files" accept=".zip,.json" multiple></div>`,
    rejectClose: false,
    ok: { label: "Import", icon: "fa-solid fa-file-import", callback: (e, b) => [...(b.form.elements.files?.files ?? [])] }
  });
  if (!files?.length) return null;
  return importFromBundleFiles(files);
}

/* ---------- Spell libraries on the character sheet ---------- */

/** Entries of all spell compendia, each with its source tag (for the picker). */
export async function spellLibraryEntries() {
  const sources = [];
  for (const { key, pack } of libraryPacks("spells")) {
    if (!pack.visible) continue;
    const index = await pack.getIndex({ fields: ["system.lvl", "system.concentration"] });
    sources.push({ key, pack: pack.collection, entries: [...index] });
  }
  return mergeSpellEntries(sources);
}

/** "From library" in the Spells box: one search list over all spell compendia; a click adds the spell. */
export async function spellFromLibraryDialog(actor) {
  if (!actor?.isOwner) { ui.notifications.warn(`You do not own ${actor?.name ?? "this actor"}.`); return null; }
  const entries = await spellLibraryEntries();
  if (!entries.length) { ui.notifications.warn("There is no spell library yet."); return null; }
  const row = (e) => {
    const l = Number(e.system?.lvl) || 0;
    const meta = [l === 0 ? "Cantrip" : `Rank ${l}`, e.system?.concentration ? "Conc." : ""].filter(Boolean).join(" · ");
    return `<li><a class="apt-lib-entry" data-pack="${esc(e.pack)}" data-id="${e._id}" title="${esc(e.label)}"><img src="${esc(e.img)}" alt=""><span class="n">${esc(e.name)} <span class="apt-src-tag">${esc(e.tag)}</span></span><small>${esc(meta)}</small></a></li>`;
  };
  const LIMIT = 200;
  const render = (q) => { const hits = filterEntries(entries, q); return { html: hits.slice(0, LIMIT).map(row).join(""), n: hits.length }; };
  let chosen = null;
  const first = render("");
  await dialog().wait({
    window: { title: `Spell libraries: ${actor.name}`, icon: "fa-solid fa-wand-sparkles" },
    position: { width: 460 },
    content: `<div class="apt-lib-picker">
      <input type="search" name="q" placeholder="Search ${entries.length} spells in ${new Set(entries.map(e => e.pack)).size} compendia" autocomplete="off" autofocus>
      <ul class="apt-lib-list">${first.html}</ul>
      <p class="hint apt-lib-more" ${first.n > LIMIT ? "" : "hidden"}>Showing ${LIMIT} of <span>${first.n}</span> - type to narrow the list.</p>
      <p class="hint apt-lib-none" hidden>No match.</p>
    </div>`,
    buttons: [{ action: "close", label: "Close", icon: "fa-solid fa-xmark" }],
    rejectClose: false,
    render: (event, dlg) => {
      const root = dlg.element;
      const input = root.querySelector("input[name=q]");
      const list = root.querySelector(".apt-lib-list");
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.preventDefault(); });
      input.addEventListener("input", () => {
        const r = render(input.value);
        list.innerHTML = r.html;
        root.querySelector(".apt-lib-none").hidden = r.n > 0;
        const more = root.querySelector(".apt-lib-more");
        more.hidden = r.n <= LIMIT; more.querySelector("span").textContent = r.n;
      });
      list.addEventListener("click", (ev) => {
        const a = ev.target.closest(".apt-lib-entry");
        if (!a) return;
        ev.preventDefault();
        chosen = { pack: a.dataset.pack, id: a.dataset.id };
        dlg.close();
      });
    }
  });
  if (!chosen) return null;
  const doc = await game.packs.get(chosen.pack)?.getDocument(chosen.id);
  if (!doc) return null;
  const data = doc.toObject();
  delete data._id; delete data.folder;
  data._stats = { compendiumSource: doc.uuid };
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  if (created) ui.notifications.info(`${created.name} added to ${actor.name}.`);
  return created ?? null;
}

export const libraries5e = { importBundle, importBundleData, importLibrariesDialog, exportBundles, readBundleFiles, importFromBundleFiles, importFromBundleFileDialog, spellFromLibraryDialog, spellLibraryEntries, getLibraryPack, libraryPacks };
