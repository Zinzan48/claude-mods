export type Locale = 'en' | 'zh-TW'

export type Messages = {
  commandDescription: string
  usage: string
  filled: string
  fillFailed: string
  noReading: string
  context: (tokens: string, window: string) => string
  nextThreshold: (tokens: string) => string
  manualCompact: string
  recentEvents: string
  none: string
  logLine: (minutes: number, kind: string, detail: string) => string
  thresholdToast: (tokens: string) => string
  draftStashed: string
  tailoring: string
  tailorFailed: (reason: string) => string
  compactedStatus: string
  idleDrop: (minutes: number, tokens: string, rewrite: string) => string
  idleBand: (minutes: number, tokens: string) => string
  thresholdBand: (tokens: string) => string
  compactLabel: string
  tailorLabel: string
  clearLabel: string
  dismissLabel: string
  baseInstructions: string
  browserInstructions: string
  forkPrompt: string
}

// Matches the free-form `language` setting ("Chinese (Traditional, Taiwan)", "zh-TW", "中文", ...).
const CHINESE = /chinese|mandarin|cantonese|taiwan|hong kong|\bzh\b|中文|漢語|汉语|國語|国语|繁體|简体/i

export function detectLocale(language: unknown): Locale {
  return typeof language === 'string' && CHINESE.test(language) ? 'zh-TW' : 'en'
}

export const MESSAGES: Readonly<Record<Locale, Messages>> = {
  en: {
    commandDescription: 'Show context-budget readings and log; add compact or tailor to put a /compact command in the prompt',
    usage: 'Usage: /context-budget [compact|tailor]',
    filled: '/compact is in the prompt. Review it and press Enter to send.',
    fillFailed: 'Could not fill the prompt (a dialog may be open). Try again in a moment.',
    noReading: 'context: no reading yet (waiting for the first turn to finish)',
    context: (tokens, window) => `context: ${tokens} / ${window}`,
    nextThreshold: tokens => `next reminder at: ${tokens}`,
    manualCompact: 'manual compact: /context-budget compact (default instructions) | /context-budget tailor (tailored instructions)',
    recentEvents: 'recent events:',
    none: '(none)',
    logLine: (minutes, kind, detail) => `- ${minutes} min ago ${kind} ${detail}`,
    thresholdToast: tokens => `Context is at ${tokens}. Use the buttons above the prompt to compact.`,
    draftStashed: 'Your draft is set aside and goes back in the prompt after the compact.',
    tailoring: 'Writing compact instructions for this conversation…',
    tailorFailed: reason => `Could not write tailored instructions (${reason}), so the default ones are in the prompt.`,
    compactedStatus: 'ctx compacted, updates next turn',
    idleDrop: (minutes, tokens, rewrite) =>
      `Idle ${minutes} min with about ${tokens} of context. The prompt cache has expired, so sending now writes the whole context again (about ${rewrite} of input). Your message is back in the prompt: press Enter to send it anyway, or use Compact, Tailored or Clear above the prompt first.`,
    idleBand: (minutes, tokens) => `☂ Idle ${minutes} min, context ${tokens}: your message is back in the prompt, press Enter to send it`,
    thresholdBand: tokens => `↯ context ${tokens}, consider compacting`,
    compactLabel: 'Compact',
    tailorLabel: 'Tailored',
    clearLabel: 'Clear',
    dismissLabel: 'Dismiss',
    baseInstructions:
      'Keep: the current task goal, what is done and what is left, important decisions and why, relevant file paths and commands. Drop: details of errors already fixed, long tool output.',
    browserInstructions:
      'Browser: drop snapshots, console logs, screenshots and DOM details. Keep only selectors that work, verification results and code logic still to handle.',
    forkPrompt:
      'Write keep-instructions for the next /compact: English, one line, at most 60 words, no preamble. List what the rest of the work has to keep (task goal, open items, decisions, file paths) and the noise that can go. Output only the instructions.',
  },
  'zh-TW': {
    commandDescription: '顯示 context-budget 的讀數與紀錄；加 compact／tailor 把 /compact 指令帶進輸入框',
    usage: '用法：/context-budget [compact|tailor]',
    filled: '已把 /compact 指令放進輸入框，確認後按 Enter 送出',
    fillFailed: '輸入框目前無法填入（可能有對話框開著），稍後再試',
    noReading: 'context：尚無讀數（等第一個回合結束）',
    context: (tokens, window) => `context：${tokens} / ${window}`,
    nextThreshold: tokens => `下一個提醒門檻：${tokens}`,
    manualCompact: '手動 compact：/context-budget compact（預設指令）｜/context-budget tailor（量身指令）',
    recentEvents: '最近的判定：',
    none: '（無）',
    logLine: (minutes, kind, detail) => `- ${minutes} 分鐘前 ${kind} ${detail}`,
    thresholdToast: tokens => `context 已到 ${tokens}，可以用輸入框上方的按鈕 compact`,
    draftStashed: '原本的草稿先收起來，compact 完成後會放回輸入框',
    tailoring: '正在依目前對話產生 compact 指令…',
    tailorFailed: reason => `產生失敗（${reason}），改填通用指令`,
    compactedStatus: 'ctx compact 完成，下一回合更新',
    idleDrop: (minutes, tokens, rewrite) =>
      `閒置 ${minutes} 分鐘、context 約 ${tokens}：快取已過期，直接送出會把整段重寫一次（約等於 ${rewrite} 的 input）。原文已放回輸入框，按 Enter 照常送出；或先按輸入框上方的 Compact／量身指令／Clear。`,
    idleBand: (minutes, tokens) => `☂ 閒置 ${minutes} 分、context ${tokens}：原文已放回輸入框，按 Enter 照常送出`,
    thresholdBand: tokens => `↯ context ${tokens}，建議 compact`,
    compactLabel: 'Compact',
    tailorLabel: '量身指令',
    clearLabel: 'Clear',
    dismissLabel: '略過',
    baseInstructions:
      '保留：目前任務目標、已完成與待辦事項、做過的決定與理由、相關檔案路徑與指令。可丟棄：已解決錯誤的細節、冗長的工具輸出。',
    browserInstructions:
      '瀏覽器：丟棄 snapshot、console log、截圖與 DOM 細節，只保留可用的 selector、驗證結論與待處理的程式邏輯。',
    forkPrompt:
      '請替接下來的 /compact 寫一段保留指示：繁體中文、單行、120 字以內、不要前言。列出接下來工作一定要保留的重點（任務目標、待辦、做過的決定、檔案路徑），以及可以丟棄的雜訊。只輸出指示本身。',
  },
}
