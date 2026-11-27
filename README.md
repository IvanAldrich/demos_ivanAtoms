# IvanAtomsDemo

用一句话想法 → 自建 AI Agent 生成一个**可运行的 Node 全栈站点**（网站 / Web app / 浏览器小游戏）→ 在 Docker 沙箱构建运行 → 公网 URL 访问 → 支持**对话式增量迭代**与**数据持久化**。

> 24h 面试 Demo。设计规格与实现计划见 `docs/superpowers/`。非生产系统，请勿存放真实数据。

## 架构（简）

```
Browser ── Next.js 15 控制面（API + SSE + 内置反代 /p/{slug} /preview）
              │  入队 build_job（SQLite）
              ▼
         worker（串行队列 + lease + superseded）
              │  Spec → Engineer → 校验 → Docker build/run → health → Review/Repair(≤3)
              ▼
         Docker 沙箱：一次性 build 容器(bridge) + 常驻 run 容器，代码按版本、数据按项目挂载
```

## 快速开始（本地）

前置：Node 22、Docker（daemon 可用）。

```bash
cp .env.example .env            # 填入 DASHSCOPE_API_KEY
docker build -t ivanatoms/base:node22 -f docker/base-node22.Dockerfile docker/

npm install
npm run dev                     # 终端 1：Next 控制面 (http://localhost:3000)
npm run worker                  # 终端 2：构建执行器
```

首页输入想法（或点模板）→ `/chat/{id}` 看 SSE 进度与 iframe 预览 → 发布得到 `/p/{slug}`。

## 测试

```bash
npm run typecheck
npm test                        # 单测 + Docker 集成测试（需 docker + 基础镜像）
npm run build
```

## 部署到 ECS（公网 IP 访问，无需域名）

1. ECS 安装 Node 22 与 Docker（daemon 可用）。
2. 拷贝仓库，`cp .env.example .env` 填 `DASHSCOPE_API_KEY`、`SESSION_SECRET`；如需公网域名子路径可设 `BASE_URL`。
3. `bash scripts/serve.sh`（自动构建基础镜像 → `npm run build` → 同时起 web:3000 与 worker）。
4. 浏览器访问 `http://<ECS_IP>:3000/`；发布的应用在 `http://<ECS_IP>:3000/p/<slug>`。

> 说明：控制面与 worker 直接跑在主机（借用主机 Docker 起沙箱容器），最省心；未提供容器化控制面的 compose，以避免 docker-in-docker 复杂度。

## API

```
POST /api/projects            {idea, templateKey?} → {projectId, slug}
GET  /api/projects            我的项目（owner cookie）
GET  /api/projects/{id}       详情（含 versions/messages）
DELETE /api/projects/{id}
POST /api/projects/{id}/messages  {content} → 入队迭代
POST /api/projects/{id}/publish   {published}
POST /api/projects/{id}/rollback  {versionId}
POST /api/projects/{id}/retry
GET  /api/projects/{id}/events    SSE（Last-Event-ID 游标）
GET  /api/health
GET  /p/{slug}/*              反代到已发布 run 容器
GET  /preview/{id}/{version}/* 反代到指定版本 run 容器
```

## 关键取舍 / 已知边界

见 `docs/deliverable.md`。要点：自由生成限 Node/CJS、依赖限预装集（express）+ Node 内置、持久化用 `DATA_DIR` 下 JSON；Docker 容器隔离非生产级多租户；无注册（owner cookie）；反代未支持 WebSocket。