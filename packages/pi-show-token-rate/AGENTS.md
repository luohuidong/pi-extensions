# AGENTS.md — `pi-show-token-rate`

本文件是 `pi-show-token-rate` extension 的实现契约与修改指引。Workspace 级约定(目录布局、Biome workspace 规则、跨包命令)见仓库根 [`AGENTS.md`](../../../AGENTS.md)。功能需求见同目录 [`SPEC.md`](./SPEC.md);本文件描述**当前实现**,改代码时保持两者一致。

## 项目速览

- **类型**: pi-coding-agent extension(npm 包名 `pi-show-token-rate`,版本 `0.2.0`)
- **作用**: 在 pi TUI 底部状态栏显示当前模型的**流式输出 token 速率**(tok/s)
- **渲染格式**: 流式中 `⚡ 62 tok/s`(按速率上色);响应结束后保留最后一次读数、继续显示但改为 `dim`;无数据 `⚡ tok/s —`
- **门控**: 无 provider 门控,任何 provider / 任何模型都渲染
- **数据来源**: 只用 pi 的事件流(`message_start` / `message_update` / `message_end`),不发网络请求、不读凭据
- **刷新时机**: 流式事件(节流 150ms)+ `message_end` 强制重绘一次
- **手动控制**: 斜杠命令 `/token-rate`(开关)

## 只统计流式速率

这是本扩展的范围界定:**没有结算速率、没有会话统计、没有历史样本**。

- 流式中:显示滑动窗口的实时速率,按速率质量上色。
- 响应结束后:用 `RateTracker#live(now)` 抓取当前窗口值冻结到 `#frozen`,状态行继续显示它,但改成 `dim`。
- 中止 / 出错的响应:不冻结半截窗口,继续显示上一条读数。
- 不存在 `finish()` 整段平均、`RateSample` / `RateSummary` / `summarize`、`MAX_SAMPLES`、`/token-rate stats|reset`。不要重新引入"结算速率"或会话聚合。

## 目录结构

```plaintext
packages/pi-show-token-rate/
├── SPEC.md                  # 功能需求(唯一权威来源)
├── AGENTS.md                # 本文件
├── README.md                # 用户文档(安装、色带、度量规则、命令)
├── package.json             # extension 元数据、`pi.extensions`、`peerDeps`
├── biome.json               # `{"extends": "//"}`
├── tsconfig.json            # strict, ESNext, bundler 解析
├── src/
│   ├── index.ts      扩展入口:事件 → 控制器接线,以及 `/token-rate` 命令
│   ├── line.ts       状态行控制器 `TokenRateLine`(节流 / 开关 / 计数 / 冻结最后读数)
│   ├── format.ts     纯函数:速率格式化、色带、状态行组装
│   └── rate/         纯逻辑:token 速率数学(目录外只从 index.ts 导入)
│       ├── index.ts      公共入口:规则总览 + re-export 全部公共名字
│       ├── estimate.ts   字符 → token 估算(两桶计费)
│       ├── window.ts     `TokenWindow`:单刻度滑动窗口 + 护栏配置
│       └── tracker.ts    `RateTracker`:双刻度实时 tracker
└── tests/
    ├── estimate.test.ts  估算器
    ├── window.test.ts    窗口:窗口语义 / 单调 / 护栏 / 差分测试
    ├── tracker.test.ts   双刻度选择与切换
    ├── format.test.ts    速率格式化与色带
    ├── line.test.ts      控制器:流式渲染、节流、冻结、中止丢弃、开关、无 UI
    ├── index.test.ts     事件接线 + `/token-rate` 命令
    └── helpers/          theme stub、消息与流事件工厂、expect 兼容壳
```

`src/rate/` 内部依赖方向:`estimate.ts` 与 `window.ts` 互不依赖;`tracker.ts` 依赖 `window.ts`;`index.ts` 只做 re-export。`line.ts` / `tests/` 统一从 `src/rate/index.ts` 导入。

## 关键约束

### 度量语义

1. **流中 = 滑动窗口**:`LIVE_WINDOW_MS = 3000`,取最近 3 秒的平均,避免 delta 突发抖动。
2. **只有流式读数**:响应结束时用 `RateTracker#live(now)` 抓当前窗口值冻结,不重算整段、不累积样本。
3. **token 数只从 delta 累计估算**:`line.ts` 用 `#count: CharCount` 按事件类型分流(`toolcall_delta` → tool 桶,`text_delta` / `thinking_delta` → text 桶),再用 `estimateTokens(count)` 求和。估算器两桶计费:
   - 正文 / thinking:宽字符(CJK / 假名 / 谚文 / 全角标点)≈ 1 token,其余 ÷ 4(`CHARS_PER_TOKEN`)。
   - tool-call 参数 JSON:窄字符 ÷ 2.5(`TOOL_CHARS_PER_TOKEN`),宽字符仍 ≈ 1。
   - **不再读取 `message.content`**(结算路径已删除)。
4. **两种刻度不可相减**:`usage`(provider `usage.output`)与 `estimate`(字符估算)各自一条 `TokenWindow`,永远不相减。
5. **`live(now)` 的优先级**:`usage` 窗口可测且 ≤ `MAX_PLAUSIBLE_TPS` 时优先返回 `{tokPerSec, source: "usage"}`;否则退回 `estimate`。`now` 必须是当前时钟——`TokenWindow#rate(now)` 用它判断最新 checkpoint 是否还在窗口内(过期即不可测)。生产代码里 `live(this.#now())` 有两处调用点:`#render`(画流式帧与结束帧)与 `onMessageEnd`(冻结最后读数),两处都必须传当前时钟。
6. **每个 delta 两条序列都喂**:`line.ts` 的 `onUpdate` 在 `usage > 0` 时先喂 usage,再喂 estimate。少了估算那条,provider 只在末尾报 usage 时实时数就没有数据源。
7. **单刻度窗口语义**(`window.ts`):
   - `observe(at, tokens)`:时间戳不前进或计数回退的观测一律丢弃(防 provider 计数重置);首次观测只开窗、不计 credit(排除 prefill)。
   - `rate(now)`:最新点过窗口(`current.at <= now - LIVE_WINDOW_MS`)→ `null`;窗口时长 `< minWindowMs` → `null`;窗口内 credit 增量 `<= 0` → `null`。
   - **窗口存的是 credited token,不是 raw**:每个区间最多记入 `dt × ceiling/1000`,其中 `ceiling = max(minCreditTps, rawRate × burstTolerance)`,`rawRate` 是**该窗口自身的 raw 速率**(不是 credited 速率)。用 raw 速率做 ceiling 是关键:它让真实快流一秒内就爬到真值,而不是被 floor 压在 100 附近慢慢爬;flush 本身的 credit 由 flush **之前**的 ceiling 决定,所以尖峰仍被压住。
8. **两条刻度护栏不对称(核心设计)**:
   - `USAGE_GUARD`:`minWindowMs: 0`、`minCreditTps: Infinity`、`burstTolerance: Infinity`——实测值,一有增量就原样上报。
   - `ESTIMATE_GUARD`:`minWindowMs: MIN_ESTIMATE_WINDOW_MS (1000)`、`minCreditTps: MIN_CREDIT_TPS (100)`、`burstTolerance: BURST_TOLERANCE (2)`——字符只知"何时到达",需最短历史 + 单区间 credit 上限。
9. **`MAX_PLAUSIBLE_TPS = 5000`**:usage 刻度没有 credit 护栏,一次计数跳跃能给出任意大的瞬时值;`live()` 把超限窗口当成不可测、交给另一条刻度或返回 `null`(状态行保留上一行),而不是打印。
10. **匿名化与性能**:`TokenWindow` 用 `#head` 头指针 + `#baseline` 游标处理已滑出窗口的前缀(amortized O(1)),超过 `PRUNE_SLACK (64)` 才 `splice` 回收一次,避免每个 delta 重建数组。`rate()` 只读最新点与基线点。

### 行为契约

11. **状态行 key**:`STATUS_KEY = "token-rate"`,UI 识别用,不要改。
12. **节流**:`WRITE_INTERVAL_MS = 150`;`message_update` 先喂 tracker 再判断是否绘制(节流不能丢采样);`message_start` 与 `message_end` 把 `#lastWriteAt` 重置为 `-Infinity` 强制画一次。
13. **相同文本不重绘**:`#rendered` 缓存最后写入的文本;隐藏时必须把 `#rendered` 清成 `undefined`,否则重新打开时因为"文本没变"而不重绘。
14. **流式中不可测时保留旧读数、标志仍为绿**:`live(now) === null` 时不 blank 行,而是用 `#frozen`(上一条读数;首次响应无则占位符)以 `measured: false` 重绘——数字 `dim`、`⚡` 仍 `success`,以满足 SPEC §2「流式中 ⚡ 恒绿」。
15. **结束冻结 / 中止丢弃**:`onMessageEnd` 正常结束时用 `live(now)` 抓最新值写入 `#frozen`,然后 `tracker.reset()`;`stopReason` 为 `aborted` / `error` 时**只** `reset()`、不更新 `#frozen`。`length`(截断)是真实生成,照常冻结。`#frozen` 是 idle 渲染的数据源。
16. **`#streaming` 标志控制状态**:`onMessageStart` 置 `true`,`onMessageEnd` 置 `false`;`#render(ctx, streaming)` 里 `streaming === true` 时 `⚡` 用 `success`、数字按 `measured` 决定上色还是 `dim`,`false` 用 `#frozen` 并全 `dim`。
17. **只有 assistant 消息参与**:`message_start` / `message_end` 按 `message.role === "assistant"` 过滤;`message_update` 只处理 `text_delta` / `thinking_delta` / `toolcall_delta`(`deltaText()` 返回 `undefined` 或空字符串直接 return)。
18. **无 UI 直接短路**:所有公开方法开头检查 `ctx.hasUI`,JSON / print 模式下不采样、不绘制。
19. **没有定时器**:控制器不持有任何 timer / handle,`session_shutdown` 无需清理;不要引入 `setInterval` 这类长驻资源。
20. **隐藏时不再重写空行**:`#render` 的不可见分支先看 `#rendered` 是否已是 `undefined`,是就直接 return。

### 格式化规则(`src/format.ts`)

需求来源:`SPEC.md` 第 2、3 条。

- `formatRate`:`<= 0` 或非有限 → `—`;显示值 `< 10` → 一位小数(`7.4`),否则取整(`62`)。
- **`⚡` 标志**:流式中用 `success`(绿);非流式恢复 `dim`。它独立于速率本身的颜色——即使速率是黄/红,只要在流式中标志就是绿的。
- **数字颜色**:仅当 `streaming && measured !== false` 时按色带上色;非流式,以及流式中 `measured: false`(沿用上一条读数)一律 `dim`。`measured` 缺省等价于 `streaming`。
- **色带(流式中)**,按**实际显示的数字**分桶,保证颜色和数字不矛盾:
  - 显示值 `> 50` → `success`(绿)
  - 显示值 `>= 10` → `warning`(黄)
  - 否则 → `error`(红)
- **idle(非流式)**:速率数字一律 `dim`,保留最后一次读数;`RateView.streaming` 缺省即 idle。
- 状态行模板:`⚡` + 速率 + `tok/s`;`⚡` 按 `streaming` 变绿/`dim`,`tok/s` 恒为 `dim`。不标注读数来自 provider usage 还是字符估算。
- 没有会话平均片段,也没有箭头。

## 开发工作流

测试全部交给 `node --test`,依赖 Node 的 `.ts` 类型剥离:`import` 必须带 `.ts` 后缀。

| 任务     | 命令                                           |
| -------- | ---------------------------------------------- |
| 安装依赖 | `pnpm install`(在 workspace 根)                |
| 跑测试   | `pnpm test`(`node --test`)                     |
| 类型检查 | `pnpm typecheck`(`tsc --noEmit`)               |
| 发布前   | `pnpm prepublishOnly`(自动跑 typecheck + test) |

Biome / Prettier 只在 workspace 根执行;Biome 自下而上会自动拾取本包的 `biome.json`。

## 代码风格

Biome(indent / lineWidth / quote / semicolon / trailing comma / organizeImports)由 workspace 根 `biome.json` 统一强制;本包 `biome.json` 把 `files.includes` 收窄到 `src/**/*.ts` / `tests/**/*.ts` / `*.json`。Markdown(本包 `SPEC.md` / `AGENTS.md` / `README.md`)由 workspace 根 Prettier 处理。

TypeScript 由 `tsconfig.json` 强制:`strict`、`module: ESNext`、`moduleResolution: bundler`、`isolatedModules`、`allowImportingTsExtensions` + `noEmit`。

## 测试约定

- 框架: `node:test`(`describe` / `it`)+ `node:assert/strict`;`expect()` 由 `tests/helpers/expect.ts` 提供兼容壳(含 `toBe` / `toEqual` / `toBeNull` / `toBeUndefined` / `toBeGreaterThan(OrEqual)` / `toContain`;**没有** `.not`,否定断言直接用 `assert.notStrictEqual`)
- import 后缀:所有本地模块写 `.ts`
- **时钟注入**:`new TokenRateLine(() => clock.now)`,测试里 `clock` 是可变对象,所有节流 / 窗口断言都必须是精确值,不允许 `sleep`
- 不依赖真实 pi 主题:`tests/helpers/theme.ts` 的 `fg` / `bg` 返回 `[color]text[/]` 标签字符串
- 事件工厂:`tests/helpers/messages.ts` 提供 `makeAssistantMessage` / `makeTextUpdate` / `makeThinkingUpdate` / `makeToolcallUpdate` / `makeMessageStart` / `makeMessageEnd`;`output = 0` 走估算分支
- `ExtensionContext` 用 `as unknown as ExtensionContext` 强转的假对象(只需 `hasUI` + `ui.theme` + `ui.setStatus` + `ui.notify`)
- 关键示例锁住整行字面量:
  - `[success]⚡[/] [success]200[/] [dim]tok/s[/]`(流式 >50:绿)
  - `[success]⚡[/] [warning]50[/] [dim]tok/s[/]`(流式 10–50:黄)
  - `[success]⚡[/] [error]2.5[/] [dim]tok/s[/]`(流式 <10:红,标志仍绿)
  - `[dim]⚡[/] [dim]50[/] [dim]tok/s[/]`(结束后冻结,dim)
  - `[success]⚡[/] [success]100[/] [dim]tok/s[/]`(流式估算读数,不再有 `~` 前缀)
  - `[dim]⚡[/] [dim]tok/s —[/]`(无数据 / session 起始)
- `window.test.ts` 有两个**差分测试**:按定义(每条序列:最新点 − `now - LIVE_WINDOW_MS` 之前最新的点;estimate 还要 `minWindowMs` 与 credit 上限)重算每一步并逐点比对。改窗口 / 剪枝 / 护栏后先看它们。

## 常见踩坑

- `src/rate/` 下的纯逻辑模块不 import `@earendil-works/pi-coding-agent`;读消息角色与字段是 `line.ts` 的职责
- `AgentMessage` 是联合类型,想读 assistant 专属字段必须先 `role === "assistant"` 收窄,或用 `Extract<MessageEndEvent["message"], { role: "assistant" }>`(`line.ts` 的 `AssistantMessage` 别名)
- `message.usage.output` 在 assistant 消息上是必填数字,但 provider 可能给 0;判断"是否上报"要用 `Number.isFinite(usage) && usage > 0`。"上报"不等于"在推进":Anthropic 从 `message_start` 起就报非 0,是否可测由 `RateTracker#live(now)` 自己判断(窗口增量 + 新鲜度),调用方不用另设门控
- 估算不是纯 `÷ 4`:宽字符 ≈1 token,tool JSON 按 2.5 chars/token;改 `line.ts` 时 `#count` 四个字段必须同步累加
- 估算刻度有两道护栏(最短 1 秒历史、credit 上限),estimate 用例的窗口至少需要 1 秒;usage 刻度不受影响
- credit ceiling 跟随**raw** 速率,不是 credited 速率:改成 credited 会让真实快流被压在 floor 附近慢慢爬(实测 400 tok/s 会从 100 起爬约 4 秒);改成固定常数则慢流上的 flush 会被过度信任
- `rate(now)` 的 `now` 必传当前时钟:过期的窗口必须交还给另一条刻度,否则 provider 停报后状态行会冻在旧速率
- 测试里想让 `/token-rate` 的控制器走假时钟,必须在 `extension(pi)` **之前**装 `t.mock.timers`(控制器构造时就把 `Date.now` 存成了默认时钟)
- `tests/index.test.ts` 只断言"接线正确、命令能跑通",不要在里面复制 `line.test.ts` 的速率断言
- `peerDependencies` 中 `@earendil-works/pi-coding-agent` 必须是 `*`
