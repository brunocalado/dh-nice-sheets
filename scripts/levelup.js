/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATE_PATH } from "./constants.js";

/*
 * The system's level-up windows with our templates for the tiers and the choices. Everything else
 * (the form, the summary, the footer, drops, Tagify) is the system's. What the templates keep from
 * the system's markup, checked against 2.10.13:
 * - `input.selection-checkbox` with its `data-*` attributes: the system listens for `change` on it
 *   and reads the pick from the dataset. Ours are hidden inside the gems that toggle them.
 * - `.levelup-trait-increases` and `.levelup-experience-increases`, which the system turns into
 *   Tagify fields; the experience inputs' `name` paths.
 * - `.levelup-card-selection .card-preview-container`, the drop targets, under `.domain-cards` or
 *   `.multiclass-cards`; the system's card preview partials and their actions.
 * - Context keys: `levelup.tiersForRendering`, `levelup.currentLevel`, `levelup.levels`, the
 *   view mode's `tiers`, and the choices tab's `newExperiences`, `traits`, `experienceIncreases`,
 *   `domainCards`, `subclassCards`, `multiclass`.
 */

/**
 * Turn the system's tier list into rows of gems. Each gem is one of the system's checkbox
 * groups: a single pick, or one pick that costs two. The text of a row toggles its next free gem,
 * or the last one taken at this level when none is free, so the whole row is the control.
 * @param {object[]} tiers         `tiersForRendering`, or the view mode's `tiers`.
 * @param {object} levelTiers      The actor's `system.levelupTiers`, for the level ranges.
 * @param {object} options
 * @param {string} options.idPrefix       Unique per window, for the inputs' ids.
 * @param {number} [options.currentLevel] The level being advanced; unset in the view mode.
 */
function describeTiers(tiers, levelTiers, { idPrefix, currentLevel }) {
  const readonly = currentLevel === undefined;
  const ranges = Object.values(levelTiers.tiers);
  return tiers.map((tier, index) => {
    const levels = ranges[index]?.levels;
    // A tier above the level being advanced; the view mode shows every tier as it stands.
    const locked = !readonly && !tier.active;
    const options = tier.groups.map(group => {
      const gems = group.checkboxGroups.map(({ multi, checkboxes }) => {
        const { selected = false, disabled = false } = checkboxes[0];
        const inputs = checkboxes.map(box => ({ ...box, id: `${idPrefix}-${box.tier}-${box.option}-${box.checkboxNr}` }));
        return {
          multi,
          inputs,
          id: inputs[0].id,
          // Taken at an earlier level, or crossed out by a multiclass choice. The view mode
          // disables every box only because it is read-only, so there it means neither.
          spent: !readonly && selected && disabled,
          blocked: !readonly && !selected && disabled,
          selected,
          clickable: !readonly && !locked && !disabled
        };
      });
      const target = gems.find(gem => gem.clickable && !gem.selected) ?? gems.findLast(gem => gem.clickable && gem.selected);
      return {
        label: group.label,
        gems,
        target: target?.id,
        taken: gems.some(gem => gem.selected),
        closed: gems.every(gem => gem.selected || gem.blocked)
      };
    });
    return {
      name: game.i18n.localize(tier.name),
      levels,
      locked,
      current: !readonly && !!levels && currentLevel >= levels.start && currentLevel <= levels.end,
      options
    };
  });
}

/**
 * Build the level-up classes. Called from the init hook, once the system's classes are reachable.
 * @returns {{ NiceLevelUp: typeof foundry.applications.api.ApplicationV2,
 *             NiceLevelUpView: typeof foundry.applications.api.ApplicationV2 }}
 */
export function defineNiceLevelUp() {
  const { CharacterLevelup, LevelupViewMode } = game.system.api.applications.levelup;
  // Pinned dark like the sheet; see NiceCharacterSheet.DEFAULT_OPTIONS.
  const classes = [MODULE_ID, `${MODULE_ID}-levelup`, "themed", "theme-dark"];

  class NiceLevelUp extends CharacterLevelup {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = { classes, window: { resizable: false }, position: { width: 1040 } };

    /** @inheritdoc */
    static PARTS = {
      ...super.PARTS,
      advancements: {
        template: `${TEMPLATE_PATH}/levelup-advancements.hbs`,
        templates: [`${TEMPLATE_PATH}/levelup-tiers.hbs`]
      },
      selections: { template: `${TEMPLATE_PATH}/levelup-selections.hbs` },
      footer: { template: `${TEMPLATE_PATH}/levelup-footer.hbs` }
    };

    /** @inheritdoc */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      const { levelup } = this;
      if (partId === "advancements") {
        const level = levelup.levels[levelup.currentLevel];
        const { selections } = level.nrSelections;
        context.nice = {
          level: levelup.currentLevel,
          picks: Array.fromRange(level.maxSelections).map(index => index < selections),
          left: Math.max(level.maxSelections - selections, 0),
          tiers: describeTiers(levelup.tiersForRendering, this.actor.system.levelupTiers, {
            idPrefix: this.id,
            currentLevel: levelup.currentLevel
          })
        };
      } else if (partId === "footer") {
        // What still stands between the player and the next button, in the footer's free space.
        const left = levelup.levels[levelup.currentLevel].nrSelections.available;
        const onSummary = this.tabGroups.primary === "summary";
        let status;
        if (onSummary) status = levelup.allLevelsFinished
          ? { state: "ready", text: game.i18n.localize("DH_NICE_SHEETS.LevelUp.readyToFinish") }
          : { state: "pending", text: game.i18n.localize("DH_NICE_SHEETS.LevelUp.unfinished") };
        else if (left > 0) status = { state: "pending", text: game.i18n.format("DH_NICE_SHEETS.LevelUp.left", { count: left }) };
        else if (!levelup.currentLevelFinished) status = { state: "pending", text: game.i18n.localize("DH_NICE_SHEETS.LevelUp.choicesLeft") };
        else status = { state: "ready", text: game.i18n.format("DH_NICE_SHEETS.LevelUp.levelReady", { level: levelup.currentLevel }) };
        context.nice = { status };
      } else if (partId === "selections") {
        const { traits, experienceIncreases, multiclass, domainCards } = context;
        const emptyCards = domainCards.filter(card => !card.img);
        context.nice = {
          domainCardsChosen: domainCards.length - emptyCards.length,
          domainCardsDone: !emptyCards.length,
          // Every open slot lists what it accepts; slots of the same level list the same, so once.
          domainCardHints: [...new Set(emptyCards.flatMap(card => card.emptySubtexts))],
          traitsDone: traits.progress.selected >= traits.progress.max,
          experienceIncreasesDone: experienceIncreases.progress.selected >= experienceIncreases.progress.max,
          subclassDone: context.subclassCards.some(card => card.selected),
          multiclassDone: !!(multiclass?.uuid && multiclass.domains.some(d => d.selected) && multiclass.subclasses.some(s => s.selected))
        };
      }
      return context;
    }
  }

  class NiceLevelUpView extends LevelupViewMode {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = { classes, window: { resizable: false }, position: { width: 1040 } };

    /** @inheritdoc */
    static PARTS = {
      main: {
        template: `${TEMPLATE_PATH}/levelup-view.hbs`,
        templates: [`${TEMPLATE_PATH}/levelup-tiers.hbs`]
      }
    };

    /** @inheritdoc */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.nice = { tiers: describeTiers(context.tiers, this.actor.system.levelupTiers, { idPrefix: this.id }) };
      return context;
    }
  }

  return { NiceLevelUp, NiceLevelUpView };
}
