/** The context reading taken when the main loop's last turn ended. */
export type Reading = { tokens: number; window: number; at: number }

/** The reminder the band above the prompt shows; null hides it. */
export type Alert =
  | { kind: 'threshold'; tokens: number }
  | { kind: 'idle'; tokens: number; minutes: number }

/** Last activity per session in $.store, under `last:<sessionId>`. */
export type LastActivity = { at: number; tokens: number }

/** The event log in $.store, under `log`. */
export type LogEntry = { at: number; kind: string; detail: string }

declare module 'claude-code' {
  interface PluginState {
    'context-budget': {
      reading: Reading | null
      history: number[]
      alert: Alert | null
      /** Token count that triggers the next reminder; null means the configured first threshold. */
      nextThreshold: number | null
      /** The prompt draft set aside when `/compact` was filled in, restored after the manual compact; null when there is none. */
      stashedDraft: string | null
      /** The interface language resolved for the `language` option it was resolved under; null until first use. */
      locale: { language: 'auto' | 'en' | 'zh-TW'; locale: 'en' | 'zh-TW' } | null
    }
  }
}
