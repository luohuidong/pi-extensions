# AGENTS.md — `pi-show-opencode-go-quota`

本文件覆盖 `pi-show-opencode-go-quota` extension 的全部契约、测试约定、踩坑与修改指引。Workspace 级约定(目录布局、Biome workspace 规则、跨包命令)见仓库根 [`AGENTS.md`](../../../AGENTS.md)。

## 项目速览

- **类型**: pi-coding-agent extension(npm 包名 `pi-show-opencode-go-quota`,版本 `0.1.0`)
- **作用**: 在 pi TUI 底部状态栏显示 **OpenCode Go** 订阅的三窗口已用配额
- **渲染格式**: `Go·1%(3h28m)·6%(4d7h)·3%(28d20h)`(`Go` / `·` / `(` / `)` / 时长均为 `dim`,百分比按 70 / 90 阈值走 `success` / `warning` / `error`)。**三个分组无标签、按位置解读**,顺序固定为 rolling → weekly → monthly,共 32 列
- **端点**: `GET https://opencode.ai/zen/go/v1/usage`(硬编码,不从 model 的 `baseUrl` 推导)
- **凭据来源**: 先走宿主 `ctx.modelRegistry.getApiKeyForProvider("opencode-go")`,失败再回退 `readStoredCredential("opencode-go")` 读 `~/.pi/agent/auth.json`
- **凭据类型**: 静态 `api_key`(`oauth` 等同未配置)
- **刷新时机**: `session_start`、`agent_settled`、跨越 provider 边界的 `model_select`、斜杠命令 `/opencode-go-quota`
- **斜杠命令**: `/opencode-go-quota` 先 `refreshNow`(绕过节流),再用 `ctx.ui.notify` 打印带标签的明细(`formatDetail`);拉取失败时只提示失败,不打印旧数据
- **节流**: 距上次拉取 `< 30s` 时跳过(`THROTTLE_MS`);手动命令绕过节流
- **无轮询**: 不引入 `setInterval`,因此也不需要 `session_shutdown` 清理
- **激活 provider**: 仅 `opencode-go`;其它 provider 一律保持状态栏空(不渲染任何占位符)

## 目录结构

```
packages/pi-show-opencode-go-quota/
├── AGENTS.md                # 本文件
├── README.md                # 用户文档(安装、激活、窗口含义、状态消息表)
├── LICENSE                  # MIT,随包发布
├── package.json             # extension 元数据、`pi.extensions`、`peerDeps`
├── biome.json               # `{"extends": "//"}` + 收窄 files.includes
├── tsconfig.json            # strict, ESNext, bundler 解析
├── .npmignore
├── src/
│   ├── index.ts      扩展入口,只做事件接线与 hasUI 判断,以及 `/opencode-go-quota` 命令
│   ├── line.ts       配额状态行控制器:门控 / 节流 / 并发去重 / 占位符 / 快照;导出 isProviderActive / classifyModelSwitch / shouldThrottle 三个纯函数
│   ├── api.ts        usage HTTP 客户端(10s 超时,错误分类)
│   ├── auth.ts       凭据解析(modelRegistry 优先,auth.json 兜底)
│   ├── aggregate.ts  三窗口归一化(percent clamp、resetsAt → epoch ms)
│   └── format.ts     纯函数:formatDuration / 颜色桶 / formatStatusLine / formatDetail
└── tests/
    ├── aggregate.test.ts  窗口解析 / clamp / 缺字段 / 全缺归 null
    ├── api.test.ts        stub fetch:200 / 401 / 403 / 其它非 2xx / 网络异常 / 非 JSON
    ├── auth.test.ts       registry 优先、auth.json 兜底、oauth 与空 key 归 missing
    ├── format.test.ts     formatDuration 边界 + 颜色桶 + 完整 formatStatusLine
    ├── line.test.ts       isProviderActive / classifyModelSwitch / shouldThrottle
    └── helpers/           expect 兼容壳、theme stub、usage 工厂
```

## 关键约束(必须保留)

### 行为契约

1. **激活门控**(`src/line.ts` 的 `isProviderActive` + `QuotaLine#run`): 仅当 `ctx.model?.provider === "opencode-go"` 时才渲染状态行;其它 provider 直接不写状态栏。切走时 `clear` 清空。
2. **跨 provider 边界才动作**(`classifyModelSwitch`):
   - 非 `opencode-go` → `opencode-go` → `"enter"`(拉取)
   - `opencode-go` → 非 `opencode-go` → `"leave"`(清空)
   - 两端都是 `opencode-go`(同 provider 内换模型)→ `"noop"`,**不查询、不清空、不显示占位**
   - 两端都不是 → `"noop"`
   - `event.previousModel` 为 `undefined`(会话内首次选择)时按「从非 opencode-go 切入」处理
   - 判断必须用 `event.model` / `event.previousModel` 的 `provider`,**不要**用 `ctx.model`(切换瞬间两者可能不一致)
3. **节流**(`shouldThrottle`): `hasContent && lastFetchAt > 0 && now - lastFetchAt < THROTTLE_MS` 时跳过本次拉取,并**保持当前状态栏内容不变**(不写 `loading…` 占位)。
   - `hasContent` 表示「状态栏当前已有本扩展写入的内容」,数据帧与占位符帧都算 `true`。
   - `clear()` 必须把 `hasContent` 重置为 `false`,否则「切走后再切回」会被节流,导致状态栏一直空着。
   - 占位符帧也算 `true`,所以失败后的重试仍受节流约束,不会立刻轰炸接口。
   - `#lastFetchAt` 记录上次拉取**开始**的时刻;为 `0`(本会话未拉取过)时不节流。
4. **执行顺序**(`QuotaLine#run`): `#inflight` 去重 → 门控 → 节流 → 写 `loading…` → `resolveAuth` → `fetchUsage` → 渲染。占位符写在拉取之前,但节流检查必须更早,否则会闪一下占位符。
5. **并发去重**: `#inflight` 布尔位防止多个事件连发时并发拉取。
6. **飞行中的结果不得在 `clear` 后回写**(`#generation` 计数): `#run` 在发起拉取前记下 `#generation`,await 回来后若已变化则丢弃结果(不写数据、不写占位)。`clear()` 必须自增 `#generation`。
   - 原因:冷启动首个请求实测可达 6s,用户在这段窗口内切走 provider 时,旧结果会把已清空的配额行重新写回来。
   - `finally` 仍要更新 `#lastFetchAt` —— 这次请求确实发出去了。
7. **内部兜底**: `#run` 的 `try/catch` 保证任何未预期异常都落到 `error` 占位,绝不向宿主抛错。
8. **快照与状态栏同步**(`#snapshot`): 拉取成功后 `#render` 返回 `{ text, quota }`,`#run` 据此更新 `#snapshot`;失败 / `clear()` / 被 generation 丢弃时置 `undefined`。`/opencode-go-quota` 的明细完全从这个快照渲染,不自己再发一次请求。
   - 失败必须清掉快照 —— 状态栏和明细都不允许展示旧数值(测试 "drops the snapshot on failure and on clear" 锁住)。
9. **占位符仅在激活期间出现**(`src/line.ts` 常量区):
   - `OpenCode Go: loading…` —— 拉取进行中
   - `OpenCode Go: no credentials` —— registry 与 `auth.json` 都没有可用的 `opencode-go` api-key
   - `OpenCode Go: invalid key` —— HTTP 401
   - `OpenCode Go: no Go subscription` —— HTTP 403(key 合法但 workspace 没有 Go 订阅;Zen 与 Go 共用 workspace key)
   - `OpenCode Go: no quota data` —— 200 但三窗口都没有可用的 `percent`
   - `OpenCode Go: error` —— 其它任意失败(网络、超时、其它非 2xx、响应体非 JSON)

### 取数规则(`src/api.ts` + `src/aggregate.ts`)

- 端点常量 `ENDPOINT = "https://opencode.ai/zen/go/v1/usage"`,只读 `usage.{rolling,weekly,monthly}` 的 `percent` 与 `resetsAt`,其余字段一律忽略。
- 上游该路由已重构为纯代理(`proxyInference`),响应 schema 由 opencode 后端服务拥有,可能再变 —— 解析必须防御性,不要扩大读取的字段面。
- `percent` 是**已用百分比**(服务端已 floor)。不要改成 `100 - percent`。
- 超时 `TIMEOUT_MS = 10_000`:实测首个请求(冷连接/经代理)约 6.3s,之后约 0.4s。**不要**降回 5s,否则会话启动会误报 `error`。
- 状态码映射:`401` → `unauthorized`,`403` → `no-subscription`,其它非 2xx → `error`。
- `aggregate` 规则:
  - `usedPct` = `clamp(0, 100, percent)`,`percent` 非有限数则该窗口视为缺失
  - `resetsAtMs` = `Date.parse(resetsAt)`,非有限或 `<= 0` 归 `0`
  - 三窗口全部缺失 → 返回 `null`(→ `no quota data` 占位),而不是三份 `0%`
  - **`percent === 0` 不做任何特殊处理**,照常返回;上游在这种情况下可能给 `resetsAt` 填 `now + 窗口` 占位值,我们无力区分,不做猜测

### 格式化规则(`src/format.ts`)

- 重置时间**只到分钟**(`formatDuration`),不允许秒级输出
  - `< 1h` → `3m`
  - `≥ 1h 且 < 1d` → `2h35m`
  - `≥ 1d` → `5d8h`(分钟被丢弃)
  - `<= 0` → `0m`
- 颜色阈值(**已用**百分比,方向与"剩余"相反):
  - `< 70` → `success`(绿)
  - `70 ≤ used < 90` → `warning`(黄)
  - `≥ 90` → `error`(红)
- 状态行整体模板(**无窗口标签,按位置解读**):
  ```
  Go·<rolling-pct>(<dur>)·<weekly-pct>(<dur>)·<monthly-pct>(<dur>)
  ```
  其中 `Go` / `·` / `(` / `)` / `<dur>` 都包一层 `theme.fg("dim", ...)`,只有百分比走颜色桶。
- 分组顺序 `rolling → weekly → monthly` 是**公开契约**:标签被去掉就是为了省下约 20 列,重排分组会静默改变数字含义。改顺序属于破坏性变更。
- 百分比与 `(` 之间**没有空格**,分隔符是单字符 `·`(U+00B7)。
- 关于分隔符的宽度:`·` 在 Unicode 里属于 **East Asian Ambiguous**,pi 的 `visibleWidth()` 走 `get-east-asian-width` 默认配置,把 ambiguous 一律算作 1 列,所以 `·` 在 pi 眼里就是 1 列。选它是因为与仓内 `pi-show-minimax-quota` 那行的风格一致,而不是因为宽度安全。真要彻底消除终端侧的渲染差异,应改用 narrow/neutral 类字符(如 `|`);`⟳` `↻` 属于 neutral,在宽度上其实是安全的。
- `formatDetail` 输出**不带主题色标签**(`notify` 会整体上色),并且与状态栏保持相同的窗口顺序。
- 百分比**原样输出**接口返回值(`${usedPct}%`),不四舍五入、不与 dashboard 对齐。
- `resetsAtMs === 0` → 该窗口连括号一起省略;`resetsAtMs > 0` → `remainingMs = max(0, resetsAtMs - now)`,`now` 由调用方传入(取数时刻)。

## 开发工作流

测试全部交给 `node --test`(`import` 必须用 `.ts` 后缀)。

| 任务     | 命令                                                  |
| -------- | ----------------------------------------------------- |
| 安装依赖 | `pnpm install`(在 workspace 根)                       |
| 跑测试   | `pnpm test`(`node --test`;`import` 必须用 `.ts` 后缀) |
| 类型检查 | `pnpm typecheck`(`tsc --noEmit`)                      |
| 发布前   | `pnpm prepublishOnly`(自动跑 typecheck + test)        |

Biome / Prettier 只在 workspace 根执行(`pnpm format` / `pnpm check` / `pnpm md:check` 等),本包不再重复定义这些脚本;Biome 自下而上会自动拾取本包的 `biome.json`。

## 代码风格

Biome 风格由 workspace 根 `biome.json` 统一强制,本包的 `biome.json` 在 `"extends": "//"` 基础上把 `files.includes` **收窄**到 `src/**/*.ts` / `tests/**/*.ts` / `*.json`,避免 `pnpm check` 在包内跑时误把 Markdown 当 Biome 的工作对象。Markdown(`AGENTS.md` / `README.md`)交由根目录 Prettier 处理。

TypeScript 风格由 `tsconfig.json` 强制:`strict`、`module: ESNext`、`moduleResolution: bundler`、`isolatedModules`、`allowImportingTsExtensions` + `noEmit`。

## 测试约定

- 框架: `node:test`(`describe` / `it`)+ `node:assert/strict`;`expect()` 由 `tests/helpers/expect.ts` 提供兼容壳
- import 后缀: 所有本地模块的 `import` 写 `.ts` 后缀;npm 包保持裸名
- 不依赖真实 pi 主题: `tests/helpers/theme.ts` 提供 `fg` / `bg` 返回 `[color]text[/]` 标签字符串,断言通过标签匹配颜色
- payload 工厂: `tests/helpers/usage.ts` 暴露 `makeWindow(overrides)` / `makeUsage(overrides)`,默认代表"三窗口齐全且带重置时间"的健康账号
- HTTP 层一律注入 stub `fetchImpl`(见 `tests/api.test.ts` 的 `stubFetch`),不发真实请求
- 凭据测试用 `mkdtempSync` + 写临时 `auth.json`,`afterEach` 清理临时目录
- 纯函数优先:`classifyModelSwitch` / `shouldThrottle` 就是为了让门控与节流可单测才从 `QuotaLine` 里拆出来的,新增判定逻辑请沿用这个模式
- `QuotaLine` 的控制器测试(`tests/line.test.ts` 的后半段)通过替换 `globalThis.fetch` 来拦截网络(`fetchUsage` 的默认参数在调用时解析全局 `fetch`),并在 `afterEach` 恢复;凭据一律由 registry stub 提供,避免读到开发机真实的 `~/.pi/agent/auth.json`。新增控制器用例请沿用 `makeCtx` / `stubFetch` / `deferred` 三个工具

## 端点与凭据

- **HTTP**:`GET https://opencode.ai/zen/go/v1/usage` + `Authorization: Bearer <key>`
- **Key 解析顺序**:
  1. `await ctx.modelRegistry.getApiKeyForProvider("opencode-go")`(覆盖 `OPENCODE_API_KEY` 环境变量、`auth.json`、运行时 key)
  2. `readStoredCredential("opencode-go", authPath?)` 读 `~/.pi/agent/auth.json` 的 `opencode-go.api_key.key`
  3. 都没有 → `no credentials` 占位
- 经宿主 `modelRegistry` 的调用可能抛错(registry 未就绪),必须 `try/catch` 后回退,不要让异常冒到状态栏
- **不要**去读 opencode 自己的 `~/.local/share/opencode/auth.json` —— 那是别的工具的凭据
- 改 key 后跑一次 `/opencode-go-quota` 即可生效

## 修改指引

### 增加新占位符

1. 在 `src/line.ts` 的占位符常量区增加新的 `const`
2. 在 `QuotaLine#render` 的对应分支用 `ctx.ui.theme.fg("dim", ...)` 返回
3. 同步更新 `README.md` 的 "Status messages" 表

### 调整颜色阈值或时长格式

- 阈值常量在 `src/format.ts`(`COLOR_YELLOW_MIN` / `COLOR_RED_MIN`);时长规则在 `formatDuration`
- 同步更新 `README.md` 的 "What the bar shows" 与 `AGENTS.md` 的本节
- 测试: `tests/format.test.ts` 里锁了 `69/70/89/90` 四个边界,改阈值必须同步改断言

### 调整节流窗口

- `THROTTLE_MS` 在 `src/line.ts`,测试用 `THROTTLE_MS` 常量本身而非字面量,改值不需要改测试

### 不要改动的内容

- `STATUS_KEY = "opencode-go-quota"`(UI 上识别此行的 key,`footerData.getExtensionStatuses()` 会暴露它)
- `TARGET_PROVIDER = "opencode-go"`(激活 provider 常量;改名要同步 README 的激活条件说明)
- `ENDPOINT`(硬编码的官方端点;`opencode-go` 的模型有 `/inference/go`、`/inference/go/v1`、`opencode.ai/zen` 三种 baseUrl,都不是配额端点,不要从 model 推导)
- `percent` 的"已用"语义(README 与颜色阈值都建立在这上面)
- 状态行整体顺序 `rolling → weekly → monthly`(测试断言完整字符串;因为无标签,改顺序是破坏性变更)
- 无标签的紧凑设计:不要重新加回 `5h` / `wk` / `mo` 标签或 `OpenCode Go` 全称 —— 32 列宽度是这个格式的核心目标,`tests/format.test.ts` 有宽度断言
- `peerDependencies` 中 `@earendil-works/pi-coding-agent` 必须是 `*`
- 不引入轮询 / `setInterval` / `session_shutdown`

## 常见踩坑

- **超时不能降回 5s**:实测冷连接首请求约 6.3s,5s 会在 `session_start` 误报 `error`
- **`clear()` 必须重置 `hasContent`**:否则「切走再切回」被节流,状态栏一直空着(这是实现时真实踩过的坑,已由 `tests/line.test.ts` 的 "never throttles when the bar holds no content" 锁住)
- **`clear()` 必须自增 `#generation`**:否则飞行中的拉取会在清空后把旧数据写回来(已由 "discards a result that resolves after the line was cleared" 锁住)
- **节流检查要在写占位符之前**:顺序反了会闪一下 `loading…` 再被跳过
- **`aggregate` 返回 `null` 与返回全 0 是两回事**:三窗口全缺才是 `null`(→ `no quota data`);部分缺失的窗口归一为 `{ usedPct: 0, resetsAtMs: 0 }`
- **`status` 字段不参与判定**:只读 `percent`,不要用 `status !== "ok"` 去丢弃窗口
- **`percent === 0` 不是缺失**:`0` 是合法值,照常渲染
- 占位符使用 `dim` 主题色,不要换成彩色,避免误读为"高配额"
- 测试中 `theme` 是 `as unknown as Parameters<typeof formatStatusLine>[0]` 强转,新增 `format*` 函数时记得更新此断言的导入类型
- `formatDetail` 是给 `notify` 用的**纯文本**,不要给它加 `theme.fg(...)` —— 宿主会对整个 notify 消息统一上色

## 许可

MIT(见 `LICENSE`,Copyright 2026-present Luo Huidong)。
