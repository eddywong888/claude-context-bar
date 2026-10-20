# context-bar

A Claude Code mod that draws a status bar above the prompt:

- Context gauge (green → red gradient) with a marker where auto-compaction runs
- 5-hour usage dots with a reset countdown and a notice when it resets
- Fable usage gauge (shown when the API reports a Fable window)
- Git branch, uncommitted files, commits ahead/behind
- Working indicator (current tool) and running subagents
- Last turn length and session length
- Hide/Show button for a compact view

## Develop

```bash
claude plugin validate .
claude plugin test .
```

Edits load with `/reload-plugins`.
