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
  showPartyNotes: "showPartyNotes",
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

/**
 * The companion's level-up options as the Daggerheart system defines them (defaultCompanionTier in
 * module/data/levelTier.mjs, 2.10.13), which the system does not expose: the selection's
 * `optionKey`, the name of its label under `DAGGERHEART.APPLICATIONS.Levelup.options`, how many
 * marks it takes, and its icon. Keep in step with the system. Constructing the system's
 * DhCompanionLevelUp only to read its levelTiers would open its level-up state for a label lookup.
 */
export const COMPANION_TRAINING = Object.freeze([
  { key: "experience", name: "intelligent", max: 3, icon: "fa-brain" },
  { key: "hope", name: "lightInTheDark", max: 1, icon: "fa-sun" },
  { key: "creatureComfort", name: "creatureComfort", max: 1, icon: "fa-heart" },
  { key: "armored", name: "armored", max: 1, icon: "fa-shield-halved" },
  { key: "vicious", name: "vicious", max: 3, icon: "fa-burst" },
  { key: "stress", name: "resilient", max: 3, icon: "fa-brain" },
  { key: "bonded", name: "bonded", max: 1, icon: "fa-link" },
  { key: "evasion", name: "aware", max: 3, icon: "fa-eye" }
]);
