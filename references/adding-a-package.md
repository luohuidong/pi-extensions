# 增加新 extension 包

本文件是 [`../AGENTS.md`](../AGENTS.md) 的补充参考,记录在本仓库新增一个扩展包时需要完成的清单。

1. `mkdir packages/<new-pkg>` 并在该目录下创建:
   - `package.json`(声明 `name` / `version` / `pi.extensions` 入口 / `peerDependencies` / `devDependencies`)
   - `biome.json`(必须同时写 `"extends": "//"` 和该包的 `files.includes`,见 [`../AGENTS.md`](../AGENTS.md) 的“Biome workspace 约定”;只有需要偏离全局规则时才追加其他字段)
   - `tsconfig.json`(继承 workspace TypeScript 约定:strict + ESNext + bundler)
   - `src/` / `tests/` / `README.md` / `LICENSE` / `AGENTS.md`
2. workspace 根的 `pnpm-workspace.yaml` 用 `packages/*` 通配,新包会被自动识别,无需额外注册。
3. 扩展专属的 peer / dev 依赖(例如 `@earendil-works/pi-coding-agent`、`typescript`、`@types/node`)放到该包的 `package.json`,不要污染根 `package.json`。
   - 每个包的 `devDependencies` 必须**自己声明 `typescript` 与 `@types/node`**(如 `^7.0.2` / `^26.6.1`),不能只靠包管理器往上找根目录的 `node_modules/.bin/tsc` 或 `../node_modules/@types`。
   - 根 `package.json` **不声明 `typescript`**(版本只在各包内维护,升级时逐个包改);根里的 `@types/node` 仅供根级工具链使用,不是包的依赖来源。包内声明后,`pnpm -F <pkg> typecheck` 会解析到包自己的 `tsc`,`tsc --traceResolution` 也能看到 `@types/node` 从包内命中。
   - **不要用 pnpm catalog**(`catalog:` 协议):发布若走 `npm publish`,npm 不认这个协议,会把 `"catalog:"` 原样写进发布的 manifest。显式写版本区间没有这个风险。
   - `biome` / `prettier` 不需要写进包内 —— 它们只在根脚本里调用。
4. 同步把新包登记到根 `README.md` 的 "Packages" 表。
5. 该包若有自己的契约约束,在它的 `AGENTS.md` 里补一份"关键约束"小节,不要混到根 `AGENTS.md`。
