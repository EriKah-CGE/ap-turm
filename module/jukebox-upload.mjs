/**
 * Jukebox: music from anywhere on the computer. The server only serves its data folder, so the files are uploaded
 * (FilePicker.upload) into Data/music/<playlist name>/ and become a playlist - the same name conflict and shuffle
 * handling as the folder import of the data folder.
 *
 * - "Import from computer": the browser's own file dialog, either a whole folder (webkitdirectory) or several files.
 * - Drag & drop: audio files or a folder from the explorer onto the jukebox window.
 * Only mp3 / ogg / wav / webm / flac are taken; the upload shows "file X of Y", a failing file is reported at the
 * end and never stops the others.
 */
import {
  pickAudio, pickedFolderName, uploadDir, UPLOAD_ROOT, importPlan, newPaths, trackName, sameName, SOUNDBOARD_NAME, FADE_MS
} from "./jukebox-logic.mjs";

const SYSTEM_ID = "ap-turm";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const DialogV2 = () => foundry.applications.api.DialogV2;
const FP = () => foundry.applications.apps.FilePicker.implementation;
const HINT = "Files are copied into Foundry's data folder so all players can hear them.";
const ACCEPT = ".mp3,.ogg,.wav,.webm,.flac,audio/*";

/** A playlist of that name exists: add to it, create a new one, or cancel. Shared by both imports. */
export function askImportConflict(name) {
  return DialogV2().wait({
    window: { title: "Playlist exists", icon: "fa-solid fa-circle-question" },
    content: `<p>A playlist named <b>${esc(name)}</b> already exists.</p>`,
    buttons: [
      { action: "append", label: "Add to it", icon: "fa-solid fa-plus", default: true },
      { action: "new", label: "Create new", icon: "fa-solid fa-copy" },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
}

/** Create the playlist for `plan` (or add to it) with the given data paths. */
export async function createOrAppend(plan, paths, { shuffle = false } = {}) {
  const sound = (path) => ({ name: trackName(path), path, repeat: false, volume: 0.5 });
  if (plan.action === "append") {
    const pl = game.playlists.find(p => sameName(p.name, plan.name));
    const add = newPaths(pl.sounds.map(s => s.path), paths);
    if (add.length) await pl.createEmbeddedDocuments("PlaylistSound", add.map(sound));
    return { playlist: pl, added: add.length };
  }
  const M = CONST.PLAYLIST_MODES;
  // a playlist named "Soundboard" becomes a soundboard (one sound at a time, played once)
  const mode = sameName(plan.name, SOUNDBOARD_NAME) ? M.DISABLED : (shuffle ? M.SHUFFLE : M.SEQUENTIAL);
  const playlist = await Playlist.implementation.create({ name: plan.name, mode, fade: mode === M.DISABLED ? 0 : FADE_MS, sounds: paths.map(sound) });
  return { playlist, added: paths.length };
}

/** Make sure Data/<dir> exists (createDirectory fails for an existing folder - that is fine). */
async function ensureDir(dir) {
  let path = "";
  for (const seg of dir.split("/")) {
    path = path ? `${path}/${seg}` : seg;
    try { await FP().createDirectory("data", path, {}); } catch { /* exists */ }
  }
}

/**
 * Upload files into Data/music/<name>/ and create / extend the playlist. Every file is tried; failures are
 * collected and reported at the end.
 * @param {File[]} files   audio files (already filtered)
 * @param {object} o       {name, shuffle}
 */
export async function uploadAsPlaylist(files, { name, shuffle = false } = {}) {
  if (!game.user.isGM) { ui.notifications.warn("Only the GM can import music."); return null; }
  if (!game.user.can("FILES_UPLOAD")) { ui.notifications.warn("You are not allowed to upload files."); return null; }
  if (!files?.length) { ui.notifications.warn("No audio files (mp3, ogg, wav, webm, flac) chosen."); return null; }
  const names = game.playlists.map(p => p.name);
  const choice = names.some(n => sameName(n, name)) ? await askImportConflict(name) : null;
  const plan = importPlan(names, name, choice);
  if (plan.action === "cancel") return null;
  const { paths, errors } = await uploadFiles(files, uploadDir(plan.name));
  const total = files.length;
  let result = null;
  if (paths.length) {
    result = await createOrAppend(plan, paths, { shuffle });
    ui.notifications.info(plan.action === "append"
      ? `${result.added} track${result.added === 1 ? "" : "s"} added to ${result.playlist.name}.`
      : `Playlist ${result.playlist.name} created with ${result.added} track${result.added === 1 ? "" : "s"}.`);
  }
  await reportUploadErrors(errors, total);
  return result;
}

/**
 * Upload files into Data/<dir> one by one with "file X of Y" progress; a failing file is collected, the others go on.
 * @returns {Promise<{paths:string[], errors:string[]}>}
 */
export async function uploadFiles(files, dir) {
  await ensureDir(dir);
  const total = files.length;
  const bar = ui.notifications.info(`Uploading 0 of ${total} to ${dir}`, { progress: true });
  const paths = [], errors = [];
  for (let i = 0; i < total; i++) {
    const file = files[i];
    ui.notifications.update(bar, { message: `Uploading file ${i + 1} of ${total}: ${file.name}`, pct: i / total });
    try {
      const res = await FP().upload("data", dir, file, {}, { notify: false });
      if (!res?.path) throw new Error("the server did not accept the file");
      paths.push(res.path);
    } catch (err) {
      console.error(`${SYSTEM_ID} | jukebox upload ${file.name}`, err);
      errors.push(`${file.name}: ${err?.message ?? err}`);
    }
  }
  ui.notifications.update(bar, { message: `Uploaded ${paths.length} of ${total} to ${dir}`, pct: 1 });
  return { paths, errors };
}

/** The files that failed, in one message at the end. */
export async function reportUploadErrors(errors, total) {
  if (!errors?.length) return;
  await DialogV2().prompt({
    window: { title: "Some files were not uploaded", icon: "fa-solid fa-triangle-exclamation" },
    content: `<p>${errors.length} of ${total} file${total === 1 ? "" : "s"} could not be uploaded:</p><ul class="apt-jb-errors">${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`,
    rejectClose: false, ok: { label: "OK" }
  });
}

/** Summary line of a selection. */
function selectionText(sel) {
  if (!sel) return "Nothing chosen yet.";
  const n = sel.files.length;
  const extra = [sel.ignored.length ? `${sel.ignored.length} other file${sel.ignored.length === 1 ? "" : "s"} ignored` : "",
    sel.duplicates.length ? `${sel.duplicates.length} duplicate name${sel.duplicates.length === 1 ? "" : "s"} skipped` : ""].filter(Boolean).join(", ");
  return `${n} audio file${n === 1 ? "" : "s"}${sel.folder ? ` from "${sel.folder}"` : ""}${extra ? ` (${extra})` : ""}.`;
}

/**
 * "Import from computer": choose a folder or files with the browser's dialog, name the playlist, upload.
 * With `preset` ({files, folder} from a drop) the choice is already made and only name / shuffle are asked.
 */
export async function importFromComputerDialog(preset = null) {
  let sel = preset ? { ...pickAudio(preset.files), folder: preset.folder || "" } : null;
  const res = await DialogV2().wait({
    window: { title: "Import from computer", icon: "fa-solid fa-upload" },
    position: { width: 480 },
    content: `<div class="apt-jb-dialog apt-jb-upload">
      <p class="hint">${esc(HINT)}</p>
      ${preset ? "" : `<div class="form-group"><label>Choose</label><div class="form-fields apt-jb-pickmode">
        <label><input type="radio" name="pickmode" value="folder" checked> A folder</label>
        <label><input type="radio" name="pickmode" value="files"> Single files</label>
        <button type="button" class="apt-jb-choose"><i class="fa-solid fa-folder-open"></i> Choose…</button>
        <input type="file" class="apt-jb-in-folder" webkitdirectory multiple hidden>
        <input type="file" class="apt-jb-in-files" accept="${ACCEPT}" multiple hidden>
      </div></div>`}
      <p class="apt-jb-sel">${esc(selectionText(sel))}</p>
      <div class="form-group"><label>Playlist name</label><div class="form-fields"><input type="text" name="name" value="${esc(sel?.folder ?? "")}" placeholder="Imported"></div></div>
      <div class="form-group"><label>Shuffle</label><div class="form-fields"><input type="checkbox" name="shuffle"></div></div>
      <p class="hint">Target: <code>Data/${UPLOAD_ROOT}/&lt;playlist name&gt;/</code></p>
    </div>`,
    buttons: [
      { action: "import", label: "Upload & import", icon: "fa-solid fa-upload", default: true,
        callback: (ev, button) => ({ name: button.form.elements.name.value.trim(), shuffle: !!button.form.elements.shuffle.checked }) },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false,
    render: (event, dlg) => {
      const root = dlg.element;
      const nameInput = root.querySelector("input[name=name]");
      const line = root.querySelector(".apt-jb-sel");
      let typed = false;
      nameInput.addEventListener("input", () => { typed = true; });
      const take = (fileList) => {
        const files = [...(fileList ?? [])];
        sel = { ...pickAudio(files), folder: pickedFolderName(files) };
        line.textContent = selectionText(sel);
        if (!typed) nameInput.value = sel.folder || "";
      };
      const inFolder = root.querySelector(".apt-jb-in-folder");
      const inFiles = root.querySelector(".apt-jb-in-files");
      // set as properties: the dialog's HTML cleaning drops multiple / accept / webkitdirectory attributes
      if (inFolder) { inFolder.webkitdirectory = true; inFolder.multiple = true; }
      if (inFiles) { inFiles.multiple = true; inFiles.accept = ACCEPT; }
      inFolder?.addEventListener("change", () => take(inFolder.files));
      inFiles?.addEventListener("change", () => take(inFiles.files));
      root.querySelector(".apt-jb-choose")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        const mode = root.querySelector("input[name=pickmode]:checked")?.value;
        (mode === "files" ? inFiles : inFolder)?.click();
      });
    }
  });
  if (!res || res === "cancel" || typeof res !== "object") return null;
  if (!sel?.files.length) { ui.notifications.warn("No audio files (mp3, ogg, wav, webm, flac) chosen."); return null; }
  return uploadAsPlaylist(sel.files, { name: res.name || sel.folder || "Imported", shuffle: res.shuffle });
}

/* ---------- drag & drop from the explorer ---------- */

/** Does this drag carry files from outside the browser? */
export const isFileDrag = (ev) => !!ev.dataTransfer?.types?.includes("Files");

/**
 * Files of a drop, folders read recursively. The entries have to be taken synchronously in the drop handler,
 * so this is called right there and awaited afterwards.
 * @returns {Promise<{files:File[], folder:string}>}
 */
export function filesFromDrop(dataTransfer) {
  const entries = [...(dataTransfer?.items ?? [])].filter(i => i.kind === "file").map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const plain = [...(dataTransfer?.files ?? [])];
  return (async () => {
    if (!entries.length) return { files: plain, folder: "" };
    const files = [];
    let folder = "";
    const readAll = (dir) => new Promise((resolve, reject) => {
      const reader = dir.createReader();
      const all = [];
      const next = () => reader.readEntries(batch => { if (!batch.length) return resolve(all); all.push(...batch); next(); }, reject);
      next();
    });
    const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
    const walk = async (entry) => {
      if (entry.isFile) files.push(await fileOf(entry));
      else if (entry.isDirectory) for (const child of await readAll(entry)) await walk(child);
    };
    for (const e of entries) {
      if (e.isDirectory && !folder) folder = e.name;
      try { await walk(e); } catch (err) { console.error(`${SYSTEM_ID} | jukebox drop`, err); }
    }
    return { files, folder };
  })();
}
