/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, RESOURCE_ICONS, TEMPLATE_PATH } from "./constants.js";
import { describeTraits, reportSheetFailure, ringCard, syncLoopingAnimations, track } from "./helpers.js";
import { VitalCards } from "./vital-cards.js";

/*
 * What this sheet relies on from the Daggerheart system, checked against 2.10.13 (same role as the
 * list at the top of character-sheet.js):
 * - Class path `game.system.api.applications.sheets.actors.Party`.
 * - PARTS ids: the system prepares context by id (`_preparePartContext`: header, partyMembers,
 *   notes), and `Actor#_onUpdate` re-renders `{ parts: ["partyMembers"] }` on every party when a
 *   member changes.
 * - Context keys: tabs, partyMembers (weapons, subtitle), showStats, isGM, tagTeamActive,
 *   groupRollActive, notes, inventory, source.
 * - Actions: tagTeamRoll, groupRoll, triggerRest (data-type), openDocument (data-uuid),
 *   deletePartyMember (closest [data-uuid]), toggleHope (data-actor-id, data-value), editImage,
 *   tempBrowser.
 * - The contextmenu listener `_attachPartListeners` puts on `img.profile` (shows the artwork).
 * - Settings and schema: `variantRules.massiveDamage`, the party's `DEFAULT_ICON` and `active`;
 *   `system.updateArmorValue({ value })` on members.
 */

/**
 * What flashes when a member's vital changes: its ring card, and for Hope the gem row. The party's
 * art is not a member's, so a Hope gain lights no backdrop here.
 */
const MEMBER_FLASHES = Object.freeze({
  hitPoints: { card: ".nice-ring-card.hp", up: "flash-worse", down: "flash-better" },
  stress: { card: ".nice-ring-card.stress", up: "flash-worse", down: "flash-better" },
  armor: { card: ".nice-ring-card.armor", up: "flash-worse", down: "flash-better" },
  hope: { card: ".nice-hope", up: "flash-gain", down: "flash-spend" }
});

/** Member types in the order their groups are listed; characters come first and untitled. */
const MEMBER_GROUPS = ["character", "companion", "adversary", "npc"];

/**
 * Build the party sheet class. Like the character sheet, it extends the system's own PartySheet,
 * so the Tag Team and Group Roll dialogs, the rest trigger, actor drops, the inventory filters and
 * item transfers stay the system's; the templates, their context and the CSS scope are ours.
 *
 * @returns {typeof foundry.applications.sheets.ActorSheetV2}
 */
export function defineNicePartySheet() {
  const SystemPartySheet = game.system.api.applications.sheets.actors.Party;

  return class NicePartySheet extends SystemPartySheet {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
      // Pinned dark like the character sheet; the second class scopes what only this window needs.
      classes: [MODULE_ID, `${MODULE_ID}-party`, "themed", "theme-dark"],
      // The system's party sheet is resizable and 600×900; this one keeps a smaller designed size.
      window: { resizable: false },
      position: { width: 760, height: 640 },
      actions: {
        // A right click reaches actions as an `auxclick` with button 2 only when it is listed.
        niceStepResource: { handler: NicePartySheet.#onStepResource, buttons: [0, 2] }
      }
    };

    /** @inheritdoc */
    static PARTS = {
      header: {
        id: "header",
        template: `${TEMPLATE_PATH}/party-header.hbs`
      },
      partyMembers: {
        id: "partyMembers",
        scrollable: [".nice-scroll"],
        template: `${TEMPLATE_PATH}/party-members.hbs`,
        templates: [`${TEMPLATE_PATH}/ring-card.hbs`]
      },
      // TODO: our own inventory, with containers. The system's part until then, so its filters
      // keep their markup.
      inventory: {
        template: "systems/daggerheart/templates/sheets/actors/party/inventory.hbs",
        scrollable: [".tab.inventory .items-section"]
      },
      notes: {
        id: "notes",
        template: `${TEMPLATE_PATH}/party-notes.hbs`
      }
    };

    /** The members' ring cards: click queue and flashes, per member. */
    #vitals = new VitalCards(MEMBER_FLASHES, () => this.render({ parts: ["partyMembers"] }));

    /** Whether a full render has completed; see NiceCharacterSheet#settled. */
    #settled = false;

    /** @inheritdoc */
    _initializeApplicationOptions(options) {
      const applicationOptions = super._initializeApplicationOptions(options);
      // The system scopes its party layout under the `party` class, as it does the character's
      // under `character`; dropping it leaves the shared partials styled and the layout ours.
      applicationOptions.classes = applicationOptions.classes.filter(c => c !== "party");
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
        const party = this.document;
        const count = party.system.partyMembers.length;
        const plural = new Intl.PluralRules(game.i18n.lang).select(count);
        const membersKey = `DH_NICE_SHEETS.Party.members.${game.i18n.has(`DH_NICE_SHEETS.Party.members.${plural}`) ? plural : "other"}`;
        context.nice = {
          // The party's art is a faint backdrop; the system's default icon is skipped.
          backdrop: party.img !== party.system.constructor.DEFAULT_ICON ? party.img : null,
          memberCount: game.i18n.format(membersKey, { count }),
          count,
          active: party.system.active
        };
      } catch (error) {
        reportSheetFailure(error);
        context.nice = {};
      }
      return context;
    }

    /** @inheritdoc */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if (partId !== "partyMembers" || !context.nice.count) return context;
      try {
        context.nice.groups = this.#prepareGroups(context);
      } catch (error) {
        reportSheetFailure(error);
      }
      return context;
    }

    /**
     * The members as cards, grouped by actor type: characters first, untitled, then a titled
     * group per other type that has members. Which stats each type shows follows the system's
     * party-members.hbs.
     * @param {object} context  The members part's render context.
     */
    #prepareGroups(context) {
      const massive = game.settings.get(CONFIG.DH.id, CONFIG.DH.SETTINGS.gameSettings.variantRules).massiveDamage.enabled;
      const systemMembers = new Map(context.partyMembers.map(member => [member.uuid, member]));
      const groups = MEMBER_GROUPS.map(type => ({
        type,
        title: type === "character" ? null : `DH_NICE_SHEETS.Party.section.${type}`,
        members: []
      }));

      for (const actor of this.document.system.partyMembers) {
        const group = groups.find(g => g.type === actor.type);
        if (!group) continue;
        const system = actor.system;
        const isCharacter = actor.type === "character";
        const shown = key => this.#vitals.shown(actor, key);
        const { weapons, subtitle } = systemMembers.get(actor.uuid) ?? {};

        const rings = [];
        if (["character", "adversary"].includes(actor.type)) {
          rings.push({ kind: "hp", resource: "hitPoints", label: "DAGGERHEART.GENERAL.HitPoints.short",
            card: ringCard(shown("hitPoints"), system.resources.hitPoints.max, RESOURCE_ICONS.hitPoints) });
        }
        if (actor.type !== "npc" && system.resources?.stress) {
          rings.push({ kind: "stress", resource: "stress", label: "DAGGERHEART.GENERAL.stress",
            card: ringCard(shown("stress"), system.resources.stress.max, RESOURCE_ICONS.stress) });
        }
        if (system.armorScore?.max) {
          rings.push({ kind: "armor", resource: "armor", label: "DAGGERHEART.GENERAL.armor",
            card: ringCard(shown("armor"), system.armorScore.max, RESOURCE_ICONS.armor) });
        }

        let defense = null;
        if (system.evasion != null) defense = { label: "DAGGERHEART.GENERAL.evasion", value: system.evasion };
        else if (system.difficulty != null) defense = { label: "DAGGERHEART.GENERAL.difficulty", value: system.difficulty };
        const thresholds = ["character", "adversary"].includes(actor.type) ? system.damageThresholds : null;

        let traits = null;
        if (isCharacter) {
          const spellcastKey = system.spellcastModifierTrait?.key;
          traits = describeTraits(Object.fromEntries(Object.entries(system.traits).map(([key, trait]) => [key, {
            value: trait.value,
            label: game.i18n.localize(CONFIG.DH.ACTOR.abilities[key].label),
            isSpellcasting: key === spellcastKey
          }])));
        }

        group.members.push({
          uuid: actor.uuid,
          name: actor.name,
          img: actor.img,
          type: actor.type,
          editable: actor.isOwner,
          // Characters list their class, subclass, community and ancestry as the character
          // sheet's header does; the others take the system's subtitle.
          heritage: isCharacter
            ? [system.class?.value, system.class?.subclass, system.community, system.ancestry].filter(Boolean).map(item => item.name)
            : null,
          subtitle: isCharacter ? null : subtitle,
          weapons,
          hope: isCharacter ? { ...track(shown("hope"), system.resources.hope.max), scars: Array.fromRange(system.scars ?? 0) } : null,
          rings,
          defense,
          thresholds,
          // The Massive Damage variant rule: at or above twice Severe marks 4 HP.
          massive: massive && thresholds ? thresholds.severe * 2 : null,
          traits
        });
      }
      return groups.filter(group => group.members.length);
    }

    /* -------------------------------------------- */
    /*  Actions                                     */
    /* -------------------------------------------- */

    /**
     * Step a member's vital by one from its ring card: left click adds, right click removes. The
     * template leaves the action off the cards of members this user doesn't own; the check here
     * covers a card rendered before ownership changed.
     * @this {NicePartySheet}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onStepResource(event, target) {
      const uuid = target.closest("[data-member-uuid]")?.dataset.memberUuid;
      const actor = this.document.system.partyMembers.find(member => member.uuid === uuid);
      if (!actor?.isOwner) return;
      this.#vitals.step(event, target, actor);
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    /**
     * A system partial the templates use can go missing in a system update, and then the sheet
     * cannot open at all. The system's party sheet opens in its place, so play goes on and the
     * sheet can be switched from there.
     * @inheritdoc
     */
    async _renderHTML(context, options) {
      try {
        return await super._renderHTML(context, options);
      } catch (error) {
        reportSheetFailure(error);
        if (options.isFirstRender) new SystemPartySheet({ document: this.document }).render({ force: true });
        throw error;
      }
    }

    /** @inheritdoc */
    async _onRender(context, options) {
      await super._onRender(context, options);
      if (this.#settled) this.element.classList.add("nice-settled");
      this.#settled = true;
      syncLoopingAnimations(this.element);
      for (const root of this.element.querySelectorAll("[data-member-uuid]")) {
        const actor = this.document.system.partyMembers.find(member => member.uuid === root.dataset.memberUuid);
        if (actor) this.#vitals.sync(actor, root);
      }
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
