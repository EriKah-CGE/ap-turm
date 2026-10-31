/**
 * Keyboard shortcuts (Configure Controls → AP-Turm). Foundry's keybinding API skips every shortcut while a text
 * field has focus. GM-only actions are "restricted" (players do not see them in Configure Controls) and do
 * nothing for a player - no window, no message.
 * Defaults: O = combat overview, J = jukebox; everything else unbound.
 */
import { combatOverview, openCombatOverview } from "./combat-overview.mjs";
import { JukeboxApp, openJukebox } from "./jukebox.mjs";
import { BAR_SHOW, BAR_GM_ONLY } from "./condition-bar.mjs";
import { awardApDialog } from "./award.mjs";
import { requestRollDialog } from "./request-roll.mjs";

const SYSTEM_ID = "ap-turm";

/** Run a shortcut action; errors go to the console. `true` = the key press is consumed. */
const run = (label, fn) => {
  Promise.resolve().then(fn).catch(err => console.error(`${SYSTEM_ID} | shortcut ${label}`, err));
  return true;
};

/** Open the app, or close it when it is already open. */
function toggleApp(app, open) {
  if (app?.rendered) return app.close();
  return open();
}

export function registerKeybindings() {
  const kb = game.keybindings;
  kb.register(SYSTEM_ID, "combatOverview", {
    name: "Combat Overview: open / close", hint: "AP-Turm combat overview (GM).",
    editable: [{ key: "KeyO" }], restricted: true,
    onDown: () => { if (!game.user.isGM) return false; return run("combat overview", () => toggleApp(combatOverview.app, openCombatOverview)); }
  });
  kb.register(SYSTEM_ID, "jukebox", {
    name: "Jukebox: open / close", hint: "AP-Turm jukebox (GM).",
    editable: [{ key: "KeyJ" }], restricted: true,
    onDown: () => {
      if (!game.user.isGM) return false;
      const app = foundry.applications.instances.get(JukeboxApp.DEFAULT_OPTIONS.id);
      return run("jukebox", () => toggleApp(app, openJukebox));
    }
  });
  kb.register(SYSTEM_ID, "conditionBar", {
    name: "Condition bar: show / hide", hint: "The quick condition bar on the canvas.",
    editable: [],
    onDown: () => {
      if (game.settings.get(SYSTEM_ID, BAR_GM_ONLY) && !game.user.isGM) return false;
      return run("condition bar", async () => {
        await game.settings.set(SYSTEM_ID, BAR_SHOW, !game.settings.get(SYSTEM_ID, BAR_SHOW));
        ui.controls?.render();                       // the toggle in the token controls follows
      });
    }
  });
  kb.register(SYSTEM_ID, "awardAp", {
    name: "Award AP", hint: "Open the Award AP dialog (GM).",
    editable: [], restricted: true,
    onDown: () => { if (!game.user.isGM) return false; return run("award AP", () => awardApDialog()); }
  });
  kb.register(SYSTEM_ID, "requestRoll", {
    name: "Request Roll", hint: "Open the Request Roll dialog (GM).",
    editable: [], restricted: true,
    onDown: () => { if (!game.user.isGM) return false; return run("request roll", () => requestRollDialog()); }
  });
}
