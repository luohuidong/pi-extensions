## 0.3.0

### Minor Changes

- 新增 TTFT(首 token 延迟)指标:状态行渲染为 `TPS 62 tok/s · TTFT 1.2s`。TTFT 度量从该次模型请求发出到首个 token 到达的间隔,每次 assistant 响应刷新一次,单位自适应(毫秒 / 秒),数字按延迟上色;`/token-rate` 统一开关整行。

### Patch Changes

- 状态行排版调整:标志由 `⚡` 换成文本 `TPS`,有读数时渲染为 `TPS 62 tok/s`,无数据时渲染为 `TPS — tok/s`(`—` 落在速率的值槽位上,不再是单位后缀)。
