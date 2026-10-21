# Claude Context Bar

A status bar for Claude Code that sits above the prompt. It shows how full the context window is, how much of your 5-hour usage is gone and when it resets, the git branch, and how long the last turn and the session have run.

![The bar in the ember skin](media/bar-ember.png)

Click either percentage to open a panel with the details and controls.

## Install

In Claude Code, run these three commands:

```
/plugin marketplace add eddywong888/claude-context-bar
/plugin install context-bar@claude-context-bar
/reload-plugins
```

The bar appears after the reload. If it doesn't show up, restart Claude Code.

A mod is code that runs inside Claude Code on your machine, with the same access Claude Code has. Read the source in `hooks/` before installing, as you would with any package.

To update later:

```
/plugin marketplace update claude-context-bar
/plugin update context-bar@claude-context-bar
/reload-plugins
```

## The bar

| Part | What it means |
|---|---|
| **Context** gauge | How full the context window is, in a gradient from calm to full. The thin line marks 75%. The figure after it is the percent used, then tokens used out of the window, then how much the last turn added. |
| ⚠ auto-compact | Shows once the context is 85% of the way to the point where Claude Code compacts on its own. A **Compact** button appears from 70%. |
| **5h** dots | Your 5-hour usage: five dots, one per 20%. The ↻ countdown is the time until it resets, blue at first and amber, then red, as the limit nears. A notice shows when it resets. |
| **Fable** gauge | Shown only when Claude Code reports a Fable usage window. |
| ⎇ branch | The git branch, ✎ uncommitted files, ↑↓ commits ahead and behind. |
| **L** and **Age** | How long the last turn took, and how long the session has been open (days past 24 hours, e.g. `1d12h44m`). |
| ▶ working | The tool Claude is running now, and any subagents. |
| **Hide** | Folds the bar into small gauges. **Show** brings it back. |

## The panels

**Context** (click the context %) breaks down what fills the window: system prompt, tools, memory files, skills and messages, with the room left and what loads only when needed. It also shows the model, the auto-compact point, roughly how many turns are left before it, what the session has cost and how many tools ran. Buttons: Refresh, Compact now, Early compact at 90% (compacts just before Claude Code would) and Copy figures.

![The Context panel](media/context-panel.png)

**Usage** (click the 5h %) shows each usage window with its reset time and, after a few minutes of readings, when you'd hit the limit at the recent pace. Buttons: Refresh, Sound (a short bell when Claude finishes a reply), Hide the bar and Clear chat. Below them is the skin picker.

![The Usage panel with the skin picker](media/usage-panel.png)

The Fable weekly limit isn't reported to mods, so the panel points to Settings → Usage for it.

## Skins

Ten skins change the gauges' colours and glyphs, the bar and panel backgrounds, the text colours, the panel border and the labels: meadow (the default, in the app's own look), ocean, ember, hermes, mono, retro, cyberpunk, latte, blueprint and sumi. Pick one in the Usage panel; the choice is remembered across sessions.

![The bar in the blueprint skin](media/bar-blueprint.png)

Mods can't change the font, and the app draws its own buttons, so dark skins put the buttons on a light strip to keep them readable.

## Commands

| Command | What it does |
|---|---|
| `/contextbar` | Shows the current settings |
| `/contextbar show` / `hide` | Shows or folds the bar |
| `/contextbar sound on` / `off` | Turns the reply bell on or off |
| `/contextbar early on` / `off` | Turns early compaction on or off |
| `/contextbar theme <name>` | Picks a skin; with no name, lists them |

## Develop

```bash
claude plugin validate .
claude plugin test .
```

Edits load with `/reload-plugins`. The bell is `sounds/done.wav`, an original sound from [claude-castle-mod](https://github.com/eddywong888/claude-castle-mod).

## License

[MIT](LICENSE)
