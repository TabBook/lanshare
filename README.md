# LanShare —— 局域网私人分享站

自托管版"QQ 文件传输助手"：单用户、多设备、纯局域网的消息时间线，在手机与电脑间传文本、剪贴板与大文件。

- **轻量**：单二进制（纯 Go + SQLite，无 CGO），scratch 镜像，空闲内存 < 50MB
- **快速**：局域网满速传输、冷启动可交互 < 1s、5000+ 条历史消息流畅滚动
- **强大**：分块并发上传、断点续传、Range 下载（兼容 aria2/IDM）、全局搜索（Word 式命中高亮 + 逐条跳转）、日期跳转、Markdown 渲染、PWA、自动清理

## 部署

两种方式任选其一。部署完成后打开 `http://<主机IP>:10088`，输入 TOKEN 并给设备起名即可。手机浏览器可"添加到主屏幕"作为 PWA 使用（注：PWA 安装与离线缓存要求 HTTPS 或 localhost；纯 HTTP 的局域网 IP 下网页功能完整，只是没有"安装"入口）。

### 方式一：Docker（推荐）

```bash
git clone <repo> lanshare && cd lanshare
cp .env.example .env        # 编辑 .env，把 TOKEN 改成自己的长随机串
docker compose up -d
```

镜像从 scratch 构建，最终只含一个静态二进制（约 17MB）。数据通过 `./data` 目录挂载持久化，**备份该目录即完整备份**；`restart: unless-stopped` 保证开机自启。

不用 compose 也可以直接 run：

```bash
docker build -t lanshare .
docker run -d --name lanshare --restart unless-stopped \
  -p 10088:10088 -e TOKEN=<你的令牌> -e TZ=Asia/Shanghai \
  -v ./data:/data lanshare
```

### 方式二：直接部署（裸二进制）

零运行时依赖：纯 Go + 内嵌 SQLite（无 CGO）+ go:embed 前端，编译产物是一个约 12MB 的静态二进制，复制到任何同架构 Linux 机器即可运行。

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

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TOKEN` | （必填） | 访问令牌，所有请求凭它准入 |
| `DATA_DIR` | `/data` | 数据目录（SQLite + 文件），备份它即完整备份 |
| `MAX_STORAGE` | `50GB` | 存储上限；超出后从最旧的文件消息删起，文本永不自动删 |
| `PORT` | `10088` | 监听端口 |
| `TZ` | 系统时区 | "跳转到日期"按此时区解析（二进制已内嵌 tzdata，scratch 容器中也生效） |

### 数据目录结构

```
/data
├── share.db (+ -wal/-shm)   # SQLite
├── files/ab/abcdef...        # 文件实体（ID 两级散列）
├── thumbs/                   # 缩略图（可整目录删除，会按需重建）
└── tmp/                      # 上传分块暂存（48h 自动清理）
```

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
