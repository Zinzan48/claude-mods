# claude-mods

[English](README.md)

[Claude Code](https://claude.com/claude-code) 的 mod。這個 repo 是名為 `zinzan-mods` 的 plugin marketplace，目前只有一個 mod：context-budget。

## context-budget

Claude Code 的長 session 會在兩個地方燒錢。context 一直長大，直到你想起來要 compact；休息一陣子回來，prompt cache 已經過期，送出的第一句話會把整段 context 重送一次。context-budget 盯的就是這兩件事，另外也替幾種子代理挑模型、替子代理設 effort 下限。

### 功能

#### Compact 提醒

context 超過 500k token 時跳出 toast，輸入框上方出現一條提示列，之後每多 150k 再提醒一次。提示列有三顆按鈕：

- Compact：把 `/compact` 和預設的保留／丟棄指示放進輸入框。按 Enter 才會執行，送出前可以先改。
- 量身指令：請模型依這段對話寫一份指示，放進輸入框。
- 略過：收起提示列，等下一次提醒。

session 用過 Playwright 或 Chrome DevTools 的工具時，預設指示會多一句「丟掉 snapshot、console log 和截圖」。輸入框原本有草稿的話，會先收起來，compact 完再放回去。

狀態列顯示目前的 context 和最近 12 次讀數的小走勢圖，例如 `ctx 520k/1000k ▂▃▄▅`。

#### 閒置攔截

離開 60 分鐘以上、context 至少 200k token 時，回來送出的第一句話會被攔下並放回輸入框。提示列這時多一顆 Clear，可以選 Compact、量身指令、Clear 或略過；直接再按一次 Enter 就照原樣送出。每段閒置只攔一次。

#### 子代理模型

Claude 叫出下列子代理卻沒指定模型時，由 mod 指定：

| 子代理 | 模型 |
| --- | --- |
| Explore | haiku |
| claude-code-guide | sonnet |
| Plan | opus |

Agent 呼叫裡明確寫了模型就以它為準，其他類型的子代理不動。

#### 子代理 effort 下限

子代理的 effort 是 `low` 或 `medium` 時改成 `high`。5.5 世代的模型上，子代理吃不到頂層的 `effortLevel` 設定，不處理的話會停在模型預設的 `medium`。主 session 的 effort 不會被改。

### 安裝

在 Claude Code 終端機 session 的輸入框執行：

```
/plugin install context-budget --marketplace Zinzan48/claude-mods
```

問到是否加入 marketplace 時回 `y`，選擇範圍（user 範圍會在每個 session 載入），再設定選項或沿用預設值。裝完立刻生效。

### 指令

| 指令 | 作用 |
| --- | --- |
| `/context-budget` | 顯示目前讀數、下一個提醒門檻和最近 15 筆紀錄 |
| `/context-budget compact` | 不管 context 多大，都把 `/compact` 和預設指示放進輸入框 |
| `/context-budget tailor` | 把 `/compact` 和量身指令放進輸入框 |

### 設定

在 `/config` 裡改，或在 shell 執行 `claude plugin configure context-budget@zinzan-mods`。預設值就是上面描述的行為。

| 選項 | 預設 | 說明 |
| --- | --- | --- |
| `language` | `auto` | `auto`、`en` 或 `zh-TW`。`auto` 會讀 settings.json 的 `language`，寫的是中文就用 zh-TW，其他用英文 |
| `first_threshold` | `500000` | 第一次提醒的 token 數。context 視窗是 200k 的話，要設在 200000 以下 |
| `threshold_step` | `150000` | 之後每次提醒的間隔 |
| `idle_minutes` | `60` | 閒置多久後攔下下一句話 |
| `idle_min_tokens` | `200000` | context 小於這個數字就不攔 |
| `explore_model` | `haiku` | `inherit`、`haiku`、`sonnet` 或 `opus`。`inherit` 交給 Claude Code 決定 |
| `guide_model` | `sonnet` | 同上，用於 claude-code-guide |
| `plan_model` | `opus` | 同上，用於 Plan |
| `subagent_effort_floor` | `high` | `off`、`medium`、`high`、`xhigh` 或 `max` |

### 存了哪些資料

mod 會在本機 Claude Code 的 plugin store 留一份事件紀錄（最多 200 筆），以及每個 session 最後一個回合的時間與大小。不會往外送任何東西。唯一會呼叫模型的是「量身指令」，它就在你的 session 裡執行，跟一般請求一樣。

### 需求

Claude Code 2.1.271 以上，這是 `/config` 開始支援下拉選項的版本；實測版本是 2.1.296。mod 用的是 early access 的 plugin API，版本之間可能改動，Claude Code 更新後有可能壞掉，要等這裡修好。

### 移除

```
claude plugin uninstall context-budget@zinzan-mods
```

## 授權

[MIT](LICENSE)
