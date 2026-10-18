/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, RESOURCE_ICONS, SETTINGS, STORABLE_TYPES, TEMPLATE_PATH } from "./constants.js";
import { ContainerSheetMixin } from "./containers.js";
import {
  collapsedGroupsOf, describeTraits, reportSheetFailure, ringCard, syncLoopingAnimations, toggleGroup, track,
  traitAttributes
} from "./helpers.js";
import { RING_FLASHES, VitalCards } from "./vital-cards.js";

/*
 * What this sheet relies on from the Daggerheart system, checked against 2.10.13 (same role as the
 * list at the top of character-sheet.js):
 * - Class path `game.system.api.applications.sheets.actors.Party`.
 * - PARTS ids: the system prepares context by id (`_preparePartContext`: header, partyMembers,
 *   notes), and `Actor#_onUpdate` re-renders `{ parts: ["partyMembers"] }` on every party when a
 *   member changes.
 * - Context keys: tabs, partyMembers (weapons, subtitle), showStats, tagTeamActive,
 *   groupRollActive, notes, inventory, source.
 * - Actions: tagTeamRoll, groupRoll, triggerRest (data-type), openDocument (data-uuid),
 *   deletePartyMember (closest [data-uuid]), toggleHope (data-actor-id, data-value), editImage,
 *   tempBrowser, addNewItem.
 * - The inventory: coins drag from `.currency[data-currency] .drag-handle` (the base actor sheet's
 *   `dragDrop` and `_onDragStart`); `_onSearchFilterInventory` and `_onMenuFilterInventory` hide
 *   every `.inventory-item` the search hasn't matched, so a hidden `input.search-inventory` stays.
 * - The contextmenu listener `_attachPartListeners` puts on `img.profile` (shows the artwork).
 * - Settings and schema: `variantRules.massiveDamage`, the party's `DEFAULT_ICON` and `active`;
 *   `system.updateArmorValue({ value })` on members.
 */

/**
 * What flashes when a member's vital changes: its ring card, and for Hope the gem row. The party's
 * art is not a member's, so a Hope gain lights no backdrop here.
 */
const MEMBER_FLASHES = Object.freeze({
  ...RING_FLASHES,
  hope: { card: ".nice-hope", up: "flash-gain", down: "flash-spend" }
});

/** Member types in the order their groups are listed; characters come first and untitled. */
const MEMBER_GROUPS = ["character", "companion", "adversary", "npc"];

/**
 * Build the party sheet class. Like the character sheet, it extends the system's own PartySheet,
 * so the Tag Team and Group Roll dialogs, the rest trigger, actor drops, the inventory filters and
 * item transfers stay the system's; the templates, their context and the CSS scope are ours. A
 * sheet written from scratch on ActorSheetV2 would have to re-implement all of those.
 *
 * @returns {typeof foundry.applications.sheets.ActorSheetV2}
 */
export function defineNicePartySheet() {
  const SystemPartySheet = game.system.api.applications.sheets.actors.Party;

  return class NicePartySheet extends ContainerSheetMixin(SystemPartySheet) {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
      // Pinned dark like the character sheet; the second class scopes what only this window needs.
      classes: [MODULE_ID, `${MODULE_ID}-party`, "themed", "theme-dark"],
      // The system's party sheet is resizable and 600×900; this one keeps a smaller designed size,
      // smaller than the character's 900×720 too, so the party takes less room on screen.
      window: { resizable: false },
      position: { width: 760, height: 640 },
      actions: {
        // A right click reaches actions as an `auxclick` with button 2 only when it is listed.
        niceStepResource: { handler: NicePartySheet.#onStepResource, buttons: [0, 2] },
        niceToggleGroup: toggleGroup,
        nicePartyAction: NicePartySheet.#onPartyAction
      },
      // Concatenated onto the system's menus (effects, actions, features), not replacing them. The
      // system's party rows carry no menu of their own; this one hosts the container entries the
      // mixin appends.
      contextMenus: [{
        handler: NicePartySheet.#getItemContextOptions,
        selector: STORABLE_TYPES.map(type => `[data-item-uuid][data-type="${type}"]`).join(", "),
        options: { parentClassHooks: false, fixed: true }
      }]
    };

    /** What templates/party-inventory.hbs passes per section: everything stacks, gear hides its resources. */
    static CONTAINER_ROWS = {
      weapon: { isQuantifiable: true, hideResources: true },
      armor: { isQuantifiable: true, hideResources: true },
      consumable: { isQuantifiable: true },
      loot: { isQuantifiable: true }
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
      inventory: {
        id: "inventory",
        scrollable: [".items-section"],
        template: `${TEMPLATE_PATH}/party-inventory.hbs`,
        templates: [`${TEMPLATE_PATH}/group-toggle.hbs`, `${TEMPLATE_PATH}/container.hbs`]
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

    /** The `onClick` of each header coin other modules added, by action id; rebuilt per header render. */
    #partyActions = new Map();

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
    _configureRenderParts(options) {
      const parts = super._configureRenderParts(options);
      if (game.settings.get(MODULE_ID, SETTINGS.showPartyNotes)) return parts;
      delete parts.notes;
      // Turning the setting off while Notes is open would leave no tab active.
      if (this.tabGroups.primary === "notes") this.tabGroups.primary = "partyMembers";
      return parts;
    }

    /** @inheritdoc */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      if (!game.settings.get(MODULE_ID, SETTINGS.showPartyNotes)) delete context.tabs?.notes;
      // What the sheet adds reads system internals (see the list at the top of this file). When an
      // update breaks one, the sheet still opens with what the system provides, and the user is told.
      try {
        const party = this.document;
        const count = party.system.partyMembers.length;
        const plural = new Intl.PluralRules(game.i18n.lang).select(count);
        const membersKey = `DH_NICE_SHEETS.Party.members.${game.i18n.has(`DH_NICE_SHEETS.Party.members.${plural}`) ? plural : "other"}`;
        const collapsedGroups = collapsedGroupsOf(party);
        context.nice = {
          // The party's art is a faint backdrop; the system's default icon is skipped.
          backdrop: party.img !== party.system.constructor.DEFAULT_ICON ? party.img : null,
          memberCount: game.i18n.format(membersKey, { count }),
          count,
          active: party.system.active,
          collapsedGroups,
          inventory: this.containerInventory(context.inventory, collapsedGroups),
          // Keyed: the system's drag reads the currency key off the chip.
          currencies: Object.entries(context.inventory?.currencies ?? {})
            .filter(([, currency]) => currency.enabled)
            .map(([key, currency]) => ({ key, ...currency }))
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
      try {
        if (partId === "header") context.nice.partyActions = this.#preparePartyActions(context);
        else if (partId === "partyMembers" && context.nice.count) context.nice.groups = this.#prepareGroups(context);
      } catch (error) {
        reportSheetFailure(error);
      }
      return context;
    }

    /**
     * The header's action coins. Other modules add, remove or reorder them through the
     * `dh-nice-sheets.partyActions` hook instead of editing the rendered markup, so the coin's
     * markup and classes stay ours to change. Runs after the system's header context, which sets
     * tagTeamActive and groupRollActive.
     * @param {object} context  The header part's render context.
     */
    #preparePartyActions(context) {
      const actions = [
        { id: "tagTeamRoll", label: "DH_NICE_SHEETS.TagTeam.label", tooltip: "DAGGERHEART.APPLICATIONS.TagTeamSelect.title",
          icon: "fa-solid fa-user-group", active: context.tagTeamActive, action: "tagTeamRoll" },
        { id: "groupRoll", label: "DAGGERHEART.APPLICATIONS.GroupRollSelect.title", tooltip: "DAGGERHEART.APPLICATIONS.GroupRollSelect.title",
          icon: "fa-solid fa-users", active: context.groupRollActive, action: "groupRoll" },
        // The rests ask every member for their downtime moves, so they are the GM's only. The
        // system's triggerRest reads which rest from data-type.
        { id: "shortRest", label: "DAGGERHEART.APPLICATIONS.Downtime.shortRest.title", icon: "fa-solid fa-campground",
          gmOnly: true, action: "triggerRest", type: "shortRest" },
        { id: "longRest", label: "DAGGERHEART.APPLICATIONS.Downtime.longRest.title", icon: "fa-solid fa-moon",
          gmOnly: true, action: "triggerRest", type: "longRest" }
      ];
      // callAll reports a throwing listener through Hooks.onError and goes on with the next one.
      Hooks.callAll(`${MODULE_ID}.partyActions`, this, actions);

      // The entries now come from other modules: an entry without an id or a handler, or reusing
      // an id, is dropped rather than drawn as a coin that does nothing.
      this.#partyActions = new Map();
      const seen = new Set();
      const entries = [];
      for (const entry of actions) {
        if (!entry?.id || seen.has(entry.id)) continue;
        if (!entry.action && typeof entry.onClick !== "function") continue;
        if (entry.gmOnly && !game.user.isGM) continue;
        seen.add(entry.id);
        if (!entry.action) this.#partyActions.set(entry.id, entry.onClick);
        // The GM's coins sit after a divider, when anything comes before them.
        const divider = Boolean(entry.gmOnly) && entries.length > 0 && !entries.at(-1).gmOnly;
        entries.push({ ...entry, dataAction: entry.action ?? "nicePartyAction", divider });
      }
      return entries;
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
        if (isCharacter) traits = describeTraits(traitAttributes(actor));

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
     * Edit and Delete, the two controls the system's party rows show as buttons.
     * @this {NicePartySheet}
     * @returns {import("@client/applications/ux/context-menu.mjs").ContextMenuEntry[]}
     */
    static #getItemContextOptions() {
      return [
        {
          label: "CONTROLS.CommonEdit",
          icon: "fa-solid fa-pen-to-square",
          onClick: (_, target) => this.itemFromTarget(target)?.sheet.render({ force: true })
        },
        {
          label: "CONTROLS.CommonDelete",
          icon: "fa-solid fa-trash",
          visible: () => this.isEditable,
          onClick: (_, target) => this.itemFromTarget(target)?.deleteDialog()
        }
      ];
    }

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

    /**
     * A header coin another module added through the `dh-nice-sheets.partyActions` hook.
     * @this {NicePartySheet}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onPartyAction(event, target) {
      this.#partyActions.get(target.dataset.actionId)?.(event, this);
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
