/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { FLAGS, MODULE_ID, STORABLE_TYPES } from "./constants.js";
import { releaseContents, unsetFlagData } from "./helpers.js";

/*
 * What containers rely on from the Daggerheart system, checked against 2.10.13:
 * - The inventory lists of the system's render context (`context.inventory`: weapons, armor,
 *   consumables, loot), in STORABLE_TYPES order and sorted.
 * - What `_onDropItem` and `Actor#transferItem` return and create on drops from another actor.
 * - Its sheets bind DragDrop without a drop permission, so a drop on a sheet the user can't edit
 *   still reaches `_onDropItem`.
 */

/** How long after a drop an item the GM transfers is still caught, in ms (see #awaitTransfer). */
const TRANSFER_WAIT = 10000;

/**
 * Containers in an actor sheet's inventory: a loot item flagged as a container holds other items,
 * shown as a panel of its own (templates/container.hbs). The mixin sorts the inventory into panels,
 * adds the container entries to the item menus, stores or takes out items dropped on the sheet,
 * and lights up the panel under a dragged item.
 * @param {typeof foundry.applications.sheets.ActorSheetV2} Base
 */
export function ContainerSheetMixin(Base) {
  return class ContainerSheet extends Base {
    /**
     * Parameters each item type's rows pass to the system's inventory-item partial inside a
     * container panel, the same ones the type's own section passes. `showActions: true` stands for
     * "when the sheet is editable".
     * @type {Record<string, {isQuantifiable?: boolean, showActions?: boolean, hideResources?: boolean}>}
     */
    static CONTAINER_ROWS = {};

    /**
     * Split the system's inventory lists into containers and loose items. A container is a loot
     * item with the container flag; it leaves the Loot list for a panel of its own, listing what
     * it holds by type. An item stays loose when its container is gone or when it is equipped:
     * equipping takes it out (see main.js), so this only covers data that predates that.
     * @param {object} [inventory]                      The system's `context.inventory`.
     * @param {Record<string, boolean>} collapsedGroups  Groups this browser shows collapsed.
     */
    containerInventory(inventory, collapsedGroups) {
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
        contents: held.map(heldItem => {
          const { showActions, ...row } = this.constructor.CONTAINER_ROWS[heldItem.type] ?? {};
          return { item: heldItem, ...row, showActions: showActions ? this.isEditable : undefined };
        })
      }));
      return { ...loose, containers };
    }

    /**
     * Every item menu of the sheet gets the container entries; each entry shows only on the rows
     * it applies to, so one wrapper covers the loot, consumable and equipment menus alike.
     * @inheritdoc
     */
    _createContextMenu(handler, selector, options) {
      return super._createContextMenu(() => [...handler(), ...this.#containerContextOptions()], selector, options);
    }

    /**
     * Context menu entries that turn loot into a container and back, and take an item out of
     * the container holding it.
     * @returns {import("@client/applications/ux/context-menu.mjs").ContextMenuEntry[]}
     */
    #containerContextOptions() {
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
      // A user who can't edit this sheet can't write the container flags; the drop is the
      // system's alone and the item arrives loose.
      if (!this.isEditable) return super._onDropItem(event, item);
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

      if (!storable) return super._onDropItem(event, item);
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
  };
}
