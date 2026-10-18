---
"pi-show-token-rate": minor
---

新增 TTFT(首 token 延迟)指标:状态行渲染为 `TPS 62 tok/s · TTFT 1.2s`。TTFT 度量从该次模型请求发出到首个 token 到达的间隔,每次 assistant 响应刷新一次,单位自适应(毫秒 / 秒),数字按延迟上色;`/token-rate` 统一开关整行。
