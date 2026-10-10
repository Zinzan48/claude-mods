import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { detectLocale } from '../hooks/i18n'

const MINUTE = 60_000

type World = {
  language: string | null
  tokens: number | undefined
  filled: string[]
  box: string
  compactInstructions: string[]
  toasts: string[]
  usedTools: string[]
  statuses: (string | undefined)[]
}

function seat(on: On, world: World) {
  const clock = mock.clock(on, { now: 10_000_000 })
  mock.store(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: world.tokens, window: 1_000_000 }, rateLimits: [] },
  }))
  on('session.id', () => ({ value: 'session-1' }))
  on('settings.read', () => ({ value: world.language === null ? {} : { language: world.language } }))
  on('session.messages', () => ({
    value: [
      {
        role: 'assistant' as const,
        text: '',
        toolUses: world.usedTools.map((tool, index) => ({ tool_use_id: `t${index}`, tool, input: {} })),
      },
    ],
  }))
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', ($, e) => {
    world.filled.push(e.text)
    world.box = e.text
    return { isFilled: true, box: { text: e.text, cursor: e.text.length } }
  })
  on('prompt.read', () => ({ value: { text: world.box, cursor: world.box.length } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('agent.spawn', ($, e) => ({ model: e.model ?? 'parent-model' }))
  // Stands in for the engine's own AbovePrompt, which the mod falls through to with next(e) when it has nothing to show.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  return clock
}

async function completeTurn($: Engine, world: World, tokens: number) {
  world.tokens = tokens
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: `turn-${tokens}`,
    reason: 'answer',
  })
}

async function status($: Engine, args = ''): Promise<string> {
  const { text } = await $.command.run({
    command: 'context-budget',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  return text ?? ''
}

function spawn($: Engine, subagentType: string, model?: string) {
  return $.agent.spawn({
    tool_use_id: `tool-${subagentType}-${model ?? 'none'}`,
    prompt: 'find it',
    description: 'find',
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    model,
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// Records the effort each model request reaches beneath the plugin.
function recordEfforts(on: On): (string | number | undefined)[] {
  const sent: (string | number | undefined)[] = []
  on('turn.step', async function* ($, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  return sent
}

async function step($: Engine, sent: readonly (string | number | undefined)[], agentId: string | undefined, effort: Effort | undefined) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', effort, messageCount: 1, agentId })
  for await (const _ of stream) {
    // drain the stream
  }
  return sent.at(-1)
}

const summary = [{ role: 'assistant' as const, text: 'summary', toolUses: [] }]
const manualCompact = { trigger: 'manual' as const, messages: summary }

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
}

const typed = (text: string) => ({ text, origin: { kind: 'composer' as const }, wait: false })

const newWorld = (language: string | null = 'Chinese (Traditional, Taiwan)'): World => ({
  language,
  tokens: undefined,
  filled: [],
  box: '',
  compactInstructions: [],
  toasts: [],
  usedTools: [],
  statuses: [],
})

describe('register', () => {
  test('reminds at 500k, then again every 150k', async ($, on) => {
    const world = newWorld()
    seat(on, world)

    await completeTurn($, world, 300_000)
    expect(await status($)).toContain('下一個提醒門檻：500k')

    await completeTurn($, world, 520_000)
    expect(await status($)).toContain('下一個提醒門檻：650k')

    await completeTurn($, world, 560_000)
    const between = await status($)
    expect(between).toContain('下一個提醒門檻：650k')
    expect(between.match(/threshold/g)?.length).toBe(1)

    await completeTurn($, world, 660_000)
    const second = await status($)
    expect(second).toContain('下一個提醒門檻：800k')
    expect(second.match(/threshold/g)?.length).toBe(2)
  })

  test('a drop below 60% of the last reading resets the threshold to 500k', async ($, on) => {
    const world = newWorld()
    seat(on, world)

    await completeTurn($, world, 700_000)
    expect(await status($)).toContain('下一個提醒門檻：800k')

    await completeTurn($, world, 150_000)
    expect(await status($)).toContain('下一個提醒門檻：500k')
  })

  test('after a compact, tokensAfter updates the status line and the idle check', async ($, on) => {
    const world = newWorld()
    const clock = seat(on, world)
    on('session.compact', () => ({ messages: summary, tokensBefore: 700_000, tokensAfter: 40_000 }))

    await completeTurn($, world, 700_000)
    expect(world.statuses.at(-1)).toContain('ctx 700k/1000k')

    // usage() reports 700k until the next turn; the status line must not stay there.
    await $.session.compact(manualCompact)
    expect(world.statuses.at(-1)).toContain('ctx 40k/1000k')
    const after = await status($)
    expect(after).toContain('context：40k')
    expect(after).toContain('下一個提醒門檻：500k')

    await clock.advance(90 * MINUTE)
    const sent = await $.prompt.submit(typed('回來繼續'))
    expect(sent.drop).toBeUndefined()
  })

  test('a compact with no size clears the reading and the idle check lets the message through', async ($, on) => {
    const world = newWorld()
    const clock = seat(on, world)
    on('session.compact', () => ({ messages: summary }))

    await completeTurn($, world, 700_000)
    await $.session.compact(manualCompact)
    expect(world.statuses.at(-1)).toContain('下一回合更新')
    expect(await status($)).toContain('尚無讀數')

    await clock.advance(90 * MINUTE)
    const sent = await $.prompt.submit(typed('回來繼續'))
    expect(sent.drop).toBeUndefined()
  })

  test('band Compact fills the default command; the status line updates once the compact runs', async ($, on) => {
    const world = newWorld()
    seat(on, world)
    on('session.compact', ($, e) => {
      world.compactInstructions.push(e.instructions ?? '')
      return { messages: summary, tokensBefore: 520_000, tokensAfter: 30_000 }
    })

    await completeTurn($, world, 520_000)
    const ui = await $.ui.mount({
      plugin: 'context-budget',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })
    expect(await ui.find({ key: 'edit' })).toBeUndefined()
    await ui.press({ key: 'compact' })
    expect(world.box.startsWith('/compact 保留：')).toBe(true)
    expect(world.compactInstructions).toEqual([])

    const command = world.box
    await $.prompt.submit(typed(command))
    world.box = ''
    await $.session.compact({ ...manualCompact, instructions: command.slice('/compact '.length) })
    expect(world.statuses.at(-1)).toContain('ctx 30k/1000k')
    expect(await status($)).toContain('manual, 30k')
  })

  test('after 90 idle minutes at 600k, the first send is held and put back; the second goes through', async ($, on) => {
    const world = newWorld()
    const clock = seat(on, world)

    await completeTurn($, world, 600_000)
    await clock.advance(90 * MINUTE)

    const first = await $.prompt.submit(typed('繼續剛才的修改'))
    expect(first.drop).toContain('閒置 90 分鐘')
    expect(world.filled).toEqual(['繼續剛才的修改'])

    const second = await $.prompt.submit(typed('繼續剛才的修改'))
    expect(second.drop).toBeUndefined()
    expect(second.text).toBe('繼續剛才的修改')
  })

  test('idle band Compact sets the held message aside and restores it after the manual compact', async ($, on) => {
    const world = newWorld()
    const clock = seat(on, world)
    on('session.compact', () => ({ messages: summary, tokensBefore: 600_000, tokensAfter: 40_000 }))

    await completeTurn($, world, 600_000)
    await clock.advance(90 * MINUTE)
    await $.prompt.submit(typed('繼續剛才的修改'))
    expect(world.box).toBe('繼續剛才的修改')

    const ui = await $.ui.mount({
      plugin: 'context-budget',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })
    expect(await ui.find({ key: 'tailor' })).toBeDefined()
    expect(await ui.find({ key: 'edit' })).toBeUndefined()
    await ui.press({ key: 'compact' })
    expect(world.box.startsWith('/compact 保留：')).toBe(true)

    // The user sends /compact: the prompt empties, then the compact runs.
    const command = world.box
    await $.prompt.submit(typed(command))
    world.box = ''
    await $.session.compact({ ...manualCompact, instructions: command.slice('/compact '.length) })
    expect(world.box).toBe('繼續剛才的修改')
  })

  test('sending something else instead of the filled /compact drops the stashed draft', async ($, on) => {
    const world = newWorld()
    seat(on, world)
    on('session.compact', () => ({ messages: summary, tokensBefore: 600_000, tokensAfter: 40_000 }))

    await completeTurn($, world, 520_000)
    world.box = '寫到一半的草稿'
    const ui = await $.ui.mount({
      plugin: 'context-budget',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })
    await ui.press({ key: 'compact' })
    await $.prompt.submit(typed('算了，先做別的'))
    world.box = ''
    await $.session.compact(manualCompact)
    expect(world.box).toBe('')
  })

  test('slash commands, short idles and small contexts are not held', async ($, on) => {
    const world = newWorld()
    const clock = seat(on, world)

    await completeTurn($, world, 600_000)
    await clock.advance(90 * MINUTE)
    const command = await $.prompt.submit(typed('/compact 保留重點'))
    expect(command.drop).toBeUndefined()

    await completeTurn($, world, 600_000)
    await clock.advance(30 * MINUTE)
    const recent = await $.prompt.submit(typed('hello'))
    expect(recent.drop).toBeUndefined()

    await completeTurn($, world, 150_000)
    await clock.advance(90 * MINUTE)
    const small = await $.prompt.submit(typed('hello'))
    expect(small.drop).toBeUndefined()
    expect(world.filled).toEqual([])
  })

  test('the band appears past the threshold, adds browser cleanup after browser tools, and Dismiss hides it', async ($, on) => {
    const world = newWorld()
    world.usedTools.push('mcp__plugin_playwright_playwright__browser_click')
    seat(on, world)
    on('session.compact', ($, e) => {
      world.compactInstructions.push(e.instructions ?? '')
      return { messages: [] }
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = () =>
        $.ui.mount({
          plugin: 'context-budget',
          surface,
          component: 'AbovePrompt',
          props: BAND_PROPS,
        })

      await completeTurn($, world, 300_000)
      expect(await (await band()).find({ key: 'compact' })).toBeUndefined()

      await completeTurn($, world, surface === 'terminal' ? 520_000 : 670_000)
      const ui = await band()
      expect(await ui.find({ key: 'compact' })).toBeDefined()
      world.box = ''
      await ui.press({ key: 'compact' })
      expect(world.box).toContain('只保留可用的 selector')
      expect(world.compactInstructions).toEqual([])

      await completeTurn($, world, surface === 'terminal' ? 680_000 : 830_000)
      const again = await band()
      await again.press({ key: 'dismiss' })
      expect(await (await band()).find({ key: 'compact' })).toBeUndefined()
    }
  })

  test('/context-budget compact and tailor fill the prompt at any context size', async ($, on) => {
    const world = newWorld()
    seat(on, world)
    on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))

    await completeTurn($, world, 120_000)
    expect(await status($, 'compact')).toContain('按 Enter 送出')
    expect(world.box.startsWith('/compact 保留：')).toBe(true)

    world.box = ''
    expect(await status($, ' tailor ')).toContain('按 Enter 送出')
    expect(world.box.startsWith('/compact 保留：')).toBe(true)
    expect(world.toasts.at(-1)).toContain('改填通用指令')

    expect(await status($, 'nope')).toContain('用法')
    expect(await status($)).toContain('下一個提醒門檻：500k')
  })

  test('subagents spawned without a model get their tier: Explore haiku, claude-code-guide sonnet, Plan opus', async ($, on) => {
    const world = newWorld()
    seat(on, world)

    expect((await spawn($, 'Explore')).model).toBe('haiku')
    expect((await spawn($, 'claude-code-guide')).model).toBe('sonnet')
    expect((await spawn($, 'Plan')).model).toBe('opus')
    expect((await spawn($, 'Explore', 'opus')).model).toBe('opus')
    expect((await spawn($, 'general-purpose')).model).toBe('parent-model')
  })

  test('subagent effort below high is raised to high; the main session and higher levels are left alone', async ($, on) => {
    const world = newWorld()
    seat(on, world)
    const sent = recordEfforts(on)

    expect(await step($, sent, 'agent-a', 'medium')).toBe('high')
    expect(await step($, sent, 'agent-b', 'low')).toBe('high')
    expect(await step($, sent, 'agent-c', 'xhigh')).toBe('xhigh')
    expect(await step($, sent, undefined, 'medium')).toBe('medium')
    expect(await step($, sent, 'agent-d', undefined)).toBe(undefined)
    expect(await step($, sent, 'agent-a', 'medium')).toBe('high')

    const report = await status($)
    expect(report).toContain('agent-effort medium -> high (claude-haiku-5-5)')
    expect(report).toContain('agent-effort xhigh (claude-haiku-5-5)')
    expect(report.split('agent-effort').length - 1).toBe(4)
  })

  test(
    'options move the thresholds and the idle check',
    { options: { first_threshold: 100_000, threshold_step: 50_000, idle_minutes: 10, idle_min_tokens: 50_000 } },
    async ($, on) => {
      const world = newWorld()
      const clock = seat(on, world)

      await completeTurn($, world, 120_000)
      expect(await status($)).toContain('下一個提醒門檻：150k')

      await clock.advance(15 * MINUTE)
      const sent = await $.prompt.submit(typed('繼續'))
      expect(sent.drop).toContain('閒置 15 分鐘')
    },
  )

  test(
    'options change the subagent models and the effort floor',
    { options: { explore_model: 'inherit', plan_model: 'sonnet', subagent_effort_floor: 'xhigh' } },
    async ($, on) => {
      const world = newWorld()
      seat(on, world)
      const sent = recordEfforts(on)

      expect((await spawn($, 'Explore')).model).toBe('parent-model')
      expect((await spawn($, 'claude-code-guide')).model).toBe('sonnet')
      expect((await spawn($, 'Plan')).model).toBe('sonnet')

      expect(await step($, sent, 'agent-a', 'high')).toBe('xhigh')
      expect(await step($, sent, 'agent-b', 'max')).toBe('max')
    },
  )

  test('effort floor off leaves subagents alone', { options: { subagent_effort_floor: 'off' } }, async ($, on) => {
    const world = newWorld()
    seat(on, world)
    const sent = recordEfforts(on)

    expect(await step($, sent, 'agent-a', 'low')).toBe('low')
    expect(await status($)).toContain('agent-effort low (claude-haiku-5-5)')
  })

  test('detectLocale reads Chinese out of the free-form language setting', () => {
    for (const language of ['Chinese (Traditional, Taiwan)', 'chinese', 'zh-TW', 'zh', '中文', '繁體中文']) {
      expect(detectLocale(language)).toBe('zh-TW')
    }
    for (const language of ['japanese', 'English', 'french', '', undefined, 42]) {
      expect(detectLocale(language)).toBe('en')
    }
  })

  test('without a Chinese language setting everything is in English', async ($, on) => {
    const world = newWorld(null)
    const clock = seat(on, world)

    await completeTurn($, world, 520_000)
    expect(world.toasts.at(-1)).toBe('Context is at 520k. Use the buttons above the prompt to compact.')
    const report = await status($)
    expect(report).toContain('context: 520k / 1000k')
    expect(report).toContain('next reminder at: 650k')

    const ui = await $.ui.mount({ plugin: 'context-budget', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'compact' })
    expect(world.box.startsWith('/compact Keep: the current task goal')).toBe(true)
    expect(await status($, 'nope')).toBe('Usage: /context-budget [compact|tailor]')

    world.box = ''
    await clock.advance(90 * MINUTE)
    const sent = await $.prompt.submit(typed('carry on'))
    expect(sent.drop).toContain('Idle 90 min with about 520k of context')
  })

  test('the language option overrides the setting', { options: { language: 'en' } }, async ($, on) => {
    const world = newWorld()
    seat(on, world)

    expect(await status($)).toContain('next reminder at: 500k')
  })

  test('language zh-TW wins over an English setting', { options: { language: 'zh-TW' } }, async ($, on) => {
    const world = newWorld('english')
    seat(on, world)

    expect(await status($)).toContain('下一個提醒門檻：500k')
  })
})
