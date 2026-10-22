# Dxcufgb's Reminders

FoundryVTT v13 module (id `dxcufgbs-reminders`, the install folder must have the same name). Keeps legendary actions,
villain actions, lair actions and legendary resistances in the GM's chat at the right moments: whispered cards with
each option's cost, the points remaining and native dnd5e Use buttons. Built for dnd5e 4.x / 5.x (`relationships` in
`module.json`); other systems get name matching only. Each world keeps its own copy of the Reminder list. No build step
and no npm dependencies.

## Layout
- `scripts/reminders.js` – everything: settings and the Export/Import settings menus, the world's list (`ensureList`,
  `addToList`, `removeFromList`, `validateImport`, `importListFlow`, `resetList`), classification (`activationKind`,
  `kindOf`, `findReminders`), villain once-per-combat tracking (`villainUsed`, `markVillainUsed`, combat flag
  `villainUsed`), context menus, the item sheet header button (`configureItem`), turn detection (`combatTurnChange` →
  `onTurnChange` → `postTurnCard` / `checkLair` → `postLairCard`), legendary resistance (`dnd5e.rollSavingThrow` /
  `dnd5e.rollAbilitySave` → `onSaveRolled`, `useResistance`), card buttons and live labels (`refreshLabels`,
  `refreshCardsFor`), `useItem`, and the module API (`game.modules.get("dxcufgbs-reminders").api`).
- `data/reminders.json` – the default list (`version`, `matching`, `kinds`, `features`, `creatures`): the legendary
  and lair actions of the 2014 and 2024 Monster Manuals. Copied into each world on first GM start.
- `styles/reminders.css` – cards and dialogs. `lang/en.json` – all strings (`DXRM.*`).
- `.github/workflows/ci.yml` / `release.yml` – thin callers of `dxcufgb/foundry-module-ci` (checks, packaging,
  release); identical in every module, do not edit them here. `claude.yml` – the Claude review.

## Conventions
- `MODULE_ID` must equal `id` in `module.json`; CI checks it.
- Every visible setting (`config: true`) and settings menu needs a Name and Hint in `lang/en.json`; CI checks it.
- Settings are all `world` scope. The list lives in the hidden `ReminderList` setting (`config: false`, type Object);
  `listCache` must be reset whenever it changes (`saveList` and the setting's `onChange` do this).
- Strings go through `t()` (`DXRM.` prefix). Hook handlers catch and `console.error` their errors.
- Update `README.md` when behaviour, settings or the API change.

## Review focus
- **One client posts**: turn and lair cards (`onTurnChange`) and the first list setup (`ensureList`) run only where
  `isResponsibleGM()` is true (`game.user.isGM && game.users.activeGM?.isSelf`), because `combatTurnChange` fires on
  every client. The legendary resistance card and villain tracking run from dnd5e roll/use hooks that fire only on
  the client that rolled or used, and are limited to GMs (`game.user.isGM`). New hooks that fire on every client must
  use `isResponsibleGM()`, or each GM posts a copy. `lairDone` (once per combat round) is in memory on that client.
- **Who sees the cards**: `whisperTargets()` whispers every card to all GM users while `WhisperGM` is on (the
  default). With it off the cards are public by design (README: only the GM can press the buttons): players then see
  creature names, points and the effect summaries. Keep `WhisperGM` the only switch; never post a card or flag
  outside `whisperTargets()`. Buttons are disabled for non-GMs (`renderChatMessageHTML`, `refreshLabels`); the sound
  and live label refreshes run only on GM clients.
- **GM-only writes**: list changes, import/export/reset, `configureItem`, the context-menu entries,
  `markVillainUsed` (combat flag) and `useResistance` (`system.resources.legres.value`) are GM-only; the settings
  menus are `restricted: true`. Keep those checks on any new entry point.
- **Points**: the module never restores legendary points (dnd5e does that at the creature's turn); it only reads
  `system.resources.legact` / `legres`, skips backward turn changes (`forward` in `onTurnChange`), and spends points
  through the system's `item.use()`. Only `useResistance` writes `legres` directly, and only when the Legendary
  Resistance item did not consume it.
- **Escaping**: names, images, uuids and list `effect` text go into card HTML through `escapeHTML`. Flag new
  interpolations without it.
- **dnd5e paths**: activities (`system.activities`, 4.x+), the 3.x `system.activation` fallback, `resources.legact`,
  `legres`, `lair`; every lookup must return null/false instead of throwing on other systems. In dnd5e a listed
  legendary/lair name only counts with a matching activation (`systemHasActivations`), so a generic "Bite" is not a
  reminder; keep that.
- **List data contract**: `validateImport` must keep rejecting files without a `features` array or with an unnamed
  entry; `kind` is `legendary` / `villain` / `lair`, `match` is `exact` / `contains`. Changing an entry's `name` or
  `match` changes matching in every world that copies the default list.
