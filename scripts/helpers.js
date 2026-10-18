/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { FLAGS, MODULE_ID } from "./constants.js";

/** Whether this session has already told the user that the sheet failed. */
let failureReported = false;

/**
 * Log an error in the sheet's own additions and, once per session, tell the user how to keep
 * playing. Most such errors mean a Daggerheart update changed something listed at the top of
 * the sheet's file; the system's sheet keeps working then, so the user is pointed to it.
 * @param {Error} error
 */
export function reportSheetFailure(error) {
  console.error(`${MODULE_ID} | The sheet failed with Daggerheart ${game.system.version}.`, error);
  if (failureReported) return;
  failureReported = true;
  ui.notifications.error(game.i18n.format("DH_NICE_SHEETS.Failure", { version: game.system.version }), { permanent: true });
}

/** Trait order used by the printed Daggerheart sheet; the system stores them as an object. */
const TRAIT_ORDER = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

/** Trait plaque materials for the values between the lowest and the highest, lowest first. */
const MIDDLE_MATERIALS = ["slate", "bronze", "brass"];

/** Degrees left open at the bottom of a resource ring, where its count sits (see ringCard). */
const RING_OPENING = 90;

/**
 * Describe the traits in sheet order and pick each plaque's material by the rank of its value
 * among this character's distinct values: the lowest is cracked iron, the highest gold, and
 * the ones between spread over slate, bronze and brass. Different values get different
 * materials and equal values always match, at level 1 (+2 to −1) as at level 10.
 * @param {Record<string, object>} attributes  Trait data keyed like the system's `context.attributes`.
 */
export function describeTraits(attributes) {
  const traits = TRAIT_ORDER.filter(key => attributes[key]).map(key => ({
    key,
    ...attributes[key],
    value: Number(attributes[key].value ?? 0)
  }));
  const ranks = [...new Set(traits.map(trait => trait.value))].sort((a, b) => a - b);
  const top = ranks.length - 1;
  // Middle values hold ranks 1 to top − 1. A single one takes the central material; more
  // stretch from the first to the last, so two read as far apart as the scale allows.
  const middle = top - 1;

  return traits.map(trait => {
    const rank = ranks.indexOf(trait.value);
    const crowned = top > 0 && rank === top;
    let material;
    if (trait.isSpellcasting) material = crowned ? "spell-top" : "spell";
    else if (crowned) material = "gold";
    else if (top > 0 && rank === 0) material = "iron";
    else {
      const last = MIDDLE_MATERIALS.length - 1;
      const index = middle > 1 ? Math.round(((rank - 1) * last) / (middle - 1)) : last / 2;
      material = MIDDLE_MATERIALS[index];
    }
    return {
      ...trait,
      signed: trait.value.signedString(),
      short: game.i18n.localize(`DAGGERHEART.CONFIG.Traits.${trait.key}.short`),
      material,
      crowned,
      cracked: material === "iron"
    };
  });
}

/**
 * Pin the sheet's looping CSS animations to the document timeline. A re-render replaces the parts'
 * elements, and new elements start their animations from zero, so every pip click would restart
 * the sheens, orbits and pulses. With a shared start time, a replacement picks up the loop at the
 * phase the old element had reached. One-shot animations (entrance, flashes) are left alone.
 * @param {HTMLElement} element  The application's root element.
 */
export function syncLoopingAnimations(element) {
  for (const animation of element.getAnimations({ subtree: true })) {
    if (animation instanceof CSSAnimation && animation.effect.getTiming().iterations === Infinity) {
      animation.startTime = 0;
    }
  }
}

/**
 * Describe a pip track for the templates.
 * @param {number} value
 * @param {number} max
 */
export function track(value, max) {
  value = Math.max(Number(value) || 0, 0);
  max = Math.max(Number(max) || 0, 0);
  return {
    value,
    max,
    percent: max ? Math.round((value / max) * 100) : 0,
    pips: Array.fromRange(max, 1).map(index => ({ index, filled: value >= index }))
  };
}

/**
 * Describe a ring card: the track plus one arc per slot, filling clockwise from the bottom left
 * round to the bottom right, with RING_OPENING left free between them for the count. Scars,
 * when given, take the last segments and are drawn as lost slots.
 * @param {number} value
 * @param {number} max
 * @param {string} icon     Image drawn inside the ring.
 * @param {number} [scars]
 */
export function ringCard(value, max, icon, scars = 0) {
  const pips = track(value, max);
  const total = pips.max + scars;
  // Degrees left between segments; narrower past 9 so a 12-slot ring still reads as filled.
  const gap = total > 9 ? 4 : 6;
  const step = (360 - RING_OPENING) / total;
  const start = 180 + RING_OPENING / 2;
  // A point on the segments' centre line (radius 41 in the 100×100 viewBox), 0° at the top.
  const point = deg => {
    const rad = (deg * Math.PI) / 180;
    return `${(50 + 41 * Math.sin(rad)).toFixed(2)} ${(50 - 41 * Math.cos(rad)).toFixed(2)}`;
  };
  const ring = Array.fromRange(total).map(i => {
    const from = start + i * step + gap / 2;
    const to = start + (i + 1) * step - gap / 2;
    const state = i >= pips.max ? "scar" : i < pips.value ? "filled" : "empty";
    return { state, d: `M${point(from)} A41 41 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}` };
  });
  return { ...pips, ring, icon };
}

/**
 * Update data that removes one of the module's flags, in the nested form `unsetFlag` itself
 * sends, so it merges into a larger update or a batch.
 * @param {string} key  A key of FLAGS.
 */
export function unsetFlagData(key) {
  return { flags: { [MODULE_ID]: { [key]: foundry.data.operators.ForcedDeletion.create() } } };
}

/**
 * Batch updates that take every item out of a container, leaving them loose in the inventory.
 * @param {foundry.documents.Item} container
 * @returns {object[]}
 */
export function releaseContents(container) {
  return (container.parent?.items ?? [])
    .filter(item => item.getFlag(MODULE_ID, FLAGS.storedIn) === container.id)
    .map(item => ({ _id: item.id, ...unsetFlagData(FLAGS.storedIn) }));
}
