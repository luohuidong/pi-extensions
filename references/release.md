# 版本与发布

本文件是 [`../AGENTS.md`](../AGENTS.md) 的补充参考,记录本仓库的版本变更与包发布流程。日常开发只需要用 `pnpm change` 记录变更意图;以下内容在真正准备发布时才需要查阅。

## 完整流程

发布由 pnpm 原生能力驱动,**不安装 `@changesets/cli`**。

```bash
pnpm change                          # 记录变更意图(交互式:选包 / 选 bump / 写 summary)
pnpm change status                   # 预览待处理意图会产生的发布计划
pnpm version -r                      # 消费意图:bump 版本 + 写 changelog + 记录 ledger
pnpm publish -r                      # 发布 registry 上尚不存在的版本
```

发布前会自动跑各包自己的 `prepublishOnly`(typecheck + test);Biome / Prettier 的校验只在 workspace 根通过 `pnpm verify` 执行。

## 关键约束

- **意图文件仍是 changesets 格式**,落在 `.changeset/*.md`(该目录由 `pnpm change` 按需创建,不需要预置文件),随改动一起提交。
- **配置只认 `pnpm-workspace.yaml` 的 `versioning:` 键**;`.changeset/config.json` 已删除且不会被读取,不要再新建(两份真相)。
- **不要装 `@changesets/cli`**;也不要调用 `changeset` / `pnpm changeset` 等 CLI 命令。
- **`pnpm version -r` 不建 git commit、不建 tag**(一次递归可能把多个包 bump 到不同版本,没有单一版本可 tag)。发布前自己 `git commit` 并打 tag。
- 各包**独立版本**,没有 `versioning.fixed` 分组;根包 `private: true`,不参与发布。
- changelog 走 `versioning.changelog.storage: registry`:不在仓库提交 `CHANGELOG.md`,发布时合成并打进 tarball。若要改成仓库内 `CHANGELOG.md`,需同时把 `CHANGELOG.md` 加进各包的 `files` 白名单。
- 这些命令要求 **pnpm >= 11.13**(`pnpm change check` 需 >= 12.4)。仓库**没有**用 `packageManager` / `devEngines` 字段钉住 pnpm 版本:本地用自己安装的 pnpm,CI 在 workflow 的 setup 步骤里显式指定版本。
