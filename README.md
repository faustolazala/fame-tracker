# Fame Tracker

A Foundry VTT module for tracking Fame on official D&D 5e character sheets.

Owners and GMs can adjust non-negative Fame. The widget shows the current Fame rank and its Performance bonus: Unknown (+0), Known (+1), Admired (+2), Honored (+3), Revered (+4), or Legend (+5). Clicking the Fame score opens a configurable Performance check, applies the rank bonus, then rolls a d100 and compares the percentile result against the rounded-down average of Performance and Fame.

Performance, Deception, Intimidation, and Persuasion dialogs include an optional **Target is interested in the arena** checkbox. Selecting it applies the character's current Fame-rank bonus to that skill check.

## Installation

In Foundry VTT, open **Add-on Modules**, choose **Install Module**, and paste this manifest URL:

```text
https://github.com/faustolazala/fame-tracker/releases/latest/download/module.json
```

Compatible with Foundry VTT 12–14 and the D&D 5e system.
