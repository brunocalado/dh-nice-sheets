/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { FLAGS, MODULE_ID, RESOURCE_ICONS, SETTINGS, STORABLE_TYPES, TEMPLATE_PATH } from "./constants.js";
import { releaseContents, unsetFlagData } from "./helpers.js";
import { defineNiceLevelUp } from "./levelup.js";

/*
 * What this sheet relies on from the Daggerheart system beyond its document data, checked against
 * 2.10.13. None of it is documented API, so when a system update breaks the sheet, start here:
 * - Class paths: `game.system.api.applications.sheets.actors.Character` and
 *   `.sheetConfigs.CharacterSettings`.
 * - The `settingSheet` getter of the system's actor sheet, overridden to swap in our settings window.
 * - The private `levelManagement` handler, reached through `this.options.actions` (#onLevelUp), and
 *   the `viewLevelups` action name of the window control we take over. The level-up windows list
 *   their own dependencies in levelup.js.
 * - PARTS ids: the system prepares each part's context by its id, so ours keep the system's names.
 * - Keys of the system's render context: tabs, attributes, equippedItems, inventory,
 *   featureGroups, background, connections, isDeath.
 * - Settings and schema: `variantRules.massiveDamage`, `LevelTiers` tiers' `levels.end`, and the
 *   party schema's `tagTeam.initiator.cost`.
 * - The filters: inventory search on `input.search-inventory` inside
 *   `[data-application-part="inventory"] .items-section`; the loadout filters, whose hiding is
 *   undone (_attachPartListeners).
 * - Markup of the system's item partials: `.inventory-item[data-item-id]`, `.controls >
 *   [data-action="triggerContextMenu"]`, `.item-name`, `.img-portait` (the system's spelling);
 *   and `.character-details`, the heritage context menu's selector.
 * - Action names in the templates, among them `toggleArmorMangement` (the system's spelling).
 * - `system.updateArmorValue({ value })`, which spreads a signed armor change over the armor
 *   sources (#onStepResource).
 * - What `_onDropItem` and `Actor#transferItem` return and create on drops from another actor.
 */

/** Whether this session has already told the user that the sheet failed. */
let failureReported = false;

/**
 * Log an error in the sheet's own additions and, once per session, tell the user how to keep
 * playing. Most such errors mean a Daggerheart update changed something listed above; the
 * system's sheet keeps working then, so the user is pointed to it.
 * @param {Error} error
 */
function reportSheetFailure(error) {
  console.error(`${MODULE_ID} | The sheet failed with Daggerheart ${game.system.version}.`, error);
  if (failureReported) return;
  failureReported = true;
  ui.notifications.error(game.i18n.format("DH_NICE_SHEETS.Failure", { version: game.system.version }), { permanent: true });
}

/** Trait order used by the printed Daggerheart sheet; the system stores them as an object. */
const TRAIT_ORDER = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

/** Trait plaque materials for the values between the lowest and the highest, lowest first. */
const MIDDLE_MATERIALS = ["slate", "bronze", "brass"];

/** Width of a collapsed sheet, which shows the sidebar alone. */
const COLLAPSED_WIDTH = 270;

/** Height the sidebar's item list keeps; with less room left the whole sidebar scrolls instead. */
const SIDEBAR_LIST_MIN_HEIGHT = 200;

/** How long after a drop an item the GM transfers is still caught, in ms (see #awaitTransfer). */
const TRANSFER_WAIT = 10000;

/**
 * Describe the traits in sheet order and pick each plaque's material by the rank of its value
 * among this character's distinct values: the lowest is cracked iron, the highest gold, and
 * the ones between spread over slate, bronze and brass. Different values get different
 * materials and equal values always match, at level 1 (+2 to −1) as at level 10.
 * @param {Record<string, object>} attributes  Trait data keyed like the system's `context.attributes`.
 */
function describeTraits(attributes) {
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
function syncLoopingAnimations(element) {
  for (const animation of element.getAnimations({ subtree: true })) {
    if (animation instanceof CSSAnimation && animation.effect.getTiming().iterations === Infinity) {
      animation.startTime = 0;
    }
  }
}

/**
 * Build the sheet class. It extends the system's own CharacterSheet so that every action, context
 * menu, drag-and-drop handler, filter and roll keeps working untouched; only the templates, the
 * context additions used by those templates, and the CSS scope are ours. Because render hooks fire
 * for every class in the inheritance chain, modules that listen to `renderCharacterSheet` keep
 * receiving this sheet too.
 *
 * @returns {typeof foundry.applications.sheets.ActorSheetV2}
 */
export function defineNiceCharacterSheet() {
  const SystemCharacterSheet = game.system.api.applications.sheets.actors.Character;
  const { NiceLevelUp, NiceLevelUpView } = defineNiceLevelUp();

  /**
   * The system's settings window (wrench button) dressed as the sheet. It carries the module class,
   * so the sheet's tokens, panels, trait plaques and tabs apply here too, plus its own class for
   * what only this window needs. Every part is ours, but the inputs keep the system's field names,
   * so its submit-on-change form and its experience actions work unchanged.
   */
  class NiceCharacterSettings extends game.system.api.applications.sheetConfigs.CharacterSettings {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
      // Pinned dark like the sheet; see NiceCharacterSheet.DEFAULT_OPTIONS.
      classes: [MODULE_ID, `${MODULE_ID}-settings`, "themed", "theme-dark"],
      // A little wider than the system's 455px, so six plaques fit their trait names.
      position: { width: 540 }
    };

    /** @inheritdoc */
    static PARTS = {
      header: {
        id: "header",
        template: `${TEMPLATE_PATH}/settings-header.hbs`
      },
      tabs: {
        template: `${TEMPLATE_PATH}/settings-tabs.hbs`
      },
      details: {
        id: "details",
        template: `${TEMPLATE_PATH}/settings-details.hbs`,
        templates: [`${TEMPLATE_PATH}/trait-fx.hbs`]
      },
      experiences: {
        id: "experiences",
        template: `${TEMPLATE_PATH}/settings-experiences.hbs`,
        scrollable: [".nice-scroll"]
      }
    };

    /** Whether a full render has completed; see NiceCharacterSheet#settled. */
    #settled = false;

    /** @inheritdoc */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      // Without the plaques the window still opens, with the system's own fields below them.
      try {
        // The plaques edit the base values, so they are ranked on those rather than on the
        // prepared ones that include bonuses.
        const spellcastKey = this.document.system.spellcastModifierTrait?.key;
        const attributes = Object.fromEntries(
          Object.entries(this.document._source.system.traits).map(([key, trait]) => [key, {
            ...trait,
            label: game.i18n.localize(CONFIG.DH.ACTOR.abilities[key].label),
            isSpellcasting: key === spellcastKey
          }])
        );
        context.nice = { traits: describeTraits(attributes) };
      } catch (error) {
        reportSheetFailure(error);
        context.nice = {};
      }
      return context;
    }

    /** @inheritdoc */
    async _renderHTML(context, options) {
      try {
        return await super._renderHTML(context, options);
      } catch (error) {
        reportSheetFailure(error);
        throw error;
      }
    }

    /** @inheritdoc */
    async _onRender(context, options) {
      await super._onRender(context, options);
      if (this.#settled) this.element.classList.add("nice-settled");
      this.#settled = true;
      syncLoopingAnimations(this.element);
    }

    /** @inheritdoc */
    _onClose(options) {
      super._onClose(options);
      this.#settled = false;
    }
  }

  return class NiceCharacterSheet extends SystemCharacterSheet {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
      // The sheet is designed dark only. DocumentSheetV2 adds `themed theme-<x>` from the sheet
      // config only when `themed` is not already there, so declaring it here pins the window dark
      // and lets core and system partials inside it resolve their dark variables too.
      classes: [MODULE_ID, "themed", "theme-dark"],
      // The system's character sheet is resizable; this one keeps its designed size (the collapse
      // toggle aside), so the core resize handle is not even added to the frame.
      window: { resizable: false },
      position: { width: 900, height: 720 },
      actions: {
        niceLevelUp: NiceCharacterSheet.#onLevelUp,
        viewLevelups: NiceCharacterSheet.#onViewLevelUps,
        niceToggleFavorite: NiceCharacterSheet.#onToggleFavorite,
        niceToggleCollapse: NiceCharacterSheet.#onToggleCollapse,
        niceToggleGroup: NiceCharacterSheet.#onToggleGroup,
        niceToggleResource: NiceCharacterSheet.#onToggleResource,
        // A right click reaches actions as an `auxclick` with button 2 only when it is listed.
        niceStepResource: { handler: NiceCharacterSheet.#onStepResource, buttons: [0, 2] },
        niceTagTeam: NiceCharacterSheet.#onTagTeam
      }
    };

    /** @inheritdoc */
    static PARTS = {
      limited: {
        id: "limited",
        scrollable: [".nice-limited"],
        template: `${TEMPLATE_PATH}/limited.hbs`
      },
      sidebar: {
        id: "sidebar",
        scrollable: ["", ".shortcut-items-section"],
        template: `${TEMPLATE_PATH}/sidebar.hbs`
      },
      header: {
        id: "header",
        template: `${TEMPLATE_PATH}/header.hbs`,
        templates: [`${TEMPLATE_PATH}/trait-fx.hbs`]
      },
      features: {
        id: "features",
        scrollable: [".nice-scroll"],
        template: `${TEMPLATE_PATH}/features.hbs`,
        templates: [`${TEMPLATE_PATH}/group-toggle.hbs`]
      },
      loadout: {
        id: "loadout",
        scrollable: [".items-section"],
        template: `${TEMPLATE_PATH}/loadout.hbs`
      },
      inventory: {
        id: "inventory",
        scrollable: [".items-section"],
        template: `${TEMPLATE_PATH}/inventory.hbs`,
        templates: [`${TEMPLATE_PATH}/group-toggle.hbs`, `${TEMPLATE_PATH}/container.hbs`]
      },
      biography: {
        id: "biography",
        scrollable: [".items-section"],
        template: `${TEMPLATE_PATH}/biography.hbs`
      },
      effects: {
        id: "effects",
        scrollable: [".nice-scroll"],
        template: `${TEMPLATE_PATH}/effects.hbs`
      }
    };

    /**
     * Resource values seen on the previous render, used to play a one-shot flash on the track that
     * changed (damage, healing, hope gained or spent).
     * @type {{hitPoints?: number, stress?: number, hope?: number, armor?: number}}
     */
    #lastVitals = {};

    /**
     * Whether a full render has already completed. Entrance animations (shield rise, name shimmer)
     * are gated on this through the `nice-settled` class, so they play once per window and not on
     * every re-render caused by a pip click.
     * @type {boolean}
     */
    #settled = false;

    /** @type {NiceCharacterSettings} */
    #settingSheet;

    /**
     * Ids of the items the sidebar lists on its own, from the last context preparation.
     * @type {Set<string>}
     */
    #inSidebar = new Set();

    /**
     * Width the window had before it was collapsed, restored on expand. Unset when the sheet was
     * opened already collapsed; the default width is used then.
     * @type {number|undefined}
     */
    #expandedWidth;

    /**
     * Watches the sidebar's height to switch it between scrolling its item list alone and
     * scrolling as a whole (see `#fitSidebar`).
     * @type {ResizeObserver}
     */
    #sidebarObserver = new ResizeObserver(([entry]) => NiceCharacterSheet.#fitSidebar(entry.target));

    /**
     * The system resolves this from the actor type's metadata and caches it in its own private
     * field, so overriding the getter is the only way to swap in our settings window.
     * @override
     */
    get settingSheet() {
      return (this.#settingSheet ??= new NiceCharacterSettings({ document: this.document }));
    }

    /**
     * Save the Notes text while it is typed, a moment after the last key. The update skips the
     * re-render so the caret stays where it is; leaving the field submits the form as usual.
     * @type {(value: string) => void}
     */
    #saveNotes = foundry.utils.debounce(value => {
      this.document.update({ [`flags.${MODULE_ID}.${FLAGS.notes}`]: value }, { render: false });
    }, 800);

    /** @inheritdoc */
    _initializeApplicationOptions(options) {
      const applicationOptions = super._initializeApplicationOptions(options);
      // The system scopes its character layout under the `character` class. Dropping it gives this
      // sheet a clean layout slate while `daggerheart sheet dh-style actor` keep styling the shared
      // partials (inventory rows, fieldsets, inputs, tooltips) exactly as the system does.
      applicationOptions.classes = applicationOptions.classes.filter(c => c !== "character");
      // A sheet saved as collapsed opens at the collapsed width; `_renderFrame` adds the class.
      if (NiceCharacterSheet.#isSavedCollapsed(applicationOptions.document)) {
        applicationOptions.position.width = COLLAPSED_WIDTH;
      }
      return applicationOptions;
    }

    /**
     * Whether this browser saved the actor's sheet as collapsed.
     * @param {foundry.documents.Actor} actor
     */
    static #isSavedCollapsed(actor) {
      return game.settings.get(MODULE_ID, SETTINGS.collapsedSheets).includes(actor.uuid);
    }

    /**
     * Apply the saved collapsed state and add the collapse toggle to the window header. The frame
     * is rebuilt each time a closed sheet reopens, while the instance and its options are reused,
     * so the state is read here rather than when the options are initialized.
     * @inheritdoc
     */
    async _renderFrame(options) {
      const frame = await super._renderFrame(options);
      frame.classList.toggle("nice-collapsed", NiceCharacterSheet.#isSavedCollapsed(this.document));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "header-control icon fa-solid nice-collapse-toggle";
      button.dataset.action = "niceToggleCollapse";
      this.window.header.prepend(button);
      NiceCharacterSheet.#syncCollapseToggle(button, frame.classList.contains("nice-collapsed"));
      return frame;
    }

    /* -------------------------------------------- */
    /*  Context                                     */
    /* -------------------------------------------- */

    /** @inheritdoc */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      // The system's Biography tab opens with the Notes; its own fields sit below, if shown at all.
      context.tabs.biography = { ...context.tabs.biography, label: "DH_NICE_SHEETS.Notes.tab" };
      // What the sheet adds reads system internals (see the list at the top of this file). When an
      // update breaks one, the sheet still opens with what the system provides, and the user is told.
      try {
        context.nice = this.#prepareNiceContext(context);
      } catch (error) {
        reportSheetFailure(error);
        context.nice = {};
      }
      return context;
    }

    /**
     * The sheet's own additions to the render context, read by the templates as `nice`.
     * @param {object} context  The system's render context.
     */
    #prepareNiceContext(context) {
      const system = this.document.system;
      const { hitPoints, stress, hope } = system.resources;
      const armor = system.armorScore;

      // Items the sidebar already lists on its own. A favorite among them stays out of the
      // Favorites section, and their rows get no star, so nothing shows up twice.
      const inSidebar = new Set([
        ...context.equippedItems.map(item => item.id),
        ...system.domainCards.loadout.map(card => card.id)
      ]);
      this.#inSidebar = inSidebar;

      // Features and Inventory groups this browser saved as collapsed, keyed by group type.
      const groupPrefix = `${this.document.uuid}.`;
      const collapsedGroups = Object.fromEntries(
        game.settings.get(MODULE_ID, SETTINGS.collapsedGroups)
          .filter(key => key.startsWith(groupPrefix))
          .map(key => [key.slice(groupPrefix.length), true])
      );

      return {
        collapsedGroups,
        inventory: NiceCharacterSheet.#sortIntoContainers(context.inventory, collapsedGroups, this.isEditable),
        notes: {
          name: `flags.${MODULE_ID}.${FLAGS.notes}`,
          value: this.document.getFlag(MODULE_ID, FLAGS.notes) ?? ""
        },
        showBiography: game.settings.get(MODULE_ID, SETTINGS.showBiography),
        traits: describeTraits(context.attributes),
        hitPoints: NiceCharacterSheet.#ringCard(hitPoints.value, hitPoints.max, RESOURCE_ICONS.hitPoints),
        stress: NiceCharacterSheet.#ringCard(stress.value, stress.max, RESOURCE_ICONS.stress),
        armor: NiceCharacterSheet.#ringCard(armor.value, armor.max, RESOURCE_ICONS.armor),
        // Homebrew resources (game settings) and feature-granted ones; the system only shows them
        // in a locked tooltip off the Hope row, here they sit as tracks under the vitals.
        extraResources: Object.entries(system.availableExtraResources).map(([key, resource]) => {
          const { value, max } = system.resources[key] ?? {};
          return {
            key,
            label: game.i18n.localize(resource.label),
            fullIcon: resource.images?.full ?? { value: "fa-solid fa-circle", isIcon: true, opacity: 1 },
            emptyIcon: resource.images?.empty ?? { value: "fa-regular fa-circle", isIcon: true, opacity: 1 },
            ...NiceCharacterSheet.#track(value, max)
          };
        }),
        // The header's Hope row reads `pips`, which the ring card passes through from its track.
        hope: NiceCharacterSheet.#ringCard(hope.value, hope.max, RESOURCE_ICONS.hope, system.scars ?? 0),
        tagTeam: NiceCharacterSheet.#tagTeam(hope.value),
        scars: Array.fromRange(system.scars ?? 0),
        thresholds: system.damageThresholds,
        // The Massive Damage variant rule: at or above twice Severe marks 4 HP (see the system's
        // Actor#convertDamageToThreshold). Shown only while the rule is on.
        massiveDamage: game.settings.get(CONFIG.DH.id, CONFIG.DH.SETTINGS.gameSettings.variantRules)
          .massiveDamage.enabled ? system.damageThresholds.severe * 2 : null,
        domains: system.domainData,
        level: system.levelData.level.changed,
        canLevelUp: system.levelData.canLevelUp,
        // At the last level the badge stops offering a level up, unless one is still pending.
        canRaiseLevel: system.levelData.canLevelUp || system.levelData.level.current < NiceCharacterSheet.#maxLevel,
        needsSetup: system.needsCharacterSetup,
        loadoutSlot: system.loadoutSlot,
        hasParties: this.document.parties.size > 0,
        // The art is a faint backdrop behind the whole sheet; the placeholder silhouette is skipped.
        backdrop: this.document.img !== CONST.DEFAULT_TOKEN ? this.document.img : null,
        currencies: Object.values(context.inventory?.currencies ?? {}).filter(c => c.enabled),
        favorites: this.document.items
          .filter(item => item.getFlag(MODULE_ID, FLAGS.favorite) && !inSidebar.has(item.id))
          .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      };
    }

    /**
     * Split the system's inventory lists into containers and loose items. A container is a loot
     * item with the container flag; it leaves the Loot list for a panel of its own, listing what
     * it holds by type. An item stays loose when its container is gone or when it is equipped:
     * equipping takes it out (see main.js), so this only covers data that predates that.
     * @param {object} [inventory]                      The system's `context.inventory`.
     * @param {Record<string, boolean>} collapsedGroups  Groups this browser shows collapsed.
     * @param {boolean} editable
     */
    static #sortIntoContainers(inventory, collapsedGroups, editable) {
      if (!inventory) return null;
      const { weapons, armor, consumables, loot } = inventory;
      const contents = new Map(loot.filter(item => item.getFlag(MODULE_ID, FLAGS.container)).map(item => [item, []]));
      const byId = new Map([...contents].map(([container, held]) => [container.id, held]));

      // The lists come in STORABLE_TYPES order and sorted, so each container's list ends up
      // grouped by type with the sheet's own order inside each type.
      const loose = Object.fromEntries(Object.entries({ weapons, armor, consumables, loot }).map(([key, items]) => [
        key,
        items.filter(item => {
          if (contents.has(item)) return false;
          const held = item.system.equipped ? null : byId.get(item.getFlag(MODULE_ID, FLAGS.storedIn));
          held?.push(item);
          return !held;
        })
      ]));

      const containers = [...contents].map(([item, held]) => ({
        item,
        groupType: `container-${item.id}`,
        collapsed: !!collapsedGroups[`container-${item.id}`],
        // The row parameters the type's own section passes to the system partial.
        contents: held.map(heldItem => ({
          item: heldItem,
          isQuantifiable: heldItem.type === "consumable" || heldItem.type === "loot",
          showActions: heldItem.type === "loot" ? editable : undefined
        }))
      }));
      return { ...loose, containers };
    }

    /**
     * Set an extra resource from its track, the way the system's resource tooltip does: clicking a
     * filled pip empties it and everything after it, clicking an empty one fills up to it.
     * @this {NiceCharacterSheet}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onToggleResource(event, target) {
      const { resource: key, value: index } = target.dataset;
      const current = this.document.system.resources[key]?.value ?? 0;
      const clicked = Number(index);
      await this.document.update({ [`system.resources.${key}.value`]: clicked <= current ? clicked - 1 : clicked });
    }

    /**
     * Step a vital by one from its ring card: left click adds, right click removes. Armor goes
     * through the system, so the change is spread over the armor sources the way its own sheet does.
     * @this {NiceCharacterSheet}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onStepResource(event, target) {
      if (!this.isEditable) return;
      const delta = event.button === 2 ? -1 : 1;
      const key = target.dataset.resource;
      if (key === "armor") return this.document.system.updateArmorValue({ value: delta });
      const { value, max } = this.document.system.resources[key];
      const next = Math.clamp(value + delta, 0, max);
      if (next !== value) await this.document.update({ [`system.resources.${key}.value`]: next });
    }

    /**
     * Highest level a character can reach: the end of the last tier in the system's Level Tiers
     * setting, the same cap the system's `Actor#updateLevel` applies.
     * @type {number}
     */
    static get #maxLevel() {
      const { tiers } = game.settings.get(CONFIG.DH.id, CONFIG.DH.SETTINGS.gameSettings.LevelTiers);
      return Math.max(...Object.values(tiers).map(tier => tier.levels.end));
    }

    /**
     * Hope a Tag Team costs: the default the system's own Tag Team dialog charges the initiator.
     * @type {number}
     */
    static get #tagTeamCost() {
      return CONFIG.Actor.dataModels.party.schema.getField("tagTeam.initiator.cost").initial;
    }

    /**
     * Describe the Tag Team indicator: lit while the character has the Hope to start one.
     * @param {number} hope
     */
    static #tagTeam(hope) {
      const cost = NiceCharacterSheet.#tagTeamCost;
      const ready = hope >= cost;
      return {
        ready,
        tooltip: game.i18n.format(`DH_NICE_SHEETS.TagTeam.${ready ? "ready" : "noHope"}`, { cost })
      };
    }

    /**
     * Announce in chat that the character wants a Tag Team. Nothing is spent or tracked; the table
     * runs the Tag Team itself. The card follows Daggerheart: Quick Actions' chat card look.
     * @this {NiceCharacterSheet}
     * @type {ApplicationClickAction}
     */
    static async #onTagTeam() {
      const actor = this.document;
      const cost = NiceCharacterSheet.#tagTeamCost;
      if ((actor.system.resources.hope.value ?? 0) < cost) return;
      const gold = "#C9A060";
      const name = foundry.utils.escapeHTML(actor.name);
      const content = `
        <div class="chat-card" style="border: 2px solid ${gold}; border-radius: 8px; overflow: hidden;">
          <header class="card-header flexrow" style="background: #191919 !important; padding: 8px; border-bottom: 2px solid ${gold};">
            <h3 class="noborder" style="margin: 0; font-weight: bold; color: ${gold} !important; font-family: 'Aleo', serif; text-align: center; text-transform: uppercase; letter-spacing: 1px; width: 100%;">${game.i18n.localize("DH_NICE_SHEETS.TagTeam.label")}</h3>
          </header>
          <div class="card-content" style="background: #141414; padding: 20px; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center;">
            <i class="fa-solid fa-people-arrows" style="color: ${gold}; font-size: 2em;"></i>
            <div style="color: #ffffff; font-size: 1.2em; font-family: 'Aleo', serif; text-shadow: 1px 1px 2px #000;">${game.i18n.format("DH_NICE_SHEETS.TagTeam.chat", { name })}</div>
            <div style="color: #777; font-size: 0.85em;">${game.i18n.format("DH_NICE_SHEETS.TagTeam.cost", { cost })}</div>
          </div>
        </div>`;
      const ChatMessage = foundry.documents.ChatMessage.implementation;
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    }

    /**
     * Describe a pip track for the templates.
     * @param {number} value
     * @param {number} max
     */
    static #track(value, max) {
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
     * Describe a ring card: the track plus one arc per slot, filling clockwise from the bottom.
     * Scars, when given, take the last segments and are drawn as lost slots.
     * @param {number} value
     * @param {number} max
     * @param {string} icon     Image drawn inside the ring.
     * @param {number} [scars]
     */
    static #ringCard(value, max, icon, scars = 0) {
      const track = NiceCharacterSheet.#track(value, max);
      const total = track.max + scars;
      // Degrees left between segments; narrower past 9 so a 12-slot ring still reads as filled.
      const gap = total > 9 ? 4 : 6;
      const step = 360 / total;
      // A point on the segments' centre line (radius 41 in the 100×100 viewBox), 0° at the top.
      const point = deg => {
        const rad = (deg * Math.PI) / 180;
        return `${(50 + 41 * Math.sin(rad)).toFixed(2)} ${(50 - 41 * Math.cos(rad)).toFixed(2)}`;
      };
      const ring = Array.fromRange(total).map(i => {
        const from = 180 + i * step + gap / 2;
        const to = 180 + (i + 1) * step - gap / 2;
        const state = i >= track.max ? "scar" : i < track.value ? "filled" : "empty";
        return { state, d: `M${point(from)} A41 41 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}` };
      });
      return { ...track, ring, icon };
    }

    /* -------------------------------------------- */
    /*  Actions                                     */
    /* -------------------------------------------- */

    /**
     * The level badge is read-only; clicking it asks before leveling up. On confirmation the level
     * is raised through the actor's own `updateLevel` (what the system's level input does) and our
     * level-up manager opens. A level up that is already pending just reopens the manager. A
     * character still missing its setup, class or subclass goes to the system's `levelManagement`
     * action instead, reached via the options map because the handler is private to the system
     * class: it opens character creation or explains what is missing.
     * @this {NiceCharacterSheet}
     * @type {ApplicationClickAction}
     */
    static async #onLevelUp(event, target) {
      const { level, canLevelUp } = this.document.system.levelData;
      const next = canLevelUp ? level.changed : level.current + 1;
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "DH_NICE_SHEETS.LevelUp.title", icon: "fa-solid fa-angles-up" },
        content: `<p>${game.i18n.format(canLevelUp ? "DH_NICE_SHEETS.LevelUp.pending" : "DH_NICE_SHEETS.LevelUp.content", {
          name: foundry.utils.escapeHTML(this.document.name),
          level: next
        })}</p>`,
        yes: { default: true },
        rejectClose: false
      });
      if (!confirmed) return;
      if (!canLevelUp) await this.document.updateLevel(next);
      const { needsCharacterSetup, class: { value, subclass } } = this.document.system;
      if (!needsCharacterSetup && value && subclass) return new NiceLevelUp(this.document).render({ force: true });
      const levelManagement = this.options.actions.levelManagement;
      const handler = typeof levelManagement === "function" ? levelManagement : levelManagement?.handler;
      await handler?.call(this, event, target);
    }

    /**
     * The window control that lists the advancements taken so far, in our dress.
     * @this {NiceCharacterSheet}
     * @type {ApplicationClickAction}
     */
    static #onViewLevelUps() {
      new NiceLevelUpView(this.document).render({ force: true });
    }

    /**
     * Pin an item to the sidebar's Favorites section, or unpin it. The flag is removed rather than
     * set to false, so unpinned items carry no leftover data.
     * @this {NiceCharacterSheet}
     * @type {ApplicationClickAction}
     */
    static async #onToggleFavorite(event, target) {
      const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      if (!item) return;
      if (item.getFlag(MODULE_ID, FLAGS.favorite)) await item.unsetFlag(MODULE_ID, FLAGS.favorite);
      else await item.setFlag(MODULE_ID, FLAGS.favorite, true);
    }

    /**
     * Collapse the sheet to its sidebar, or expand it back. Only the window class and width change,
     * so nothing re-renders: the sidebar always carries the traits strip and the Hope card, and
     * the CSS shows them while collapsed. The choice is saved per actor in this browser.
     * @this {NiceCharacterSheet}
     * @type {ApplicationClickAction}
     */
    static async #onToggleCollapse(event, target) {
      const collapsed = !this.element.classList.contains("nice-collapsed");
      if (collapsed) this.#expandedWidth = this.position.width;
      // The class goes first: it lifts the window's CSS minimum width that would hold it open.
      this.element.classList.toggle("nice-collapsed", collapsed);
      NiceCharacterSheet.#syncCollapseToggle(target, collapsed);
      this.setPosition({
        width: collapsed ? COLLAPSED_WIDTH : (this.#expandedWidth ?? NiceCharacterSheet.DEFAULT_OPTIONS.position.width)
      });

      const uuids = new Set(game.settings.get(MODULE_ID, SETTINGS.collapsedSheets));
      if (collapsed) uuids.add(this.document.uuid);
      else uuids.delete(this.document.uuid);
      await game.settings.set(MODULE_ID, SETTINGS.collapsedSheets, [...uuids]);
    }

    /**
     * Collapse a Features or Inventory group to its plaque, or expand it back. Like the sheet collapse, only
     * classes change, so nothing re-renders; the next render reads the saved state again.
     * @this {NiceCharacterSheet}
     * @type {ApplicationClickAction}
     */
    static async #onToggleGroup(event, target) {
      const fieldset = target.closest("fieldset[data-group-type]");
      const collapsed = fieldset.classList.toggle("nice-group-collapsed");
      target.firstElementChild.classList.toggle("fa-chevron-down", collapsed);
      target.firstElementChild.classList.toggle("fa-chevron-up", !collapsed);
      target.dataset.tooltip = `DH_NICE_SHEETS.Group.${collapsed ? "expand" : "collapse"}`;

      const key = `${this.document.uuid}.${fieldset.dataset.groupType}`;
      const keys = new Set(game.settings.get(MODULE_ID, SETTINGS.collapsedGroups));
      if (collapsed) keys.add(key);
      else keys.delete(key);
      await game.settings.set(MODULE_ID, SETTINGS.collapsedGroups, [...keys]);
    }

    /**
     * Point the collapse toggle's arrows and tooltip at what a click will do.
     * @param {HTMLButtonElement} button
     * @param {boolean} collapsed
     */
    static #syncCollapseToggle(button, collapsed) {
      button.classList.toggle("fa-angles-right", collapsed);
      button.classList.toggle("fa-angles-left", !collapsed);
      const label = game.i18n.localize(`DH_NICE_SHEETS.Collapse.${collapsed ? "expand" : "collapse"}`);
      button.dataset.tooltip = label;
      button.setAttribute("aria-label", label);
    }

    /* -------------------------------------------- */
    /*  Containers                                  */
    /* -------------------------------------------- */

    /**
     * Every item menu of the sheet gets the container entries; each entry shows only on the rows
     * it applies to, so one wrapper covers the loot, consumable and equipment menus alike.
     * @inheritdoc
     */
    _createContextMenu(handler, selector, options) {
      return super._createContextMenu(() => [...handler(), ...this.#getContainerContextOptions()], selector, options);
    }

    /**
     * Context menu entries that turn loot into a container and back, and take an item out of
     * the container holding it.
     * @returns {import("@client/applications/ux/context-menu.mjs").ContextMenuEntry[]}
     */
    #getContainerContextOptions() {
      const itemOf = target => this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      const containerOf = item => this.document.items.get(item?.getFlag(MODULE_ID, FLAGS.storedIn));
      return [
        {
          label: "DH_NICE_SHEETS.Container.make",
          icon: "fa-solid fa-box-open",
          visible: target => {
            const item = itemOf(target);
            return this.isEditable && item?.type === "loot" && !item.getFlag(MODULE_ID, FLAGS.container);
          },
          // A loot item can be held by a container; becoming one takes it out, since containers
          // do not nest.
          onClick: (_, target) => itemOf(target)?.update(foundry.utils.mergeObject(
            unsetFlagData(FLAGS.storedIn),
            { flags: { [MODULE_ID]: { [FLAGS.container]: true } } }
          ))
        },
        {
          label: "DH_NICE_SHEETS.Container.unmake",
          icon: "fa-solid fa-box",
          visible: target => this.isEditable && !!itemOf(target)?.getFlag(MODULE_ID, FLAGS.container),
          onClick: (_, target) => {
            const container = itemOf(target);
            if (!container) return;
            return this.document.updateEmbeddedDocuments("Item", [
              { _id: container.id, ...unsetFlagData(FLAGS.container) },
              ...releaseContents(container)
            ]);
          }
        },
        {
          label: "DH_NICE_SHEETS.Container.takeOut",
          icon: "fa-solid fa-arrow-up-from-bracket",
          visible: target => this.isEditable && !!containerOf(itemOf(target))?.getFlag(MODULE_ID, FLAGS.container),
          onClick: (_, target) => itemOf(target)?.unsetFlag(MODULE_ID, FLAGS.storedIn)
        }
      ];
    }

    /**
     * Dropping an item on a container panel stores it there; dropping a stored item anywhere
     * else in the Inventory tab takes it out. Items from elsewhere (another actor, the sidebar,
     * a compendium) are created as usual and then stored. Every other drop is the system's.
     * @inheritdoc
     */
    async _onDropItem(event, item) {
      const panel = event.target.closest("[data-container-id]");
      const container = this.document.items.get(panel?.dataset.containerId);
      const target = container?.getFlag(MODULE_ID, FLAGS.container) ? container : null;
      const storable = STORABLE_TYPES.includes(item.type) && !item.getFlag(MODULE_ID, FLAGS.container);

      if (item.parent !== this.document) {
        // A transfer from another actor returns the system's batch result rather than the new
        // item, may stack onto an identical item already here, and creates one item per unit of
        // an unstackable one. So what arrived is read off the inventory instead: items that are
        // new and stacks that grew. A transfer the GM performs arrives later (#awaitTransfer).
        const arrivalUpdate = (arrived, isNew) => {
          if (target && !arrived.system.equipped) {
            return { _id: arrived.id, flags: { [MODULE_ID]: { [FLAGS.storedIn]: target.id } } };
          }
          // A copy carries its flags from the source, so a container id from there is cleared.
          if (isNew && arrived.getFlag(MODULE_ID, FLAGS.storedIn)) return { _id: arrived.id, ...unsetFlagData(FLAGS.storedIn) };
          return null;
        };
        if (storable && item.actor) this.#awaitTransfer(item, arrivalUpdate);
        const quantities = new Map(this.document.items.map(owned => [owned.id, owned.system.quantity]));
        const result = await super._onDropItem(event, item);
        if (!storable) return result;
        const updates = [];
        for (const arrived of this.document.items) {
          const isNew = !quantities.has(arrived.id);
          if (!isNew && !(arrived.system.quantity > quantities.get(arrived.id))) continue;
          const update = arrivalUpdate(arrived, isNew);
          if (update) updates.push(update);
        }
        if (updates.length) await this.document.updateEmbeddedDocuments("Item", updates);
        return result;
      }

      if (!this.isEditable || !storable) return super._onDropItem(event, item);
      const storedIn = item.getFlag(MODULE_ID, FLAGS.storedIn);
      if (target) {
        if (storedIn === target.id) return super._onDropItem(event, item);
        if (item.system.equipped) {
          ui.notifications.warn("DH_NICE_SHEETS.Container.equipped", { localize: true });
          return null;
        }
        await item.setFlag(MODULE_ID, FLAGS.storedIn, target.id);
        return item;
      }
      if (storedIn && event.target.closest(".tab.inventory")) {
        await item.unsetFlag(MODULE_ID, FLAGS.storedIn);
        return item;
      }
      return super._onDropItem(event, item);
    }

    /**
     * When the player doesn't own both actors, the system has the GM's client perform the
     * transfer, and the item arrives here after `_onDropItem` has returned. For a while after the
     * drop, an item of the dropped one's name and type that the GM creates on this actor, or a
     * stack of it the GM grows, gets the treatment of an item that arrived at once. Changes this
     * client makes itself are skipped: `_onDropItem` reads those off the inventory.
     * @param {foundry.documents.Item} item  The dropped item.
     * @param {(arrived: foundry.documents.Item, isNew: boolean) => object|null} arrivalUpdate
     */
    #awaitTransfer(item, arrivalUpdate) {
      const handle = (arrived, isNew, userId) => {
        if (userId === game.user.id || arrived.parent !== this.document) return;
        if (arrived.name !== item.name || arrived.type !== item.type) return;
        const update = arrivalUpdate(arrived, isNew);
        if (update) this.document.updateEmbeddedDocuments("Item", [update]);
      };
      const created = Hooks.on("createItem", (arrived, options, userId) => handle(arrived, true, userId));
      const updated = Hooks.on("updateItem", (arrived, changes, options, userId) => {
        if (changes.system?.quantity !== undefined) handle(arrived, false, userId);
      });
      setTimeout(() => {
        Hooks.off("createItem", created);
        Hooks.off("updateItem", updated);
      }, TRANSFER_WAIT);
    }

    /**
     * Light up the container panel under a dragged item. The listeners sit on the window
     * element, which outlives every re-render, so they are added once. `dragenter` and
     * `dragleave` fire for every child crossed, so a panel only goes dark when the pointer has
     * really left it.
     * @inheritdoc
     */
    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      const panelOf = event => (this.isEditable ? event.target.closest?.(".nice-container") : null);
      this.element.addEventListener("dragenter", event => panelOf(event)?.classList.add("nice-drop-target"));
      this.element.addEventListener("dragleave", event => {
        const panel = panelOf(event);
        if (panel && !panel.contains(event.relatedTarget)) panel.classList.remove("nice-drop-target");
      });
      // A drag cancelled over a panel ends with `dragend` (on the source, when it is this sheet).
      const clear = () => {
        for (const panel of this.element.querySelectorAll(".nice-drop-target")) panel.classList.remove("nice-drop-target");
      };
      this.element.addEventListener("drop", clear);
      this.element.addEventListener("dragend", clear);
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    /**
     * Remember the Notes field while it is being typed in. Any change to the actor re-renders
     * every part, and the new field would hold the saved text, without what was typed since the
     * last save. The prior element is detached by the time `_syncPartState` runs, so `:focus` can
     * only be read here.
     * @inheritdoc
     */
    _preSyncPartState(partId, newElement, priorElement, state) {
      super._preSyncPartState(partId, newElement, priorElement, state);
      if (partId === "biography") state.niceNotes = priorElement.querySelector(".nice-notes textarea:focus");
    }

    /**
     * Carry the sidebar's scroll mode over to its re-rendered element before the scroll positions
     * are restored; the observer only sets it afterwards, too late for a whole-sidebar scroll.
     * The Notes field being typed in keeps its text, caret and scroll; the pending save still
     * holds the same text.
     * @inheritdoc
     */
    _syncPartState(partId, newElement, priorElement, state) {
      if (partId === "sidebar") newElement.classList.toggle("nice-scroll-all", priorElement.classList.contains("nice-scroll-all"));
      const typed = state.niceNotes;
      const notes = typed && newElement.querySelector(".nice-notes textarea");
      if (notes) notes.value = typed.value;
      // The core refocuses the field here, so the caret is placed after it.
      super._syncPartState(partId, newElement, priorElement, state);
      if (notes) {
        notes.setSelectionRange(typed.selectionStart, typed.selectionEnd, typed.selectionDirection);
        notes.scrollTop = typed.scrollTop;
      }
    }

    /**
     * Keep every Loadout row visible. The system's loadout search and filter menu hide each row
     * they have not matched, and this tab offers neither, so any row they hide is shown again.
     * Set up as the part is attached, before `_onRender` builds those filters. The observer goes
     * away with the part it watches.
     * @inheritdoc
     */
    _attachPartListeners(partId, htmlElement, options) {
      super._attachPartListeners(partId, htmlElement, options);
      if (partId !== "loadout") return;
      new MutationObserver(records => {
        for (const { target } of records) target.hidden = false;
      }).observe(htmlElement, { subtree: true, attributeFilter: ["hidden"] });
    }

    /**
     * A closed sheet keeps its instance, so the next opening would compare its vitals with the
     * ones seen before closing and flash whatever changed meanwhile, and would skip the entrance
     * animations. Both start over instead.
     * @inheritdoc
     */
    _onClose(options) {
      super._onClose(options);
      this.#lastVitals = {};
      this.#settled = false;
      this.#sidebarObserver.disconnect();
    }

    /**
     * A system partial the templates use can go missing in a system update, and then the sheet
     * cannot open at all, nor reach its own Configure Sheet. The system's sheet opens in its
     * place, so play goes on and the sheet can be switched from there.
     * @inheritdoc
     */
    async _renderHTML(context, options) {
      try {
        return await super._renderHTML(context, options);
      } catch (error) {
        reportSheetFailure(error);
        if (options.isFirstRender) new SystemCharacterSheet({ document: this.document }).render({ force: true });
        throw error;
      }
    }

    /** @inheritdoc */
    async _onRender(context, options) {
      await super._onRender(context, options);
      if (this.#settled) this.element.classList.add("nice-settled");
      this.#settled = true;
      syncLoopingAnimations(this.element);
      // The sidebar part is replaced on each of its renders, so the new one is observed.
      const sidebar = this.element.querySelector(".nice-sidebar");
      this.#sidebarObserver.disconnect();
      if (sidebar) this.#sidebarObserver.observe(sidebar);
      if (this.document.testUserPermission(game.user, "LIMITED", { exact: true })) return;
      this.#flashVitals(context.nice);
      if (this.isEditable) this.#addFavoriteStars();
      this.element.querySelector(".nice-notes textarea")
        ?.addEventListener("input", event => this.#saveNotes(event.target.value));
      // Long item names are cut at 30 characters; the full name is in the item tooltip. Only the
      // leading text node changes, so the system's expand icon beside it survives. Parts that were
      // not re-rendered keep their already cut names, which the flag stops from being cut again.
      for (const name of this.element.querySelectorAll(":is(.inventory-item, .inventory-item-compact) .item-name:not([data-nice-truncated])")) {
        name.dataset.niceTruncated = "";
        const text = name.firstChild;
        if (text?.nodeType !== Node.TEXT_NODE) continue;
        const full = text.data.trim();
        if (full.length > 30) text.data = `${full.slice(0, 30).trimEnd()}… `;
      }
      // Sidebar rows hide their stats line, so the item tooltip the system puts on the icon is
      // also given to the name, the larger target.
      for (const row of this.element.querySelectorAll(".nice-sidebar .inventory-item-compact")) {
        const tooltip = row.querySelector(".img-portait")?.dataset.tooltip;
        const name = row.querySelector(".item-name");
        if (tooltip && name) name.dataset.tooltip = tooltip;
      }
    }

    /**
     * The vitals sit above the item list and the list scrolls in what is left. With many resources
     * or a short window that leaves only a row or two, so below SIDEBAR_LIST_MIN_HEIGHT the whole
     * sidebar scrolls instead, with the list at full length rather than as a second scroller.
     * @param {HTMLElement} sidebar
     */
    static #fitSidebar(sidebar) {
      const list = sidebar.querySelector(".shortcut-items-section");
      if (!list) return;
      // Measured against the sidebar's content, so it holds whichever way the sidebar scrolls now.
      const listTop = list.getBoundingClientRect().top - sidebar.getBoundingClientRect().top + sidebar.scrollTop;
      sidebar.classList.toggle("nice-scroll-all", sidebar.clientHeight - listTop < SIDEBAR_LIST_MIN_HEIGHT);
    }

    /**
     * Give each item row in the tabs a favorite star beside its menu button. The rows come from
     * the system's partials, so the star is added here instead of in a
     * template. Parts that were not re-rendered keep their old star, so every pass also refreshes
     * its state. Effects, actions and attacks are not items, and rows the sidebar already lists
     * get no star.
     */
    #addFavoriteStars() {
      const rows = this.element.querySelectorAll(".tab .inventory-item[data-item-id]");
      for (const row of rows) {
        const item = ["effect", "action", "attack"].includes(row.dataset.type) ? null : this.document.items.get(row.dataset.itemId);
        const controls = row.querySelector(".controls");
        let star = controls?.querySelector(":scope > .nice-favorite");
        if (!item || !controls || this.#inSidebar.has(item.id)) {
          star?.remove();
          continue;
        }
        if (!star) {
          star = document.createElement("a");
          star.className = "nice-favorite";
          star.dataset.action = "niceToggleFavorite";
          star.innerHTML = '<i class="fa-star" inert></i>';
          const menu = controls.querySelector(':scope > [data-action="triggerContextMenu"]');
          if (menu) menu.before(star);
          else controls.append(star);
        }
        const favorite = !!item.getFlag(MODULE_ID, FLAGS.favorite);
        star.classList.toggle("active", favorite);
        star.firstElementChild.classList.toggle("fa-solid", favorite);
        star.firstElementChild.classList.toggle("fa-regular", !favorite);
        star.dataset.tooltip = `DH_NICE_SHEETS.Favorite.${favorite ? "remove" : "add"}`;
      }
    }

    /**
     * Compare the rendered vitals with the previous render and trigger the CSS flash animations:
     * a red jolt when a vital gets worse (damage, stress, an armor slot spent, Hope spent), a green
     * lift when it recovers.
     * The classes are removed on `animationend`, so a track can flash again on the next change.
     * @param {object} nice  The `nice` context block of this render.
     */
    #flashVitals(nice) {
      // No vitals when the sheet's additions failed (see _prepareContext).
      if (!nice.hitPoints) return;
      const current = {
        hitPoints: nice.hitPoints.value,
        stress: nice.stress.value,
        hope: nice.hope.value,
        armor: nice.armor.value
      };
      const previous = this.#lastVitals;
      this.#lastVitals = current;
      if (previous.hitPoints === undefined) return;

      const flash = (selector, cls) => {
        for (const element of this.element.querySelectorAll(selector)) {
          element.classList.add(cls);
          element.addEventListener("animationend", () => element.classList.remove(cls), { once: true });
        }
      };
      // The ring segments between the old and the new value are the slots that just filled or
      // emptied; they flare with the card's flash.
      const markSlots = (selector, from, to) => {
        const segments = this.element.querySelectorAll(`${selector} .seg`);
        for (let i = Math.min(from, to); i < Math.max(from, to); i++) segments[i]?.classList.add("changed");
      };
      // HP, stress and armor slots fill up as things get worse, so "more" means a loss.
      for (const [key, selector] of [["hitPoints", ".nice-ring-card.hp"], ["stress", ".nice-ring-card.stress"], ["armor", ".nice-ring-card.armor"]]) {
        if (current[key] === previous[key]) continue;
        markSlots(selector, previous[key], current[key]);
        flash(selector, current[key] > previous[key] ? "flash-worse" : "flash-better");
      }
      if (current.hope !== previous.hope) markSlots(".nice-ring-card.hope", previous.hope, current.hope);
      // Hope shows in the header and, while collapsed, as a sidebar card; both flash. A gain also
      // lights up the art and the sheet behind it.
      if (current.hope > previous.hope) flash(".nice-hope, .nice-ring-card.hope, .nice-backdrop, .nice-backdrop-hope, .nice-hope-glow", "flash-gain");
      else if (current.hope < previous.hope) flash(".nice-hope, .nice-ring-card.hope", "flash-spend");
    }
  };
}
