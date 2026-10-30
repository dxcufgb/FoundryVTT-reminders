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

Requirements and the first start: see [Installation](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Installation) in the wiki.

## Documentation

The full guide is in the [wiki](https://github.com/dxcufgb/FoundryVTT-reminders/wiki):

- [Reminder Cards](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Reminder-Cards): legendary, villain, lair and legendary resistance cards in combat.
- [The Reminder List](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/The-Reminder-List): what counts, and adding, removing and overriding actions.
- [Settings](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Settings): every option.
- [Rules Notes](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Rules-Notes): 2014 and 2024 rules.
- [API](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/API): for macros and other modules.
- [Troubleshooting](https://github.com/dxcufgb/FoundryVTT-reminders/wiki/Troubleshooting): common problems.

## License

[MIT](LICENSE). The action summaries are short paraphrases. Creature data from the System Reference Documents 5.1 and 5.2 is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Wizards of the Coast).

## Releasing

For the maintainer: **Actions → Release module → Run workflow**, type the version (for example `1.2.3`) and run it. The module is checked and packaged first; only then is the release `v1.2.3` published with `module.json` and `module.zip`. CI and releases come from [dxcufgb/foundry-module-ci](https://github.com/dxcufgb/foundry-module-ci), the same for every module.
