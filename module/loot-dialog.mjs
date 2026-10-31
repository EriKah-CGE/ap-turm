/**
 * Loot table importer, Foundry side: button "AP-Turm: Import table" in the RollTables sidebar header,
 * dialog with name, text area, file button (.json / .txt) and live preview (ranges, gaps / overlaps in red),
 * creates a native RollTable. The JSON shapes are recognized in loot.mjs (parseLootJsonText).
 */
import { parseLootTable, parseLootJsonText, lootToRollTable, problemLabel } from "./loot.mjs";
import { installSidebarButton } from "./sidebar-menu.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Preview HTML for the parsed table.
 * @param {object} parsed
 * @param {string} [note]  line above the table ("Loaded from x.json ...")
 */
export function previewHtml(parsed, note = "") {
  const head = note ? `<p class="apt-loot-note">${esc(note)}</p>` : "";
  if (!parsed.entries.length) return `${head}<p class="apt-loot-empty">No entries recognized yet.</p>`;
  const bad = new Set();
  for (const p of parsed.problems) if (p.index !== undefined) bad.add(p.index);
  const gaps = parsed.problems.filter(p => p.type === "gap");
  const overlaps = parsed.problems.filter(p => p.type === "overlap").map(p => p.index);
  const rows = parsed.entries.map((e, i) => {
    const cls = overlaps.includes(i) ? "bad" : bad.has(i) ? "warn" : "";
    const span = e.range[0] === e.range[1] ? `${e.range[0]}` : `${e.range[0]}–${e.range[1]}`;
    return `<tr class="${cls}"><td class="r">${span}</td><td class="w">${e.weight > 1 || !parsed.hasRanges ? `×${e.weight}` : ""}</td><td>${esc(e.text)}</td></tr>`;
  });
  const problems = parsed.problems.length
    ? `<ul class="apt-loot-problems">${parsed.problems.map(p => `<li class="${p.type === "noRange" ? "warn" : "bad"}">${esc(problemLabel(p))}</li>`).join("")}</ul>`
    : `<p class="apt-loot-ok">Ranges are gapless, no overlaps.</p>`;
  return `${head}<div class="apt-loot-summary"><b>${parsed.entries.length}</b> entries · formula <b>${esc(parsed.formula)}</b>${gaps.length ? ` · <span class="bad">${gaps.length} gap${gaps.length === 1 ? "" : "s"}</span>` : ""}</div>
    <table class="apt-loot-preview"><thead><tr><th>Roll</th><th></th><th>Entry</th></tr></thead><tbody>${rows.join("")}</tbody></table>${problems}`;
}

/** Open the import dialog; resolves with the created RollTable or null. */
export async function importLootTableDialog() {
  if (!game.user.isGM) { ui.notifications.warn("Only the GM can import loot tables."); return null; }
  const content = `
    <div class="apt-loot-dialog">
      <div class="form-group"><label>Table name</label><div class="form-fields"><input type="text" name="name" value="" placeholder="Loot Level 1" autofocus></div></div>
      <div class="form-group stacked"><label>Paste text from Word or Excel</label>
        <textarea name="text" rows="10" placeholder="01–05&#9;50 gold coins&#10;06–20&#9;Healing potion&#10;…&#10;or&#10;• Healing potion&#10;• Torch"></textarea></div>
      <div class="form-group"><label>Or load a file</label><div class="form-fields apt-loot-file">
        <input type="file" name="file" accept=".json,.txt,application/json,text/plain">
      </div></div>
      <p class="hint">.txt goes through the text parser, .json accepts a Foundry RollTable export, a plain list of entries, or an AP-Turm export.</p>
      <div class="form-group stacked"><label>Preview</label><div class="apt-loot-previewbox"></div></div>
    </div>`;

  // state of the dialog: what "Import" would create right now
  let current = { parsed: parseLootTable(""), note: "", error: "" };

  const table = await foundry.applications.api.DialogV2.wait({
    window: { title: "AP-Turm: Import table", icon: "fa-solid fa-table-list" },
    position: { width: 640 },
    content, rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const ta = root.querySelector("textarea[name=text]");
      const nameInput = root.querySelector("input[name=name]");
      const fileInput = root.querySelector("input[name=file]");
      const box = root.querySelector(".apt-loot-previewbox");
      const draw = () => {
        box.innerHTML = current.error
          ? `<p class="apt-loot-error">${esc(current.error)}</p><p class="apt-loot-empty">Nothing is created.</p>`
          : previewHtml(current.parsed, current.note);
      };
      const fromText = () => { current = { parsed: parseLootTable(ta.value), note: "", error: "" }; draw(); };
      ta.addEventListener("input", foundry.utils.debounce(fromText, 150));
      ta.addEventListener("paste", () => setTimeout(fromText, 0));
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        let text;
        try { text = await file.text(); }
        catch (err) { current = { parsed: parseLootTable(""), note: "", error: `${file.name} could not be read: ${err.message}` }; draw(); return; }
        if (/\.json$/i.test(file.name)) {
          const res = parseLootJsonText(text);
          if (!res.ok) { current = { parsed: parseLootTable(""), note: "", error: `${file.name}: ${res.reason}` }; draw(); return; }
          const skipped = res.skipped ? `, ${res.skipped} row(s) without text skipped` : "";
          current = { parsed: res.parsed, note: `Loaded from ${file.name} (${res.source})${skipped}`, error: "" };
          if (res.name && !nameInput.value.trim()) nameInput.value = res.name;
          ta.value = "";
        } else {
          ta.value = text;                     // .txt stays visible and editable in the text area
          current = { parsed: parseLootTable(text), note: `Loaded from ${file.name} (text)`, error: "" };
        }
        draw();
      });
      draw();
    },
    buttons: [
      {
        action: "import", label: "Import", icon: "fa-solid fa-file-import", default: true,
        callback: async (event, button) => {
          if (current.error) { ui.notifications.warn(current.error); return null; }
          const name = button.form.querySelector("input[name=name]").value.trim();
          const parsed = current.parsed;
          if (!parsed.entries.length) { ui.notifications.warn("No entries recognized."); return null; }
          const data = lootToRollTable(parsed, name || "Loot");
          const doc = await RollTable.implementation.create(data);
          const gaps = parsed.problems.filter(p => p.type !== "noRange").length;
          ui.notifications.info(`Table "${doc.name}" created with ${parsed.entries.length} entries (${parsed.formula})${gaps ? `, ${gaps} gap(s)/overlap(s) kept` : ""}.`);
          return doc;
        }
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ]
  });
  if (table && typeof table === "object" && table.documentName === "RollTable") { table.sheet.render({ force: true }); return table; }
  return null;
}

/**
 * Sidebar button (RollTables tab and its popout). v13: the render hook of the AppV2 sidebar tab is
 * "renderRollTableDirectory" and `html` is the tab's root HTMLElement. Inserted once per header (idempotent).
 * Permission: GM only (loot tables are the GM's material; RollTable.canUserCreate would also allow
 * assistants a world may have granted table creation to).
 */
export function registerLootHooks() {
  Hooks.on("renderRollTableDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    // same button as the Actors tab (sidebar-menu.mjs); one entry, so the click opens the dialog directly
    installSidebarButton(root, {
      label: "AP-Turm: Import table", icon: "fa-table-list",
      entries: [{ id: "loot-import", icon: "fa-table-list", label: "Import table", gm: true, handler: () => importLootTableDialog() }]
    });
  });
}
