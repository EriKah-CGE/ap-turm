/**
 * Window sizes of the sheets: default size per sheet type, minimum width, and the last size the user chose,
 * remembered in a client setting (AppV2 does not persist window sizes on its own).
 */
const SYSTEM_ID = "ap-turm";
export const SIZE_SETTING = "sheetSizes";

/** Default sizes and minimum widths per sheet key (character, npc, item.<type>). */
export const SHEET_SIZES = {
  character: { width: 900, height: 860, minWidth: 780 },
  npc: { width: 720, height: 780, minWidth: 600 },
  item: { width: 520, height: 560, minWidth: 400 },
  combatOverview: { width: 520, height: 620, minWidth: 380 },
  stash: { width: 560, height: 620, minWidth: 420 },
  jukebox: { width: 600, height: 780, minWidth: 460, minHeight: 460 }
};

export function registerSizeSetting() {
  game.settings.register(SYSTEM_ID, SIZE_SETTING, { scope: "client", config: false, type: Object, default: {} });
}

/** Stored {width, height} for a sheet key, or null. */
export function storedSize(key) {
  const all = game.settings?.get(SYSTEM_ID, SIZE_SETTING) ?? {};
  const s = all[key];
  return (s && Number.isFinite(s.width) && Number.isFinite(s.height)) ? { width: s.width, height: s.height } : null;
}

const pendingSaves = new Map();
/** Remember a sheet size (debounced; only numeric sizes, only when changed). */
export function rememberSize(key, { width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const cur = storedSize(key);
  if (cur && cur.width === width && cur.height === height) return;
  clearTimeout(pendingSaves.get(key));
  pendingSaves.set(key, setTimeout(() => {
    const all = foundry.utils.deepClone(game.settings.get(SYSTEM_ID, SIZE_SETTING) ?? {});
    all[key] = { width: Math.round(width), height: Math.round(height) };
    game.settings.set(SYSTEM_ID, SIZE_SETTING, all).catch(err => console.error(`${SYSTEM_ID} | sheet size`, err));
  }, 400));
}

/**
 * Mixin: resizable window with a per-type default size, a minimum width (resize handle and setPosition) and the
 * remembered size. `sizeKey(options)` maps the application options (document available) to a SHEET_SIZES key
 * or a derived key such as "item.weapon" (which falls back to SHEET_SIZES.item for defaults).
 */
export function SheetSizeMixin(Base, sizeKey) {
  return class SheetSized extends Base {
    static get SIZE_KEY() { return sizeKey; }

    // _initializeApplicationOptions runs inside the ApplicationV2 constructor, before this class's own fields
    // exist, so the key lives in the options instead of a private field
    get sizeKey() { return this.options?.apturmSizeKey ?? null; }
    get sizeSpec() { return specFor(this.sizeKey); }

    _initializeApplicationOptions(options) {
      const key = typeof sizeKey === "function" ? sizeKey(options) : sizeKey;
      const spec = specFor(key);
      const remembered = storedSize(key);
      options.apturmSizeKey = key;
      options.position = { ...(options.position ?? {}), width: spec.width, height: spec.height, ...(remembered ?? {}) };
      options.window = { ...(options.window ?? {}), resizable: true };
      return super._initializeApplicationOptions(options);
    }

    /** Clamp the width (and a minimum height where one is set) to what the layout needs (resize handle and setPosition). */
    _updatePosition(position) {
      if (typeof position.width === "number") position.width = Math.max(this.sizeSpec.minWidth, position.width);
      if (typeof position.height === "number" && this.sizeSpec.minHeight) position.height = Math.max(this.sizeSpec.minHeight, position.height);
      return super._updatePosition(position);
    }

    _onPosition(position) {
      super._onPosition(position);
      if (this.rendered && this.sizeKey) rememberSize(this.sizeKey, this.position);
    }
  };
}

/** Size spec for a key ("item.weapon" falls back to SHEET_SIZES.item). */
function specFor(key) {
  return SHEET_SIZES[key] ?? SHEET_SIZES[String(key ?? "").split(".")[0]] ?? SHEET_SIZES.item;
}
