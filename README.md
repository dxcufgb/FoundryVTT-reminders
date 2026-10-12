# Dxcufgb's Reminders

Keeps legendary actions, villain actions, lair actions and legendary resistances in the GM's chat at the right moments. Cards list each option with its cost and the points remaining. Expand **Use an Action** for native dnd5e **Use** buttons that spend legendary points through the system pipeline.

**Foundry VTT:** v13 · **System:** dnd5e 4.x / 5.x (other systems: name matching only)

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-reminders/releases/latest/download/module.json
```

## Features

- **Legendary / villain reminder cards after a PC's turn when points remain.** One card per turn lists every NPC in combat that still has legendary action points, for example *"Adult Red Dragon: Legendary actions 2/3"*, with each option and what it costs.
- **Villain actions spend legendary points but are once per combat.** Once used (from the card, the sheet or a macro), a villain action is greyed out on later cards in that combat.
- **Legendary resistance whisper when a boss fails a save and still has uses left.** It shows the roll and DC and has a **Use Legendary Resistance** button. The button uses the creature's *Legendary Resistance* item if it has one, otherwise it lowers the counter by one.
- **Native Use buttons with cost / remaining labels.** Expand **Use an Action** on the card: each button runs the item's own Use (dnd5e: the activity pipeline, which spends the legendary points), shows *costs 2 · 1 left*, and is disabled when there aren't enough points left. The labels update live as points are spent.
- **Lair action cards (2014 rules)** when the turn order passes the lair's initiative count (20 by default).
- **GM-only whisper by default.** Only the GM can press the buttons, even if the cards are made public.
- The previous card of the same combat is removed when a new one is posted, so chat stays tidy (setting).

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
- **Module settings → Export / Import Reminder list** to move a list between worlds. Import warns before replacing the list.

From a macro: `game.modules.get("dxcufgbs-reminders").api` has `remindNow()`, `findReminders(actor)`, `kindOf(item)`, `legendaryPoints(actor)`, `legendaryResistance(actor)`, `getList()`, `isListed(name)`, `addToList(item)`, `removeFromList(name)`, `exportList()`, `importList()`, `resetList()` and `configureItem(item)`.
Per item: `item.setFlag("dxcufgbs-reminders", "kind", "legendary" | "villain" | "lair" | "none")`, or `item.unsetFlag("dxcufgbs-reminders", "kind")` for automatic.

## Settings

- **Legendary action reminders**, **Only after player characters' turns**, **Villain action reminders**, **Legendary resistance reminders**, **Lair action reminders**: turn each kind of card on or off.
- **Also detect by activation type**: count dnd5e legendary / lair activations that aren't in the list.
- **Only check non-player creatures**, **Whisper to the GM only**, **Remove old reminder cards**, **Reminder sound**, **Reminder volume**.
- **Export Reminder list** / **Import Reminder list**: see above.

## Rules notes

- **2014:** legendary actions can cost 1–3 points; the card disables options that cost more than what's left. Lair actions happen on initiative count 20 (losing ties).
- **2024:** every legendary action costs 1, many can't be repeated until the start of the creature's next turn (shown in the summary), and lair actions are replaced by an extra legendary action and resistance in the lair. dnd5e restores legendary points at the start of the creature's turn.
- The legendary resistance whisper needs the save's DC. Saves rolled from a chat card with a DC have one; a plain save from the sheet doesn't, so no whisper is posted.

## License

[MIT](LICENSE). The action summaries are short paraphrases. Creature data from the System Reference Documents 5.1 and 5.2 is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Wizards of the Coast).

## Releasing

For the maintainer: **Actions → Release module → Run workflow**, type the version (for example `1.2.3`) and run it. The module is checked and packaged first; only then is the release `v1.2.3` published with `module.json` and `module.zip`. CI and releases come from [dxcufgb/foundry-module-ci](https://github.com/dxcufgb/foundry-module-ci), the same for every module.
