/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, RESOURCE_ICONS, TEMPLATE_PATH } from "./constants.js";
import { reportSheetFailure, ringCard, syncLoopingAnimations, track } from "./helpers.js";
import { RING_FLASHES, VitalCards } from "./vital-cards.js";

/*
 * What this sheet relies on from the Daggerheart system, checked against 2.10.13 (same role as the
 * list at the top of character-sheet.js):
 * - Class paths `game.system.api.applications.sheets.actors.Companion` and
 *   `.sheetConfigs.CompanionSettings`; the `settingSheet` getter, overridden as on the character.
 * - PARTS ids limited, header, details, effects (the system prepares context by id).
 * - Actions: actionRoll, levelManagement, openSettings, sendExpToChat, editImage, useItem,
 *   triggerContextMenu; the attack's context menu on `[data-item-uuid][data-type="attack"]`.
 * - Schema: system.partner, evasion, resources.stress, experiences, attack (img, name, range,
 *   uuid, getDamageFormula(), damage.main.type), canLevelUp, levelData.level.changed, the
 *   DEFAULT_ICON; on the partner, system.spellcastModifierTrait.{key,value} and resources.hope.
 */

/**
 * What flashes on the sheet: the companion's Stress card, and the partner's Hope plaque. Each is
 * synced against its own actor, the plaque inside the defense column only, so a change to the
 * partner's own Stress never flashes the companion's card.
 */
const COMPANION_FLASHES = Object.freeze({
  ...RING_FLASHES,
  hope: { card: ".nice-stat.hope", up: "flash-gain", down: "flash-spend" }
});

/**
 * Build the companion sheet class. Like the character and party sheets, it extends the system's
 * own CompanionSheet, so the Action Roll and its costs, the companion level-up window, the
 * attack's context menu and the effects tab stay the system's; the templates, their context and
 * the CSS scope are ours.
 *
 * @returns {typeof foundry.applications.sheets.ActorSheetV2}
 */
export function defineNiceCompanionSheet() {
  const SystemCompanionSheet = game.system.api.applications.sheets.actors.Companion;

  /**
   * The system's companion settings window in the sheet's dress. Only the header is ours: the art
   * is the sheet's backdrop and nowhere else on it, so the image is changed here, as on the
   * character. The other parts stay the system's, so partner selection, the attack and the
   * experiences work unchanged.
   */
  class NiceCompanionSettings extends game.system.api.applications.sheetConfigs.CompanionSettings {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
      classes: [MODULE_ID, `${MODULE_ID}-settings`, "themed", "theme-dark"]
    };

    /** @inheritdoc */
    static PARTS = {
      ...super.PARTS,
      header: {
        id: "header",
        template: `${TEMPLATE_PATH}/settings-header.hbs`
      }
    };
  }

  return class NiceCompanionSheet extends SystemCompanionSheet {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
      // Pinned dark like the other sheets; the second class scopes what only this window needs.
      classes: [MODULE_ID, `${MODULE_ID}-companion`, "themed", "theme-dark"],
      // The system's companion sheet is 340px wide with an automatic height. This one keeps a
      // designed size, wide enough that the attack card's buttons never crowd its name.
      window: { resizable: false },
      position: { width: 440, height: 640 },
      actions: {
        // A right click reaches actions as an `auxclick` with button 2 only when it is listed.
        niceStepResource: { handler: NiceCompanionSheet.#onStepResource, buttons: [0, 2] },
        niceOpenPartner: NiceCompanionSheet.#onOpenPartner,
        niceTogglePartnerHope: NiceCompanionSheet.#onTogglePartnerHope
      }
    };

    /** @inheritdoc */
    static PARTS = {
      limited: {
        id: "limited",
        template: `${TEMPLATE_PATH}/companion-limited.hbs`
      },
      header: {
        id: "header",
        template: `${TEMPLATE_PATH}/companion-header.hbs`,
        templates: [`${TEMPLATE_PATH}/ring-card.hbs`]
      },
      details: {
        id: "details",
        scrollable: [".nice-scroll"],
        template: `${TEMPLATE_PATH}/companion-details.hbs`
      },
      effects: {
        id: "effects",
        scrollable: [".nice-scroll"],
        template: `${TEMPLATE_PATH}/effects.hbs`
      }
    };

    /** The Stress card's click queue, and its flashes and the partner's Hope plaque's. */
    #vitals = new VitalCards(COMPANION_FLASHES, () => this.render());

    /** Whether a full render has completed; see NiceCharacterSheet#settled. */
    #settled = false;

    /** @type {NiceCompanionSettings} */
    #settingSheet;

    /**
     * The system resolves this from the actor type's metadata and caches it in its own private
     * field, so overriding the getter is the only way to swap in our settings window.
     * @override
     */
    get settingSheet() {
      return (this.#settingSheet ??= new NiceCompanionSettings({ document: this.document }));
    }

    /** @inheritdoc */
    _initializeApplicationOptions(options) {
      const applicationOptions = super._initializeApplicationOptions(options);
      // The system scopes its companion layout under the `companion` class, as it does the
      // character's under `character`; dropping it leaves the shared partials styled and the layout ours.
      applicationOptions.classes = applicationOptions.classes.filter(c => c !== "companion");
      // The limited view is the name and level alone, so the window shrinks to them.
      if (applicationOptions.document.testUserPermission(game.user, "LIMITED", { exact: true })) {
        applicationOptions.position.height = "auto";
      }
      return applicationOptions;
    }

    /* -------------------------------------------- */
    /*  Context                                     */
    /* -------------------------------------------- */

    /** @inheritdoc */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      // What the sheet adds reads system internals (see the list at the top of this file). When an
      // update breaks one, the sheet still opens with what the system provides, and the user is told.
      try {
        context.nice = this.#prepareNiceContext();
      } catch (error) {
        reportSheetFailure(error);
        context.nice = {};
      }
      return context;
    }

    /** The sheet's own additions to the render context, read by the templates as `nice`. */
    #prepareNiceContext() {
      const actor = this.document;
      const { partner, resources: { stress }, attack } = actor.system;
      // A partner without a subclass has no spellcast trait; one whose subclass names none has a key-less one.
      const trait = partner?.system.spellcastModifierTrait;
      // Signed by hand: Number#signedString leaves zero unsigned, and a modifier reads "+0".
      const modifier = trait?.value ?? 0;
      const spellcast = trait?.key ? {
        label: game.i18n.localize(CONFIG.DH.ACTOR.abilities[trait.key].label),
        value: modifier < 0 ? String(modifier) : `+${modifier}`
      } : null;
      const evasionBonus = actor.system.evasion - actor._source.system.evasion;
      const damageType = CONFIG.DH.GENERAL.damageTypes[attack?.damage?.main?.type?.first()];

      return {
        // The art is the backdrop only; the system's capybara is skipped, as the party skips its icon.
        backdrop: actor.img !== actor.system.constructor.DEFAULT_ICON ? actor.img : null,
        stress: ringCard(this.#vitals.shown(actor, "stress"), stress.max, RESOURCE_ICONS.stress),
        // The last Stress takes the companion out of the scene until the partner's next long rest.
        out: stress.max > 0 && stress.value >= stress.max,
        partner: partner ? { uuid: partner.uuid, name: partner.name, img: partner.img } : null,
        // Companion features are paid for with the partner's Hope, so it is shown here. Clickable
        // only by someone who could also change it on the partner's own sheet.
        hope: partner ? {
          ...track(partner.system.resources.hope.value, partner.system.resources.hope.max),
          editable: this.isEditable && partner.isOwner
        } : null,
        level: actor.system.levelData.level.changed,
        canLevelUp: actor.system.canLevelUp,
        evasion: { value: actor.system.evasion, bonus: evasionBonus ? evasionBonus.signedString() : null },
        // Read off the partner rather than the companion's prepared attack bonus, which goes stale
        // when only the partner changes.
        spellcast,
        attack: attack ? {
          uuid: attack.uuid,
          name: attack.name,
          img: attack.img,
          bonus: spellcast?.value ?? null,
          range: attack.range ? game.i18n.localize(`DAGGERHEART.CONFIG.Range.${attack.range}.short`) : null,
          damage: attack.getDamageFormula() || null,
          damageType: damageType ? game.i18n.localize(damageType.abbreviation) : null
        } : null
      };
    }

    /* -------------------------------------------- */
    /*  Actions                                     */
    /* -------------------------------------------- */

    /**
     * Step Stress by one from its ring card: left click adds, right click removes.
     * @this {NiceCompanionSheet}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onStepResource(event, target) {
      if (!this.isEditable) return;
      this.#vitals.step(event, target, this.document);
    }

    /**
     * Open the partner's sheet from the chip under the name.
     * @this {NiceCompanionSheet}
     */
    static #onOpenPartner() {
      this.document.system.partner?.sheet.render({ force: true });
    }

    /**
     * Set the partner's Hope from a gem on its plaque, the way the system's party sheet toggles a
     * member's: a click on the last lit gem clears it, any other sets Hope to that gem. The
     * template leaves the action off for users who don't own the partner; the check here covers a
     * plaque rendered before ownership changed.
     * @this {NiceCompanionSheet}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onTogglePartnerHope(event, target) {
      const partner = this.document.system.partner;
      if (!partner?.isOwner) return;
      const index = Number(target.dataset.value);
      const { value } = partner.system.resources.hope;
      await partner.update({ "system.resources.hope.value": value >= index ? index - 1 : index });
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    /**
     * A system partial the templates use can go missing in a system update, and then the sheet
     * cannot open at all. The system's companion sheet opens in its place, so play goes on and
     * the sheet can be switched from there.
     * @inheritdoc
     */
    async _renderHTML(context, options) {
      try {
        return await super._renderHTML(context, options);
      } catch (error) {
        reportSheetFailure(error);
        if (options.isFirstRender) new SystemCompanionSheet({ document: this.document }).render({ force: true });
        throw error;
      }
    }

    /** @inheritdoc */
    async _onRender(context, options) {
      await super._onRender(context, options);
      if (this.#settled) this.element.classList.add("nice-settled");
      this.#settled = true;
      syncLoopingAnimations(this.element);
      // Grey art and banner while the companion is out of the scene; on the window content so the
      // backdrop, in the header part, and the banner below it read the same state.
      this.element.querySelector(".window-content")?.classList.toggle("nice-out", Boolean(context.nice.out));
      if (context.nice.stress) this.#vitals.sync(this.document, this.element);
      const plaques = this.element.querySelector(".nice-companion-vitals .nice-defense");
      if (context.nice.hope && plaques) this.#vitals.sync(this.document.system.partner, plaques);
    }

    /**
     * A closed sheet keeps its instance; the next opening starts its flashes and entrance
     * animations over, as the character sheet's does.
     * @inheritdoc
     */
    _onClose(options) {
      super._onClose(options);
      this.#vitals.reset();
      this.#settled = false;
    }
  };
}
