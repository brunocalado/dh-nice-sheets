/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { FLAGS, MODULE_ID } from "./constants.js";

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
