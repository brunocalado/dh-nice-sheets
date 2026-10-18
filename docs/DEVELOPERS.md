# Daggerheart: Nice Sheets for module developers

This page is for authors of other modules that work with Nice Sheets. Players and GMs don't need it.

## Adding actions to the party sheet

The buttons at the top of the Nice party sheet (Tag Team, Group Roll, Short Rest and Long Rest) come from a list that other modules can change through the `dh-nice-sheets.partyActions` hook. The hook runs every time the sheet draws its header, with the sheet and the list. A listener adds, removes or reorders entries in the list, and the sheet draws a button for each one. It never needs to touch the sheet's HTML, so a change to the sheet's layout doesn't break it.

Each entry is an object with these keys:

| Key | Meaning |
|---|---|
| `id` | A unique string. The built-in ones are `tagTeamRoll`, `groupRoll`, `shortRest` and `longRest`. |
| `label` | The caption under the button, as a translation key or plain text. |
| `icon` | The Font Awesome classes of the icon, for example `fa-solid fa-moon`. |
| `tooltip` | Optional. A translation key or plain text. |
| `active` | Optional. Lights the button, as Tag Team does while one is under way. |
| `gmOnly` | Optional. Only the GM sees the button. It is drawn like the rest buttons, after a divider. |
| `onClick(event, sheet)` | What the button does when clicked. |

The sheet skips an entry with no `id`, with an `id` already used, or with no `onClick`. The built-in entries have none because they call the system's own actions, so keep them as they are when you move them. A listener that throws is reported in the console and the sheet still draws.

This example replaces the two rests with one Downtime button in the same place:

```js
Hooks.on("dh-nice-sheets.partyActions", (sheet, actions) => {
  const at = actions.findIndex(a => a.id === "shortRest");
  actions.splice(0, actions.length, ...actions.filter(a => a.id !== "shortRest" && a.id !== "longRest"));
  actions.splice(at < 0 ? actions.length : at, 0, {
    id: "my-downtime", label: "DAGGERHEART.GENERAL.downtime", icon: "fa-solid fa-moon",
    gmOnly: true, onClick: () => openMyDowntimeWindow()
  });
});
```

The hook only fires on the Nice party sheet. To support the system's own party sheet as well, keep that code path for it and skip the Nice one, which has the `dh-nice-sheets-party` class on its window.
