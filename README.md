# LanShare —— 局域网私人分享站

自托管版"QQ 文件传输助手"：单用户、多设备、纯局域网的消息时间线，在手机与电脑间传文本、剪贴板与大文件。

- **轻量**：单二进制（纯 Go + SQLite，无 CGO），scratch 镜像，空闲内存 < 50MB
- **快速**：局域网满速传输、冷启动可交互 < 1s、5000+ 条历史消息流畅滚动
- **强大**：分块并发上传、断点续传、Range 下载（兼容 aria2/IDM）、全局搜索（Word 式命中高亮 + 逐条跳转）、日期跳转、Markdown 渲染、PWA、自动清理

## 部署

两种方式任选其一。部署完成后打开 `http://<主机IP>:10088`，输入 TOKEN 并给设备起名即可。手机浏览器可"添加到主屏幕"作为 PWA 使用（注：PWA 安装与离线缓存要求 HTTPS 或 localhost；纯 HTTP 的局域网 IP 下网页功能完整，只是没有"安装"入口）。

### 方式一：Docker（推荐）

**1. 克隆仓库**

```bash
git clone https://github.com/TabBook/lanshare.git && cd lanshare
```

**2. 配置访问令牌（可跳过）**

```bash
cp .env.example .env
openssl rand -hex 16        # 生成一个随机串，填进 .env 的 TOKEN=
```


**这一步也可以直接跳过**：不配置 TOKEN 时服务照常启动，首次打开网页会引导你设置一个令牌（存进数据目录，重启不丢）。

**3. 构建并启动**

```bash
docker compose up -d
```

首次会自动完成三阶段构建（Node 编译前端 → Go 编译后端 → scratch 打包），最终镜像只含一个静态二进制（约 17MB）。启动后打开 `http://<主机IP>:10088`，输入 TOKEN 即可。

**常用操作**

```bash
docker compose logs -f          # 看日志
docker compose restart          # 重启
docker compose down             # 停止（数据在 ./data，不会丢）
git pull && docker compose up -d --build   # 更新到新版本
tar czf backup.tar.gz data/     # 备份（data 目录就是全部数据）
```

**改端口**：编辑 `docker-compose.yml` 的 `ports`，比如想用 9000 对外：改成 `"9000:10088"` 即可，容器内端口不用动。

**离线安装**（无法访问构建源时）：从 [Releases](../../releases) 下载镜像包，

```bash
docker load -i lanshare-v1.0.0-docker-image-amd64.tar.gz
docker run -d --name lanshare --restart unless-stopped \
  -p 10088:10088 -e TOKEN=<你的令牌> -e TZ=Asia/Shanghai \
  -v ./data:/data lanshare:latest
```

### 方式二：直接部署（裸二进制）

零运行时依赖：纯 Go + 内嵌 SQLite（无 CGO）+ go:embed 前端，编译产物是一个约 12MB 的静态二进制，复制到任何同架构 Linux 机器即可运行。

可以直接从 [Releases](../../releases) 下载现成的 linux-amd64 二进制（跳过下面的构建步骤），或自行构建：

```bash
# 构建（需 Node 22+ 与 Go 1.26+）
cd web && npm ci && npm run build && cd ..
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/lanshare .

# 运行
TOKEN=<你的令牌> DATA_DIR=/var/lib/lanshare PORT=10088 lanshare
```

建议用 systemd 守护（`/etc/systemd/system/lanshare.service`）：

```ini
[Unit]
Description=LanShare
After=network.target

[Service]
Environment=TOKEN=<你的令牌>
Environment=DATA_DIR=/var/lib/lanshare
Environment=PORT=10088
ExecStart=/usr/local/bin/lanshare
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now lanshare
```

## 配置说明

### 访问令牌（TOKEN）

整站只有这一道门：TOKEN 相当于全站密码，知道它的设备才能读写消息和文件，所以**务必用长随机串**（推荐 `openssl rand -hex 16` 生成），不要用 `123456` 这类弱口令——尤其当你做了端口转发、局域网外也能访问时。

令牌有两种设置方式，按优先级：

1. **`TOKEN` 环境变量**（`.env` / compose / systemd）——设置了就用它，且网页设置入口关闭
2. **首次运行网页设置**——没配环境变量时，第一次打开网页会出现"设置访问令牌"页面，输入两遍即可；令牌存进数据目录的数据库，重启不丢

其他说明：

- 浏览器首次打开会要求输入 TOKEN 并给设备起名，之后凭证存在本地，不用每次输
- 更换令牌：环境变量方式改 `.env` 后 `docker compose up -d`；网页设置方式可随时用 TOKEN 环境变量覆盖。换令牌后所有设备回到登录页重新输入，聊天记录不受影响
- API 调用时通过 `Authorization: Bearer <token>` 头携带；文件下载链接和 WebSocket 也接受 `?token=` 查询参数（方便 aria2/IDM 这类外部下载器）
- 安全提示：未设置令牌期间，局域网内**第一个**打开网页的人将完成设置。正常家庭/小团队网络无所谓；如果环境不可信，请直接用环境变量预设

### 配置文件

| 文件 | 作用 |
|---|---|
| `.env` | 存放 TOKEN（从 `.env.example` 复制），含密钥、不入库 |
| `.env.example` | TOKEN 配置模板 |
| `docker-compose.yml` | Docker 部署定义：端口映射、环境变量、`./data` 数据挂载、开机自启策略 |
| `Dockerfile` | 三阶段构建：Node 编译前端 → Go 编译静态二进制 → scratch 打包 |
| `.dockerignore` / `.gitignore` | 确保运行数据（`data/`）和密钥（`.env`）不进镜像、不进仓库 |

除 TOKEN 外没有别的配置文件，其余全部通过环境变量调整：

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TOKEN` | （可选） | 访问令牌；不设则首次打开网页时引导设置，见上文 |
| `DATA_DIR` | `/data` | 数据目录（SQLite + 文件），备份它即完整备份 |
| `MAX_STORAGE` | `50GB` | 存储上限；超出后从最旧的文件消息删起，文本永不自动删。支持 `500MB`/`2GB`/`1TB` 写法 |
| `PORT` | `10088` | 监听端口（Docker 部署一般改 compose 的端口映射即可，不用动它） |
| `TZ` | 系统时区 | "跳转到日期"按此时区解析（二进制已内嵌 tzdata，scratch 容器中也生效） |

### 数据目录结构

```
/data
├── share.db (+ -wal/-shm)   # SQLite
├── files/ab/abcdef...        # 文件实体（ID 两级散列）
├── thumbs/                   # 缩略图（可整目录删除，会按需重建）
└── tmp/                      # 上传分块暂存（48h 自动清理）
```

## 项目结构

```
.
├── main.go               # 入口：读环境变量、装配路由、优雅退出
├── static.go             # 静态资源服务：预压缩 .gz、hash 文件名 immutable 缓存
├── api/                  # HTTP 层（标准库 net/http，无框架）
│   ├── api.go            #   路由注册、Bearer 鉴权中间件、JSON 工具
│   ├── messages.go       #   时间线分页 / 搜索 / 日期锚点 / 发文本 / 删除
│   ├── uploads.go        #   分块上传：初始化、收块、续传查询、合并
│   ├── files.go          #   文件下载（Range/ETag）与缩略图
│   ├── devices.go        #   设备注册 / 改名 / 移除
│   └── ws.go             #   WebSocket hub，推送新消息 / 删除事件
├── store/                # 数据层（SQLite，modernc 纯 Go 驱动，无 CGO）
│   ├── store.go          #   建库建表、WAL、单写多读连接、自动清理
│   ├── messages.go       #   消息查询 / 搜索（LIKE，预留 FTS5 切换点）
│   ├── uploads.go        #   分块落盘、位图记录、合并校验
│   └── devices.go        #   设备表
├── thumb/                # 服务端缩略图生成（纯 Go 图像解码）
├── web/                  # 前端（React 19 + Vite + Tailwind 4）
│   ├── src/App.jsx       #   布局：侧边栏 + 时间线 + 输入框
│   ├── src/useTimeline.js#   数据引擎：双向 keyset 分页、锚点窗口、WS 去重合并
│   ├── src/upload.js     #   分块并发上传 + localStorage 断点续传指纹
│   ├── src/components/   #   时间线、消息气泡、图片网格、灯箱、搜索结果等
│   └── embed.go          #   go:embed 把 dist 打进二进制
├── e2e/                  # Puppeteer 端到端测试（虚拟滚动、上传续传、搜索、PWA）
├── Dockerfile            # 三阶段构建 → scratch 镜像
└── docker-compose.yml    # 推荐部署方式
```

前后端各自只有一层抽象：`api` 只管 HTTP 进出，`store` 只管数据，前端组件只消费 `useTimeline`。改任何一层基本不用动另外两层。

## API 简表

所有 `/api` 端点要求 `Authorization: Bearer <token>`；文件下载与 WS 额外接受 `?token=`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/devices` | 注册设备 `{name}` → `{device_id}`，后续请求带 `X-Device-Id` |
| GET / PATCH / DELETE | `/api/devices[/:id]` | 列出 / 改名 / 移除设备 |
| GET | `/api/messages?before=<id>&limit=50` | 时间线倒序分页（keyset） |
| GET | `/api/messages?after=<id>` | 正序分页 |
| GET | `/api/messages?anchor=2026-03-15` | 日期锚点（也接受消息 id），返回前后各 25 条 |
| GET | `/api/messages?q=词&type=file\|image\|text` | 搜索 / 过滤，可与分页参数组合 |
| POST | `/api/messages` | 发文本 `{type:"text", content}` |
| DELETE | `/api/messages/:id` | 删除（连同文件实体与缩略图） |
| POST | `/api/uploads` | 初始化上传 `{name,size,mime}` → `{upload_id, chunk_size, received}` |
| PUT | `/api/uploads/:id/chunks/:n` | 上传第 n 块（原始字节，8MB/块，可并发） |
| GET | `/api/uploads/:id` | 断点续传查询 → `{received:[...]}` |
| POST | `/api/uploads/:id/complete` | 校验合并，生成消息 |
| GET | `/api/files/:id?token=` | 下载（支持 Range / ETag / immutable 缓存） |
| GET | `/api/files/:id/thumb?token=` | 缩略图 |
| WS | `/api/ws?token=` | 服务端推送 `new_message` / `message_deleted` |
| GET | `/api/stats` | `{used, limit, message_count}` |

## 外部下载器

文件下载端点支持 Range 与 `?token=`，外部多线程下载器可直接使用。在文件消息上复制下载链接，或自行拼接：

```bash
# aria2 16 线程下载
aria2c -x16 -s16 "http://<IP>:10088/api/files/<file_id>?token=<TOKEN>&dl=1"

# curl 断点续传
curl -C - -O "http://<IP>:10088/api/files/<file_id>?token=<TOKEN>&dl=1"
```

IDM / NDM 等图形下载器直接粘贴带 token 的 URL 即可，自动多线程。

## 开发

```bash
# 后端（端口 18080 供前端代理）
TOKEN=t0ken DATA_DIR=/tmp/lanshare-data PORT=18080 go run .

# 前端热更新
cd web && npm install && npm run dev

# 测试
go test ./... -race          # 后端单测（分块合并、断点续传、清理、分页边界）
cd e2e && node smoke.mjs     # 浏览器端到端（需本机 chromium）
```

构建产物：`cd web && npm run build`（含 .gz 预压缩）→ `go build`（go:embed 嵌入 dist）。

## 设计要点

- ULID 主键：时间有序，直接作 keyset 分页游标，杜绝 OFFSET
- SQLite WAL + 单写多读：写操作走专用单连接串行化，读连接并发
- 分块上传全链路流式落盘，内存占用与文件大小无关
- 搜索隔离在 `store` 层独立函数（LIKE），将来可无痛切换 FTS5
- 静态资源构建期预压缩 .gz，运行时零压缩开销；hash 文件名 + immutable 缓存
- WS 单 hub 广播，慢客户端直接断开重连，绝不阻塞
