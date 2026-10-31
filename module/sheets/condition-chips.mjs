/**
 * Condition chips shared by the character and NPC sheets: click a chip to clear the condition (exhaustion steps
 * down, right-click steps up), plus a "+" menu to set one. Everything goes through toggleCondition, so the chips,
 * the quick bar and the token HUD change the same ActiveEffects.
 */
import { CONDITIONS, CHIP_ORDER, activeChips } from "../conditions.mjs";
import { toggleCondition, currentExhaustion } from "../chat.mjs";

const { DialogV2 } = foundry.applications.api;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Context entry for the shared partial (characters keep the authoritative exhaustion level on the sheet). */
export function chipContext(actor) {
  return activeChips(actor.statuses ?? [], currentExhaustion(actor));
}

/** Click on a chip: remove the condition; exhaustion steps down, right-click steps up. */
export function chipClick(actor, event, target) {
  const id = target.dataset.id;
  const right = event?.button === 2 || event?.type === "contextmenu";
  if (id === "exhaustion") return toggleCondition(actor, "exhaustion", { delta: right ? 1 : -1 });
  return toggleCondition(actor, id, { active: false });
}

/** "+" button: pick a condition to set (exhaustion adds one level). */
export async function addConditionMenu(actor) {
  const active = new Set(actor.statuses ?? []);
  const rows = CHIP_ORDER.filter(id => !active.has(id)).map(id => ({ id, name: CONDITIONS[id].name, img: CONDITIONS[id].img }));
  rows.push({ id: "exhaustion", name: "Exhaustion +1", img: "systems/ap-turm/icons/exhaustion-1.svg" });
  const content = `<div class="apt-condmenu">${rows.map(r =>
    `<button type="button" class="apt-condmenu-row" data-id="${esc(r.id)}"><img src="${esc(r.img)}" alt=""> ${esc(r.name)}</button>`).join("")}</div>`;
  const id = await DialogV2.wait({
    window: { title: `${actor.name}: Set condition` }, content, rejectClose: false, position: { width: 280 },
    buttons: [{ action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }],
    render: (event, dialog) => dialog.element.querySelectorAll(".apt-condmenu-row").forEach(b => b.addEventListener("click", () => {
      dialog.close();
      toggleCondition(actor, b.dataset.id, b.dataset.id === "exhaustion" ? { delta: 1 } : { active: true })
        .catch(err => console.error("ap-turm | condition", err));
    }))
  });
  return id ?? null;
}
