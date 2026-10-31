/**
 * One "AP-Turm" button per sidebar tab instead of a row of single buttons.
 *
 * The button sits in the directory header and opens a small popover menu with one entry per tool
 * (icon + label). Clicking an entry closes the menu and opens that tool's dialog; a click next to the
 * menu or Escape closes it. It is not a window: the menu is a plain element on the body, positioned
 * under its button.
 *
 * Visibility: an entry marked `gm` is not rendered for players at all (gone, not greyed out). If no
 * entry is left for a user, that user does not get the button either.
 */

const SYSTEM_ID = "ap-turm";

/** The button's icon: the tower of the campaign, used for every AP-Turm entry point. */
export const SYSTEM_ICON = "fa-tower-observation";

/** Entries this user may see (GM-only entries disappear for players). */
export function visibleEntries(entries, isGM) {
  return (entries || []).filter(e => e && (!e.gm || isGM));
}

/* ---------- the popover ---------- */

let openMenu = null;

/** Close the menu that is currently open, if any. */
export function closeMenu() {
  if (!openMenu) return;
  const { el, off } = openMenu;
  openMenu = null;
  off();
  el.remove();
}

/**
 * Open the menu under `button`.
 * @param {HTMLElement} button
 * @param {{id:string, icon:string, label:string, handler:Function}[]} entries
 */
function openMenuFor(button, entries) {
  closeMenu();
  const el = document.createElement("div");
  el.className = "ap-turm-menu";
  el.setAttribute("role", "menu");
  for (const entry of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ap-turm-menu-item";
    item.dataset.entry = entry.id;
    item.setAttribute("role", "menuitem");
    item.innerHTML = `<i class="fa-solid ${entry.icon}" inert></i><span>${foundry.utils.escapeHTML(entry.label)}</span>`;
    item.addEventListener("click", () => {
      closeMenu();
      Promise.resolve(entry.handler()).catch(err => {
        console.error(`${SYSTEM_ID} | ${entry.id}`, err);
        ui.notifications.error("Action failed, see the console.");
      });
    });
    el.append(item);
  }
  document.body.append(el);

  const place = () => {
    const r = button.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, r.left)))}px`;
    const below = r.bottom + 4;
    el.style.top = `${Math.round(below + h > window.innerHeight ? Math.max(4, r.top - h - 4) : below)}px`;
  };
  place();

  const onPointerDown = (ev) => { if (!el.contains(ev.target) && !button.contains(ev.target)) closeMenu(); };
  const onKeyDown = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); closeMenu(); button.focus(); } };
  const onResize = () => closeMenu();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onResize);
  const off = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onResize);
  };
  openMenu = { el, off, button };
  el.querySelector(".ap-turm-menu-item")?.focus();
  return el;
}

/* ---------- the button in a directory header ---------- */

/**
 * Put the AP-Turm button into a directory header (idempotent: a second call does nothing).
 * @param {HTMLElement} root     the directory's root element (from the render hook)
 * @param {object} o
 * @param {string} [o.label]     button label ("AP-Turm" in the actors tab, "AP-Turm: Import table" ...)
 * @param {string} [o.icon]      button icon (the system icon by default)
 * @param {{id, icon, label, gm, handler}[]} o.entries
 */
export function installSidebarButton(root, { label = "AP-Turm", icon = SYSTEM_ICON, entries = [] } = {}) {
  const header = root?.querySelector(".directory-header");
  if (!header || header.querySelector(".ap-turm-sidebar-btn")) return null;
  const list = visibleEntries(entries, game.user.isGM);
  if (!list.length) return null;                       // nothing for this user: no button either

  closeMenu();                                         // a re-render replaced the button the menu hung on
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ap-turm-sidebar-btn";
  button.innerHTML = `<i class="fa-solid ${icon}" inert></i><span>${foundry.utils.escapeHTML(label)}</span>`;
  // one entry left (or one by design, like the table import): no menu, straight to the dialog
  if (list.length === 1) {
    button.addEventListener("click", () => Promise.resolve(list[0].handler()).catch(err => {
      console.error(`${SYSTEM_ID} | ${list[0].id}`, err);
      ui.notifications.error("Action failed, see the console.");
    }));
  } else {
    button.addEventListener("click", () => { if (openMenu?.button === button) closeMenu(); else openMenuFor(button, list); });
  }
  const row = document.createElement("div");
  row.className = "header-actions action-buttons flexrow ap-turm-import-row";
  row.append(button);
  const actions = header.querySelector(".header-actions");
  if (actions) actions.after(row); else header.prepend(row);
  return button;
}
