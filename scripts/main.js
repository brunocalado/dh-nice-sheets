/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { FLAGS, MODULE_ID, SETTINGS } from "./constants.js";
import { defineNiceCharacterSheet } from "./character-sheet.js";
import { defineNiceCompanionSheet } from "./companion-sheet.js";
import { defineNicePartySheet } from "./party-sheet.js";
import { releaseContents } from "./helpers.js";
import { offerSheet } from "./sheet-offer.js";

// The sheet class extends the system's own CharacterSheet, which only becomes reachable through
// game.system.api once the system's init listener has run. Systems register their init hooks
// before modules do, so defining the class inside our own init hook is safe.
Hooks.once("init", () => {
  const NiceCharacterSheet = defineNiceCharacterSheet();
  const NicePartySheet = defineNicePartySheet();
  const NiceCompanionSheet = defineNiceCompanionSheet();

  // Stored on the user (not the browser) so the choice follows the player between devices.
  game.settings.register(MODULE_ID, SETTINGS.showBiography, {
    name: "DH_NICE_SHEETS.Settings.ShowBiography.name",
    hint: "DH_NICE_SHEETS.Settings.ShowBiography.hint",
    scope: "user",
    config: true,
    type: new foundry.data.fields.BooleanField(),
    default: false,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof NiceCharacterSheet) app.render();
      }
    }
  });

  // UUIDs of the actors whose sheet this browser shows collapsed. Per device rather than per user:
  // collapsing is about screen room, which differs between a laptop and a desktop.
  game.settings.register(MODULE_ID, SETTINGS.collapsedSheets, {
    scope: "client",
    config: false,
    type: new foundry.data.fields.ArrayField(new foundry.data.fields.StringField()),
    default: []
  });

  // `<actor uuid>.<group type>` for each Features or Inventory group this browser shows
  // collapsed; per device for the same reason as collapsed sheets.
  game.settings.register(MODULE_ID, SETTINGS.collapsedGroups, {
    scope: "client",
    config: false,
    type: new foundry.data.fields.ArrayField(new foundry.data.fields.StringField()),
    default: []
  });

  game.settings.register(MODULE_ID, SETTINGS.showPartyNotes, {
    name: "DH_NICE_SHEETS.Settings.ShowPartyNotes.name",
    hint: "DH_NICE_SHEETS.Settings.ShowPartyNotes.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField(),
    default: false,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof NicePartySheet) app.render();
      }
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.suggestSheet, {
    name: "DH_NICE_SHEETS.Settings.SuggestSheet.name",
    hint: "DH_NICE_SHEETS.Settings.SuggestSheet.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField(),
    default: true
  });

  // The player's answer to the sheet offer: "", "accepted" or "declined". Per user and per world,
  // so a "no" in one world doesn't silence the offer in another.
  game.settings.register(MODULE_ID, SETTINGS.sheetOfferAnswer, {
    scope: "user",
    config: false,
    type: new foundry.data.fields.StringField(),
    default: ""
  });

  // Fires for every actor sheet, the Nice Sheet included, since it extends the system's sheet;
  // offerSheet sorts out which ones get the offer.
  Hooks.on("renderActorSheetV2", (sheet, element, context, options) => {
    if (options.isFirstRender) offerSheet(sheet, NiceCharacterSheet);
  });

  // Default only while the GM hasn't saved another Default Sheet: core prefers the stored
  // core.sheetClasses choice over makeDefault, and nothing is written, so disabling the module
  // hands characters back to the system's sheet.
  foundry.documents.collections.Actors.registerSheet(MODULE_ID, NiceCharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "DH_NICE_SHEETS.SheetLabel",
    // Dark only (the window pins `theme-dark` itself), so the sheet config offers no theme choice.
    themes: null
  });

  // Default on the same terms as the character sheet above.
  foundry.documents.collections.Actors.registerSheet(MODULE_ID, NicePartySheet, {
    types: ["party"],
    makeDefault: true,
    label: "DH_NICE_SHEETS.PartySheetLabel",
    themes: null
  });

  // Default on the same terms as the character sheet above. Companions get no sheet offer:
  // makeDefault already covers them, and a dialog per companion would nag.
  foundry.documents.collections.Actors.registerSheet(MODULE_ID, NiceCompanionSheet, {
    types: ["companion"],
    makeDefault: true,
    label: "DH_NICE_SHEETS.CompanionSheetLabel",
    themes: null
  });

  // The system re-renders parties when a member changes, but not a companion when its partner does;
  // the companion sheet shows the partner's Hope, name, art and spellcast trait.
  Hooks.on("updateActor", actor => {
    if (actor.type !== "character") return;
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof NiceCompanionSheet && app.document.system.partner === actor) app.render();
    }
  });
});

// Equipping an item takes it out of its container, whichever sheet or tool equips it. Folded into
// the same update, so it costs no extra database call.
Hooks.on("preUpdateItem", (item, changes) => {
  if (changes.system?.equipped !== true || !item.getFlag(MODULE_ID, FLAGS.storedIn)) return;
  foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${FLAGS.storedIn}`, foundry.data.operators.ForcedDeletion.create());
});

// Deleting a container leaves what it held loose. Only the client that deleted it writes.
Hooks.on("deleteItem", (item, options, userId) => {
  if (userId !== game.user.id || !item.actor || !item.getFlag(MODULE_ID, FLAGS.container)) return;
  const updates = releaseContents(item);
  if (updates.length) item.actor.updateEmbeddedDocuments("Item", updates);
});
