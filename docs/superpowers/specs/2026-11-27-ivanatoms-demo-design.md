# IvanAtomsDemo 设计规格

- 状态：已定稿（架构评审通过，9 项修正已采纳）
- 日期：2026-11-27
- 作者：IvanAtomsDemo 项目组
- 性质：内部设计规格（非生产系统）
- 关联：atoms.dev 逆向背景（仅作参考，不复刻全量）

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
| 轻量 SSE 构建回放 | 自主多智能体对话 / Race Mode（改用三段角色流水线） |
| 1 个首页 + 工作区 + 预览/发布 | 复用 atoms.dev 品牌素材 |

> 注：① atoms.dev 的"增长 Agent"（Sarah 的 SEO / Adrian 的 Ads / David 的数据分析）属获客环节，依赖外部账号，与主链路无关，本期不做；② Iris（深度调研）为研发调研，与代码生成无关，也不落地；③ 生成侧用**三段角色流水线**（Spec/Engineer/Review），不是自主多智能体对话。产品扩展性（多类型生成、迭代）照做。

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
 │    ├─ 入口首页、工作区 /dashboard、对话 /chat/{id}
 │    └─ API: projects / messages(SSE) / publish / rollback / health
 └─ /p/{slug}、/preview/{id}/{ver} ──反代──> run 容器 IP:port

控制面 ──> SQLite(better-sqlite3, WAL)：project/message/version/build_job/build_event
   │        入队 build_job
   ▼
worker 进程 (npm run worker) —— Mike 编排状态机
   │  claim(lease)+heartbeat；项目级串行队列；有界重试
   ▼
生成流水线 Spec → Engineer → 确定性校验 →（沙箱构建/运行）→ Review/Repair → Ready
   ▼
Sandbox Provider (Docker)
   ├─ 基础镜像 ivanatoms/base:node22（预装常用依赖，免安装秒起）
   ├─ 每 version：一次性 build 容器(bridge,可写) → 常驻 run 容器(internal,只读)
   ├─ build：受控 npm install(硬超时90s) → v{n}.tmp→rename
   ├─ run  ：健康探针(端口+HTTP200+入口存在)
   └─ 挂载：/app/code = versions/v{n}(ro) + /app/data = project data(rw)
             storage/projects/{id}/versions/v{n}/  (代码，按版本隔离)
             storage/projects/{id}/data/          (持久数据，按项目固定、跨版本共享)
```

- Web 与 worker 双进程，经持久队列表解耦，避免长构建拖垮请求。
- 反代与控制面处于同一 docker 网络，直接访问 run 容器 IP；run 容器在 internal 网络无端口映射。

---

## 5. 生成引擎（自由生成 + 精选依赖）

### 5.0 角色映射（atoms.dev 核心 Agent → 本产品阶段）

| atoms Agent | 本产品落点 | 说明 |
|---|---|---|
| Mike（Team Leader） | worker 编排状态机 + Publish/迭代 审批点 | 非 LLM 对话体 |
| Emma（PM）+ Bob（Architect） | **Spec 阶段** | 想法 → 结构化 brief + 文件清单 + 技术约定（JSON schema 校验） |
| Alex（Engineer） | **Engineer 阶段** | 依据清单生成多文件 Node 工程 |
| （Reviewer） | **Review/Repair 阶段** | 确定性校验 + 构建错误 → 有界自修复 ≤3 |
| Iris（Deep Researcher） | 不落地 | 研发调研，与代码生成无关 |
| Sarah / Adrian / David | 不落地 | 增长/获客，依赖外部账号 |

> 设计原则：可靠性来自「角色分离 + 结构化契约 + 确定性校验 + 有界自修复」，而非堆叠更多自主对话 Agent。每段输出过 schema 再喂下一段。

### 5.1 生成流程（worker 内，三段角色流水线）
```
[Mike 编排] 领任务(initial|iterate) → 驱动各阶段 → 落地 version
 ① Spec (Emma+Bob)  ：组装 brief（idea + 模板种子 + 迭代时现有文件清单）
                      → 输出 { brief, fileManifest, techConstraints }（JSON schema 校验）
 ② Engineer (Alex)  ：依据 manifest 产出 首版 files[] 或 迭代 patches[]（路径 + 内容）
 ③ 确定性校验        ：见 5.2，失败结构化回喂（不浪费一次构建）
 ④ 沙箱             ：build 容器(受控 install,超时90s) → v{n}.tmp→rename → run 容器(健康探针)
 ⑤ Review/Repair    ：构建/启动/健康失败 → 错误回喂 → repair_round<3 重试，=3 则 failed + 兜底页
 ⑥ Ready            ：落 version；CAS 原子切换发布指针 → 旧 run 容器 grace 回收
```

### 5.2 确定性校验（构建前）
- `package.json` 合法、入口存在、文件数/单文件大小预算（单文件 ≤ 32KB、总 ≤ 200KB、≤ 12 文件）。
- 路径与依赖：禁绝对根路径（须相对资源路径）；依赖须 ⊆ 预装集合或走显式受控安装。
- 迭代补丁：SEARCH 片段必须唯一命中（`E_PATCH_AMBIGUOUS`）。
- 数据目录：生成物必须使用 `DATA_DIR`(= `/app/data`) 保持久化。
- violations 码集：`E_ENTRY_MISSING / E_PKG_INVALID / E_FILE_BUDGET / E_PATCH_AMBIGUOUS / E_ABS_PATH / E_FORBIDDEN_DEP`；结构化回喂模型修复。

### 5.3 依赖策略（S1）
- 基础镜像 `ivanatoms/base:node22` **预装常用依赖**（express、better-sqlite3 等）并配置 `NODE_PATH`：生成物可直接 `require` → 免安装、秒级启动。
- ⚠️ 免安装仅对 **CJS `require`** 生效（ESM `import`、vite/webpack 的 `.bin` 不适用）：首版**强制 CommonJS + express + 静态资源**，禁 vite/TS（或在镜像预置 `node_modules` 软链进 code 目录）。
- 超出预装集合的依赖：走**受控 npm install**（国内镜像 + 硬超时 90s），超时降级为"预装集内重建"并明确告知用户。
- 目标：绝大多数生成物免安装；把构建时间压到秒级，保住 24h 演示稳定。

### 5.4 阶段契约（高层）
- **Spec OUT**：`specVersion:1`；`brief{name,category:website|app|game,summary,pages,userStories,dataModel}`；`fileManifest[{path,purpose,estBytes,source}]`；`techConstraints{runtime:"node22-cjs",entry,startCmd,port,dataDirEnv:"DATA_DIR",persistence,deps,assetPaths:"relative",noAbsoluteRoot,noWebSocket}`。
- **Engineer IN**：Spec + `{existingManifest, 相关文件全文(≤8 个/≤32KB), userMessage}`；**OUT**：首版 `{files[{path,content}]}`，迭代 `{patches[{path,search,replace}]}`。
- **校验器 OUT**：`{ok, violations[{code,path,message,fixHint}]}`。
- **Review/Repair IN**：`{round, spec, currentFiles, failure|violations{stage,exitCode,stderrTail≤4KB,healthLog}}` → 回到 Engineer（`diagnosis`）。

### 5.5 模型接入
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

- **隔离**：默认 `RUNTIME_ISOLATION=container`。非 root（1000:1000）、只读 rootfs、`/tmp` tmpfs、`--cap-drop ALL`、`no-new-privileges`、pids/内存/CPU 限额。
- **构建/运行两阶段（Docker 网络无法热切）**：`build` 容器用 `bridge`（可写、可出网装依赖，一次性）；产物 `v{n}.tmp → rename` 后销毁；`run` 容器用 `internal`（无外联）、只读 rootfs，常驻。
- **挂载**：run 容器仅挂 `versions/v{n}/`（代码，ro）+ `data/`（数据，rw）+ 可写 tmp；不挂宿主目录、不注入宿主环境变量；生成物通过 `DATA_DIR=/app/data` 写库。
- **数据持久化（关键）**：`data/` 目录**按 project 固定**、跨版本共享；代码按 version 隔离 → 迭代/回滚不丢数据。
- **统一健康探针**：端口探活 + HTTP 200 + 静态入口存在（小游戏以 `index.html` 判定）；通过后登记 `version.ready`。
- **容器寻址**：run 容器在 internal 网络无端口映射，反代直接访问其容器 IP + 容器内端口（不记录 hostPort）。
- 启动自检：`docker info` 不可用时 health 明确报 `degraded`，不假装容器隔离。

---

## 8. 对话式迭代与版本/原子切换

- 用户消息 → `POST /api/projects/{id}/messages` → 入队 `iterate` 类型 build_job。
- **项目级串行队列**：同一 project 的 build 串行执行；新消息入队时把未完成的旧 iterate 标记 `superseded`（避免多 job 读同一基线互相覆盖）。
- worker 读取现有工程（文件清单 + 相关文件），产出**增量编辑**（优先 SEARCH/REPLACE，减少整文件重写漂移）。
- 新版本构建 + 健康检查通过 → **CAS 原子切换** `published_version_id` → 旧 run 容器 grace（如 30s）后回收。
- 版本表保留最近 N 个（如 3），支持一键回滚（切到历史 ready 版本）。
- `repair_round`（自修复轮次 ≤3）与 `build_job.attempts`（基础设施重试）**分开计数**。
- 全流程事件写 `build_event`，SSE 轮询回放（见 §9）。

---

## 9. 发布与公网访问

- **本地**：`http://localhost:3000/p/{slug}`（平台反代到 run 容器）。
- **ECS**：同一套 `docker-compose`/`serve.sh`，平台监听 80 → `http://<ECS_IP>/p/{slug}`；无需真实域名。
- **子路径改写（关键）**：反代注入 `<base href>` 并重写根相对 URL；生成物须用相对资源路径（`/api`、`/assets` 不带根），否则在 `/p/{slug}/` 下 404。
- 发布状态：`project.published_version_id` 控制；未发布仅 `/preview` 可见。
- **SSE**：支持 `Last-Event-ID` 游标增量回放 + 心跳；`build_event` 完成后定期清理，防断线重放全量与表膨胀。
- **Cookie 隔离**：平台会话 cookie 用 `__Host-`/前缀；反代转发前剥离平台会话 cookie，防生成应用 `Path=/` 污染。

---

## 10. 控制面数据模型（SQLite / better-sqlite3）

| 表 | 关键字段 |
|---|---|
| project | id, slug, name, idea, templateKey?, ownerToken, status(idle\|building\|ready\|failed), published_version_id?, createdAt, updatedAt |
| message | id, projectId, role(user\|assistant\|system), content, createdAt |
| version | id, projectId, n, status(building\|ready\|failed), containerId, containerIp?, containerPort, error?, createdAt |
| build_job | id, projectId, versionId, type(initial\|iterate\|retry), status(queued\|leased\|running\|superseded\|done\|failed), leaseUntil?, attempts, repair_round, error?, createdAt, updatedAt |
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
POST   /api/projects/{id}/messages       {content} → {jobId}（迭代 build，项目内串行）
POST   /api/projects/{id}/retry          → 重试失败构建
POST   /api/projects/{id}/publish        {published:bool}
POST   /api/projects/{id}/rollback       {versionId}（顺带能力）
GET    /api/projects/{id}/events         SSE：构建事件流（支持 Last-Event-ID 游标 + 心跳）
GET    /api/projects/{id}/messages       → 对话历史
GET    /p/{slug}/*                       反代 → 已发布版本 run 容器（子路径改写）
GET    /preview/{id}/{version}/*         反代 → 指定版本 run 容器（带 ownerToken 校验）
GET    /api/health                       DB / 隔离级别 / worker 心跳 / 队列积压
```

---

## 12. 评估指标

| 指标 | 说明 |
|---|---|
| 一次成型率 | initial 构建无需自修复即 ready 的比例 |
| 首版可运行率 | 有可用 run 容器且健康探针通过 |
| 端到端时延 | 提交 → 可访问（p50/p95） |
| 自修复收敛率 | repair_round ≤3 内修复成功比例 |
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

- **Skill（自建）**：`生成产物脚手架规范`（约定/预算/入口/相对路径/DATA_DIR）、`产物 E2E 验收`（起服务 + browser-use 跑主链路）。保留 `frontend-patterns`。
- **Subagent**：
  - 自定义（通用、可复用）：`代码审查`、`测试验证`（已建；项目上下文调用时传入）。
  - 其余用内置：架构/PRD → `Plan`；生成器实现/文档 → `全栈工程师` / `general-purpose` 兼。
- **MCP**：`browser-use`（预览联调/E2E）。
- **`.env` 键**：`DASHSCOPE_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`SESSION_SECRET`、`DB_PATH=./data/app.db`、`DATA_ROOT=./storage/projects`、`SANDBOX_IMAGE=ivanatoms/base:node22`、`BASE_URL`、`RUNTIME_ISOLATION=container`。

---

## 15. 24h 里程碑与风险

| 时段 | 目标 |
|---|---|
| H0–2 | 脚手架 + 控制面 DB + 基础镜像（预装依赖）+ 反代骨架 |
| H2–6 | Agent(生成/校验) + worker(串行队列) + build/run 双容器 + SSE |
| H6–10 | 预览/发布/本地公网链路打通（黄金用例 1 跑通） |
| H10–14 | 迭代增量编辑 + 版本 CAS 原子切换 + 持久化验证 |
| H14–18 | 用例 2/3（含小游戏）+ 异常降级 + UI 打磨 |
| H18–22 | E2E + browser-use 回归 + 指标采集 + 首批修复 |
| H22–24 | 部署脚本（本地→ECS）+ 说明文档 + buffer |

**H6 Gate（硬门槛）**：H6 前必须跑通 `tracker` 端到端主链路（生成→构建→预览→发布→迭代→持久化）；未达成则**砍掉小游戏**，全力保主链路与文档。

**主要风险与兜底**
- 免安装假象（ESM/vite）→ 首版强制 CJS+express+静态；镜像预置 `node_modules` 兜底。
- 构建慢/失败面大 → 精选依赖免安装 + 受控 install(90s 超时) + 有界自修复（≤3）+ 基础镜像缓存/预热。
- 模型代码不自洽 → 硬约定 + 文件预算 + 确定性校验前置。
- 时间不够 → 优先级：主链路跑通 > 迭代 > 持久化 > 小游戏 > 加分项（回滚/指标看板）；H6 Gate 未过直接砍小游戏。
- 演示风险 → 实机前 warm 3 个黄金用例，备录屏。

---

## 16. 关键取舍（并入交付文档）

1. **自由生成(Node) vs 纯模板**：取自由生成，产品上限高；靠"精选依赖 + 约定 + 自修复"换稳定，牺牲"任意语言/多框架"。
2. **精选依赖/免安装 vs 任意 npm install**：默认免安装秒起，超集走受控 install 兜底。
3. **三段角色流水线 vs 自主多智能体**：采用 Spec(Emma+Bob)→Engineer(Alex)→Review/Repair 结构化流水线（Mike 编排），兼顾可靠性与可观测；自主多智能体/Race Mode 延后。
4. **SQLite vs Postgres**：demo 足够，单实例；生产化再换。
5. **无注册（设备令牌）vs 账号体系**：按题意，用 ownerToken 支撑"我的项目"。
6. **本地优先 vs 直接上云**：本地验证 + 一键切 ECS，规避早期云端调试成本。
7. **数据/代码分离**：数据按项目固定、代码按版本 → 迭代不丢数据（兑现"持久化"要求）。
8. **不做增长闭环/计费/自定义域/i18n**：聚焦核心闭环与工程质量。
9. **构建/运行拆两容器 vs 单容器**：Docker 网络无法热切 → 拆成一次性 build(bridge) + 常驻 run(internal)，更安全但多一步编排。
10. **生成物限 CJS/相对路径 vs 任意前端工具链**：为保证免安装与子路径可用，首版约束 CJS + 相对资源；收益是秒起与部署简单。

---

## 17. 已知边界（交付时如实写明）
- 单实例 SQLite；容器隔离非生产级多租户。
- 生成物限 Node/npm 栈；依赖超集需联网安装。
- 生成物首版限 CommonJS + 相对资源路径（ESM/vite/TS 需镜像预置 `node_modules`，暂不默认）。
- 反代暂不支持 WebSocket（如游戏需要再评估）。
- 无配额/限流/滥用检测；无注册与权限体系。
- 模型质量决定首版成败，靠自修复兜底但非万能。