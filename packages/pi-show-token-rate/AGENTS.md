# AGENTS.md — `pi-show-token-rate`

本文件覆盖 `pi-show-token-rate` extension 的全部契约、测试约定与修改指引。Workspace 级约定(目录布局、Biome workspace 规则、跨包命令)见仓库根 [`AGENTS.md`](../../../AGENTS.md)。

## 项目速览

- **类型**: pi-coding-agent extension(npm 包名 `pi-show-token-rate`,版本 `0.1.0`)
- **作用**: 在 pi TUI 底部状态栏显示 **当前模型的输出 token 速率**(tok/s)
- **渲染格式**: 流式中 `⚡ 62 tok/s`;响应结束后 `⚡ 62 tok/s · avg 55`;估算值前缀 `~`;无数据 `⚡ tok/s —`
- **门控**: 无 provider 门控,任何 provider / 任何模型都渲染(与 `pi-show-minimax-quota` 不同)
- **数据来源**: 只用 pi 的事件流(`message_start` / `message_update` / `message_end`),不发任何网络请求、不读任何凭据
- **刷新时机**: 流式事件(节流 150ms)+ `message_end` 强制刷新
- **手动控制**: 斜杠命令 `/token-rate`(开关)、`/token-rate stats`、`/token-rate reset`

## 目录结构

```plaintext
packages/pi-show-token-rate/
├── AGENTS.md                # 本文件
├── README.md                # 用户文档(安装、度量规则、命令表)
├── LICENSE                  # MIT,随包发布
├── package.json             # extension 元数据、`pi.extensions`、`peerDeps`
├── biome.json               # `{"extends": "//"}`,继承根 Biome 配置
├── tsconfig.json            # strict, ESNext, bundler 解析
├── .npmignore
├── src/
│   ├── index.ts      扩展入口:事件 → 控制器接线,以及 `/token-rate` 命令
│   ├── line.ts       状态行控制器 `TokenRateLine`(节流 / 开关 / 采样 / 落盘)
│   ├── rate.ts       纯函数:字符估算、`RateTracker`(窗口速率)、`summarize`
│   └── format.ts     纯函数:速率格式化、状态行组装、stats 文案
└── tests/
    ├── index.test.ts   事件接线 + `/token-rate` 四个子命令
    ├── line.test.ts    控制器:流式渲染、节流、结算、开关、reset、无 UI
    ├── rate.test.ts    估算器、tracker(窗口 / 单调 / 剪枝 / finish)、summarize
    ├── format.test.ts  formatRate / formatStatusLine / formatSummary
    └── helpers/        theme stub、消息与流事件工厂、expect 兼容壳
```

## 关键约束(必须保留)

### 度量语义

1. **生成窗口**: 速率的时钟从第一个 token 开始(`observe()` 的第一次调用建立窗口),不含 prompt 预填充与 TTFT。
2. **流中 = 滑动窗口**(`LIVE_WINDOW_MS = 3000`): 实时数字取最近 3 秒的平均,避免 delta 突发导致的抖动。
3. **结算 = 整段平均**: `message_end` 时用整段生成窗口结算一条 `RateSample`(`finish()` 用不被剪枝的 `#first`,不要改成 `#checkpoints[0]`,否则长回复会被剪成窗口平均)。
4. **会话平均按时长加权**: `summarize()` 用 `Σtokens / ΣelapsedMs`,不是逐条算术平均。
5. **token 数取最大值**: 无 provider usage 时取 `max(delta 累计字符 ÷ 4, 最终 content 字符 ÷ 4)`。
6. **单调性**: 时间戳不前进或 token 计数回退的 `observe()` 一律丢弃,防止 provider 计数器重置造成尖峰。
7. **两种刻度不可相减**: `observe()` 必须带 `source`。窗口起点是 chars ÷ 4 估算、终值是真实 usage 时(OpenAI 兼容端点只在末包上报 usage),`finish()` 不做减法,直接用终值 —— 否则会得到负增量并静默丢掉整条样本。
8. **一个窗口只认一种刻度**: `observe()` 丢弃与窗口起点 `source` 不同的观测。流中途出现的另一刻度一旦被接受,就会拿两种单位相减制造速率尖峰(CJK 文本 chars ÷ 4 低估时必现),并让 `~` 提前消失。流中的 `~` 由 `RateTracker#windowSource`(窗口起点刻度)决定,**不是**最近一次观测的刻度;`message_end` 结算后才切到真实 usage,`~` 随之消失。

### 行为契约

9. **状态行 key**: `STATUS_KEY = "token-rate"`,UI 识别用,可能被外部依赖,不要改。
10. **节流**: `WRITE_INTERVAL_MS = 150`;`message_update` 里先喂 tracker 再判断是否绘制(节流不能丢采样);`message_start` 与 `message_end` 把 `#lastWriteAt` 重置为 `-Infinity` 强制画一次。
11. **相同文本不重绘**: `#rendered` 缓存最后写入的文本;隐藏时必须把 `#rendered` 清成 `undefined`,否则重新打开时因为"文本没变"而不重绘,状态行会一直是空的。
12. **无可测速率时保留旧行**: 流式中 `liveRate() === null`(窗口内还没有新 token)直接 return,不要把行清成 `⚡ tok/s —`。
13. **只有 assistant 消息参与**: `message_start` / `message_end` 按 `message.role === "assistant"` 过滤;`message_update` 只处理 `text_delta` / `thinking_delta` / `toolcall_delta`(`chars === 0` 直接 return)。
14. **中断的响应不计入统计**: `stopReason` 为 `aborted` / `error` 时,pi 照样发 `message_end`。此时调 `tracker.abort()` 丢掉窗口,不产生样本,状态行回退到上一条已结算的速率 —— 半截窗口算出来的速率会污染 `avg` / `peak`。`length`(截断)是真实生成,照常计入。
15. **无 UI 直接短路**: 所有公开方法开头检查 `ctx.hasUI`,JSON / print 模式下不采样、不绘制。
16. **没有定时器**: 控制器不持有任何 timer / handle,`session_shutdown` 无需清理;不要引入 `setInterval` 这类资源(会踩扩展 API 的"不要在 factory 里启动长驻资源"的坑)。
17. **样本上限**: `MAX_SAMPLES = 200`,超出后丢最旧的样本,避免超长会话无界增长。
18. **隐藏时不再重写空行**: `#render` 的不可见分支要先看 `#rendered` 是不是已经是 `undefined`,是就直接 return —— 否则每个节流窗口都会向 TUI 发一次无意义的 `setStatus(key, undefined)`。

### 格式化规则(`src/format.ts`)

- `formatRate`:`<= 0` 或非有限 → `—`;`< 10` → 一位小数(`7.4`);其余 → 取整(`62`)
- 颜色阈值:`>= 50` → `success`,`>= 20` → `warning`,其余 → `dim`(慢不是错误,不要用 `error`)
- 状态行模板:`⚡` + 可选 `~` + 速率 + `tok/s` + 可选 `· avg NN`,除速率数字外全部 `dim`
- 平均值只在样本数 ≥ 2 时出现(否则只是重复最后一个值)

## 开发工作流

测试全部交给 `node --test`,依赖 Node 的 `.ts` 类型剥离:无 flag 运行需要 Node ≥ 22.18(该特性默认开启的版本),workspace 根 `engines` 进一步要求 `>=26`。

| 任务     | 命令                                                  |
| -------- | ----------------------------------------------------- |
| 安装依赖 | `pnpm install`(在 workspace 根)                       |
| 跑测试   | `pnpm test`(`node --test`;`import` 必须用 `.ts` 后缀) |
| 类型检查 | `pnpm typecheck`(`tsc --noEmit`)                      |
| 发布前   | `pnpm prepublishOnly`(自动跑 typecheck + test)        |

Biome / Prettier 只在 workspace 根执行(`pnpm format` / `pnpm check` / `pnpm md:check` 等),本包不再重复定义这些脚本;Biome 自下而上会自动拾取本包的 `biome.json`。

## 代码风格

Biome 风格(indent / lineWidth / quote / semicolon / trailing comma / organizeImports)由 workspace 根 `biome.json` 统一强制,本包的 `biome.json` 在 `"extends": "//"` 基础上把 `files.includes` **收窄**到 `src/**/*.ts` / `tests/**/*.ts` / `*.json`。Biome 只处理 `*.ts` / `*.json`;Markdown(本包的 `AGENTS.md` / `README.md`)交由 workspace 根目录的 [Prettier](https://prettier.io/docs/install) 处理。

TypeScript 风格由 `tsconfig.json` 强制:`strict`、`module: ESNext`、`moduleResolution: bundler`、`isolatedModules`、`allowImportingTsExtensions` + `noEmit`。

## 测试约定

- 框架: `node:test`(`describe` / `it`)+ `node:assert/strict`;`expect()` 由 `tests/helpers/expect.ts` 提供兼容壳(已含 `toBe` / `toEqual` / `toBeNull` / `toBeUndefined` / `toBeGreaterThan(OrEqual)` / `toContain`;**没有** `.not`,否定断言请直接用 `assert.notStrictEqual`)
- import 后缀: 所有本地模块的 `import` 写 `.ts` 后缀
- **时钟注入**: `new TokenRateLine(() => clock.now)`,测试里 `clock` 是一个可变对象,所有节流 / 窗口断言都必须是精确值,不允许 `sleep`
- 不依赖真实 pi 主题:`tests/helpers/theme.ts` 的 `fg` / `bg` 返回 `[color]text[/]` 标签字符串
- 事件工厂:`tests/helpers/messages.ts` 提供 `makeAssistantMessage` / `makeTextUpdate(message, output, text)` / `makeMessageStart` / `makeMessageEnd(message, output?)`;`output = 0` 走估算分支
- `ExtensionContext` 用 `as unknown as ExtensionContext` 强转的假对象(只需 `hasUI` + `ui.theme` + `ui.setStatus` + `ui.notify`)
- 关键示例必须保留(测试锁住整行字面量):
  - `[dim]⚡[/] [success]100[/] [dim]tok/s[/]`(流式 / 结算,provider usage)
  - `[dim]⚡[/] [success]50[/] [dim]tok/s[/][dim] · avg [/][dim]83[/]`(两条响应后的平均)
  - `[dim]⚡[/] [dim]~[/][success]1000[/] [dim]tok/s[/]`(估算值前缀 `~`)
  - `[dim]⚡[/] [dim]~[/][success]500[/] [dim]tok/s[/]`(usage 中途出现也不摘 `~`)
  - `[dim]⚡[/] [dim]tok/s —[/]`(无数据 / reset 后)

## 修改指引

### 换一个度量口径

- 想把 live 速率改成"整段平均":改 `RateTracker#liveRate` 或在 `#render` 里传 `summary.last?.tokPerSec`,**不要**改 `finish()` 的窗口起点
- 想把估算器从 chars ÷ 4 换成别的:只改 `src/rate.ts` 的 `CHARS_PER_TOKEN` / `estimateTokensFromChars`,并同步 README 的 **Accuracy** 一节
- 想统计 input tokens:新增一个 tracker 或在 `RateSummary` 上加字段,不要改变 `RateSample.tokPerSec` 的语义

### 增加新的显示片段

1. 在 `src/format.ts` 的 `formatStatusLine` 追加片段,并扩展 `RateView`
2. 在 `src/line.ts` 的 `#render` 传入对应字段
3. 在 `tests/format.test.ts` 补字面量断言
4. 同步 `README.md` 的 "What the bar shows" 表

### 不要改动的内容

- `STATUS_KEY = "token-rate"`(UI 识别 key)
- `LIVE_WINDOW_MS` / `WRITE_INTERVAL_MS` / `MAX_SAMPLES` 三个常量(节流与窗口的取值,改了就和 README 的 **How the rate is measured** 不一致)
- `finish()` 用独立的 `#first` 而不是剪枝后的 `#checkpoints[0]`
- `#first` 上的 `source` 字段与 `finish()` 里“两种刻度不相减”的分支(丢了会让估算基线污染 usage 终值)
- `observe()` 里丢弃异刻度观测的那两行,以及 `RateTracker#windowSource`(丢了就会在混合刻度时既制造尖峰又丢 `~`)
- `liveRate()` 不接受窗口参数(`#prune` 已经按 `LIVE_WINDOW_MS` 丢弃了更早的 checkpoint,加参数只会得到静默错误的结果)
- 颜色阈值(`FAST_MIN = 50`、`SLOW_MIN = 20`)
- `peerDependencies` 中 `@earendil-works/pi-coding-agent` 必须是 `*`(扩展按宿主版本加载)
- 不要引入网络请求 / 凭据读取:本扩展的数据**只**来自 pi 事件流

## 常见踩坑

- `rate.ts` 不 import 任何东西(`AgentMessage` / `AssistantMessage` 没有从 `@earendil-works/pi-coding-agent` 根导出,只能用 `MessageEndEvent["message"]` 之类的索引类型取)
- `AgentMessage` 是联合类型,除 `AssistantMessage` 外还有 `BashExecutionMessage` 等成员,没有 `stopReason`。想读它必须先 `role === "assistant"` 收窄,或用 `Extract<MessageEndEvent["message"], { role: "assistant" }>`(`line.ts` 里的 `AssistantMessage` 别名)
- `ContentBlock` 不能带索引签名:带了索引签名之后 `AssistantMessage["content"]` 反而不可赋值(TS 报 "Index signature for type 'string' is missing")
- `message.usage.output` 在 assistant 消息上是必填数字,但 provider 可能给 0;判断"是否上报"要用 `Number.isFinite(usage) && usage > 0`
- `expect()` 兼容壳没有 `.not`,也不支持 `toBeCloseTo`;需要精确相等就设计出能整除的时间 / token 数
- 测试里想让 `/token-rate` 的控制器走假时钟,必须在 `extension(pi)` **之前**装 `t.mock.timers`:控制器构造时就把 `Date.now` 存成了默认时钟,后装的 mock 只替换 `Date.now` 属性,已捕获的引用不受影响
- `tests/index.test.ts` 只断言"接线正确、命令能跑通",不要在里面复制 `line.test.ts` 的速率断言
