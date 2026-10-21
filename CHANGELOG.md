# Unreleased

- [Changed] The character header lists class, subclass, community, ancestry and multiclass one after another, wrapping only at the edge, so the header is shorter when the names are short.
- [Changed] The expanded sheet's HP, Stress and Armor are smaller cards in a 2×2 grid, with Evasion and Proficiency beside Armor, which makes the Resources block shorter.
- [Changed] An extra resource of up to 12 points fits on one row of the sidebar.

# 0.2.0

- [Added] Items have a "Store in a container" menu entry; with several containers it asks which one.
- [Added] Dragging an item near the top or bottom of the inventory scrolls the list.
- [Fixed] The character sheet header shows class and subclass on one line and community and ancestry on the next, instead of wrapping long names wherever they run out of room.
- [Fixed] Opening a character's settings from the sheet no longer offers the player the Nice Sheet.

# 0.1.1

- [Fixed] Party cards show class and subclass on one line and community and ancestry on the next, instead of wrapping long names and pushing the card out of line with its neighbour.
- [Fixed] A character's portrait on the party card is as tall as the name, heritage and Hope beside it, leaving no gap below it.
- [Changed] A character's Evasion sits in the top corner of the party card, beside the name, which makes the card shorter.
- [Changed] Adversaries on the party sheet show their tier, type and standard attack beside the name.
- [Fixed] A companion's portrait on the party sheet is as tall as the ring cards beside it.
- [Changed] The party sheet's group titles no longer show a member count.
- [Changed] With the Massive Damage rule on, adversaries on the party sheet show Massive as a fourth band of the thresholds bar, keeping the row short.
- [Fixed] The party sheet shows the Massive Damage band even when it is 0.
- [Fixed] The numbers in the party sheet's threshold diamonds sit centred instead of half a pixel high.

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
