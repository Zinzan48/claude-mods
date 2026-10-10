# claude-mods

[繁體中文](README.zh-TW.md)

Mods for [Claude Code](https://claude.com/claude-code). This repository is a plugin marketplace named `zinzan-mods`, and it currently holds one mod, context-budget.

## context-budget

Long Claude Code sessions get expensive in two ways. The context keeps growing until you remember to compact it, and when you come back after a break, the prompt cache has expired and your first message sends the whole context again. context-budget watches for both. It also picks models for a few subagent types and sets a minimum effort for subagents.

### What it does

#### Compact reminders

When the context passes 500k tokens, a toast appears and a band shows up above the prompt. It reminds you again every 150k tokens after that. The band has three buttons:

- Compact puts `/compact` with a default set of keep/drop instructions in the prompt. Nothing runs until you press Enter, so you can edit the instructions first.
- Tailored asks the model to write instructions for this particular conversation and puts those in the prompt instead.
- Dismiss hides the band until the next reminder.

If the session used Playwright or Chrome DevTools tools, the default instructions also say to drop snapshots, console logs and screenshots. If you already had a draft in the prompt, it is set aside and comes back after the compact.

The status line shows the current context and a sparkline of the last 12 readings, for example `ctx 520k/1000k ▂▃▄▅`.

#### Idle check

If you have been away for 60 minutes or more and the context is at least 200k tokens, the first message you send is held and put back in the prompt. The band then offers Compact, Tailored, Clear or Dismiss. Press Enter again to send the message as it is. Each session is held once per idle stretch.

#### Subagent models

When Claude spawns one of these subagents without naming a model, the mod picks one:

| Subagent | Model |
| --- | --- |
| Explore | haiku |
| claude-code-guide | sonnet |
| Plan | opus |

An explicit model in the Agent call always wins, and other subagent types are not touched.

#### Subagent effort floor

Subagents that would run at `low` or `medium` effort run at `high` instead. On the 5.5 models, subagents do not pick up the top-level `effortLevel` setting, so without this they run at the model's default of `medium`. The main session's effort is never changed.

### Install

Run this at the prompt of a Claude Code terminal session:

```
/plugin install context-budget --marketplace Zinzan48/claude-mods
```

Answer `y` to add the marketplace, pick a scope (user scope loads it in every session), and set the options or keep the defaults. The mod is active right away.

### Commands

| Command | What it does |
| --- | --- |
| `/context-budget` | Shows the current reading, the next reminder threshold and the last 15 events. |
| `/context-budget compact` | Puts `/compact` with the default instructions in the prompt, at any context size. |
| `/context-budget tailor` | Puts `/compact` with tailored instructions in the prompt. |

### Configuration

Change options in `/config`, or from a shell with `claude plugin configure context-budget@zinzan-mods`. The defaults match the behavior described above.

| Option | Default | Notes |
| --- | --- | --- |
| `language` | `auto` | `auto`, `en` or `zh-TW`. `auto` reads the `language` setting in settings.json and uses zh-TW when it names Chinese, English otherwise. |
| `first_threshold` | `500000` | Tokens before the first reminder. On a 200k context window, set this below 200000. |
| `threshold_step` | `150000` | Tokens between later reminders. |
| `idle_minutes` | `60` | Idle time before the next message is held. |
| `idle_min_tokens` | `200000` | Contexts smaller than this are never held. |
| `explore_model` | `haiku` | `inherit`, `haiku`, `sonnet` or `opus`. `inherit` leaves the choice to Claude Code. |
| `guide_model` | `sonnet` | Same choices, for claude-code-guide. |
| `plan_model` | `opus` | Same choices, for Plan. |
| `subagent_effort_floor` | `high` | `off`, `medium`, `high`, `xhigh` or `max`. |

### What it stores

The mod keeps an event log (the last 200 entries) and the time and size of each session's last turn in Claude Code's plugin store on your machine. Nothing is sent anywhere. The Tailored button is the one feature that calls the model, and it runs inside your session like any other request.

### Requirements

Claude Code 2.1.287 or later in the terminal, or 2.1.286 or later in the Code tab of the Desktop app. Those are the versions where mods are on by default. The mod is tested on 2.1.296.

The band above the prompt appears in the terminal and in the Desktop app. The VS Code extension's chat panel and `claude -p` draw nothing, but the idle check, the subagent models and the effort floor still apply there.

Claude Code's own type declarations for mods say the API may change between releases, so a Claude Code update can break the mod before a fix lands here.

### Uninstall

```
claude plugin uninstall context-budget@zinzan-mods
```

## License

[MIT](LICENSE)
