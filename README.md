# Dxcufgb's Reminders

[![Foundry v13](https://img.shields.io/github/v/release/dxcufgb/FoundryVTT-reminders?label=Foundry%20v13&logo=foundryvirtualtabletop&color=ff6400)](https://github.com/dxcufgb/FoundryVTT-reminders/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/dxcufgb/FoundryVTT-reminders/module.zip?label=downloads&color=blue)](https://github.com/dxcufgb/FoundryVTT-reminders/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/dxcufgb)\
[![CI](https://img.shields.io/github/actions/workflow/status/dxcufgb/FoundryVTT-reminders/ci.yml?branch=main&label=CI)](https://github.com/dxcufgb/FoundryVTT-reminders/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dxcufgb/FoundryVTT-reminders)](LICENSE)
[![System dnd5e](https://img.shields.io/badge/system-dnd5e%204%2B-8a5cf6)](https://foundryvtt.com/packages/dnd5e)

<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>

Keeps legendary actions, villain actions, lair actions and legendary resistances in the GM's chat at the right moments. Cards list each option with its cost and the points remaining. Expand **Use an Action** for native dnd5e **Use** buttons that spend legendary points through the system pipeline.

**Foundry VTT:** v13 · **System:** dnd5e 4.x / 5.x (other systems: name matching only)

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-reminders/releases/latest/download/module.json
```

## Features

- **Legendary / villain reminder cards after a PC's turn when points remain.** One card per turn lists every NPC in combat that still has legendary action points, for example *"Adult Red Dragon: Legendary actions 2/3"*, with each option and what it costs.
- **Villain actions are once per combat.** Once used (from the card, the sheet or a macro), a villain action is marked used: it is greyed out on the card already in chat and left off later cards in that combat. The module doesn't spend legendary points for it; its Use button runs the item's own Use, which spends points only if the item itself consumes them.
- **Legendary resistance whisper when a boss fails a save and still has uses left.** It shows the roll and DC and has a **Use Legendary Resistance** button. The button uses the creature's *Legendary Resistance* item if it has one, otherwise it lowers the counter by one.
- **Native Use buttons with cost / remaining labels.** Expand **Use an Action** on the card: each button runs the item's own Use (dnd5e: the activity pipeline, which spends the legendary points), shows *costs 2 · 1 left*, and is disabled when there aren't enough points left. The labels update live as points are spent.
- **Lair action cards (2014 rules)** when the turn order passes the lair's initiative count (20 by default). In dnd5e the creature's lair setting must be on (`system.resources.lair.value`); creatures without it get no lair card.
- **GM-only whisper by default.** Only the GM can press the buttons, even if the cards are made public.
- The previous legendary or lair card of the same combat is removed when a new one of that kind is posted, so chat stays tidy (setting).

## What counts as a legendary, villain or lair action

- **dnd5e activation type:** every item whose activation is *Legendary Action* or *Lair Action* counts, whether or not it's in the list (setting *Also detect by activation type*). Its cost comes from the activation.
- **The Reminder list:** the module ships `data/reminders.json`, which holds every legendary and lair action in the **2014 and 2024 Monster Manuals**. That's 141 actions on 79 stat blocks, each with a short summary that is shown on the card. In dnd5e a listed legendary or lair name only counts when the item has that activation, so a monster's ordinary *Bite* doesn't count just because the vampire's legendary *Bite* is listed. The list also holds per-creature data (legendary action and resistance counts, in-lair counts, regional effects).
  Entries marked `"confirmed": false` come from secondary sources for non-SRD creatures; check them against the book.
- **Villain actions** (MCDM style): items with *Villain Action* in their name, list entries with `"kind": "villain"`, or items set to *Villain action* on their sheet.
- The first time a GM opens a world, the list is copied into that world. From then on each world has its own copy.

### Adding, removing and overriding

- **Right-click an item** in the Items sidebar, an Item compendium or a dnd5e actor sheet: **Add to Reminder list** / **Remove from Reminder list**.
- **Item sheet header → Reminder** (in the ⋮ menu on dnd5e sheets): *Automatic*, *Legendary action*, *Villain action*, *Lair action* or *Never remind*. This wins over everything else.
- **On a card**, the ban button next to an action: only this creature, all creatures made from this actor, or remove the name from the list.
- In dnd5e, removing a name from the list doesn't stop items that have a *Legendary Action* or *Lair Action* activation while *Also detect by activation type* is on: the activation still counts. To stop one of those, use *Never remind* (on the item sheet, or *only this creature* / *all creatures* on the card), or turn that setting off.
- **Module settings → Export / Import Reminder list** to move a list between worlds. Import warns before replacing the list.

## API

From a macro or another module:

```js
const api = game.modules.get("dxcufgbs-reminders").api;

// Any user
api.findReminders(actor);        // [{ item, kind, cost, entry }]: every legendary, villain and lair action on the actor
api.kindOf(item);                // { kind, reason, entry, cost }: how the item is classified, and why
api.legendaryPoints(actor);      // { value, max } from system.resources.legact, or null
api.legendaryResistance(actor);  // { value, max } from system.resources.legres, or null
api.getList();                   // this world's Reminder list ({ version, features, creatures, … }), or null
api.isListed("Wing Attack");     // true if the name (or an item's name) matches an entry in the list

// GM only
await api.remindNow();                    // post the legendary / villain card now (default: game.combat)
await api.addToList(item, "villain");     // add an item or a name; the kind is optional → true if added
await api.removeFromList("Wing Attack");  // remove a name or an item's name → true if removed
await api.configureItem(item);            // open the item's Reminder dialog
api.exportList();                         // download this world's list as reminders-<world id>.json
await api.importList();                   // pick a file, confirm, replace the list → true if replaced
await api.resetList();                    // replace this world's list with the default one, without asking → true if reset
```

- `kind` is `"legendary"`, `"villain"`, `"lair"` or `null`. `reason` is `"flag"` (set on the item), `"never"`, `"villain"` (name or list), `"activation"`, `"list"` or `"none"`. `cost` comes from the activation, then the list entry; `findReminders` uses 1 when neither has one. `entry` is the matching list entry (its `effect` is the summary on the card), or empty when none matches.
- `findReminders` returns every kind, whether or not that kind's reminder setting is on (only *Also detect by activation type* applies), and doesn't check villain actions already used this combat or the points left.
- GM-only calls do nothing for players: they return `false`, `null` (`remindNow`) or nothing.
- `remindNow(combat)` follows the legendary / villain reminder settings but not *Only after player characters' turns*. It leaves out the current combatant unless that's a player character, and returns the chat message, or `null` when no NPC has an option left. With *Remove old reminder cards* on, it replaces the previous card.
- `addToList(item, kind)`: without `kind`, the kind comes from the item's activation, then *Villain Action* in its name, otherwise `"legendary"`. It returns `false` when the name is already listed.
- `getList()` returns the stored list: don't change it in place, use `addToList`, `removeFromList` or `importList`.
- `resetList()` doesn't ask first. Export the list before you reset it if it has changes you want to keep.

Per item: `item.setFlag("dxcufgbs-reminders", "kind", "legendary" | "villain" | "lair" | "none")`, or `item.unsetFlag("dxcufgbs-reminders", "kind")` for automatic.

**From another module**

The API is set in the `ready` hook, so it isn't there during `init` or `setup`, and your own `ready` handler may run before it. Get it when you need it, not once at startup:

```js
function bossActions(actor) {
  const api = game.modules.get("dxcufgbs-reminders")?.api;
  if (!api) return [];   // Reminders not installed, not enabled or not ready yet
  return api.findReminders(actor).filter(r => r.kind === "legendary");
}
```

Add `{ "id": "dxcufgbs-reminders", "type": "module" }` to `relationships.recommends` in your `module.json`. The module calls no hooks of its own.

**Data**

- `flags.dxcufgbs-reminders.kind` on Items: see *Per item* above.
- `flags.dxcufgbs-reminders.villainUsed` on a Combat: `{ "<item uuid with . replaced by _>": true }` for each villain action used in that combat. Read it; the module writes it.
- Reminder cards are chat messages with `flags.dxcufgbs-reminders.card` set to `"turn"`, `"lair"` or `"resist"`, plus `actorUuids` (and `combatId` and `round` on turn and lair cards). Internal, may change.
- The list file (Export / Import, and the default `data/reminders.json`): `{ "version": 1, "features": [ … ], "creatures": [ … ], … }`. Import needs a `features` array in which every entry has a `name`. An entry has `id`, `name`, optional `aliases`, `kind` (`legendary` / `villain` / `lair`), `cost`, `match` (`exact` ignores case, apostrophe style and text in parentheses; `contains` matches anywhere in the item's name), `effect` (the summary on the card), `limit`, `creatures`, `edition`, `source` and `confirmed`. When several entries match, the one whose `creatures` names the actor wins.

## Settings

All settings are world settings, changed by the GM.

- **Legendary action reminders**, **Villain action reminders**, **Legendary resistance reminders**, **Lair action reminders**: turn each kind of card on or off.
- **Only after player characters' turns**: post the legendary / villain card only after a player character's turn. Turn off to post it after any creature's turn (the creature whose turn just ended is left out).
- **Also detect by activation type**: count dnd5e legendary / lair activations that aren't in the list.
- **Only check non-player creatures**, **Whisper to the GM only**, **Remove old reminder cards**, **Reminder sound**, **Reminder volume**.
- **Export Reminder list** / **Import Reminder list**: see above.

## Rules notes

- **2014:** legendary actions can cost 1–3 points; the card disables options that cost more than what's left. Lair actions happen on initiative count 20 (losing ties).
- **2024:** every legendary action costs 1, many can't be repeated until the start of the creature's next turn (shown in the summary), and lair actions are replaced by an extra legendary action and resistance in the lair. dnd5e restores legendary points at the start of the creature's turn.
- The legendary resistance whisper needs the save's DC. Saves rolled from a chat card with a DC have one; a plain save from the sheet doesn't, so no whisper is posted. The whisper is posted only when a GM rolls the save.

## License

[MIT](LICENSE). The action summaries are short paraphrases. Creature data from the System Reference Documents 5.1 and 5.2 is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Wizards of the Coast).

## Releasing

For the maintainer: **Actions → Release module → Run workflow**, type the version (for example `1.2.3`) and run it. The module is checked and packaged first; only then is the release `v1.2.3` published with `module.json` and `module.zip`. CI and releases come from [dxcufgb/foundry-module-ci](https://github.com/dxcufgb/foundry-module-ci), the same for every module.
