# AGENTS.md — `pi-show-token-rate`

本文件是 `pi-show-token-rate` extension 的实现契约与修改指引。Workspace 级约定(目录布局、Biome workspace 规则、跨包命令)见仓库根 [`AGENTS.md`](../../../AGENTS.md)。功能需求见同目录 [`SPEC.md`](./SPEC.md);本文件描述**当前实现**,改代码时保持两者一致。

## 项目速览

- **类型**: pi-coding-agent extension(npm 包名 `pi-show-token-rate`,版本 `0.2.0`)
- **作用**: 在 pi TUI 底部状态栏显示当前模型的**流式输出 token 速率**(TPS)与**首 token 延迟**(TTFT)
- **渲染格式**: `TPS 62 tok/s · TTFT 1.2s`;两个标签恒为 `dim`,数字按色带上色;响应结束后数字变为 `dim` 并保留最后一次读数;无数据时对应段落到占位符
- **门控**: 无 provider 门控,任何 provider / 任何模型都渲染
- **数据来源**: 只用 pi 的事件流(`message_start` / `message_update` / `message_end`),不发网络请求、不读凭据
- **刷新时机**: 流式事件(节流 150ms)+ `message_end` 强制重绘一次
- **手动控制**: 斜杠命令 `/token-rate`(统一开关整行)

## 指标体系

状态行由若干**互相独立**的指标段组成,顺序为 TPS、TTFT。每个指标是 `src/metrics/` 下的一个 `Metric` 实现,拥有自己的采样与显示状态;`line.ts` 只负责编排、节流与缓存。

`Metric` 契约(`src/metrics/types.ts`):

- `reset()` — 清空全部状态(session 启动)。
- `onMessageStart(message)` — 一条新的 assistant 响应开始,重置该响应的状态。
- `onUpdate(event, now)` — 流式进度。**每个 `message_update` 都会喂给每个指标**,由指标自己判断是否需要它(例如 TPS 只看 `*_delta`,TTFT 还要看 `*_start`);`now` 是控制器的注入时钟。
- `onMessageEnd(message, now)` — 响应结束,按指标规则冻结或丢弃读数。
- `render(theme, streaming, now)` — 渲染本指标的一个段。

约束:

1. **只统计流式**:没有整段平均、没有会话历史、没有持久化;响应结束后只保留"最后一次读数"。
2. **指标之间不共享状态、不互相推导**。新增指标 = 新增一个 `src/metrics/<name>.ts` + 在 `line.ts` 的指标列表里追加。不要为了复用而把两个指标揉进一个类。
3. `src/rate/` 是 TPS 专用的纯数学模块,TTFT 不依赖它。`src/metrics/message.ts` 的 `isDroppedResponse` 是两个指标共用的消息谓词。
4. `src/rate/` 下的纯逻辑模块不 import `@earendil-works/pi-coding-agent`;读消息角色与字段是 metric / `line.ts` 的职责。

## 目录结构

```plaintext
packages/pi-show-token-rate/
├── SPEC.md                  # 功能需求(唯一权威来源)
├── AGENTS.md                # 本文件
├── README.md                # 用户文档(安装、色带、度量规则、命令)
├── package.json             # extension 元数据、`pi.extensions`、`peerDeps`
├── biome.json               # `"extends": "//"` + 本包 `files.includes`
├── tsconfig.json            # strict, ESNext, bundler 解析
├── src/
│   ├── index.ts      扩展入口:事件 → 控制器接线,以及 `/token-rate` 命令
│   ├── line.ts       `MetricsLine`:把事件分发给各指标,节流 / 缓存 / 开关
│   ├── format.ts     纯函数:段组装、色带、单位与占位符
│   ├── metrics/      指标实现(目录外只从 line.ts 导入)
│   │   ├── types.ts     `Metric` 契约、`Theme`、`AssistantMessage`
│   │   ├── message.ts   `isDroppedResponse`(中止 / 错误谓词)
│   │   ├── tps.ts       `TpsMetric`:滑动窗口速率
│   │   └── ttft.ts      `TtftMetric`:请求锚点 → 首 token
│   └── rate/         TPS 专用纯逻辑
│       ├── index.ts      公共入口:规则总览 + re-export 全部公共名字
│       ├── estimate.ts   字符 → token 估算(两桶计费)
│       ├── window.ts     `TokenWindow`:单刻度滑动窗口 + 护栏配置
│       └── tracker.ts    `RateTracker`:双刻度实时 tracker
└── tests/
    ├── metrics/tps.test.ts   TPS 指标:窗口接线 / 刻度选择 / 冻结 / 色带
    ├── metrics/ttft.test.ts  TTFT 指标:锚点 / 首 token / 冻结 / 护栏
    ├── estimate.test.ts      估算器
    ├── window.test.ts        窗口:窗口语义 / 单调 / 护栏 / 差分测试
    ├── tracker.test.ts       双刻度选择与切换
    ├── format.test.ts        段格式化、色带与整行拼接
    ├── line.test.ts          控制器:整行组合、节流、开关、无 UI
    ├── index.test.ts         事件接线 + `/token-rate` 命令
    └── helpers/              theme stub、消息与流事件工厂、expect 兼容壳
```

依赖方向:`format.ts` 与 `metrics/*` 不互相依赖(指标只 import `format.ts` 的纯函数);`line.ts` import 指标与 `format.ts`;`index.ts` 只 import `line.ts`。`metrics/*` 不 import `line.ts`。

## 关键约束

### 控制器(`src/line.ts`)

1. **状态行 key**:`STATUS_KEY = "token-rate"`,UI 识别用,不要改。
2. **指标列表顺序即显示顺序**:`[new TpsMetric(), new TtftMetric()]`,TPS 在前、TTFT 在后。
3. **节流**:`WRITE_INTERVAL_MS = 150`;`onUpdate` 先把事件喂给所有指标、再判断是否绘制(节流不能丢采样);`message_start` 与 `message_end` 把 `#lastWriteAt` 重置为 `-Infinity` 强制画一次。
4. **相同文本不重绘**:`#rendered` 缓存最后写入的文本;隐藏时必须把 `#rendered` 清成 `undefined`,否则重新打开时因为"文本没变"而不重绘。
5. **隐藏时不再重写空行**:`#render` 的不可见分支先看 `#rendered` 是否已是 `undefined`,是就直接 return。
6. **无 UI 直接短路**:所有公开方法开头检查 `ctx.hasUI`,JSON / print 模式下不采样、不绘制。
7. **`#streaming` 标志**:`onMessageStart` 置 `true`,`onMessageEnd` 置 `false`,并作为 `streaming` 参数传给每个指标的 `render`。
8. **没有定时器**:控制器不持有任何 timer / handle,`session_shutdown` 无需清理;不要引入 `setInterval` 这类长驻资源。
9. **只有 assistant 消息参与**:`onMessageStart` / `onMessageEnd` 按 `message.role === "assistant"` 过滤、`onUpdate` 按 `event.message.role === "assistant"` 过滤。

### TPS 度量语义(`src/metrics/tps.ts` + `src/rate/`)

10. **流中 = 滑动窗口**:`LIVE_WINDOW_MS = 3000`,取最近 3 秒的平均,避免 delta 突发抖动。
11. **只有流式读数**:响应结束时用 `RateTracker#live(now)` 抓当前窗口值冻结到 `#frozen`,不重算整段、不累积样本。
12. **token 数只从 delta 累计估算**:`tps.ts` 用 `#count: CharCount` 按事件类型分流(`toolcall_delta` → tool 桶,`text_delta` / `thinking_delta` → text 桶),再用 `estimateTokens(count)` 求和。**不再读取 `message.content`**。
13. **两种刻度不可相减**:`usage`(provider `usage.output`)与 `estimate`(字符估算)各自一条 `TokenWindow`,永远不相减。
14. **`live(now)` 的优先级**:`usage` 窗口可测且 ≤ `MAX_PLAUSIBLE_TPS` 时优先返回 `{tokPerSec, source: "usage"}`;否则退回 `estimate`。`now` 必须是当前时钟——`TokenWindow#rate(now)` 用它判断最新 checkpoint 是否还在窗口内(过期即不可测)。`TpsMetric#render` 与 `onMessageEnd` 两处都必须传当前时钟。
15. **每个 delta 两条序列都喂**:`onUpdate` 在 `usage > 0` 时先喂 usage,再喂 estimate。少了估算那条,provider 只在末尾报 usage 时实时数就没有数据源。
16. **单刻度窗口语义**(`window.ts`):
    - `observe(at, tokens)`:时间戳不前进或计数回退的观测一律丢弃(防 provider 计数重置);首次观测只开窗、不计 credit(排除 prefill)。
    - `rate(now)`:最新点过窗口(`current.at <= now - LIVE_WINDOW_MS`)→ `null`;窗口时长 `< minWindowMs` → `null`;窗口内 credit 增量 `<= 0` → `null`。
    - **窗口存的是 credited token,不是 raw**:每个区间最多记入 `dt × ceiling/1000`,其中 `ceiling = max(minCreditTps, rawRate × burstTolerance)`,`rawRate` 是**该窗口自身的 raw 速率**。用 raw 速率做 ceiling 是关键:它让真实快流一秒内就爬到真值。flush 本身的 credit 由 flush **之前**的 ceiling 决定,所以尖峰仍被压住。
17. **两条刻度护栏不对称**:`USAGE_GUARD`(`minWindowMs: 0`、`minCreditTps: Infinity`、`burstTolerance: Infinity`)一有增量就原样上报;`ESTIMATE_GUARD`(`minWindowMs: MIN_ESTIMATE_WINDOW_MS`、`minCreditTps: MIN_CREDIT_TPS`、`burstTolerance: BURST_TOLERANCE`)需要最短历史 + 单区间 credit 上限。
18. **`MAX_PLAUSIBLE_TPS = 5000`**:usage 刻度没有 credit 护栏,一次计数跳跃能给出任意大的瞬时值;`live()` 把超限窗口当成不可测。
19. **结束冻结 / 中止丢弃**:`onMessageEnd` 正常结束时用 `live(now)` 抓最新值写入 `#frozen`;`isDroppedResponse` 为真时**只** `reset()`、不更新 `#frozen`。`length`(截断)是真实生成,照常冻结。
20. **流式中不可测时的显示**:`render` 在 `live(now) === null` 时不 blank 段落,而是用 `#frozen`(上一条读数;首次响应无则占位符)以 `measured: false` 渲染,数字 `dim`。

### TTFT 度量语义(`src/metrics/ttft.ts`)

21. **锚点 = assistant 消息的 `timestamp`**:pi 在打开响应流时、请求构建与发送之前写入它;`onMessageStart` 记下 `#anchor = message.timestamp`。**不要**改用 `message_start` 的到达时刻——它在收到响应头之后才触发,会严重低估 TTFT。
22. **首 token 的定义**:`isFirstToken` 接受 `text_start` / `thinking_start` / `toolcall_start`,或**非空**的 `text_delta` / `thinking_delta` / `toolcall_delta`。空 delta 是流脚手架,不算 token。
23. **每次响应一个读数**:`onMessageStart` 把 `#value` / `#measured` 清空;首个 token 到达时算 `ms = now - #anchor` 并置 `#measured = true`;此后同一响应内的后续事件不再改动它(`if (this.#measured) return;`)。
24. **护栏**:`ms <= 0`、非有限、或 `> MAX_PLAUSIBLE_TTFT_MS (300000)` 一律视为不可测(墙钟跳变),保持读数不变。
25. **结束冻结 / 中止丢弃**:与 TPS 相同——正常结束(`length` 也算)把 `#value` 写入 `#frozen`;`isDroppedResponse` 为真时保留上一条。
26. **流式中未测到首 token 时的显示**:`render` 用 `#frozen`(上一条;无则占位符)以 `measured: false` 渲染,数字 `dim`;首个 token 到达并再次绘制后才上色。
27. **重试的边界**:agent 级重启(pi 重跑整轮)天然排除——每次重启是新的 `stream()`、新的 `message.timestamp`,失败尝试没有首 token,按"错误丢弃"处理。provider 内部重试(`retryProviderRequest` 的退避)对扩展不可见,其退避时间会计入 TTFT;pi 不暴露每次 attempt 的边界,这是已知取舍,不要试图用启发式排除。

### 行为与格式化

28. **两个指标的读数独立冻结**:`#frozen` 各自持有;`render` 时由各指标决定用实时值、沿用值还是占位符。
29. **段顺序与分隔**:`line.ts` 用 `format.ts` 的 `joinSegments` 把各段以 `dim` 的 `·` 拼接;TPS 在前。整行示例:`[dim]TPS[/] [success]62[/] [dim]tok/s[/] [dim]·[/] [dim]TTFT[/] [success]1.2[/][dim]s[/]`。
30. **标签恒 `dim`**:`TPS` / `TTFT` 不再随流式变绿。这是与旧 SPEC 的行为差异,不要恢复。
31. **TPS 数字色带**:仅当 `streaming && measured !== false` 时上色,按**实际显示的数字**分桶——显示值 `> 50` → `success`,`>= 10` → `warning`,否则 `error`。`measured` 缺省等价于 `streaming`。
32. **TTFT 数字色带**:仅当 `streaming && measured !== false` 时上色,按**显示值换算成的秒数**(`ttftDisplay(...).seconds`,已按显示精度四舍五入)分桶——`< 1` → `success`,`<= 3` → `warning`,否则 `error`。用显示值分桶保证 `3.04s` 黄、`3.1s` 红。
33. **单位自适应**(`ttftDisplay`):先对毫秒四舍五入,`Math.round(ms) < 1000` 用整数毫秒(`840ms`),否则用一位小数秒(`1.2s`,即 `Math.round(ms / 100) / 10`)。数字与单位之间不加空格。用四舍五入后的值决定单位,保证 `999.6ms` 显示为 `1.0s` 而不是 `1000ms`,单位与颜色桶不会矛盾。
34. **占位符**:值缺失 / 非有限 / `<= 0` 时,值槽位填 `—`;TPS 为 `TPS — tok/s`,TTFT 为 `TTFT — ms`。

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

Biome(indent / lineWidth / quote / semicolon / trailing comma / organizeImports)由 workspace 根 `biome.json` 统一强制;本包 `biome.json` 必须声明自己的 `files.includes`(`src/**/*.ts` / `tests/**/*.ts` / `*.json`):`extends` 只继承规则不继承文件范围,根配置的 includes 不会向下覆盖,缺了它包内 `src` / `tests` 在 `biome check` 和编辑器里都不会被处理。Markdown(本包 `SPEC.md` / `AGENTS.md` / `README.md`)由 workspace 根 Prettier 处理。

TypeScript 由 `tsconfig.json` 强制:`strict`、`module: ESNext`、`moduleResolution: bundler`、`isolatedModules`、`allowImportingTsExtensions` + `noEmit`。

## 测试约定

- 框架: `node:test`(`describe` / `it`)+ `node:assert/strict`;`expect()` 由 `tests/helpers/expect.ts` 提供兼容壳(含 `toBe` / `toEqual` / `toBeNull` / `toBeUndefined` / `toBeGreaterThan(OrEqual)` / `toContain`;**没有** `.not`,否定断言直接用 `assert.notStrictEqual`)
- import 后缀:所有本地模块写 `.ts`
- **时钟注入**:`new MetricsLine(() => clock.now)`,测试里 `clock` 是可变对象,所有节流 / 窗口断言都必须是精确值,不允许 `sleep`
- **指标单测**优先直接驱动 `TpsMetric` / `TtftMetric`(它们不依赖 ctx),`line.test.ts` 只测组合、节流、开关与生命周期
- 不依赖真实 pi 主题:`tests/helpers/theme.ts` 的 `fg` / `bg` 返回 `[color]text[/]` 标签字符串
- 事件工厂:`tests/helpers/messages.ts` 提供 `makeAssistantMessage` / `makeTextUpdate` / `makeThinkingUpdate` / `makeToolcallUpdate` / `makeTextStart` / `makeThinkingStart` / `makeToolcallStart` / `makeMessageStart` / `makeMessageEnd`;`output = 0` 走估算分支
- TTFT 的锚点来自 `message.timestamp`:测组合时用 `{ ...message, timestamp: startAt }` 对齐假时钟,首 token 的间隔才是确定的
- `ExtensionContext` 用 `as unknown as ExtensionContext` 强转的假对象(只需 `hasUI` + `ui.theme` + `ui.setStatus` + `ui.notify`)
- 关键示例锁住整行 / 整段字面量:
  - `[dim]TPS[/] [success]200[/] [dim]tok/s[/]`(TPS 流式 >50:绿)
  - `[dim]TPS[/] [warning]50[/] [dim]tok/s[/]`(TPS 流式 10–50:黄)
  - `[dim]TPS[/] [error]2.5[/] [dim]tok/s[/]`(TPS 流式 <10:红)
  - `[dim]TPS[/] [dim]50[/] [dim]tok/s[/]`(TPS 结束后冻结,dim)
  - `[dim]TTFT[/] [success]840[/][dim]ms[/]`(TTFT 流式 <1s:绿,毫秒)
  - `[dim]TTFT[/] [warning]1.2[/][dim]s[/]`(TTFT 流式 1–3s:黄,秒)
  - `[dim]TTFT[/] [error]3.1[/][dim]s[/]`(TTFT 流式 >3s:红)
  - `[dim]TTFT[/] [dim]— ms[/]`(TTFT 无数据)
  - `[dim]TPS[/] [dim]— tok/s[/] [dim]·[/] [dim]TTFT[/] [dim]— ms[/]`(整行无数据)
- `window.test.ts` 有两个**差分测试**:按定义重算每一步并逐点比对。改窗口 / 剪枝 / 护栏后先看它们。

## 常见踩坑

- `AgentMessage` 是联合类型,想读 assistant 专属字段必须先 `role === "assistant"` 收窄。TTFT 里的 `message.timestamp` 只在 `onMessageStart` 读一次,不需要在 `onUpdate` 重新解读。
- `message.usage.output` 在 assistant 消息上是必填数字,但 provider 可能给 0;判断"是否上报"要用 `Number.isFinite(usage) && usage > 0`。"上报"不等于"在推进":是否可测由 `RateTracker#live(now)` 自己判断。
- 估算不是纯 `÷ 4`:宽字符 ≈1 token,tool JSON 按 2.5 chars/token;改 `tps.ts` 时 `#count` 四个字段必须同步累加。
- 估算刻度有两道护栏(最短 1 秒历史、credit 上限),estimate 用例的窗口至少需要 1 秒;usage 刻度不受影响。
- credit ceiling 跟随 **raw** 速率,不是 credited 速率:改成 credited 会让真实快流被压在 floor 附近慢慢爬。
- `rate(now)` 的 `now` 必传当前时钟:过期的窗口必须交还给另一条刻度,否则 provider 停报后状态行会冻在旧速率。
- TTFT 的 `isFirstToken` 会收到 `text_end` / `thinking_end` / `toolcall_end`,它们都不算首 token;不要用"type 结尾是 `_end`"之外的方式猜。
- TTFT 的 `ttftDisplay` 用 `Math.round(ms / 100) / 10`:1250ms 显示 `1.3s`,不是 `1.2s`;写断言时注意半值进位。
- 测试里想让 `/token-rate` 的控制器走假时钟,必须在 `extension(pi)` **之前**装 `t.mock.timers`(控制器构造时就把 `Date.now` 存成了默认时钟)。
- `tests/index.test.ts` 只断言"接线正确、命令能跑通",不要在里面复制指标级断言。
- `peerDependencies` 中 `@earendil-works/pi-coding-agent` 必须是 `*`。
