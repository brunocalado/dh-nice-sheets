/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";

/** Whether the offer dialog is on screen, so opening several sheets at once asks only once. */
let offerOpen = false;

/**
 * Offer a player the Nice Sheet the first time they open their character in another sheet.
 * A "no", or closing the dialog, silences the offer for good; a "yes" keeps offering it for their
 * other characters, since the sheet choice is stored on each actor, not on the user.
 * @param {foundry.applications.api.DocumentSheetV2} sheet  The sheet that just rendered.
 * @param {typeof foundry.applications.api.DocumentSheetV2} NiceCharacterSheet
 */
export async function offerSheet(sheet, NiceCharacterSheet) {
  const actor = sheet.document;
  if (offerOpen || game.user.isGM || (sheet instanceof NiceCharacterSheet)) return;
  if ((actor.type !== "character") || !actor.isOwner) return;
  if (!game.settings.get(MODULE_ID, SETTINGS.suggestSheet)) return;
  if (game.settings.get(MODULE_ID, SETTINGS.sheetOfferAnswer) === "declined") return;

  // Recorded before the dialog opens, so closing it or reloading counts as a "no".
  offerOpen = true;
  await game.settings.set(MODULE_ID, SETTINGS.sheetOfferAnswer, "declined");
  const accepted = await foundry.applications.api.DialogV2.confirm({
    window: { title: "DH_NICE_SHEETS.Offer.title", icon: "fa-solid fa-scroll" },
    position: { width: 640 },
    // Width and height up front: the dialog centers itself before the image loads, and an image of
    // unknown size would then push the buttons off screen. The cap keeps them visible on short screens.
    content: `<img src="modules/${MODULE_ID}/assets/sheet-preview.webp" alt="" width="900" height="760"`
      + ` style="display: block; width: 100%; height: auto; max-height: 55vh; object-fit: contain; border: none;">`
      + `<p>${game.i18n.format("DH_NICE_SHEETS.Offer.content", { name: foundry.utils.escapeHTML(actor.name) })}</p>`
      + `<p>${game.i18n.localize("DH_NICE_SHEETS.Offer.hint")}</p>`,
    yes: { label: "DH_NICE_SHEETS.Offer.yes" },
    no: { label: "DH_NICE_SHEETS.Offer.no" },
    rejectClose: false
  });
  offerOpen = false;
  if (!accepted) return;

  await game.settings.set(MODULE_ID, SETTINGS.sheetOfferAnswer, "accepted");
  // The same flag the Configure Sheet dialog writes; core closes the open sheet and renders the new one.
  await actor.setFlag("core", "sheetClass", `${MODULE_ID}.${NiceCharacterSheet.name}`);
}
