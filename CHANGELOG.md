# Unreleased

- [Fixed] Party cards show class and subclass on one line and community and ancestry on the next, instead of wrapping long names and pushing the card out of line with its neighbour.

# 0.1.0

- [Added] A Nice Party Sheet, used by default for parties: member cards with Hope, Hit Points, Stress, Armor, Evasion, damage thresholds and traits, with companions, adversaries and NPCs in groups of their own.
- [Added] The party sheet's buttons start a Tag Team or a Group Roll, and give the GM a short and a long rest. Other modules can add, remove or reorder them through the `dh-nice-sheets.partyActions` hook (see docs/DEVELOPERS.md).
- [Added] The party Inventory tab, with the party's coins and containers.
- [Added] A party Notes tab, hidden unless the GM turns on "Show the party Notes tab". Players don't see the GM's secret blocks in it.
- [Added] The party art fills the sheet's background, and an info icon explains what art suits it.
- [Added] Choosing a party from the character sheet now uses a picker in the sheet's style.
- [Changed] Characters now open in the Nice Sheet by default, unless the GM already chose another Default Sheet.
- [Changed] The Tag Team button on the character sheet opens the system's Tag Team window.
- [Changed] Coins can be dragged from the character sheet's purse, as on the system's sheet.

# 0.0.3

* Hit Points, Stress and Armor are now cards with a ring around an icon, one segment per slot. Left click marks one, right click clears one, and the name shows when you hover the card.
* The collapsed sheet shows Hope as a fourth card, next to Hit Points, Stress and Armor.
* A card changes as soon as you click it, without waiting for the server, and quick clicks no longer count as one.
* A loss now shakes the card and turns it red, and a recovery lifts it and turns it green.
* The Resources title stays in place when the death move is available.
* The traits in the collapsed sheet's strip no longer show tooltips.

# 0.0.2

* First release.
