# AGENTS.md

面向在该仓库中协作的 AI Agent / 贡献者的项目说明。

本仓库是 pnpm workspace:根目录只托管 workspace 元信息与共享工具(BIome、TypeScript、Node 类型);每个扩展都是 `packages/` 下的独立子项目,自带 `src/` / `tests/` / `AGENTS.md` / `README.md` / `LICENSE.md`。子项目专属契约(行为门控、格式化细节、测试约定等)请到对应包的 `AGENTS.md` 查看 —— 当前唯一子项目为 [`packages/show-minimax-quota-for-pi`](./packages/show-minimax-quota-for-pi/AGENTS.md)。

## 项目速览

- **类型**: pnpm workspace,托管多个 pi-coding-agent 扩展
- **当前扩展**: `show-minimax-quota-for-pi`(位于 `packages/show-minimax-quota-for-pi/`,版本 `0.1.0`)
- **许可**: MIT,Copyright 2026 Luo Huidong。每个发布的扩展包内附带一份同样的 `LICENSE.md`。

## 目录结构

```
.
├── AGENTS.md                 # 本文件:workspace 级约定
├── README.md                 # workspace 总览
├── LICENSE.md                # 随根发布的副本
├── package.json              # workspace 根,`private: true`,脚本用 `pnpm -r`
├── pnpm-workspace.yaml       # workspace 声明,`packages/*`
├── biome.json                # workspace 根 Biome 配置(共享 formatter / linter 规则)
├── .gitignore
└── packages/
    └── show-minimax-quota-for-pi/   # 唯一子项目,内部结构和契约见其 AGENTS.md
```

### Biome workspace 约定

- 根 `biome.json` 负责所有 `formatter` / `linter` / `javascript` / `assist` / `vcs` / `files.includes` 基础设定。
- 每个包自带一个 `biome.json`,只声明 `"extends": "//"`,自动继承根配置;当某个包需要偏离全局规则(例如禁用某条 lint 或关掉 formatter)时,只在对应包内追加字段即可,不要修改根配置。
- Biome 自下而上寻找最近配置:在包内跑 `biome check` 会自动用 `packages/<pkg>/biome.json`(继承根),在根目录跑则覆盖整个 workspace。

### Markdown 由 Prettier 处理

- Biome 的 `files.includes` **不**包含 `**/*.md`;Markdown 文件交由根目录的 [Prettier](https://prettier.io/docs/install) 格式化。
- 根目录的 `.prettierrc`(默认 `{}`)和 `.prettierignore`(排除 `node_modules` / `dist` / `coverage` / `pnpm-lock.yaml`)控制行为。
- 调用约定:Prettier 总是用显式 glob `**/*.md`,而不是 `prettier .`,避免误伤 Biome 负责的 `*.ts` / `*.json`。
- 编辑器集成:由于 `.prettierignore` 把非 md 文件全部排除,Save-on-format 类插件只会动 Markdown,不会和 Biome 冲突。

## 开发工作流

根目录脚本用 `pnpm -r` 递归到所有包;`biome` 相关脚本(Biome 在根 `node_modules` 可用)直接作用于整个 workspace。单包细节见该包内的 `AGENTS.md`。

| 任务                 | 根目录命令                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| 安装依赖             | `pnpm install`                                                                    |
| 跑所有包的测试       | `pnpm test`(`pnpm -r test`)                                                       |
| 所有包类型检查       | `pnpm typecheck`(`pnpm -r typecheck`)                                             |
| 全 workspace 校验    | `pnpm verify`(`pnpm -r typecheck && pnpm check && pnpm md:check && pnpm -r test`) |
| 格式化 `*.ts/*.json` | `pnpm format`(`biome format --write`)                                             |
| 格式化 `*.md`        | `pnpm md:format`(`prettier --write "**/*.md"`)                                    |
| Biome check          | `pnpm check`                                                                      |
| Markdown check       | `pnpm md:check`(`prettier --check "**/*.md"`)                                     |
| Biome lint           | `pnpm lint`                                                                       |
| Biome 自动修复       | `pnpm fix`(`biome check --write`)                                                 |
| 单包操作             | `pnpm -F <pkg> <script>`,例如 `pnpm -F show-minimax-quota-for-pi test`            |

发布前会自动跑 `pnpm verify`(`prepublishOnly`),由各包的 `package.json` 控制。

## 代码风格

- **Biome**(根 `biome.json` 统一设定,所有子项目继承):负责 `*.ts` / `*.json` 的 format、lint 与 import 排序。
  - Formatter:`indentWidth: 2`,`lineWidth: 100`,`quoteStyle: "double"`,`semicolons: "always"`,`trailingCommas: "all"`
  - Linter:`recommended` preset
  - Assist:`organizeImports: on`
- **Prettier**(根目录 `.prettierrc` + `.prettierignore`,见"Markdown 由 Prettier 处理"一节):仅格式化 `*.md`。
- **TypeScript**:每个包各自的 `tsconfig.json` 强制 `strict`、`module: ESNext`、`moduleResolution: bundler`、`isolatedModules`;包级细节见该包 `AGENTS.md` 的"代码风格"一节。

## 修改指引

### 增加新 extension 包

1. `mkdir packages/<new-pkg>` 并在该目录下创建:
   - `package.json`(声明 `name` / `version` / `pi.extensions` 入口 / `peerDependencies` / `devDependencies`)
   - `biome.json`(只写 `{"extends": "//"}`,除非该包需要偏离全局规则)
   - `tsconfig.json`(继承 workspace TypeScript 约定:strict + ESNext + bundler)
   - `src/` / `tests/` / `README.md` / `LICENSE.md` / `AGENTS.md`
2. workspace 根的 `pnpm-workspace.yaml` 用 `packages/*` 通配,新包会被自动识别,无需额外注册。
3. 扩展专属的 peer / dev 依赖(例如 `@earendil-works/pi-coding-agent`)放到该包的 `package.json`,不要污染根 `package.json`。
4. 同步把新包登记到根 `README.md` 的 "Packages" 表。
5. 该包若有自己的契约约束,在它的 `AGENTS.md` 里补一份"关键约束"小节,不要混到根 `AGENTS.md`。

### 修改 Biome 全局规则

1. 编辑根 `biome.json`。
2. 跑 `pnpm check` 确认所有包仍然合规;如有包失败,在该包 `biome.json` 内局部豁免。
3. 不要在包内重复声明根已经覆盖的字段(如 `formatter.indentWidth`),避免两份真相。
