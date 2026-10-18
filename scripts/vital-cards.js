/*!
 * Daggerheart: Nice Sheets
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/** How long a flash can still be running, in ms: the longest one is the Hope glow (1.8s). */
const FLASH_LIFETIME = 2000;

/** How soon after a vital's last flash a click still adds to the same run, in ms: a ring card's 0.9s flash. */
const BURST_WINDOW = 900;

/**
 * @typedef {object} VitalFlash
 * @property {string} card        Selector of the vital's card.
 * @property {string} up          Class played when the value rises.
 * @property {string} down        Class played when the value falls.
 * @property {string} [alsoUp]    More elements flashing on a rise.
 * @property {string} [alsoDown]  More elements flashing on a fall.
 */

/**
 * The ring cards' click queue and flashes, for any number of actors in one window. Every vital is
 * tracked under `<actor uuid>.<key>`, so a party sheet's members never share a queue or a flash.
 * The character and party sheets share this rather than each keeping a copy, so a fix to the
 * module's subtlest code lands in both.
 */
export class VitalCards {
  /**
   * @param {Record<string, VitalFlash>} flashes  What each vital flashes, as selectors inside the root given to sync().
   * @param {(actor: Actor) => void} rerender      Called when the server kept a value other than the one a click showed.
   */
  constructor(flashes, rerender) {
    this.#flashSpecs = flashes;
    this.#rerender = rerender;
  }

  /** @type {Record<string, VitalFlash>} */
  #flashSpecs;

  /** @type {(actor: Actor) => void} */
  #rerender;

  /**
   * Values a ring card click has shown but the server has not confirmed yet.
   * @type {Record<string, number>}
   */
  #pending = {};

  /**
   * The #send run saving each vital's clicks, while one is in flight.
   * @type {Record<string, Promise<void>>}
   */
  #sends = {};

  /**
   * Vital values seen on each actor's previous sync, by actor uuid, used to play a one-shot flash
   * on the track that changed (damage, healing, hope gained or spent).
   * @type {Record<string, Record<string, number>>}
   */
  #last = {};

  /**
   * The element each actor's cards were last synced in, by actor uuid; a click flashes there.
   * @type {Record<string, HTMLElement>}
   */
  #roots = {};

  /**
   * Flashes started in the last FLASH_LIFETIME ms, so a render that replaces their elements can
   * carry them on from where they were.
   * @type {Record<string, {from: number, to: number, start: number}>}
   */
  #flashes = {};

  /**
   * The value a card shows: a click the server has not confirmed yet, else the saved value. A
   * render that confirms an earlier click would otherwise show the older value until sync repaints.
   * @param {Actor} actor
   * @param {string} key
   */
  shown(actor, key) {
    return this.#pending[`${actor.uuid}.${key}`] ?? VitalCards.#saved(actor, key).value;
  }

  /**
   * Step a vital by one from its ring card: left click adds, right click removes. The card shows
   * the new value and plays its flash at once, without waiting for the server's round trip and
   * the re-render that follows. Each click steps from the value shown, so quick clicks add up
   * even while an earlier one is still in flight; #send saves them.
   * @param {PointerEvent} event
   * @param {HTMLElement} card  The ring card, carrying `data-resource`.
   * @param {Actor} actor
   */
  step(event, card, actor) {
    const key = card.dataset.resource;
    const id = `${actor.uuid}.${key}`;
    const saved = VitalCards.#saved(actor, key);
    const shown = this.#pending[id] ?? saved.value;
    const next = Math.clamp(shown + (event.button === 2 ? -1 : 1), 0, saved.max);
    if (next === shown) return;

    this.#pending[id] = next;
    // The confirming sync then finds nothing new to flash.
    if (this.#last[actor.uuid]) this.#last[actor.uuid][key] = next;
    VitalCards.paint(card, next);
    this.#startFlash(this.#roots[actor.uuid] ?? card.parentElement, id, key, shown, next);
    // A send already in flight picks the new value up when it returns.
    this.#sends[id] ??= this.#send(actor, key);
  }

  /**
   * Compare an actor's vitals with its previous sync and trigger the CSS flash animations: a red
   * jolt when a vital gets worse (damage, stress, an armor slot spent, Hope spent), a green lift
   * when it recovers. A value a click has shown but the server has not confirmed counts as the
   * current one, so the renders in between neither flash it back nor show the older value.
   * Flashes still running from before this render carry on in the new elements. Vitals the actor
   * doesn't have (a companion's HP) are skipped.
   * @param {Actor} actor
   * @param {HTMLElement} root  The element holding this actor's cards, just rendered.
   */
  sync(actor, root) {
    const uuid = actor.uuid;
    this.#roots[uuid] = root;
    const keys = Object.keys(this.#flashSpecs).filter(key => VitalCards.#saved(actor, key));
    const current = Object.fromEntries(keys.map(key => [key, this.shown(actor, key)]));
    for (const key of keys) {
      const value = this.#pending[`${uuid}.${key}`];
      const card = value === undefined ? null : root.querySelector(this.#flashSpecs[key].card);
      if (card) VitalCards.paint(card, value);
    }

    const previous = this.#last[uuid];
    this.#last[uuid] = current;
    const changed = previous ? keys.filter(key => current[key] !== previous[key]) : [];

    const now = performance.now();
    for (const key of keys) {
      const id = `${uuid}.${key}`;
      const flash = this.#flashes[id];
      if (!flash) continue;
      if (now - flash.start >= FLASH_LIFETIME) delete this.#flashes[id];
      else if (!changed.includes(key)) this.#applyFlash(root, key, flash);
    }
    for (const key of changed) this.#startFlash(root, `${uuid}.${key}`, key, previous[key], current[key]);
  }

  /**
   * The window closed: forget the last values and the running flashes, so the next opening neither
   * flashes what changed meanwhile nor carries on old flashes. Sends in flight finish on their own.
   */
  reset() {
    this.#last = {};
    this.#roots = {};
    this.#flashes = {};
  }

  /**
   * Show a value on a ring card as a render would: the filled segments and the count. Scars keep
   * their segments.
   * @param {HTMLElement} card
   * @param {number} value
   */
  static paint(card, value) {
    card.querySelectorAll(".seg:not(.scar)").forEach((segment, i) => {
      segment.classList.toggle("filled", i < value);
      segment.classList.toggle("empty", i >= value);
    });
    card.querySelector(".nice-ring-count").firstChild.data = value;
  }

  /**
   * Save the value ring card clicks have shown for a vital: one update, then, if clicks moved it
   * while that one was in flight, one more with the latest value, until the server has what the
   * card shows. A run of quick clicks so costs two round trips and two renders, not one each.
   * Waiting for the previous update also keeps the next one right: sent earlier, an update back
   * to the value still saved (+1 then −1) would be dropped by Foundry's diff as no change, and an
   * armor step would compute a zero delta. Armor goes through the system, so the change is spread
   * over the armor sources the way its own sheet does. A value the server did not apply is undone
   * by rendering the saved one.
   * @param {Actor} actor
   * @param {string} key
   */
  async #send(actor, key) {
    const id = `${actor.uuid}.${key}`;
    let sent;
    try {
      while (this.#pending[id] !== sent) {
        sent = this.#pending[id];
        if (key === "armor") await actor.system.updateArmorValue({ value: sent - VitalCards.#saved(actor, key).value });
        else await actor.update({ [`system.resources.${key}.value`]: sent });
      }
    } catch {
      // Foundry has already reported the rejected update, on screen and in the console.
    } finally {
      delete this.#pending[id];
      delete this.#sends[id];
      const actual = VitalCards.#saved(actor, key).value;
      if (actual !== sent) {
        if (this.#last[actor.uuid]) this.#last[actor.uuid][key] = actual;
        delete this.#flashes[id];
        this.#rerender(actor);
      }
    }
  }

  /**
   * A vital's saved value and max: armor from the system's armor score, the others from the
   * actor's resources. Undefined for a vital this actor type doesn't have.
   * @param {Actor} actor
   * @param {string} key
   * @returns {{value: number, max: number}|undefined}
   */
  static #saved(actor, key) {
    return key === "armor" ? actor.system.armorScore : actor.system.resources?.[key];
  }

  /**
   * Flash a vital's elements for a change from one value to another. A change that lands while
   * the vital's last flash is still playing, carries on from where it ended and goes the same
   * way, is the next click of a run: the flash keeps the run's starting value, so every slot
   * clicked so far flares again with the new one, whatever renders came in between.
   * @param {HTMLElement} root
   * @param {string} id   `<actor uuid>.<key>`
   * @param {string} key  A key of the flashes given to the constructor.
   * @param {number} from
   * @param {number} to
   */
  #startFlash(root, id, key, from, to) {
    const last = this.#flashes[id];
    const now = performance.now();
    if (last && now - last.start < BURST_WINDOW && last.to === from && Math.sign(to - from) === Math.sign(from - last.from)) {
      from = last.from;
    }
    this.#flashes[id] = { from, to, start: now };
    this.#applyFlash(root, key, this.#flashes[id]);
  }

  /**
   * Put a flash's classes on the elements now in the root and seek their animations to the time
   * the flash has already run. The ring segments between the two values are the slots that just
   * filled or emptied; they flare with the card. The classes come off on `animationend`, so a
   * vital can flash again on the next change.
   * @param {HTMLElement} root
   * @param {string} key
   * @param {{from: number, to: number, start: number}} flash
   */
  #applyFlash(root, key, { from, to, start }) {
    const { card, up, down, alsoUp, alsoDown } = this.#flashSpecs[key];
    const rising = to > from;
    const cls = rising ? up : down;
    // Toggled, not added: a slot left marked by an earlier run, the other way, must not flare.
    root.querySelectorAll(`${card} .seg`).forEach((segment, i) => {
      segment.classList.toggle("changed", i >= Math.min(from, to) && i < Math.max(from, to));
    });

    const elapsed = performance.now() - start;
    const selector = [card, rising ? alsoUp : alsoDown].filter(Boolean).join(", ");
    for (const element of root.querySelectorAll(selector)) {
      // Hope shows in the header or in its card, never both, so one of them is hidden. A hidden
      // element never fires `animationend`, and its class would play a stale flash the moment
      // the sheet is collapsed or expanded.
      if (!element.checkVisibility()) continue;
      // A quick second click lands on an element still flashing, maybe the other way; the old
      // class goes, so the new animation starts over instead of fighting it.
      if (element.classList.contains(up) || element.classList.contains(down)) {
        element.classList.remove(up, down);
        void element.offsetWidth;
      }
      element.classList.add(cls);
      element.addEventListener("animationend", () => element.classList.remove(cls), { once: true });
      if (elapsed < 50) continue;
      // Looping animations are left to syncLoopingAnimations.
      for (const animation of element.getAnimations({ subtree: true })) {
        if (animation instanceof CSSAnimation && animation.effect.getTiming().iterations !== Infinity) {
          animation.currentTime = elapsed;
        }
      }
    }
  }
}
