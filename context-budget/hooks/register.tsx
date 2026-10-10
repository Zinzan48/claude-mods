import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { LastActivity, LogEntry } from '../types'
import { MESSAGES, detectLocale } from './i18n'
import type { Locale, Messages } from './i18n'

type Engine = EngineInterface
type Model = 'haiku' | 'sonnet' | 'opus'
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Language = 'auto' | Locale

type Config = {
  language: Language
  firstThreshold: number
  thresholdStep: number
  idleMs: number
  idleMinTokens: number
  agentModels: Readonly<Record<string, Model>>
  effortFloor: Effort | undefined
}

const LANGUAGES: readonly Language[] = ['auto', 'en', 'zh-TW']
const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// [subagent type, userConfig key, default model]
const AGENT_MODEL_OPTIONS = [
  ['Explore', 'explore_model', 'haiku'],
  ['claude-code-guide', 'guide_model', 'sonnet'],
  ['Plan', 'plan_model', 'opus'],
] as const
// A drop below 60% of the previous reading means the session was compacted or cleared.
const RESET_RATIO = 0.6
const HISTORY_LENGTH = 12
const LOG_LIMIT = 200
const SESSION_KEYS_LIMIT = 100
const SEEN_AGENTS_LIMIT = 200
const seenAgents = new Set<string>()
const BROWSER_TOOL = /playwright|chrome-devtools/i
const BARS = '▁▂▃▄▅▆▇█'

const reading = atom({ plugin: 'context-budget', key: 'reading' } as const, null)
const history = atom({ plugin: 'context-budget', key: 'history' } as const, [])
const alert = atom({ plugin: 'context-budget', key: 'alert' } as const, null)
const nextThreshold = atom({ plugin: 'context-budget', key: 'nextThreshold' } as const, null)
const stashedDraft = atom({ plugin: 'context-budget', key: 'stashedDraft' } as const, null)
const localeChoice = atom({ plugin: 'context-budget', key: 'locale' } as const, null)

function numberOption(value: unknown, fallback: number, min: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback
}

function choiceOption<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  return choices.find(choice => choice === value)
}

function readConfig(options: PluginOptions): Config {
  const agentModels: Record<string, Model> = {}
  for (const [subagentType, key, fallback] of AGENT_MODEL_OPTIONS) {
    const model = options[key] === 'inherit' ? undefined : (choiceOption(options[key], MODELS) ?? fallback)
    if (model !== undefined) {
      agentModels[subagentType] = model
    }
  }
  const floor = options.subagent_effort_floor
  return {
    language: choiceOption(options.language, LANGUAGES) ?? 'auto',
    firstThreshold: numberOption(options.first_threshold, 500_000, 50_000),
    thresholdStep: numberOption(options.threshold_step, 150_000, 10_000),
    idleMs: numberOption(options.idle_minutes, 60, 1) * 60_000,
    idleMinTokens: numberOption(options.idle_min_tokens, 200_000, 0),
    agentModels,
    effortFloor: floor === 'off' ? undefined : (choiceOption(floor, EFFORTS) ?? 'high'),
  }
}

let config = readConfig({})

async function strings($: Engine): Promise<Messages> {
  const cached = await read($, localeChoice)
  if (cached !== null && cached.language === config.language) {
    return MESSAGES[cached.locale]
  }
  const locale = config.language === 'auto' ? detectLocale((await $.settings.read()).language) : config.language
  await update($, localeChoice, () => ({ language: config.language, locale }))
  return MESSAGES[locale]
}

function firstThreshold(stored: number | null): number {
  return stored ?? config.firstThreshold
}

// The top-level effortLevel setting does not reach 5.5-generation subagents, so they run at the model's default (medium).
function raisedEffort(effort: string | number | undefined): Effort | undefined {
  const floor = config.effortFloor
  const level = EFFORTS.findIndex(candidate => candidate === effort)
  if (floor === undefined || level === -1) {
    return undefined
  }
  return level < EFFORTS.indexOf(floor) ? floor : undefined
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`

function spark(values: readonly number[], window: number): string {
  return values
    .map(value => BARS[Math.min(BARS.length - 1, Math.floor((value / window) * BARS.length))])
    .join('')
}

async function log($: Engine, kind: string, detail: string) {
  const entries = ((await $.store.get('log')) as LogEntry[] | undefined) ?? []
  const at = await $.clock.now()
  await $.store.set('log', [...entries, { at, kind, detail }].slice(-LOG_LIMIT))
}

async function pruneStore($: Engine) {
  const keys = await $.store.keys()
  const sessionKeys = keys.filter(key => key.startsWith('last:') || key.startsWith('ack:'))
  const excess = sessionKeys.length - SESSION_KEYS_LIMIT
  for (const key of sessionKeys.slice(0, Math.max(0, excess))) {
    await $.store.delete(key)
  }
}

async function instructions($: Engine): Promise<string> {
  const t = await strings($)
  const messages = await $.session.messages()
  const usedBrowser = messages.some(message =>
    message.toolUses.some(use => BROWSER_TOOL.test(use.tool)),
  )
  return usedBrowser ? `${t.baseInstructions} ${t.browserInstructions}` : t.baseInstructions
}

async function showStatus($: Engine) {
  const current = await read($, reading)
  if (current === null) {
    $.ui.status(undefined)
    return
  }
  const values = await read($, history)
  $.ui.status(`ctx ${k(current.tokens)}/${k(current.window)} ${spark(values, current.window)}`)
}

async function resetBudget($: Engine) {
  await update($, nextThreshold, () => null)
  await update($, alert, () => null)
}

// A draft in the prompt (such as the message the idle check put back) is stashed and restored after the manual compact.
async function fillCompact($: Engine, text: string): Promise<boolean> {
  const draft = (await $.prompt.read()).text
  const isDraft = draft.trim() !== '' && !draft.trimStart().startsWith('/compact')
  const filled = await $.prompt.fill({ text: `/compact ${text}` })
  if (filled.isFilled && isDraft) {
    await update($, stashedDraft, () => draft)
    $.ui.toast((await strings($)).draftStashed)
  }
  return filled.isFilled
}

async function restoreDraft($: Engine) {
  const draft = await read($, stashedDraft)
  if (draft === null) {
    return
  }
  await update($, stashedDraft, () => null)
  if ((await $.prompt.read()).text.trim() === '') {
    await $.prompt.fill({ text: draft })
  }
}

async function fillTailored($: Engine): Promise<boolean> {
  const t = await strings($)
  $.ui.toast(t.tailoring)
  const reply = await $.model.fork({ prompt: t.forkPrompt })
  if (!reply.isAnswered) {
    $.ui.toast(t.tailorFailed(reply.reason))
    await log($, 'fork-failed', reply.reason)
    return fillCompact($, await instructions($))
  }
  await log($, 'fork', 'tailored instructions filled')
  return fillCompact($, reply.text.replace(/\s+/g, ' ').trim())
}

// usage().context.tokens is the input of the previous response and changes only on the next turn,
// so the reading after a compact comes from its tokensAfter.
async function recordCompaction($: Engine, tokensAfter: number | undefined) {
  const id = await $.session.id()
  if (tokensAfter === undefined) {
    // With no new size, drop the old reading so the idle check never uses the pre-compact size.
    await $.store.delete(`last:${id}`)
    await update($, reading, () => null)
    $.ui.status((await strings($)).compactedStatus)
    return
  }
  const now = await $.clock.now()
  const last: LastActivity = { at: now, tokens: tokensAfter }
  await $.store.set(`last:${id}`, last)
  const window = (await $.session.usage()).context.window
  await update($, reading, () => ({ tokens: tokensAfter, window, at: now }))
  await update($, history, values => [...values, tokensAfter].slice(-HISTORY_LENGTH))
  await showStatus($)
}

async function takeReading($: Engine) {
  const usage = await $.session.usage()
  const tokens = usage.context.tokens
  if (tokens === undefined) {
    return
  }
  const now = await $.clock.now()
  const previous = await read($, reading)
  const last: LastActivity = { at: now, tokens }
  await $.store.set(`last:${await $.session.id()}`, last)
  await update($, reading, () => ({ tokens, window: usage.context.window, at: now }))
  await update($, history, values => [...values, tokens].slice(-HISTORY_LENGTH))

  if (previous !== null && tokens < previous.tokens * RESET_RATIO) {
    await resetBudget($)
  }

  const threshold = firstThreshold(await read($, nextThreshold))
  if (tokens >= threshold) {
    let next = threshold
    while (next <= tokens) {
      next += config.thresholdStep
    }
    await update($, nextThreshold, () => next)
    await update($, alert, () => ({ kind: 'threshold' as const, tokens }))
    $.ui.toast((await strings($)).thresholdToast(k(tokens)))
    await log($, 'threshold', `${k(tokens)}, next ${k(next)}`)
  }
  await showStatus($)
}

export const register: Register = (on, options) => {
  config = readConfig(options)

  on('session.start', async ($, e, next) => {
    // Pick up a language setting that changed since the last session.
    await update($, localeChoice, () => null)
    await $.command.register({
      name: 'context-budget',
      description: (await strings($)).commandDescription,
      argumentHint: '[compact|tailor]',
    })
    await pruneStore($)
    await showStatus($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await takeReading($)
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    // precompute only prepares a summary and keeps the conversation; a subagent's compact leaves the main session alone.
    const isSkipped = 'skip' in result && typeof result.skip === 'string'
    if (isSkipped || e.trigger === 'precompute' || e.agentId !== undefined) {
      return result
    }
    const tokensAfter = 'tokensAfter' in result ? result.tokensAfter : undefined
    await resetBudget($)
    await recordCompaction($, tokensAfter)
    await log($, 'compacted', `${e.trigger}, ${tokensAfter === undefined ? 'size unknown' : k(tokensAfter)}`)
    if (e.trigger === 'manual') {
      await restoreDraft($)
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // Sending anything other than /compact abandons the filled command, so the stashed draft is dropped.
    if (e.origin.kind === 'composer' && !e.text.trimStart().startsWith('/compact')) {
      await update($, stashedDraft, () => null)
    }
    const isTypedWhileIdle = e.origin.kind === 'composer' && e.turnId === undefined
    const isCommand = e.text.trimStart().startsWith('/')
    const hasAttachments = (e.attachments?.length ?? 0) > 0
    if (!isTypedWhileIdle || isCommand || hasAttachments) {
      return next(e)
    }

    const id = await $.session.id()
    const last = (await $.store.get(`last:${id}`)) as LastActivity | undefined
    if (last === undefined) {
      return next(e)
    }
    const idleMs = (await $.clock.now()) - last.at
    // usage() still reports the old size after a compact; `last` is updated by the compact.
    const tokens = last.tokens
    const isAcknowledged = (await $.store.get(`ack:${id}`)) === last.at
    if (idleMs < config.idleMs || tokens < config.idleMinTokens || isAcknowledged) {
      return next(e)
    }

    const minutes = Math.round(idleMs / 60_000)
    await $.store.set(`ack:${id}`, last.at)
    await update($, alert, () => ({ kind: 'idle' as const, tokens, minutes }))
    await $.prompt.fill({ text: e.text })
    await log($, 'idle-drop', `${minutes}m, ${k(tokens)}`)
    return { drop: (await strings($)).idleDrop(minutes, k(tokens), k(tokens * 2)) }
  })

  on('agent.spawn', async ($, e, next) => {
    const model = config.agentModels[e.subagentType]
    if (e.fork || e.model !== undefined || model === undefined) {
      return next(e)
    }
    await log($, 'agent-model', `${e.subagentType} -> ${model}`)
    return next({ ...e, model })
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      return yield* next(e)
    }
    const raised = raisedEffort(e.effort)
    // Log only each subagent's first step, to show which effort it started with.
    if (!seenAgents.has(e.agentId)) {
      if (seenAgents.size >= SEEN_AGENTS_LIMIT) {
        seenAgents.clear()
      }
      seenAgents.add(e.agentId)
      const after = raised === undefined ? '' : ` -> ${raised}`
      await log($, 'agent-effort', `${e.effort ?? 'unset'}${after} (${e.model})`)
    }
    return yield* next(raised === undefined ? e : { ...e, effort: raised })
  })

  on('command.run', { command: 'context-budget' }, async ($, e) => {
    const t = await strings($)
    const action = e.args.trim()
    if (action === 'compact' || action === 'tailor') {
      const isFilled = action === 'compact' ? await fillCompact($, await instructions($)) : await fillTailored($)
      await log($, 'command', action)
      return { text: isFilled ? t.filled : t.fillFailed }
    }
    if (action !== '') {
      return { text: t.usage }
    }
    const current = await read($, reading)
    const threshold = firstThreshold(await read($, nextThreshold))
    const entries = (((await $.store.get('log')) as LogEntry[] | undefined) ?? []).slice(-15)
    const now = await $.clock.now()
    const lines = [
      current === null ? t.noReading : t.context(k(current.tokens), k(current.window)),
      t.nextThreshold(k(threshold)),
      t.manualCompact,
      t.recentEvents,
      ...(entries.length === 0
        ? [t.none]
        : entries.map(entry => t.logLine(Math.round((now - entry.at) / 60_000), entry.kind, entry.detail))),
    ]
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const active = await read($, alert)
    if (active === null || e.props.hasSurvey) {
      return next(e)
    }
    const t = await strings($)
    const { Box, Button, Text } = $.ui.resolve(e)
    const dismiss = () => update($, alert, () => null)
    const isIdle = active.kind === 'idle'
    const message = isIdle ? t.idleBand(active.minutes, k(active.tokens)) : t.thresholdBand(k(active.tokens))
    const buttons = [
      <Button
        key="compact"
        label={t.compactLabel}
        variant="primary"
        onPress={async () => {
          await fillCompact($, await instructions($))
        }}
      />,
      <Button key="tailor" label={t.tailorLabel} onPress={() => fillTailored($)} />,
      ...(isIdle
        ? [
            <Button
              key="clear"
              label={t.clearLabel}
              onPress={async () => {
                await $.command.run({ command: 'clear' })
                await dismiss()
              }}
            />,
          ]
        : []),
      <Button key="dismiss" label={t.dismissLabel} role="dismiss" onPress={dismiss} />,
    ]

    return (
      <Box flexDirection="column">
        <Text color="yellow" wrap="truncate-end">
          {message}
        </Text>
        <Box gap={1}>{buttons}</Box>
      </Box>
    )
  })
}
