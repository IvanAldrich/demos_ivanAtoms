# IvanAtomsDemo 设计规格（24h 面试 Demo）

- 状态：待评审
- 日期：2026-11-27
- 作者：IvanAtomsDemo 项目组
- 性质：面试笔试题的内部设计规格（非生产系统）
- 关联：`docs/05-产品介绍.md`（atoms.dev 逆向与 IvanAtoms 背景，仅作参考，不复刻全量）

---

## 0. 一句话

用户输入一句话想法 → 自建 AI Agent **自由生成一个可运行的 Node/npm 全栈站点**（网站 / Web app / 浏览器小游戏）→ 在 Docker 沙箱中构建运行 → 公网 URL 访问 → 支持**对话式增量迭代**；数据持久化落在项目级数据卷。模板只作为 quick-start 预设，不作为产品上限。

---

## 1. 产品定位与核心闭环

- **定位**：面向终端用户的「想法→可运行网站」代码生成平台（atoms.dev 同类）。
- **核心闭环**：`描述 → 生成 → 构建 → 预览 → 发布 → 迭代`。
- **工作流**（对齐 atoms.dev）：Describe → 打开首版 → 对话修改 → Publish 得到可分享链接。
- **可交付物**：① 完整可运行产品；② 说明文档（实现思路与取舍 / 完成度 / 扩展优先级）。
- **约束**：总时长 24h；不需要注册功能；DashScope 模型；开发期本地 `localhost` 验证，交付期部署到 ECS，经公网 IP 访问（无需真实域名）。

---

## 2. 范围

| 做（本期） | 明确不做（写入取舍） |
|---|---|
| 自由生成任意 Node/npm 工程（网站/app/小游戏） | 任意语言/多框架构建矩阵（仅 Node 工具链） |
| 模板 quick-start 预设 | 计费/积分/订阅 |
| Docker 沙箱构建 + 运行 | 注册/登录（用匿名设备令牌区分"我的项目"） |
| 对话式增量迭代 | i18n 多语言、营销内容矩阵、自定义域名 |
| 数据持久化（项目级数据卷） | 增长闭环 Agent（SEO 自动优化 / Google Ads / 数据分析） |
| 版本化 + 原子切换（顺带做回滚） | 真实支付（Stripe）/ 邮件等外部账号集成 |
| 轻量 SSE 构建回放 | 多智能体编排 / Race Mode |
| 1 个首页 + 工作区 + 预览/发布 | 复用 atoms.dev 品牌素材 |

> 注：atoms.dev 的"增长 Agent"（Sarah/Adrian/David）属于获客环节，依赖外部广告与分析账号，与"生成→运行→迭代"主链路无关，本期不做；但产品扩展性（多类型生成、迭代）照做。

---

## 3. 用户旅程

```
首页(/) 输入想法 (+可选模板 quick-start)
  → POST /api/projects  → 创建 project + 首个 build_job (queued)
  → /chat/{id} 页面：SSE 实时回放 生成/构建/自修复 事件
  → 完成：iframe 内嵌预览（/preview/{id}/{version}）
  → Publish：/p/{slug} 公开访问（本地 localhost；ECS 经公网 IP）
  → 继续对话：改文案/加功能/换布局/加游戏关卡 → 增量改文件 → 新版本容器 → 原子切换
  → 数据持久：生成的 app 自身写库到项目级数据卷，迭代/重建不丢
```

无注册：首次访问下发 `ownerToken`（HttpOnly cookie，随机 UUID），`/api/projects` 按该令牌隔离"我的项目"。

---

## 4. 系统架构

```
Browser
 ├─ 控制面 Next.js 15 (App Router / React 19 / TS / 内置 http 反代)
 │    ├─ 营销/入口首页、工作区 /dashboard、对话 /chat/{id}
 │    └─ API: projects / messages(SSE) / publish / health
 └─ /p/{slug}、/preview/{id}/{ver} ──反代──> 运行时容器 IP:port

控制面 ──> SQLite(better-sqlite3, WAL)：project/message/version/build_job/build_event
   │        入队 build_job
   ▼
worker 进程 (npm run worker)
   │  claim(lease)+heartbeat+有界重试
   ▼
Sandbox Provider (Docker)
   ├─ 基础镜像 ivanatoms/base:node22（预装常用依赖，免安装秒起）
   ├─ 每 version 一容器：挂载 代码(按版本) + 数据(按项目固定)
   ├─ 构建：可选受控 npm install → 启动 → 健康检查
   └─ 产物：storage/projects/{id}/versions/v{n}/  (代码)
             storage/projects/{id}/data/          (持久数据，跨版本共享)
```

- Web 与 worker 双进程，经持久队列表解耦，避免长构建拖垮请求。
- 反代与控制面处于同一 docker 网络，直接访问容器 IP。

---

## 5. 生成引擎（自由生成 + 精选依赖）

### 5.1 生成流程（worker 内）
```
Plan   ：组装 brief（idea + 模板种子 + 迭代时读取现有文件清单/关键文件）
Generate：LLM 产出多文件 Node 工程（文件路径 + 内容）
Validate：确定性校验（见 5.2），失败直接结构化回喂，不浪费构建
Build  ：沙箱 install(可选)→start→health
Repair ：构建/启动失败 → 错误结构化回喂 → 重试（总尝试 ≤3）
Ready  ：落 version；按需原子切换发布指针
```

### 5.2 确定性校验（构建前）
- `package.json` 合法、入口存在、文件数/单文件大小预算（如单文件 ≤ 32KB）。
- 约定检查：启动命令约定（`npm start` / `node server.js` / 静态入口 `index.html`）。
- 输出结构化 violations 回喂模型修复。

### 5.3 依赖策略（S1）
- 基础镜像 `ivanatoms/base:node22` **预装常用依赖**（express、better-sqlite3、vite 等），配置 `NODE_PATH`：生成物可直接 `require` 顶层依赖 → **免安装、秒级启动**。
- 若生成物声明的依赖超出预装集合：走**受控 npm install**（超时 + 失败进自修复）。
- 目标：绝大多数生成物免安装；把构建时间压到秒级，保住 24h 演示稳定。

### 5.4 模型接入
- DashScope OpenAI 兼容端点：`LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`。
- `LLM_MODEL` 可配（默认选代码能力强的模型，如 qwen3-coder 系列）；`DASHSCOPE_API_KEY` 走 `.env`。
- 关闭 thinking/推理 token 挤占可选；温度偏低以提升代码稳定性。

---

## 6. 模板（quick-start 预设）
- 模板 = 静态配置（`src/templates/*`）：`{ key, name, category(website|app|game), brief, seedFiles? }`。
- 用户选择模板 → 预填结构化 brief +（可选）可运行种子工程 → 降低首版翻车率，兼作"Remix"卖点。
- **引擎始终是自由生成**，模板不限制后续能力。
- 首期内置 2–3 个：`tracker`（待办/追踪，含持久化）、`landing`（品牌/作品集）、`game`（canvas 小游戏）。

---

## 7. 沙箱运行时与持久化（数据/代码分离）

- **隔离**：默认 `RUNTIME_ISOLATION=container`。非 root（1000:1000）、只读 rootfs、`/tmp` tmpfs、`--cap-drop ALL`、`no-new-privileges`、pids/内存/CPU 限额；运行时 `internal` 网络（无外联），构建期 `bridge`（npm install 需外网）。
- **挂载**：仅挂载 `versions/v{n}/`（代码）+ `data/`（数据）+ 一个可写 tmp；不挂宿主目录、不注入宿主环境变量。
- **数据持久化（关键）**：`data/` 目录**按 project 固定**、跨版本共享；代码按 version 隔离 → 迭代/回滚不丢数据。
- **每 version 一容器**，健康检查通过后登记 `version.ready`。
- 启动自检：`docker info` 不可用时 health 明确报 `degraded`，不假装容器隔离。

---

## 8. 对话式迭代与版本/原子切换

- 用户消息 → `POST /api/projects/{id}/messages` → 入队 `iterate` 类型 build_job。
- worker 读取现有工程（文件清单 + 相关文件），产出**增量编辑**（优先 SEARCH/REPLACE 式，减少整文件重写漂移）。
- 新版本构建成功 → 起新容器健康检查通过 → **原子切换**发布指针 `published_version_id` → 旧容器延迟回收。
- 版本表保留最近 N 个（如 3），支持一键回滚（切换到历史 ready 版本容器）。
- 全流程事件写 `build_event`，SSE 轮询回放，多实例/重启不丢。

---

## 9. 发布与公网访问

- **本地**：`http://localhost:3000/p/{slug}`（平台反代到容器）。
- **ECS**：同一套 `docker-compose`/`serve.sh`，平台监听 80 → `http://<ECS_IP>/p/{slug}`；无需真实域名。
- 发布状态：`project.published` 控制；未发布仅 `/preview` 可见。
- 反代转发前剥离平台会话 cookie，避免生成应用读取/覆盖平台会话。

---

## 10. 控制面数据模型（SQLite / better-sqlite3）

| 表 | 关键字段 |
|---|---|
| project | id, slug, name, idea, templateKey?, ownerToken, status(idle\|building\|ready\|failed), published_version_id?, createdAt, updatedAt |
| message | id, projectId, role(user\|assistant\|system), content, createdAt |
| version | id, projectId, n, status(building\|ready\|failed), containerId, hostPort?, error?, createdAt |
| build_job | id, projectId, versionId, type(initial\|iterate\|retry), status(queued\|leased\|running\|done\|failed), leaseUntil?, attempts, error?, createdAt, updatedAt |
| build_event | id, jobId, level, message, data?, ts |
| （template 为静态配置，不入库） | — |

> 控制面 ORM：`better-sqlite3` + 轻量 repository（手写 SQL），最低摩擦、最快落地；迁移用简单 SQL 脚本。

---

## 11. API

```
POST   /api/projects                     {idea, templateKey?} → {projectId}（并入队 initial）
GET    /api/projects                     → 当前 ownerToken 的项目列表
GET    /api/projects/{id}                → 详情（含版本/发布状态）
DELETE /api/projects/{id}                → 级联清理（容器/磁盘）
POST   /api/projects/{id}/messages       {content} → {jobId}（迭代 build）
POST   /api/projects/{id}/retry          → 重试失败构建
POST   /api/projects/{id}/publish        {published:bool}
POST   /api/projects/{id}/rollback       {versionId}（顺带能力）
GET    /api/projects/{id}/events         SSE：构建事件流
GET    /api/projects/{id}/messages       → 对话历史
GET    /p/{slug}/*                       反代 → 已发布版本容器
GET    /preview/{id}/{version}/*         反代 → 指定版本容器（带 ownerToken 校验）
GET    /api/health                       DB / 隔离级别 / worker 心跳 / 队列积压
```

---

## 12. 评估指标

| 指标 | 说明 |
|---|---|
| 一次成型率 | initial 构建无需自修复即 ready 的比例 |
| 首版可运行率 | 有可用容器且健康检查通过 |
| 端到端时延 | 提交 → 可访问（p50/p95） |
| 自修复收敛率 | 失败后 ≤3 次内修复成功比例 |
| 迭代成功率 | iterate 构建成功且原子切换无中断 |
| 持久化正确性 | 写入后刷新/重启/重建仍在 |
| 交互可用性(B) | 前端产物控制台无致命错误、主交互可玩 |

---

## 13. 验收方案

**黄金用例（端到端，覆盖三类）**
1. **待办/追踪（app，含持久化）**：输入想法 → 生成 → 预览可增删改 → 刷新/重启数据仍在 → 公网 URL 可访问。
2. **预约/联系表单（website/app）**：生成 → 表单提交落库 → 迭代"加一个字段" → 重建不丢已填数据。
3. **浏览器小游戏（game）**：生成 → 预览可玩、控制台无致命错误 → 迭代"加难度/换主题" → 重新可玩。

**异常用例**：无意义/超长输入 → 友好降级（提示或生成通用页），不崩溃。

**自动化**：`browser-use` E2E 跑主链路；`/api/health` 冒烟；构建指标 JSONL。

**交付文档**：① 实现思路与关键取舍；② 当前完成度（做了/没做）；③ 继续投入的扩展方向与优先级判断。

---

## 14. 本地环境建设

- **Skill（自建）**：`生成产物脚手架规范`（约定/预算/入口）、`产物 E2E 验收`（起服务 + browser-use 跑主链路）。保留 `frontend-patterns`。
- **Subagent**：架构/PRD、生成器实现、代码审查（依赖与安全）、测试验证、文档撰写（与全栈工程师协作，独立上下文）。
- **MCP**：`browser-use`（预览联调/E2E）。
- **`.env` 键**：`DASHSCOPE_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`SESSION_SECRET`、`DATABASE_URL=file:./data/app.db`、`DATA_ROOT=./storage/projects`、`SANDBOX_IMAGE=ivanatoms/base:node22`、`BASE_URL`、`RUNTIME_ISOLATION=container`。

---

## 15. 24h 里程碑与风险

| 时段 | 目标 |
|---|---|
| H0–2 | 脚手架 + 控制面 DB + 基础镜像（预装依赖）+ 反代骨架 |
| H2–6 | Agent(生成/校验) + worker + Docker 构建运行 + SSE |
| H6–10 | 预览/发布/本地公网链路打通（黄金用例 1 跑通） |
| H10–14 | 迭代增量编辑 + 版本原子切换 + 持久化验证 |
| H14–18 | 用例 2/3（含小游戏）+ 异常降级 + UI 打磨 |
| H18–22 | E2E + browser-use 回归 + 指标采集 + 首批修复 |
| H22–24 | 部署脚本（本地→ECS）+ 说明文档 + buffer |

**主要风险与兜底**
- 构建慢/失败面大 → 精选依赖免安装 + 受控 install + 有界自修复（≤3）+ 基础镜像缓存。
- 模型代码不自洽 → 硬约定 + 文件预算 + 确定性校验前置。
- 时间不够 → 优先级：主链路跑通 > 迭代 > 持久化验证 > 小游戏 > 加分项（回滚/指标看板）。

---

## 16. 关键取舍（并入交付文档）

1. **自由生成(Node) vs 纯模板**：取自由生成，产品上限高；靠"精选依赖 + 约定 + 自修复"换稳定，牺牲"任意语言/多框架"。
2. **精选依赖/免安装 vs 任意 npm install**：默认免安装秒起，超集走受控 install 兜底。
3. **单 Agent 单模型 vs 多智能体**：单 Agent，链路清晰、可观测；多智能体/Race Mode 延后。
4. **SQLite vs Postgres**：demo 足够，单实例；生产化再换。
5. **无注册（设备令牌）vs 账号体系**：按题意，用 ownerToken 支撑"我的项目"。
6. **本地优先 vs 直接上云**：本地验证 + 一键切 ECS，规避早期云端调试成本。
7. **数据/代码分离**：数据按项目固定、代码按版本 → 迭代不丢数据（兑现"持久化"要求）。
8. **不做增长闭环/计费/自定义域/i18n**：聚焦核心闭环与工程质量。

---

## 17. 已知边界（交付时如实写明）
- 单实例 SQLite；容器隔离非生产级多租户。
- 生成物限 Node/npm 栈；依赖超集需联网安装。
- 反代暂不支持 WebSocket（如游戏需要再评估）。
- 无配额/限流/滥用检测；无注册与权限体系。
- 模型质量决定首版成败，靠自修复兜底但非万能。