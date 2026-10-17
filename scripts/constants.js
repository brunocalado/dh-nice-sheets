/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

export const MODULE_ID = "dh-nice-sheets";

/** Root folder of the sheet templates, shared by every PARTS entry. */
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;

/** Setting keys registered by main.js. */
export const SETTINGS = Object.freeze({
  showBiography: "showBiography",
  collapsedSheets: "collapsedSheets",
  collapsedGroups: "collapsedGroups",
  suggestSheet: "suggestSheet",
  sheetOfferAnswer: "sheetOfferAnswer"
});

/** Flag keys stored on documents under the module's scope. */
export const FLAGS = Object.freeze({
  /** On an item: pinned to the sheet's sidebar. */
  favorite: "favorite",
  /** On a character: the free-form text at the top of the Notes tab. */
  notes: "notes",
  /** On a loot item: it holds other items in the Inventory tab. */
  container: "container",
  /** On an inventory item: id of the container item it is stored in. */
  storedIn: "storedIn"
});

/** Item types that can be stored in a container, in the order a container lists them. */
export const STORABLE_TYPES = Object.freeze(["weapon", "armor", "consumable", "loot"]);

/** Core icons drawn at the centre of the resource rings, by resource key. Every install has them. */
export const RESOURCE_ICONS = Object.freeze({
  hitPoints: "icons/commodities/biological/organ-heart-red.webp",
  stress: "icons/commodities/biological/organ-brain-pink-purple.webp",
  hope: "icons/magic/light/explosion-star-glow-yellow.webp",
  armor: "icons/equipment/shield/heater-embossed-gold.webp"
});
