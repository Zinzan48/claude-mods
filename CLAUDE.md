# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A Claude Code plugin marketplace (`.claude-plugin/marketplace.json`, name `zinzan-mods`) holding one mod, `context-budget/`. A mod is a plugin whose behavior lives in a function-hooks module (`hooks/hooks.json` points at `hooks/register.tsx`) that runs inside Claude Code, not as a shell hook. The mod API is early access: when in doubt, the engine's type declarations are the reference, not memory.

User-facing docs are `README.md` (English) and `README.zh-TW.md`. Keep them in sync.

## Commands

All run from the repository root. There is no package.json; the `claude` CLI does everything.

```sh
claude plugin validate context-budget   # manifest, userConfig schema, hooks, $.state contract
claude plugin validate .                # marketplace.json
claude plugin test context-budget       # runs every *.test.ts / *.test.tsx under the folder
```

`claude plugin test` takes a folder and has no filter, so there is no way to run a single test case. To isolate one, copy the mod to a scratch folder with a test file that holds only that case.

Type checking needs the engine's declarations. `context-budget/tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes (gitignored) when it loads the mod from a `--plugin-dir` folder in an interactive session. Without that folder, `tsc -p context-budget` fails (it has `noEmit`, so it writes nothing). The reliable route is a tsconfig outside the repo that includes the declaration file the `plugin-authoring` skill writes (`<skill dir>/types/claude-code.d.ts`):

```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": ["<path to>/claude-code.d.ts", "<repo>/context-budget/hooks", "<repo>/context-budget/types", "<repo>/context-budget/tests"]
}
```

Editor/LSP diagnostics on these files are mostly noise (missing `claude-code` module, ES5 lib errors) because the editor does not see the engine types. Trust `tsc` with the config above.

Trying a change in a live session: when this folder is added as a directory marketplace (`claude plugin marketplace add <repo>`), Claude Code reads the mod from the folder itself, so `/reload-plugins` picks up edits without a version bump. Installs from GitHub run the copy made at install time and change only through `claude plugin update`, so bump `version` in `context-budget/.claude-plugin/plugin.json` for each release.

## Architecture

Everything is in `context-budget/hooks/register.tsx`, plus `hooks/i18n.ts` for strings and `types/index.d.ts` for the `$.state` contract.

`register(on, options)` turns the userConfig values into a module-level `config` (`readConfig`, falling back to defaults on anything malformed), then registers these hooks:

- `turn.complete` (main session only, `e.agentId === undefined`): `takeReading` stores the context size in the `reading`/`history` atoms and in `$.store` as `last:<sessionId>`. A drop below 60% of the previous reading means a compact or clear happened and resets the threshold. Crossing `nextThreshold` sets the `alert` atom and toasts.
- `ui.render` on `AbovePrompt`: draws the band from `alert` (threshold or idle kind). The Compact and Tailored buttons call `fillCompact`, which puts `/compact <instructions>` into the prompt and stashes any existing draft in `stashedDraft`. The mod never compacts on its own.
- `prompt.submit`: the idle check. It only considers messages typed in the composer while no turn is running, skips slash commands and attachments, and compares against `last:<sessionId>`. When it holds a message it returns `{ drop }`, refills the prompt, and writes `ack:<sessionId>` so the same idle stretch is only held once.
- `session.compact`: after `next(e)`, ignores skipped, `precompute` and subagent compactions, resets the budget, records `tokensAfter` as the new reading, and after a manual compact restores the stashed draft.
- `agent.spawn`: sets `model` from `config.agentModels` when the call names none (forks are left alone).
- `turn.step` (streaming hook, `async function*`): raises subagent effort to `config.effortFloor`; logs only each agent's first step (module-level `seenAgents`).
- `command.run` for `/context-budget`: report, or `compact` / `tailor` to fill the prompt.

State lives in two places. `$.state` atoms are per session and declared in `types/index.d.ts`; `claude plugin validate` checks every key the module touches against that file. `$.store` persists across sessions and holds `log` (capped at 200), `last:*` and `ack:*` (pruned to 100 keys at `session.start`).

## Gotchas found the hard way

- A mod's own `$.session.compact()` call does not go through the `session.compact` hook. That is why the buttons fill `/compact` into the prompt for the user to send instead of compacting directly.
- `$.session.usage().context.tokens` is the input size of the previous response, so it still shows the pre-compact size until the next turn. Use `tokensAfter` from the compact result.
- `classic.UserPromptSubmit` is not delivered to mods (seen on 2.1.288), so a mod cannot filter what settings-file `UserPromptSubmit` hooks receive.
- userConfig fields are strict objects: an unknown key makes the plugin fail to load. Keep the defaults in `plugin.json` and in `readConfig` identical.
- `claude plugin validate` lists `session.compact`, `prompt.submit` and `agent.spawn` as gating hooks without `.catch`. That is informational: if one throws it is skipped and the engine's behavior continues.

## Strings and languages

Every user-facing string goes through `strings($)` and is defined in both locales in `hooks/i18n.ts`; the `Messages` type makes a missing translation a type error. `strings($)` resolves the locale once per session and caches it in the `locale` atom, keyed by the `language` option so a config change takes effect. `detectLocale` maps the free-form `language` setting to `zh-TW` or `en`. Log `kind` values and the `ctx 520k/1000k` status format are not translated.

## Tests

`tests/register.test.tsx` uses the kit from `claude-code/testing`. Hooks registered with `on` inside a test sit beneath the plugin and stand in for the engine; `seat()` stubs the clock, store, usage, session id, `settings.read`, prompt and UI. Things that are easy to trip on:

- The test `$` has no `settings` noun. Stub it with `on('settings.read', () => ({ value: {...} }))`.
- `seat()` answers `settings.read` with a Chinese `language` by default, so most tests assert zh-TW strings. Use `newWorld(null)` for "no language setting"; `newWorld(undefined)` silently falls back to the default parameter.
- `test(name, { options }, body)` sets userConfig values for that test.
- UI tests mount the band with `$.ui.mount({ plugin, surface, component: 'AbovePrompt', props: BAND_PROPS })` and act on buttons by `key`; cover `terminal` and `desktop`.
