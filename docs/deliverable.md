# IvanAtomsDemo 交付说明

> 面向评审：实现思路与取舍 / 完成度 / 后续扩展优先级。配套设计见 `docs/superpowers/specs/2026-11-27-ivanatoms-demo-design.md`，计划见 `docs/superpowers/plans/2026-11-27-ivanatoms-demo-plan.md`。

## 1. 实现思路与关键取舍

**一句话**：用户输入想法 → 自建 AI Agent 生成可运行的 Node 全栈站点 → Docker 沙箱构建运行 → 公网 URL 访问 → 对话式增量迭代 + 数据持久化。

**生成引擎（核心）**：不用单一巨型 prompt，而是**三段角色流水线**：`Spec（产品+架构，产出结构化 SiteSpec）→ Engineer（多文件生成 / 增量 patch）→ 确定性校验 → 构建运行 → Review/Repair（有界 ≤3 轮）`，由 worker 状态机编排。可靠性来自「角色分离 + 结构化契约（JSON Schema）+ 确定性校验前置 + 有界自修复」，而非堆叠更多对话 Agent。

**沙箱**：Docker 双阶段——一次性 `build` 容器（bridge，可装依赖）+ 常驻 `run` 容器（只读 rootfs、cap-drop、限额）。**代码按版本隔离、数据按项目固定挂载**（`DATA_DIR=/app/data`）→ 迭代/回滚不丢数据。健康检查通过后 **CAS 原子切换**发布指针；版本保留最近 3 个 + 回滚。

**关键取舍**：
| 取舍 | 选择 | 理由 |
|---|---|---|
| 自由生成 vs 纯模板 | 自由生成（Node/CJS） | 产品上限高；模板仅作 quick-start 预设 |
| 任意依赖 vs 精选依赖 | 默认免安装（镜像预装 express），禁其它依赖 | 24h 内「免安装秒起」比「任意 npm install」稳 |
| 构建/运行 | 拆两容器 | Docker 网络无法热切（构建需出网、运行需隔离） |
| 运行时持久化 | `DATA_DIR` 下 JSON | 避免镜像内原生依赖编译，稳且快 |
| 多智能体 | 三段角色流水线 | 兼顾可靠性与 24h 可控；自主多智能体/Race Mode 延后 |
| 鉴权 | 无注册，owner cookie | 按题；用匿名令牌区分「我的项目」 |
| 增长/计费/自定义域/i18n | 不做 | 与主链路无关、依赖外部账号 |

## 2. 当前完成度

**已做（端到端可运行）**
- 控制面：项目 CRUD、对话入队、SSE 进度、发布/回滚/重试、健康检查。
- 生成引擎：Spec / Engineer / 确定性校验 / SEARCH-REPLACE 补丁 / Review-Repair（≤3）/ 流水线编排。
- 沙箱：基础镜像（免原生）、build/run 双容器、挂载、健康探针、持久化。
- 队列/Worker：SQLite 持久队列、项目级串行、superseded、租约回收。
- 发布访问：`/p/{slug}`、`/preview` 反代 + 子路径 `<base>`/根相对改写 + 剥离平台 cookie。
- 前端：首页（模板 quick-start）、工作区、对话+iframe 预览+发布。
- 测试：多级单测 + Docker 集成（沙箱持久化、流水线 happy/repair 路径）；`typecheck`/`build` 通过。

**未做 / 待验证**
- **真实模型联调**：引擎以 mock LLM 验证；需配置 `DASHSCOPE_API_KEY` 后跑真实生成并调优 prompt。
- E2E 黄金用例（真实生成）待联调后由「测试验证」执行（见 `tests/e2e/golden.md`）。
- 暂无：注册/登录、配额限流、WebSocket 反代、多智能体、Race Mode、自定义域名、计费、增长闭环、ESM/vite/TS 生成。

## 3. 若继续投入的扩展优先级

1. **P0 真实模型质量**：接 DashScope 跑通 3 类黄金用例，沉淀/迭代各阶段 prompt 与 Few-shot，提升一次成型率与生成丰富度。
2. **P0 可观测/稳定性**：结构化日志、构建指标 p50/p95、失败归因看板、孤儿容器/磁盘 GC。
3. **P1 生成能力**：放开受控依赖（npm 镜像 + 缓存 + 超时）、支持 ESM/vite/TS 子集、多页面/路由、图片/资源。
4. **P1 体验**：实时 token 流、可视化 diff、版本对比、移动端适配。
5. **P2 平台化**：多用户/权限（真正账号）、配额限流、多实例部署（Postgres + 共享队列 + 对象存储）、对象存储/对象网关。
6. **P3 增长/商业化**：SEO/分析、计费、自定义域名、Race Mode 多模型比稿。