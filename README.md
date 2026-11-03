# Dxcufgb's Reminders

[![Foundry v13](https://img.shields.io/github/v/release/dxcufgb/FoundryVTT-reminders?label=Foundry%20v13&logo=foundryvirtualtabletop&color=ff6400)](https://github.com/dxcufgb/FoundryVTT-reminders/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/dxcufgb/FoundryVTT-reminders/module.zip?label=downloads&color=blue)](https://github.com/dxcufgb/FoundryVTT-reminders/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/dxcufgb)\
[![CI](https://img.shields.io/github/actions/workflow/status/dxcufgb/FoundryVTT-reminders/ci.yml?branch=main&label=CI)](https://github.com/dxcufgb/FoundryVTT-reminders/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dxcufgb/FoundryVTT-reminders)](LICENSE)
[![System dnd5e](https://img.shields.io/badge/system-dnd5e%204%2B-8a5cf6)](https://foundryvtt.com/packages/dnd5e)

<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>

Keeps legendary actions, villain actions, lair actions, legendary resistances, when-hit traits (such as Heated Body, on a melee hit) and death triggers (such as Undead Fortitude or Death Burst, when a creature drops to 0 HP) in the GM's chat at the right moments. Cards list each option with its cost and the points remaining. Expand **Use an Action** for native dnd5e **Use** buttons that spend legendary points through the system pipeline.

**Death triggers** used to be the separate module [Dxcufgb's Death Trigger Alerts](https://github.com/dxcufgb/FoundryVTT-death-trigger) and are part of Reminders now. When you switch over:

- On the first start as GM, Reminders moves that world's Death Trigger list into the Reminder list once: your own death triggers come along, and default ones you had removed stay removed. The **Always / Never** death-trigger setting on items is read as is.
- While Death Trigger Alerts is still enabled, Reminders posts no death cards (so you don't get two) and reminds you to disable it in **Manage Modules**.
- New settings: **Death trigger reminders**, **HP attribute path** and **Death trigger sound**. Right-click an item for **Add to Reminder list as a death trigger**; the item sheet's **Reminder** button has a **Death trigger** option.
- API: `deathAlert(actor, items?)` posts the card, `hpPathFor(actor)` gives the watched HP path, and `findReminders(actor)` returns death triggers with `kind: "death"`.

**Foundry VTT:** v13 · **System:** dnd5e 4.x / 5.x (other systems: name matching only; death triggers work in any system)

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-reminders/releases/latest/download/module.json
```

Requirements and the first start: see [Installation](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Installation) in the wiki.

## Documentation

The full guide is in the [wiki](https://github.com/dxcufgb/FoundryVTT-reminders/wiki):

- [Reminder Cards](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Reminder-Cards): legendary, villain, lair, legendary resistance, when-hit and death trigger cards.
- [The Reminder List](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/The-Reminder-List): what counts, and adding, removing and overriding actions.
- [Settings](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Settings): every option.
- [Rules Notes](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Rules-Notes): 2014 and 2024 rules.
- [API](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/API): for macros and other modules.
- [Troubleshooting](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Troubleshooting): common problems.

## License

[MIT](LICENSE). The action summaries are short paraphrases. Creature data from the System Reference Documents 5.1 and 5.2 is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Wizards of the Coast).
