# Dxcufgb's Reminders

FoundryVTT v13 module (id `dxcufgbs-reminders`, the install folder must have the same name). Keeps legendary actions,
villain and mythic actions, lair actions, legendary resistances, when-hit traits, death triggers, turn traits and
recharges, auras, bloodied, damage, saving throw and spell reaction traits in the GM's chat at the right moments: whispered cards with each option's cost, the points remaining and native dnd5e Use buttons. Death triggers
(0 HP) used to be the separate module `dxcufgbs-death-trigger` (Death Trigger Alerts) and work in any system. Built for dnd5e 4.x / 5.x (`relationships` in
`module.json`); other systems get name matching only. Each world keeps its own copy of the Reminder list. No build step
and no npm dependencies.

## Layout
- `scripts/reminders.js` – everything: settings and the Export/Import settings menus, the world's list (`ensureList`,
  `addToList`, `removeFromList`, `validateImport`, `importListFlow`, `resetList`), classification (`activationKind`,
  `kindOf`, `findReminders`), villain once-per-combat tracking (`villainUsed`, `markVillainUsed`, combat flag
  `villainUsed`), context menus, the item sheet header button (`configureItem`), turn detection (`combatTurnChange` →
  `onTurnChange` → `postTurnCard` / `checkLair` → `postLairCard`), legendary resistance (`dnd5e.rollSavingThrow` /
  `dnd5e.rollAbilitySave` → `onSaveRolled`, `useResistance`), when-hit traits such as Heated Body (`createChatMessage`
  on a dnd5e attack message → `onAttackMessage` → `postHitCard`), death triggers (`preUpdateActor` / `updateActor` /
  `updateToken` → `checkDeath` → `postDeathCard`, `hpPathFor`, `deathAlert`), the one-time move of the old Death Trigger
  Alerts list (`migrateDeathList`, hidden setting `DeathMigrated`), other creatures' death triggers (`deathOthers`:
  killer from `lastAttacker` / the current combatant, `markedBy`, `isCompanionOf`, range), mythic actions (`mythicActive`,
  `markMythicActive`, combat flag `mythicActive`, `mythicAtZero`, `onRevived`), the HP handler `onHpChange` (→ `checkDeath`,
  `checkBloodied`, `trackTurnDamage`), turn traits (`checkTurnTraits` → `postTurnTraitsCard`: own `turn` traits,
  `rechargeOptions` / `rechargeInfo` / `rollRecharge`, `auraOptions`), damage types (`dnd5e.calculateDamage` →
  `lastDamageTypes`, `dnd5e.applyDamage` → `onDamageApplied`, `damageSince`), saves before the roll
  (`dnd5e.preRollSavingThrowV2` / `preRollSavingThrow` / `preRollAbilitySave` → `onSaveStart`), spells cast
  (`createChatMessage` → `spellCast` / `onSpellMessage`), the shared `postGroupsCard`, distance helpers (`distanceBetween`,
  `withinRange`, `otherActors`, `opposed`), card buttons and live labels (`refreshLabels`,
  `refreshCardsFor`), `useItem`, and the module API (`game.modules.get("dxcufgbs-reminders").api`).
- `data/reminders.json` – the default list (`version`, `matching`, `kinds`, `features`, `creatures`): the legendary
  and lair actions of the 2014 and 2024 Monster Manuals, plus when-hit traits (Heated Body) and death
  triggers (kind `death`, ids `death-<old module id>`, from Death Trigger Alerts; `deathListVersion` is only used by
  `migrateDeathList`). Copied into each world on first GM
  start; it also has the turn, aura, damage, save and spell traits and the Shield spell (see `kinds` and `matching`); on later starts `mergeDefaults` adds new default entries (by `id`) once (setting `MergeDefaultList`). The
  world's list keeps the offered ids in `knownDefaults`, so removed entries stay removed; default entries need a
  stable, unique `id`.
- `styles/reminders.css` – cards and dialogs. `lang/en.json` – all strings (`DXRM.*`).
- `.github/workflows/ci.yml` / `release.yml` – thin callers of `dxcufgb/foundry-module-ci` (checks, packaging,
  release); identical in every module, do not edit them here. `claude.yml` – the Claude review.

## Conventions
- `MODULE_ID` must equal `id` in `module.json`; CI checks it.
- Every visible setting (`config: true`) and settings menu needs a Name and Hint in `lang/en.json`; CI checks it.
- Settings are all `world` scope. The list lives in the hidden `ReminderList` setting (`config: false`, type Object);
  `listCache` must be reset whenever it changes (`saveList` and the setting's `onChange` do this).
- Strings go through `t()` (`DXRM.` prefix). Hook handlers catch and `console.error` their errors.
- Update the wiki (not `README.md`, which only has the install steps and links to the wiki) when behaviour, settings or the API change.

## Review focus
- **One client posts**: turn and lair cards (`onTurnChange`) and the list setup and merge (`ensureList`) run only where
  `isResponsibleGM()` is true (`game.user.isGM && game.users.activeGM?.isSelf`), because `combatTurnChange` fires on
  every client. The when-hit card (`onAttackMessage`) runs from `createChatMessage`, which also fires on every client, so
  it uses `isResponsibleGM()` too, and so does the death check (`checkDeath`, from `updateActor` / `updateToken`); its
  once-per-drop memory (`deathAlerted`) is in memory on that client and the previous HP travels in the update options
  (`dxrmPrevHp`). Death cards are skipped while `dxcufgbs-death-trigger` is still active, so the GM doesn't get two.
  The same `isResponsibleGM()` guard covers `onHpChange` (bloodied, damage thresholds, mythic revive), the turn traits
  card (from `onTurnChange`) and `onSpellMessage` (`createChatMessage`); `lastAttacker` is recorded there too. Damage
  types (`dnd5e.calculateDamage` / `applyDamage`) and the save card (`preRoll…` hooks) fire only on the client that
  applied or rolled, so they check `game.user.isGM`; `damageSince` (types since its last turn, for Regeneration) is in
  memory on that client. The pre-roll and `calculateDamage` handlers must never return `false` (that cancels the roll or
  damage). `onHpChange` drops a change already seen from the other hook (`lastHpChange`), and every kind has its own
  setting, checked before it posts. The legendary resistance card and villain tracking run from dnd5e roll/use hooks that fire only on
  the client that rolled or used, and are limited to GMs (`game.user.isGM`). New hooks that fire on every client must
  use `isResponsibleGM()`, or each GM posts a copy. `lairDone` (once per combat round) is in memory on that client.
- **Who sees the cards**: `whisperTargets()` whispers every card to all GM users while `WhisperGM` is on (the
  default). With it off the cards are public by design (the wiki says only the GM can press the buttons): players then see
  creature names, points and the effect summaries. Keep `WhisperGM` the only switch; never post a card or flag
  outside `whisperTargets()`. Buttons are disabled for non-GMs (`renderChatMessageHTML`, `refreshLabels`); the sound
  and live label refreshes run only on GM clients.
- **GM-only writes**: list changes, import/export/reset, `configureItem`, the context-menu entries,
  `markVillainUsed` (combat flag), `markMythicActive` (combat flag), `rollRecharge` and `useResistance` (`system.resources.legres.value`) are GM-only; the settings
  menus are `restricted: true`. Keep those checks on any new entry point.
- **Points**: the module never restores legendary points (dnd5e does that at the creature's turn); it only reads
  `system.resources.legact` / `legres`, skips backward turn changes (`forward` in `onTurnChange`), and spends points
  through the system's `item.use()`. Only `useResistance` writes `legres` directly, and only when the Legendary
  Resistance item did not consume it.
- **Escaping**: names, images, uuids and list `effect` text go into card HTML through `escapeHTML`. Flag new
  interpolations without it.
- **Old Death Trigger flag**: items may still carry `flags.dxcufgbs-death-trigger.trigger` (true / false). `kindOf` reads
  it with `getProperty` (never `getFlag`: that scope throws once the old module is disabled); this module's own `kind`
  flag wins, and saving the item's Reminder dialog removes the old flag.
- **dnd5e paths**: activities (`system.activities`, 4.x+), the 3.x `system.activation` fallback, `resources.legact`,
  `legres`, `lair`; every lookup must return null/false instead of throwing on other systems. In dnd5e a listed
  legendary/lair name only counts with a matching activation (`systemHasActivations`), so a generic "Bite" is not a
  reminder; keep that.
- **List data contract**: `validateImport` must keep rejecting files without a `features` array or with an unnamed
  entry; `kind` is `legendary` / `villain` / `lair` / `mythic` / `hit` / `death` / `turn` / `aura` / `bloodied` / `damage` /
  `save` / `spell` (`KINDS`; all but the first four are `PASSIVE_KINDS`: no activation needed, and `activation` /
  `requires` apply to them like to `hit`). Kind fields: `turn` `phase` (`start` / `end`), `stopTypes`, `hpAtMost`; `aura`
  and `spell` `rangeFt`; `damage` `damageTypes` or `threshold`; `save` `abilities` (empty = every save); `death`
  `trigger` (the ones in `OTHERS_DEATH_TRIGGERS` belong to another creature than the one at 0 HP). Mythic actions come
  from the dnd5e activation `mythic`; bloodied traits also from the description (`OWN_BLOODIED`, never "the target"). `hit` entries need no activation; their optional `activation`
  (required dnd5e activation type), `requires` (text the item's description must contain) and `attack` (`melee`, the
  default, or `any`) keep same-named features of the other edition apart (2014 vs 2024 Fire Aura), and a legendary or
  lair activation always wins over a `hit` or `death` entry (`death` entries need no activation either) (the 2014 Mummy Lord's Whirlwind of Sand); `match` is `exact` / `contains`. Changing an entry's `name` or
  `match` changes matching in every world that copies the default list.
