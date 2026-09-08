# AGENTS.md

面向在该仓库中协作的 AI Agent / 贡献者的项目说明。所有内容均来自当前代码、测试与配置。

## 项目速览

- **类型**: pi-mono 扩展(npm 包名 `minimax-quota-show-for-pi`,版本 `0.1.0`)
- **作用**: 在 pi TUI 底部状态栏显示 **Token Plan** 配额
- **渲染格式**: `5h:80%(3h12m) 7d:65%(4d6h)`,按窗口着色
- **端点**: 仅 China 区域 `https://api.minimaxi.com/v1/token_plan/remains`
- **凭据来源**: 环境变量 `MINIMAX_TOKEN_PLAN_API_KEY`(静态 API key)
- **凭据类型**: 静态 `api_key`(以 `sk-cp-` 开头)
- **刷新时机**: `session_start`(同步占位 + 异步拉取)与 `agent_settled`
- **手动刷新**: 斜杠命令 `/minimax-quota`

## 目录结构

```
.
├── src/
│   ├── index.ts      扩展入口、事件钩子、`/minimax-quota` 命令
│   ├── api.ts        Token Plan HTTP 客户端(5s 超时)
│   ├── auth.ts       读取 MINIMAX_TOKEN_PLAN_API_KEY,生成 Bearer header
│   ├── aggregate.ts  取 model_remains[0] 直读 percent / 剩余时间(ms)
│   └── format.ts     纯函数:百分比着色、时长格式化、状态行组装
├── tests/
│   ├── aggregate.test.ts  aggregate(取首模型、缺字段归 0、clamp)
│   ├── auth.test.ts       resolveAuthHeader(env var 行为)
│   ├── format.test.ts     formatDuration + formatStatusLine
│   └── helpers/           theme stub、model 工厂
├── biome.json        格式化 + lint(2.5.12,双引号、尾随逗号、width 100)
├── tsconfig.json     strict, ESNext, bundler 解析
├── package.json      pnpm 9.12, node --test, biome
└── README.md         用户文档(包含状态消息表、安装、prereqs)
```

## 关键约束(必须保留)

### 行为契约

1. **占位符在 UI 永不空**(由 `src/index.ts` 控制):
   - `minimax: loading…` —— `session_start` 同步显示
   - `minimax: no credentials` —— `MINIMAX_TOKEN_PLAN_API_KEY` 缺失或为空
   - `minimax: no quota data` —— 接口返回空 / 形状不符
   - `minimax: error` —— 其它任意失败(网络、鉴权、解析)
2. **并发去重**: `inflight` 标志位防止 `session_start` / `agent_settled` 连发时并发拉取。

### 取数规则(`src/aggregate.ts`)

- 接口只取 `model_remains[0]`,后续 model 一律忽略
- `5h` 百分比 = `model_remains[0].current_interval_remaining_percent`(直接读,不重算)
- `7d` 百分比 = `model_remains[0].current_weekly_remaining_percent`(直接读,不重算)
- `5h` 剩余时间 = `model_remains[0].remains_time`(毫秒)
- `7d` 剩余时间 = `model_remains[0].weekly_remains_time`(毫秒)
- 百分比硬上限 `PERCENT_CLAMP_MAX = 200`,缺省(0 / 负 / null / undefined)统一归 0

### 格式化规则(`src/format.ts`)

- 重置时间**只到分钟**(`formatDuration`),不允许秒级输出
  - `< 1h` → `3m`
  - `≥ 1h 且 < 1d` → `2h35m`
  - `≥ 1d` → `5d8h`(分钟被丢弃)
- 颜色阈值(百分比剩余):
  - `≥ 50` → `success`(绿)
  - `≥ 20` → `warning`(黄)
  - 其它 → `error`(红)
- 状态行整体模板:
  ```
  5h:<pctColor>(<dimDuration>) 7d:<pctColor>(<dimDuration>)
  ```

## 开发工作流

| 任务 | 命令 |
|---|---|
| 安装依赖 | `pnpm install` |
| 跑测试 | `pnpm test`(`node --test`,Node 22.7+ 自带 strip-types;`import` 必须用 `.ts` 后缀) |
| 类型检查 | `pnpm typecheck`(`tsc --noEmit`) |
| 全量校验 | `pnpm verify`(typecheck + biome check + test) |
| 格式化 | `pnpm format` |
| Lint | `pnpm lint` |
| 自动修复 | `pnpm fix` |

发布前会自动跑 `pnpm verify`(`prepublishOnly`)。

## 代码风格

- Biome 强制:`indentWidth: 2`,`lineWidth: 100`,`quoteStyle: "double"`,`semicolons: "always"`,`trailingCommas: "all"`
- Linter:`recommended` preset
- import 排序:由 Biome `assist.organizeImports` 自动处理
- TypeScript:`strict` 开启,`module: ESNext`,`moduleResolution: bundler`,`isolatedModules`

## 测试约定

- 框架: `node:test`(`describe` / `it` / `afterEach`)+ `node:assert/strict`;`expect()` 由 `tests/helpers/expect.ts` 提供兼容壳
- import 后缀: 所有本地模块的 `import` 写 `.ts` 后缀(如 `from "./foo.ts"`);`tsconfig` 配 `allowImportingTsExtensions: true` + `noEmit: true` 让 TS 编译通过,Node 26 strip-types 原生解析。npm 包保持裸名(如 `@earendil-works/pi-coding-agent`)
- 不依赖真实 pi 主题: `tests/helpers/theme.ts` 提供 `fg` / `bg` 返回 `[color]text[/]` 标签字符串,断言通过标签匹配颜色
- 模型工厂: `tests/helpers/models.ts` 暴露 `makeModel(overrides)`,默认值代表"健康 general"模型
- 覆盖范围: 取首模型、缺字段归 0、百分比 clamp、百分比 / 时长边界、颜色桶、完整 `formatStatusLine` 输出
- 关键示例必须保留(测试断言锁住):
  - `5h:20%(2h35m) 7d:30%(5d8h)`(聚合与格式各有一个用例)
  - `5h:20%(3m) 7d:30%(3m)`(接近重置)

## 端点与凭据

- **HTTP**:`GET https://api.minimaxi.com/v1/token_plan/remains`
- **Auth**:`Authorization: Bearer <MINIMAX_TOKEN_PLAN_API_KEY>`
- **环境变量**: `MINIMAX_TOKEN_PLAN_API_KEY`,值为以 `sk-cp-` 开头的静态 API key

## 修改指引

### 增加新占位符

1. 在 `src/index.ts` 增加 `PLACEHOLDER_*` 常量
2. 在 `refresh` 的对应分支用 `ctx.ui.theme.fg("dim", ...)` 设置
3. 同步更新 `README.md` 的"Status messages"表

### 增加新的统计窗口

- 形状:扩展 `QuotaModelRemain`(`src/api.ts`)与 `AggregatedQuota`(`src/aggregate.ts`)
- 模板:修改 `formatStatusLine`(`src/format.ts`),并把示例同步进 `README.md`
- 测试:在 `aggregate.test.ts` / `format.test.ts` 补边界用例
- 颜色与时长规则可复用现有常量

### 不要改动的内容

- `STATUS_KEY = "minimax-quota"`(UI 上识别此行的 key,可能被外部依赖)
- 颜色阈值常量(`COLOR_GREEN_MIN=50`、`COLOR_YELLOW_MIN=20`)、`PERCENT_CLAMP_MAX`(已有测试锁住)
- 状态行整体顺序 `5h … 7d …`(测试断言完整字符串)
- `peerDependencies` 中 `@earendil-works/pi-coding-agent` 必须是 `*`(扩展按宿主版本加载)
- 凭据只通过 `MINIMAX_TOKEN_PLAN_API_KEY` 环境变量获取;不要新增配置文件解析

## 常见踩坑

- `api.ts` 在任何 HTTP / JSON 错误上返回 `null`,由 `index.ts` 决定占位符
- `aggregate.ts` 取 `models[0]`;空数组 / 缺字段一律归 0,不要假设一定有 percent / ms
- `formatDuration` 不会输出 `0s`;`0` 或负数 → `"0m"`
- 占位符使用 `dim` 主题色,不要换成彩色,避免误读为"高配额"
- `auth.ts` 直接读 `process.env.MINIMAX_TOKEN_PLAN_API_KEY`;测试中要 `afterEach` 还原环境变量,避免污染其它用例
- 测试中 `theme` 是 `as unknown as Parameters<typeof formatStatusLine>[0]` 强转,新增 `format*` 函数时记得更新此断言的导入类型

## 许可

MIT(见 `LICENSE.md`,Copyright 2026 Luo Huidong)。
