# AGENTS.md

面向在该仓库中协作的 AI Agent / 贡献者的项目说明。

本仓库是 pnpm workspace:根目录只托管 workspace 元信息与共享工具(BIome、TypeScript、Node 类型);每个扩展都是 `packages/` 下的独立子项目,自带 `src/` / `tests/` / `AGENTS.md` / `README.md` / `LICENSE`。子项目专属契约(行为门控、格式化细节、测试约定等)请到对应包的 `AGENTS.md` 查看 —— 当前子项目为 [`packages/pi-show-provider-quota`](./packages/pi-show-provider-quota/AGENTS.md) 与 [`packages/pi-show-token-rate`](./packages/pi-show-token-rate/AGENTS.md)。

## 项目速览

- **类型**: pnpm workspace,托管多个 pi-coding-agent 扩展
- **当前扩展**: `pi-show-provider-quota`(`packages/pi-show-provider-quota/`,版本 `0.1.0`)、`pi-show-token-rate`(`packages/pi-show-token-rate/`,版本 `0.2.0`)
- **许可**: MIT,Copyright 2026 Luo Huidong。每个发布的扩展包内附带一份同样的 `LICENSE`。

## 目录结构

```
.
├── AGENTS.md                 # 本文件:workspace 级约定
├── README.md                 # workspace 总览
├── LICENSE                   # 随根发布的副本
├── package.json              # workspace 根,`private: true`,脚本用 `pnpm -r`
├── pnpm-workspace.yaml       # workspace 声明,`packages/*`
├── biome.json                # workspace 根 Biome 配置(共享 formatter / linter 规则)
├── .gitignore
├── references/
│   ├── adding-a-package.md   # 新增 extension 包清单(按需查阅)
│   └── release.md            # 版本变更与包发布流程(按需查阅)
└── packages/
    ├── pi-show-provider-quota/     # 合并后的配额扩展:core + provider 适配器
    └── pi-show-token-rate/          # 内部结构和契约见其 AGENTS.md
```

### Biome workspace 约定

- 根 `biome.json` 负责所有 `formatter` / `linter` / `javascript` / `assist` / `vcs` 共享规则;根级 `files.includes` 只声明根目录自身的文件(`biome.json` / `package.json` / `pnpm-workspace.yaml`),**不会**向下覆盖各包。
- 每个包**必须**自带 `biome.json`,声明 `"extends": "//"` **并且显式写出自己的 `files.includes`**(至少 `["src/**/*.ts", "tests/**/*.ts", "*.json"]`)。`extends` 只继承规则,不继承“处理哪些文件”:包内一旦缺少 `files.includes`,Biome 会沿用从根继承来的范围,结果只处理 `biome.json` / `package.json`,`src` / `tests` 下的 `*.ts` 既不会被 format / lint,VSCode 里的 Save on format 也不会生效。用 `biome check --verbose` 可以核对实际处理的文件列表。
- 需要偏离全局规则(禁用某条 lint、关掉 formatter 等)时,在对应包内追加字段,不要修改根配置。
  - **严禁**在包级 `biome.json` 的 `files.includes` 里加入 `**/*.md` —— Markdown 由根目录 Prettier 负责,混入 Biome 会导致 `pnpm check` 在包内跑时格式化结果与 Prettier 冲突。
- Biome 自下而上寻找最近配置:在包内跑 `biome check` 会自动用 `packages/<pkg>/biome.json`(继承根规则 + 该包自己的 `files.includes`),在根目录跑则由各层配置分别认领文件,合起来覆盖整个 workspace。

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
| 单包操作             | `pnpm -F <pkg> <script>`,例如 `pnpm -F pi-show-token-rate test`                   |
| 记录变更意图         | `pnpm change`(写 `.changeset/*.md`,与改动一起提交)                                |

## 版本与发布

扩展包发生功能变化或修复 Bug 时,用 `pnpm change` 写一条 changeset(`.changeset/*.md`),与改动一起提交。完整的版本与发布流程(预览计划、bump 版本、发布到 npm 及关键约束)见 [`references/release.md`](./references/release.md)。

## 代码风格

- **Biome**(根 `biome.json` 统一设定,所有子项目继承):负责 `*.ts` / `*.json` 的 format、lint 与 import 排序。
  - Formatter:`indentWidth: 2`,`lineWidth: 100`,`quoteStyle: "double"`,`semicolons: "always"`,`trailingCommas: "all"`
  - Linter:`recommended` preset
  - Assist:`organizeImports: on`
- **Prettier**(根目录 `.prettierrc` + `.prettierignore`,见"Markdown 由 Prettier 处理"一节):仅格式化 `*.md`。
- **TypeScript**:每个包各自的 `tsconfig.json` 强制 `strict`、`module: ESNext`、`moduleResolution: bundler`、`isolatedModules`;包级细节见该包 `AGENTS.md` 的"代码风格"一节。

## 修改指引

### 增加新 extension 包

新建扩展包的完整清单(目录结构、依赖声明约定、登记要求等)见 [`references/adding-a-package.md`](./references/adding-a-package.md)。

### 修改 Biome 全局规则

1. 编辑根 `biome.json`。
2. 跑 `pnpm check` 确认所有包仍然合规;如有包失败,在该包 `biome.json` 内局部豁免。
3. 不要在包内重复声明根已经覆盖的字段(如 `formatter.indentWidth`),避免两份真相。
