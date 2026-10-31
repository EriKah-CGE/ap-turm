/**
 * Permission guard for sheet actions.
 *
 * ApplicationV2 runs a data-action handler no matter whether the sheet is editable, so a viewer with
 * only observer rights would reach the document update and get Foundry's raw "User lacks permission"
 * rejection. guardWrites() wraps every action that writes and answers with a readable message instead.
 */

/**
 * Wrap all actions except `readOnly` with an editability check.
 * @param {Record<string, Function|{handler:Function}>} actions   Action map for DEFAULT_OPTIONS
 * @param {string[]} readOnly                                     Actions that only roll, open or post
 * @returns {Record<string, Function|object>}
 */
export function guardWrites(actions, readOnly = []) {
  const skip = new Set(readOnly);
  const out = {};
  for (const [name, def] of Object.entries(actions)) {
    if (skip.has(name)) { out[name] = def; continue; }
    const handler = typeof def === "function" ? def : def.handler;
    const guarded = function (...args) {
      if (!this.isEditable) { ui.notifications.warn(deniedMessage(this.document ?? this.actor)); return null; }
      return handler.apply(this, args);
    };
    out[name] = typeof def === "function" ? guarded : { ...def, handler: guarded };
  }
  return out;
}

/** Why the action was refused: missing ownership, or the document locked for everyone. */
export function deniedMessage(doc) {
  const name = doc?.name ?? "This document";
  if (doc && !doc.isOwner) return `You do not own ${name} - only its owner and the GM can change anything here.`;
  return `${name} is not editable right now (compendium or locked).`;
}
