# AGENTS.md — `pi-show-provider-quota`

本文件覆盖 `pi-show-provider-quota` extension 的全部契约、测试约定、踩坑与修改指引。Workspace 级约定(目录布局、Biome workspace 规则、跨包命令)见仓库根 [`AGENTS.md`](../../../AGENTS.md)。

## 项目速览

- **类型**: pi-coding-agent extension(npm 包名 `pi-show-provider-quota`,版本 `0.1.0`)
- **作用**: 在 pi TUI 底部状态栏显示**当前激活 model provider** 的订阅额度
- **架构**: 单个扩展 + 单个 status key(`provider-quota`)+ 单个命令(`/show-provider-quota`);厂商差异全部下沉到 `src/providers/` 下的适配器
- **激活门控**: 仅当 `ctx.model?.provider` 命中的 provider 适配器存在时才渲染;其它 provider 清空状态栏
- **百分比语义**: 全链路统一为**已用**(used)。MiniMax 在 aggregate 层做 `100 - remaining` 换算
- **颜色阈值**: 统一 `<70` 绿、`<90` 黄、`>=90` 红(在 `src/core/format.ts`)
- **节流**: 每个 provider 各自 30 秒(`THROTTLE_MS`),切换时命中缓存不重发
- **刷新时机**: `session_start`、`agent_settled`、跨厂商边界的 `model_select`、命令
- **无轮询**: 不引入 `setInterval`,因此也不需要 `session_shutdown` 清理

## 目录结构

```
packages/pi-show-provider-quota/
├── AGENTS.md                # 本文件
├── README.md                # 用户文档(安装、激活、每 provider 的窗口说明、状态消息表)
├── PLAN.md                  # 本次合并的实现计划
├── LICENSE                  # MIT,随包发布
├── package.json             # extension 元数据、`pi.extensions`、`peerDeps`
├── biome.json               # `{"extends": "//"}` + 收窄 files.includes
├── tsconfig.json            # strict, ESNext, bundler 解析
├── .npmignore
├── src/
│   ├── index.ts             扩展入口:事件接线 + `/show-provider-quota`
│   ├── core/                厂商无关:core 不认识任何厂商名、HTTP 形状或 percent 语义
│   │   ├── types.ts         `QuotaProvider` / `RenderResult`
│   │   ├── format.ts        `formatDuration` + `pctColor`(共享纯函数)
│   │   ├── lookup.ts        `providerFor` + `classifyModelSwitch`
│   │   └── line.ts          `QuotaLine`:Map 状态、唯一 paint、节流、inflight
│   └── providers/
│       ├── index.ts         `PROVIDERS` 表 + 重新导出 lookup
│       ├── minimax/         api / auth / aggregate / format / index(适配器)
│       └── opencode-go/     同上
└── tests/
    ├── core/                format / lookup / line
    ├── providers/minimax/       api / auth / aggregate / format
    ├── providers/opencode-go/   api / auth / aggregate / format
    ├── index.test.ts        事件接线与命令(集成)
    └── helpers/             expect / theme / fake-provider / models / usage
```

## 关键约束(必须保留)

### core 契约

1. **唯一写入口 `#paint`**:所有状态栏写入都必须经过 `QuotaLine#paint`,而 `#paint` 只读**当前激活 provider** 在 Map 里的那一格。
   - 这条不变式使得"上一个 provider 的在飞请求回来覆盖当前行"在结构上不可能发生,因此**不需要** `#generation` 计数器。不要再引入按请求代次丢弃结果的逻辑。
2. **状态按 provider 存**:`Map<provider.id, { text, detail, at, inflight }>`。`at` 是上次请求**落定**的时刻(成功或失败),同时驱动节流与缓存新鲜度判断。
3. **节流**(`refresh`):`state.at > 0 && now - state.at < THROTTLE_MS` 时直接返回,且**不 paint**(避免闪 loading)。`inflight` 存在时返回同一个 Promise,供命令 `await`。
4. **渲染异常兜底**(`#fetch` 的 `catch`):provider 本不该抛异常;一旦抛出,core 保持不向宿主抛错,并把该 provider 的 `text/detail` 清空。core **不**生成任何厂商文案,因此没有 `errorText` 接口成员。
5. **缓存保留**:切到不受支持的 provider 时只清空状态栏,Map 里的缓存保留,切回即可命中。
6. **失败占位符进缓存**:失败与成功一样写入 `text` 并更新 `at`,所以 30 秒内的切回会重现同一个占位符,不会立刻轰炸接口。

### provider 契约

```ts
export interface QuotaProvider {
  id: string; // 稳定 id,也是 Map 的 key
  providerIds: readonly string[]; // 归它管的 model provider,允许一对多
  loadingText(ctx: ExtensionContext): string;
  render(ctx: ExtensionContext, now: number): Promise<RenderResult>; // 整条流水线
}
```

- `render` 负责 auth → fetch → aggregate → 选占位符 → 拼行/拼明细,**所有已知失败都在内部变成占位符文本并返回,不抛异常**。
- `RenderResult.detail` 是给 `/show-provider-quota` 的**纯文本**,不带主题色标签(`notify` 会整体上色);仅成功时存在。
- `providerIds` 允许一对多:同一厂商的不同地区 provider id 可以共用一个适配器,此时它们被视为同一个账户(见 `classifyModelSwitch`)。

### 激活与切换

- 门控唯一来源是 `providerFor(PROVIDERS, ctx.model?.provider)`;没有命中就清行。
- `classifyModelSwitch` 按**适配器身份**而非 provider 字符串比较:
  - 两边命中同一适配器 → `noop`(同厂商内换模型不请求、不清空)
  - 命中 → 未命中 → `leave`(清行)
  - 未命中/未知 → 命中 → `enter`(拉取)
  - 判断必须用 `event.model` / `event.previousModel` 的 `provider`,**不要**用 `ctx.model`(切换瞬间两者可能不一致)
- `QuotaLine#activate` = 无条件 `paint` + `refresh`。`paint` 无条件执行,是为了切到有缓存的 provider 时立刻换行;`refresh` 负责节流。

### 命令 `/show-provider-quota`

1. 无激活 provider → `notify` 警告,不动状态栏。
2. 该 provider 有 `inflight` → `notify("querying quota…")` 并 `await` 它(不重发)。
3. 有缓存且 `now - at < 30s`(`isFresh`)→ 直接打印 `detail`。
4. 否则 `refresh`(此时必然通过节流检查),再打印 `detail`;`detail` 为 `undefined` 时提示失败,**不打印旧数据**。

## 取数规则

### MiniMax(`src/providers/minimax/`)

- 端点 `GET https://api.minimaxi.com/v1/token_plan/remains`,超时 5s;任何失败返回 `null`。
- 凭据:同步 `readStoredCredential("minimax-cn", authPath?)`;`oauth` / 空 key / 文件缺失 / JSON 损坏 → `missing`;`sk-api-` 前缀 → `wrong-type`;`sk-cp-` 或其它前缀 → `ok`(`Bearer <key>`)。
- 取首条 `model_remains[0]`;`used = clamp(0, 100, 100 - remaining)`,缺失/非有限数按 0% used 处理;时长为接口给的相对毫秒。
- 空数组 → `no quota data`。

### OpenCode Go(`src/providers/opencode-go/`)

- 端点 `GET https://opencode.ai/zen/go/v1/usage`,超时 10s。**不能降回 5s**:实测冷连接首请求约 6.3s。
- 凭据:先 `await ctx.modelRegistry.getApiKeyForProvider("opencode-go")`(覆盖 env / auth.json / 运行时 key),失败再回退 `readStoredCredential`;两者都没有 → `missing`。registry 调用可能抛错,必须 `try/catch` 后回退。
- 只读 `usage.{rolling,weekly,monthly}` 的 `percent` 与 `resetsAt`;`percent` 是**已用**值,不要做 `100 - percent`。
- `usedPct = clamp(0, 100, percent)`;`resetsAtMs = Date.parse(resetsAt)`,非有限或 `<= 0` 归 0;三窗口全缺 → `null`(`no quota data`)。
- 状态码:`401` → `invalid key`,`403` → `no Go subscription`,其它非 2xx → `error`。
- **不要**读 opencode 自己的 `~/.local/share/opencode/auth.json`。

## 格式化规则

- 共享(`src/core/format.ts`):
  - `formatDuration(ms)`:`<=0` → `0m`;`<1h` → `3m`;`<1d` → `2h35m`;`>=1d` → `5d8h`(丢分钟)。只到分钟,不输出秒。
  - `pctColor(theme, usedPct)`:`<70` success、`<90` warning、`>=90` error。百分比按原值展示,不四舍五入。
- 布局**不共享**,由各 provider 自己的 `format.ts` 拼:
  - MiniMax:`MPlan·<5h pct>(<dur>)·<7d pct>(<dur>)`,**无标签按位置**,顺序固定 5h → 7d,与 MiniMax 标题一起构成公开契约(改顺序属破坏性变更);段内无空格。
  - OpenCode Go:`Go·<rolling><dur>·<weekly><dur>·<monthly><dur>`,**无标签按位置**,顺序 rolling → weekly → monthly 是公开契约,重排属破坏性变更;`resetsAtMs === 0` 时整段括号省略。
- `formatDetail` 各 provider 自己实现,均为纯文本、窗口顺序与状态行一致。

## 开发工作流

测试全部交给 `node --test`(`import` 必须用 `.ts` 后缀)。

| 任务     | 命令                                                  |
| -------- | ----------------------------------------------------- |
| 安装依赖 | `pnpm install`(在 workspace 根)                       |
| 跑测试   | `pnpm test`(`node --test`;`import` 必须用 `.ts` 后缀) |
| 类型检查 | `pnpm typecheck`(`tsc --noEmit`)                      |
| 发布前   | `pnpm prepublishOnly`(自动跑 typecheck + test)        |

Biome / Prettier 只在 workspace 根执行,本包不再重复定义这些脚本;Biome 自下而上会自动拾取本包的 `biome.json`。

## 代码风格

Biome 风格由 workspace 根 `biome.json` 统一强制,本包的 `biome.json` 在 `"extends": "//"` 基础上把 `files.includes` 收窄到 `src/**/*.ts` / `tests/**/*.ts` / `*.json`,避免 `pnpm check` 在包内跑时误把 Markdown 当 Biome 的工作对象。Markdown(`AGENTS.md` / `README.md` / `PLAN.md`)交由根目录 Prettier 处理。

TypeScript 风格由 `tsconfig.json` 强制:`strict`、`module: ESNext`、`moduleResolution: bundler`、`isolatedModules`、`allowImportingTsExtensions` + `noEmit`。

## 测试约定

- 框架: `node:test`(`describe` / `it`)+ `node:assert/strict`;`expect()` 由 `tests/helpers/expect.ts` 提供兼容壳
- import 后缀: 所有本地模块的 `import` 写 `.ts` 后缀;npm 包保持裸名
- 不依赖真实 pi 主题: `tests/helpers/theme.ts` 提供 `fg` / `bg` 返回 `[color]text[/]` 标签字符串,断言通过标签匹配颜色
- core 控制器测试用 `tests/helpers/fake-provider.ts` 的 `makeFakeProvider` / `deferred`,并向 `QuotaLine` 构造器注入可控时钟,不碰网络
- 集成测试(`tests/index.test.ts`)用 fake `ExtensionAPI` 捕获事件与命令处理器,并通过替换 `globalThis.fetch` 拦截网络;`afterEach` 恢复
- provider 的 HTTP 层:OpenCode 注入 stub `fetchImpl`;MiniMax 的 `fetchQuota` 直接调全局 `fetch`,用替换 `globalThis.fetch` 的方式测试(见 `tests/providers/minimax/api.test.ts`)
- 凭据测试用 `mkdtempSync` + 写临时 `auth.json`,`afterEach` 清理临时目录
- 纯函数优先:`providerFor` / `classifyModelSwitch` / `isFresh` 等判定逻辑从控制器里拆出来以便单测

## 修改指引

### 增加一个新厂商的 provider

1. 在 `src/providers/<vendor>/` 下建 `api.ts` / `auth.ts` / `aggregate.ts` / `format.ts` / `index.ts`,导出满足 `QuotaProvider` 的对象。
2. 在 `src/providers/index.ts` 的 `PROVIDERS` 数组里追加一项。core 与 `src/index.ts` 不需要任何改动。
3. `aggregate` 必须把百分比归一成**已用**,时长归一成**毫秒**(相对时长)或提供 epoch 毫秒并在 `formatStatusLine` 内自行与 `now` 相减。
4. 在 `tests/helpers/` 加 payload 工厂,补 `api` / `auth` / `aggregate` / `format` 四类用例。
5. 同步更新 `README.md` 的 provider 表、窗口说明与状态消息表。

### 调整颜色阈值或共享时长格式

- 改 `src/core/format.ts`;这是所有 provider 共用的,改动会影响全部厂商。
- 测试在 `tests/core/format.test.ts` 锁了 `69/70/89/90` 四个边界,改阈值必须同步改断言。

### 调整节流窗口

- `THROTTLE_MS` 在 `src/core/line.ts`,测试用常量本身而非字面量,改值不需要改测试。

### 不要改动的内容

- `STATUS_KEY = "provider-quota"`、命令名 `show-provider-quota`
- `QuotaProvider` 的 `providerIds` 用于切换判定,新增 provider 时不要改已有 provider 的 id
- 百分比统一为"已用"以及 70 / 90 阈值
- OpenCode Go 状态行的窗口顺序 `rolling → weekly → monthly`(无标签,重排会静默改变含义)
- MiniMax 状态行的窗口顺序 `5h → 7d`(无标签,同样不能重排)
- `peerDependencies` 中 `@earendil-works/pi-coding-agent` 必须是 `*`
- 不要引入轮询 / `setInterval` / `session_shutdown`

## 常见踩坑

- **core 不认识厂商**:任何 `"OpenCode Go"` / `"MPlan"` 之类的用户可见文案都必须留在 provider 内,core 只能调用 `loadingText` / 用 `render` 的返回值。
- **不要恢复 `#generation`**:单一 paint 出口已经消除了旧结果覆盖新行的可能;再叠加代次判断是多余且容易写错。
- **节流检查要在 paint 之前**:顺序反了会闪一下 `loading…` 再被跳过。
- **失败也写 `at`**:否则失败后会被反复立即重试;由"失败占位符进缓存"的用例锁住。
- **`clear` 不删缓存**:切走再切回应命中缓存而不是空行;由"retains the cache while the provider is unsupported"锁住。
- **`paint` 只读激活 provider**:飞行中的结果写回自己那一格后,paint 仍按当前激活 provider 取内容。
- **MiniMax 的 `100 - remaining`**:缺失/非有限 remaining 视为 0% used,不要让它变成 100%。
- **`ResetsAt` 语义**:OpenCode 是绝对 ISO 时间,需 `resetsAtMs - now`;MiniMax 是相对毫秒,直接用。两者都通过共享的 `formatDuration` 输出。
- 测试中 `theme` 是 `as unknown as Theme` 强转,新增 `format*` 函数时记得更新断言用的类型来源。

## 许可

MIT(见 `LICENSE`,Copyright 2026-present Luo Huidong)。
