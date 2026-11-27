# IvanAtomsDemo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户输入一句话想法，自建 AI Agent 生成一个可运行的 Node 全栈站点（网站/App/小游戏），在 Docker 沙箱构建运行、公网访问，并支持对话式增量迭代与数据持久化。

**Architecture:** Next.js 15 控制面（含反代）+ 独立 worker（SQLite 队列表，项目级串行）解耦；生成走三段角色流水线 Spec→Engineer→Review/Repair（Mike=编排状态机）；沙箱为「一次性 build 容器(bridge) → 常驻 run 容器(internal)」双容器；代码按版本隔离、数据按项目固定挂载实现持久化；健康检查后 CAS 原子切换发布指针。

**Tech Stack:** Node 22 / TypeScript / Next.js 15 App Router + React 19 / better-sqlite3(WAL) / Docker / DashScope OpenAI 兼容 SDK / Vitest / browser-use(E2E)。

**Spec:** `docs/superpowers/specs/2026-11-27-ivanatoms-demo-design.md`

## Global Constraints

- 运行时：Node 22，包管理 npm；TypeScript strict。
- 控制面 DB：`better-sqlite3`（WAL），路径 `DB_PATH`（默认 `./data/app.db`）；手写 repository，简单 SQL 迁移。
- 模型：DashScope OpenAI 兼容端点 `LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`；`LLM_MODEL` 可配（默认 `qwen3-coder-plus`）；Key 取自 `DASHSCOPE_API_KEY`。
- 基础镜像：`ivanatoms/base:node22`，预装 `express`、`better-sqlite3` 等常用依赖并设 `NODE_PATH`；生成物**强制 CommonJS + 相对资源路径**，禁 ESM `import`/vite/TS。
- 文件预算：≤ 12 文件、单文件 ≤ 32KB、总 ≤ 200KB。
- 数据目录：生成物必须以 `DATA_DIR`（= `/app/data`）读写，保证持久化。
- 构建：npm 国内镜像；`npm install` 硬超时 90s，超时降级为“预装集内重建”。
- 健康探针：端口探活 + HTTP 200 + 静态入口存在（小游戏以 `index.html` 判定）。
- 自修复：`repair_round ≤ 3`（与 `build_job.attempts` 基础设施重试**分开计数**）。
- 队列：同一 project 串行；新消息把未完成旧 iterate 置 `superseded`。
- SSE：支持 `Last-Event-ID` 游标增量 + 心跳；`build_event` 完成后定期清理。
- 反代：注入 `<base href>` 并重写根相对 URL；剥离平台会话 cookie；平台 cookie 用前缀。
- 鉴权：无注册；`ownerToken` HttpOnly cookie（随机 UUID）隔离“我的项目”。
- 部署：开发期 `localhost`；交付期 `docker-compose`/`serve.sh` 到 ECS，公网 IP 访问，无需域名。

## Review Focus

1. **根相对资源路径**：生成物若用 `/assets/x.js`、`fetch('/api/x')`，在 `/p/{slug}/` 下必须仍能加载（反代注入 `<base>` + 校验禁绝对根路径）。测试归属 Task 15 / Task 7。
2. **非 CJS 代码**：生成物若含 `import`/vite/TS 导致“免安装秒起”失效，必须在校验阶段被拒并回喂（`E_FORBIDDEN_MODULE`）。测试归属 Task 7。
3. **并发消息覆盖**：同项目连发两条 iterate，必须串行且旧任务被 `superseded`，不得后写覆盖前写。测试归属 Task 12。
4. **迭代失败不打断线上**：新版本构建/健康失败时，旧已发布 run 容器继续服务，发布指针不被切换。测试归属 Task 16。
5. **持久化丢失**：`data/` 目录按项目固定、跨版本共享；迭代/重启后已写入数据仍在。测试归属 Task 11。

---

## File Structure

```
package.json / tsconfig.json / next.config.ts / .env.example / vitest.config.ts
docker/
  base-node22.Dockerfile        # 基础镜像：Node22 + 预装依赖 + NODE_PATH + 探针脚本
  compose.yaml                  # 控制面 + worker + 网络（run 容器 internal）
src/
  env.ts                        # 读取/校验 env
  lib/
    owner.ts                    # ownerToken cookie 读写
    db.ts                       # better-sqlite3 连接 + schema 初始化
    repo/{projects,messages,versions,jobs,events}.ts
  engine/
    llm.ts                      # DashScope OpenAI 兼容客户端（可注入 mock）
    prompts.ts                  # 三段 prompt 模板
    schema.ts                   # SiteSpec / violations 的 zod schema
    validate.ts                 # 确定性校验 + violations 码
    patches.ts                  # SEARCH/REPLACE 解析与应用
    stages/{spec,engineer,review}.ts
    pipeline.ts                 # Mike 编排（initial|iterate）
  sandbox/
    docker.ts                   # build/run 容器创建、mount、清理
    health.ts                   # 健康探针
    proxy-url.ts                # <base> 注入 + 根相对 URL 重写
  worker/
    main.ts                     # 轮询 claim + 串行 + superseded + lease/heartbeat
  templates/{tracker,landing,game}.ts
  app/
    layout.tsx / page.tsx       # 首页（想法 + 模板）
    dashboard/page.tsx
    chat/[id]/page.tsx
    p/[slug]/route.ts           # 反代已发布 run 容器（子路径改写）
    preview/[id]/[version]/route.ts
    api/health/route.ts
    api/projects/route.ts
    api/projects/[id]/route.ts
    api/projects/[id]/messages/route.ts
    api/projects/[id]/retry/route.ts
    api/projects/[id]/publish/route.ts
    api/projects/[id]/rollback/route.ts
    api/projects/[id]/events/route.ts
tests/
  unit/{validate,patches,proxy-url,sse-cursor,cas}.test.ts
  integration/{queue,pipeline-sandbox}.test.ts
scripts/{serve.sh,warm.sh}
README.md
```

---

## Task 1: 脚手架、env 与测试框架

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `src/env.ts`

**Interfaces:**
- Produces: `loadEnv(): Env`（`{DASHSCOPE_API_KEY?,LLM_BASE_URL,LLM_MODEL,DB_PATH,DATA_ROOT,SANDBOX_IMAGE,BASE_URL,RUNTIME_ISOLATION}`，缺关键项抛错）；`npm test` 可跑。

- [ ] **Step 1: 写失败测试** `tests/unit/env.test.ts`：`loadEnv()` 在缺 `DB_PATH` 时用默认 `./data/app.db`；缺 `LLM_BASE_URL` 抛 `MissingEnvError`。
- [ ] **Step 2: 运行确认失败** `npx vitest run tests/unit/env.test.ts` → FAIL（未定义）。
- [ ] **Step 3: 实现** 初始化 Next 15+TS+Vitest；`src/env.ts` 导出 `loadEnv`/`MissingEnvError`；`.env.example` 列出全部键。
- [ ] **Step 4: 运行确认通过** 同上 → PASS；`npm run typecheck` 通过。
- [ ] **Step 5: Commit** `git add -A && git commit -m "chore: scaffold next15+ts+vitest and env loader"`

## Task 2: 控制面 DB 与 repository

**Files:**
- Create: `src/lib/db.ts`, `src/lib/repo/{projects,messages,versions,jobs,events}.ts`；Test: `tests/unit/repo.test.ts`

**Interfaces:**
- Produces: `openDb(path)`；`projects.create({slug,idea,ownerToken})→Project`、`projects.listByOwner(token)`；`jobs.enqueue({projectId,versionId,type})`、`jobs.claimNext()→Job|null`、`jobs.setStatus(id,status,extra?)`；`events.append(jobId,level,message,data?)`、`events.since(jobId,afterId)`；`versions.create/ready/failed`。
- 表字段严格对齐 spec §10（`build_job` 含 `repair_round`、`status` 含 `superseded`；`version` 用 `containerIp/containerPort`，无 `hostPort`）。

- [ ] **Step 1: 写失败测试** `repo.test.ts`：临时 db 上 create project → `listByOwner` 命中；enqueue→claimNext 返回并可置 `running`；`events.since` 按 id 过滤。
- [ ] **Step 2: 运行确认失败** `npx vitest run tests/unit/repo.test.ts` → FAIL。
- [ ] **Step 3: 实现** schema 初始化（PRAGMA WAL）+ 5 个 repo 模块。
- [ ] **Step 4: 运行确认通过** 同上 → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(db): sqlite schema and repositories"`

## Task 3: 基础镜像与健康探针

**Files:**
- Create: `docker/base-node22.Dockerfile`, `sandbox/probe/server.js`（镜像内探针）, `src/sandbox/health.ts`；Test: `tests/unit/health.test.ts`

**Interfaces:**
- Produces: `checkHealth(baseUrl,{isStatic,timeoutMs}): Promise<{ok,reason?}>`（TCP + GET / 200 + 静态入口存在；静态→要求 `index.html`）。
- 镜像：Node22、预装 express/better-sqlite3、设 `NODE_PATH`、npm 镜像、非 root、含探针脚本。

- [ ] **Step 1: 写失败测试** `health.test.ts`：起一个本地 http 服务返回 200 → `checkHealth` ok；服务 500 → `ok:false, reason:'http_status'`。
- [ ] **Step 2: 运行确认失败** `npx vitest run tests/unit/health.test.ts` → FAIL。
- [ ] **Step 3: 实现** `health.ts` + Dockerfile（`docker build -t ivanatoms/base:node22 docker/`）。
- [ ] **Step 4: 验证** 示例：容器内 `node -e "require('express')"` 成功；`docker run` 起探针 → `checkHealth` ok。
- [ ] **Step 5: Commit** `git commit -m "feat(sandbox): base image and health probe"`

## Task 4: 沙箱管理器（build/run 双容器 + 挂载）

**Files:**
- Create: `src/sandbox/docker.ts`；Test: `tests/integration/pipeline-sandbox.test.ts`（本任务先建最小样例）

**Interfaces:**
- Produces:
  - `buildVersion({projectId,version,files,needsInstall}): Promise<{ok,logTail}>`：起 `build` 容器(bridge,可写)，写 `versions/v{n}.tmp` 后 `rename` 为 `v{n}`，销毁 build 容器；`needsInstall` 时 `npm install`(90s 超时)。
  - `runVersion({projectId,version,portEnv}): Promise<{containerId,containerIp}>`：起 `run` 容器(internal,只读 rootfs)，挂 `/app/code=v{n}(ro)`、`/app/data=project data(rw)`，返回容器 IP。
  - `stopContainer(id)`, `reapOrphans()`。
- 约束：run 容器 `--cap-drop ALL`、`no-new-privileges`、pids/mem/cpu 限额；不与宿主共享 env。

- [ ] **Step 1: 写失败测试** integration：用最小 `server.js`(`require('express')` 监听 `$PORT`) 走 `buildVersion`→`runVersion`→`checkHealth(containerIp)` → ok；再次 run 同 mount data 写入文件后重建，数据仍在。
- [ ] **Step 2: 运行确认失败** `npx vitest run tests/integration/pipeline-sandbox.test.ts` → FAIL（依赖 docker 可用）。
- [ ] **Step 3: 实现** `docker.ts`（用 `docker` CLI 或 dockerode；先 CLI 降低依赖）。
- [ ] **Step 4: 运行确认通过** 同上 → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(sandbox): build/run containers with mounts"`

## Task 5: LLM 客户端 + SiteSpec/violations schema

**Files:**
- Create: `src/engine/llm.ts`, `src/engine/schema.ts`, `src/engine/prompts.ts`；Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Produces: `class LlmClient { completeJSON<T>(msgs, schema): Promise<T> }`（OpenAI 兼容；可注入 fake）；`SiteSpecSchema`、`ViolationsSchema`（zod）；`PROMPTS.spec/engineer/review`。

- [ ] **Step 1: 写失败测试** `schema.test.ts`：合法 spec 通过；`category` 非枚举/`fileManifest` 缺 `path` 时 `SiteSpecSchema.safeParse` 失败。
- [ ] **Step 2: 运行确认失败** `npx vitest run tests/unit/schema.test.ts` → FAIL。
- [ ] **Step 3: 实现** 三个文件；`completeJSON` 用 `response_format` 或解析+校验，失败抛 `SchemaError`。
- [ ] **Step 4: 运行确认通过** 同上 → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(engine): llm client and site-spec schema"`

## Task 6: Spec 阶段

**Files:**
- Create: `src/engine/stages/spec.ts`；Test: `tests/unit/spec-stage.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `SiteSpecSchema`。
- Produces: `runSpec({idea,template?,existingManifest?}): Promise<SiteSpec>`；约束 `fileManifest.length ≤ 12`，含 `techConstraints.runtime='node22-cjs'`、`assetPaths='relative'`、`dataDirEnv='DATA_DIR'`。

- [ ] **Step 1: 写失败测试** fake llm 返回超 12 文件的 spec → `runSpec` 抛 `BudgetError`；正常返回 → 字段齐全。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** 组装 prompt → `completeJSON` → 校验 + 预算裁剪/报错。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(engine): spec stage"`

## Task 7: 确定性校验器

**Files:**
- Create: `src/engine/validate.ts`；Test: `tests/unit/validate.test.ts`

**Interfaces:**
- Produces: `validateArtifacts({files,spec,mode:'initial'|'iterate'}): {ok, violations: Violation[]}`；码：`E_ENTRY_MISSING/E_PKG_INVALID/E_FILE_BUDGET/E_PATCH_AMBIGUOUS/E_ABS_PATH/E_FORBIDDEN_DEP/E_FORBIDDEN_MODULE`。
  - `E_FORBIDDEN_MODULE`：检测 `import ... from`/`.ts`/`vite` 等非 CJS。
  - `E_ABS_PATH`：HTML/JS 中出现 `="/` 或 `'/` 根相对资源（除 `//` 协议）。

- [ ] **Step 1: 写失败测试** 每个码各一条：入口缺失、pkg 非法、超预算、绝对路径、`import x from 'y'`、`require('lodash')`(非预装)。断言对应码命中。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(engine): deterministic validator"`

## Task 8: SEARCH/REPLACE 补丁解析与应用

**Files:**
- Create: `src/engine/patches.ts`；Test: `tests/unit/patches.test.ts`

**Interfaces:**
- Produces: `applyPatches(files: Map<string,string>, patches: Patch[]): {files, violations}`；`Patch={path,search,replace}`；search 必须在目标文件**唯一命中**，否则 `E_PATCH_AMBIGUOUS`。

- [ ] **Step 1: 写失败测试**：唯一命中→替换成功；0 处或 >1 处→ `E_PATCH_AMBIGUOUS`；跨文件互不影响。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(engine): search/replace patch applier"`

## Task 9: Engineer 阶段

**Files:**
- Create: `src/engine/stages/engineer.ts`；Test: `tests/unit/engineer-stage.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `applyPatches`。
- Produces: `runEngineer({spec,mode,existingFiles?,userMessage?}): Promise<{files?:File[]; patches?:Patch[]}>`；initial→files，iterate→patches。

- [ ] **Step 1: 写失败测试**：fake llm 返回 files → initial 结果 files 非空；iterate 返回 patches → 经 `applyPatches` 产出新 files。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** prompt 注入相关文件（≤8 个/≤32KB）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(engine): engineer stage"`

## Task 10: Review/Repair 与修复计数

**Files:**
- Create: `src/engine/stages/review.ts`；Test: `tests/unit/review-loop.test.ts`

**Interfaces:**
- Produces: `runReviewRepair({round,spec,currentFiles,failure}): Promise<{files?;patches?;diagnosis}>`；`nextRound(round): {retry:true,round+1} | {retry:false}`（`round>=3` 停）。

- [ ] **Step 1: 写失败测试**：round=0,1,2 → 可重试；round=3 → 停止；diagnosis 非空。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(engine): review/repair stage"`

## Task 11: 流水线编排（Mike，initial + iterate）

**Files:**
- Create: `src/engine/pipeline.ts`；Test: `tests/integration/pipeline-sandbox.test.ts`（扩展：mock LLM + 真实 sandbox）

**Interfaces:**
- Consumes: spec/engineer/validate/patches/review/sandbox。
- Produces: `runPipeline(job, deps): Promise<{status:'ready'|'failed',versionId,error?}>`；流程 Spec→Engineer→validate→build→run→health→(fail)Review/Repair(repair_round<3)→ready；每步 `events.append`；ready 时以 CAS 更新发布指针（若 project.published）；失败达 3 轮→`version.failed` + 兜底页。

- [ ] **Step 1: 写失败测试**：mock LLM 产出 tracker 样例 → 流水线 ready 且 run 容器可访问、data 落库；mock LLM 首轮故意坏代码、次轮修好 → repair 收敛。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** `pipeline.ts` + 兜底页资源。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(engine): mike pipeline orchestration"`

## Task 12: worker 循环（串行 + superseded + lease）

**Files:**
- Create: `src/worker/main.ts`；Test: `tests/integration/queue.test.ts`

**Interfaces:**
- Produces: `tick(db, deps)`：claim 一个 job；同 project 已有 running → 跳过并把排队中的旧 iterate 置 `superseded`；处理中周期 `heartbeat(leaseUntil)`；完成写 status。

- [ ] **Step 1: 写失败测试**：同 project 入队两个 iterate，`tick` 只处理一个，另一个变 `superseded`；lease 过期可被重新 claim。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**（`npm run worker` 入口）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(worker): serial queue with supersede and lease"`

## Task 13: 控制面 API（owner + projects + messages + publish/rollback/retry）

**Files:**
- Create: `src/lib/owner.ts`, `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `.../messages/route.ts`, `.../publish/route.ts`, `.../rollback/route.ts`, `.../retry/route.ts`, `src/app/api/health/route.ts`；Test: `tests/integration/api.test.ts`

**Interfaces:**
- Produces：按 spec §11 的端点；`POST /api/projects` 创建并 enqueue initial；`messages` enqueue iterate（项目串行）；`publish` 置 `published_version_id`；`rollback` 切历史 ready；`health` 返回 DB/隔离级别/worker 心跳/队列积压。

- [ ] **Step 1: 写失败测试**：无 cookie 访问 → 自动下发 ownerToken；创建项目→列表含之；他人 token 不可见；messages 入队 jobs 增加。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**（Route Handlers，复用 repo）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(api): projects/messages/publish/rollback/retry/health"`

## Task 14: SSE 事件流（游标 + 心跳 + 清理）

**Files:**
- Create: `src/app/api/projects/[id]/events/route.ts`, `src/lib/sse-cursor.ts`；Test: `tests/unit/sse-cursor.test.ts`

**Interfaces:**
- Produces: `parseLastEventId(header): number`；SSE：`event: build`，`id:` 用 build_event.id；`Last-Event-ID` 之后增量回放；每 15s 心跳；job 完成 N 天后清理事件。

- [ ] **Step 1: 写失败测试**：cursor 解析；`since(afterId)` 只返回更大 id。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** route（ReadableStream）+ 清理任务。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(api): SSE with Last-Event-ID cursor and heartbeat"`

## Task 15: 反代与子路径改写

**Files:**
- Create: `src/sandbox/proxy-url.ts`, `src/app/p/[slug]/route.ts`, `src/app/preview/[id]/[version]/route.ts`；Test: `tests/unit/proxy-url.test.ts`

**Interfaces:**
- Produces: `rewriteHtml(html, basePath): html`（注入 `<base href="/p/{slug}/">`，把 `="/x"`、`'/x'`、`url(/x)` 重写为相对）；route 用 `http` 转发到 `containerIp:containerPort`，剥离平台 cookie，透传 SSE/流。

- [ ] **Step 1: 写失败测试**：`/assets/a.js`→`assets/a.js` 或 `<base>` 后可用；`//cdn` 不改；`fetch('/api')`→相对。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(proxy): subpath rewrite and reverse proxy"`

## Task 16: 发布指针 CAS 与版本保留/回滚

**Files:**
- Modify: `src/lib/repo/projects.ts`, `src/lib/repo/versions.ts`；Create: `src/lib/cas.ts`；Test: `tests/unit/cas.test.ts`

**Interfaces:**
- Produces: `casPublish(projectId, expectVersion, nextVersion): boolean`（仅当当前指针=expect 才切）；`retain(projectId, keep=3)`（保护 published 与正在运行）；`rollback(projectId, versionId)` 复用 CAS。

- [ ] **Step 1: 写失败测试**：并发两路 CAS，仅一路成功；retain 后保留 ≤3 且含 published。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**（`UPDATE ... WHERE published_version_id=?`）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(release): CAS publish pointer and version retention"`

## Task 17: 前端（首页 + 工作区 + 对话/预览）

**Files:**
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/chat/[id]/page.tsx`

**Interfaces:**
- Consumes: 上述 API/SSE。
- Produces: 首页（想法输入 + 模板卡片）提交→跳 `/chat/{id}`；dashboard 列表；chat 页：消息流、SSE 进度、iframe 预览（`/preview/{id}/{version}`）、Publish/Rollback 按钮、继续对话框。

- [ ] **Step 1: 写失败测试（组件级）**：首页提交调用 `POST /api/projects`（mock fetch）；chat 页渲染 SSE 事件与 iframe src。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现**（Tailwind/简约样式；复用 `frontend-patterns`）。
- [ ] **Step 4: 验证** `npm run build` 通过；手动走查首页→chat→预览。
- [ ] **Step 5: Commit** `git commit -m "feat(ui): home, dashboard, chat with sse preview"`

## Task 18: 模板（tracker / landing / game 种子）

**Files:**
- Create: `src/templates/{tracker,landing,game}.ts`, `src/templates/index.ts`

**Interfaces:**
- Produces: `templates.list()`、`templates.get(key)`；每个含 `brief` 与可选 `seedFiles`（可运行、CJS、相对路径、用 `DATA_DIR`）。

- [ ] **Step 1: 写失败测试**：`get('tracker').seedFiles` 可被 `validateArtifacts` 判 ok；`game` 种子含 `index.html`。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** 三种子。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(templates): tracker/landing/game seeds"`

## Task 19: 部署（compose/serve/warm）+ README 与健康

**Files:**
- Create: `docker/compose.yaml`, `scripts/serve.sh`, `scripts/warm.sh`, `README.md`, `.env.example`(完善)

**Interfaces:**
- Produces: 一键起控制面+worker；`warm.sh` 预热基础镜像并跑 3 个黄金用例；README 含本地/ECS 部署步骤、env、演示路径、已知边界。

- [ ] **Step 1: 写失败测试（冒烟）**：`tests/integration/api.test.ts` 扩展：进程起来后 `GET /api/health` → `{db:'ok',isolation:'container',workerHeartbeat:true}`。
- [ ] **Step 2: 运行确认失败** → FAIL。
- [ ] **Step 3: 实现** compose/serve/warm/README。
- [ ] **Step 4: 验证** `bash scripts/serve.sh` 后 localhost 首页可开；health ok。
- [ ] **Step 5: Commit** `git commit -m "chore(deploy): compose, serve, warm, readme"`

## Task 20: E2E 黄金用例 + 交付文档

**Files:**
- Create: `tests/e2e/golden.md`（用例脚本/步骤）, `docs/deliverable.md`（思路取舍/完成度/扩展）

**Interfaces:**
- 用 `测试验证` 子代理（browser-use）执行：tracker 持久化、预约表单迭代不丢数据、小游戏可玩 + 迭代；异常输入降级。

- [ ] **Step 1: 写 E2E 步骤**（golden.md）：三条用例 + 异常，含判据与证据采集点。
- [ ] **Step 2: 执行** 用 `测试验证` 子代理跑，记录 pass/fail + 截图/日志。
- [ ] **Step 3: 修复** 失败项回到对应任务修复（走 `代码审查` 复核）。
- [ ] **Step 4: 写交付文档** `docs/deliverable.md`（引用 spec §16 取舍）。
- [ ] **Step 5: Commit** `git commit -m "test(e2e)+docs: golden cases and deliverable"`

---

## Self-Review

- **Spec coverage**：§3 旅程→T17；§4 架构→T1/T4/T11/T12/T15；§5 引擎→T5–T11；§6 模板→T18；§7 沙箱→T3/T4；§8 迭代/版本→T12/T16；§9 公网/反代→T15/T19；§10 数据→T2；§11 API→T13/T14；§12 指标→T13(health)/T20；§13 验收→T20；§14 环境→已建 agent，T19 warm；§15 里程碑→任务顺序对齐；§16/§17→`docs/deliverable.md`。无遗漏。
- **Step scan/Type consistency**：`validateArtifacts`、`applyPatches`、`casPublish`、`runPipeline`、`checkHealth` 命名在各任务一致；`version` 无 `hostPort`（用 `containerIp/containerPort`）。
- **Review Focus**：5 条已分别绑定 T15/T7/T12/T16/T11 的测试。
- **Proportion**：任务以签名/测试断言为主，未铺陈实现体。

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-11-27-ivanatoms-demo.md`.