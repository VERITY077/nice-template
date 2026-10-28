# 学习资料 Worker（Cloudflare Workers）

`/study/` 页面的线上后端：接收课件上传，在 Worker 内解析文字，调用 **DeepSeek 官方 API**，返回结构化的中文课件 JSON。

- 前端仍然是 GitHub Pages 静态页面，只调用本 Worker；浏览器里没有任何密钥。
- 密钥只放在 Cloudflare Worker Secret `DEEPSEEK_API_KEY`，不写进仓库、`wrangler.toml`、日志或响应。
- 不使用 DeepSeek Harness 桌面应用的本地配置作为线上后端。

## 目录

```text
worker/
  src/index.js      路由、CORS、限流、上传校验、错误映射
  src/config.js     环境变量与非敏感配置
  src/extract.js    DOCX / PPTX / TXT / MD 文本提取
  src/zip.js        基于 DecompressionStream 的极简 ZIP 读取
  src/pdf.js        用 unpdf 按页提取 PDF
  src/ai.js         DeepSeek 调用、JSON 解析、一次修复重试
  src/schema.js     结构化课件校验与规范化
  src/mock.js       本地模拟模式（AI_MOCK=1）
  test/             Node 原生测试与真实 DOCX/PPTX/PDF 样本
  wrangler.toml     非敏感 vars 与 Worker 配置
  .dev.vars.example 本地变量模板（不含真实密钥）
```

## 接口

```text
GET  /healthz         健康检查，返回 configured/mock/model/limits，不含密钥
POST /api/study-pack  multipart/form-data，字段名 files（可多个）
```

成功响应与 `pack` 结构见 `src/schema.js` 与根 README；失败统一为：

```json
{"ok": false, "error": {"code": "...", "message": "...", "hint": "...", "details": []}}
```

常见状态码：`400` 请求问题、`403` 来源不允许、`413` 过大、`415` 格式不支持、`422` 解析失败/内容不足、`429` 限流、`502` DeepSeek 异常、`503` 未配置密钥、`504` DeepSeek 超时。

## 环境变量

| 名称 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | **Secret** | 无 | 只通过 `wrangler secret put` 或 Dashboard 设置 |
| `DEEPSEEK_API_BASE` | var | `https://api.deepseek.com` | DeepSeek 官方地址，不要带结尾斜杠 |
| `DEEPSEEK_MODEL` | var | `deepseek-chat` | 当前官方文档支持的模型名，可随文档调整 |
| `ALLOWED_ORIGINS` | var | `https://verity077.github.io,...` | 逗号分隔，CORS 白名单 |
| `MAX_FILES` | var | `3` | 单次最多文件数 |
| `MAX_FILE_MB` | var | `5` | 单文件上限 |
| `MAX_TOTAL_MB` | var | `10` | 单次合计上限 |
| `MAX_CHARS` | var | `60000` | 送进模型的文本上限 |
| `MAX_PDF_PAGES` | var | `60` | PDF 最多处理页数 |
| `RATE_LIMIT_PER_HOUR` | var | `20` | 每 IP 每小时请求数（实例内内存计数） |
| `AI_MOCK` | var | `0` | 仅本地联调；线上必须为 `0` |

`wrangler.toml` 里只放非敏感 vars；不要添加 `DEEPSEEK_API_KEY`。

## 本地开发

需要 Node.js 22+ 与 pnpm（仅后端开发使用；博客本身仍然不需要 Node.js）：

```bash
cd worker
pnpm install

cp .dev.vars.example .dev.vars   # 默认 AI_MOCK=1，不调用真实模型
pnpm dev                         # 默认 http://127.0.0.1:8787
```

本地真实调用 DeepSeek（可选，密钥只在你本机 `.dev.vars`）：

```text
AI_MOCK=0
DEEPSEEK_API_KEY=你的本地临时key
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
ALLOWED_ORIGINS=http://localhost:8000,http://127.0.0.1:8000
```

`.dev.vars` 已在 `.gitignore` 中，不要提交。

## 部署（需要你的 Cloudflare 账号）

### 方式 A：Wrangler CLI（推荐）

```bash
cd worker
pnpm install
npx wrangler login                 # 浏览器里由你本人授权
npx wrangler secret put DEEPSEEK_API_KEY   # 按提示粘贴，不会回显
npx wrangler deploy
```

部署成功后 Wrangler 会输出 `https://verity-study.<你的子域>.workers.dev`。

检查：

```bash
curl https://verity-study.<你的子域>.workers.dev/healthz
# 期望 "configured": true, "mock": false
```

### 方式 B：Cloudflare Dashboard + Git 集成

1. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Import a repository**。
2. 选择 GitHub 仓库 `VERITY077/nice-template`。
3. 设置：
   - 根目录 / Root directory：`worker`
   - Build command：`pnpm install`
   - Deploy command：`pnpm exec wrangler deploy`
4. 创建后进入 Worker → **Settings → Variables and Secrets**：
   - 添加 **Secret**：`DEEPSEEK_API_KEY`（只在这里填一次）
   - 非敏感变量可保持 `wrangler.toml` 里的值，也可在 Dashboard 覆盖。
5. 打开 Dashboard 里提供的 `*.workers.dev` 地址的 `/healthz` 确认 `configured: true`。

> 不需要把 Cloudflare 密码、Cookie 或 API Token 发给任何人；授权由你在浏览器里完成。

## 接前端

把 Worker 的 **HTTPS 根地址**（不要带 `/api`、不要带结尾斜杠）填到仓库根目录：

```yaml
# _config.yml
study_api_base: "https://verity-study.<你的子域>.workers.dev"
```

push 后 GitHub Pages 会自动重建，`/study/` 页面从 `data-api-base` 读到该地址。

## 平台限制与合理上限

- **Cloudflare Workers 免费计划 CPU 上限 10 ms/请求**。PDF 解析（pdf.js）很容易超过，PDF 在免费计划上可能失败；要稳定支持 PDF，请使用 Workers Paid。
- 平台请求体上限约 100 MB，但本应用限制合计 10 MB、单文件 5 MB，远低于平台限制。
- 内存上限 128 MB；PDF 页数限制 60 页、文本限制 60,000 字符。
- 打包体积约 **590 KiB gzip**（含 `unpdf`），低于免费计划 3 MB。
- 生成请求超时 90 秒（可用 `AI_TIMEOUT_MS` 调整，最大值 120 秒）。

## 安全与隐私

- 密钥只在 Worker Secret；响应、日志、源码和打包产物都不含密钥。
- 文件只在内存中解析，不落盘、不进仓库或公开存储。
- 前后端都校验扩展名与大小；Worker 还会核对文件头（`%PDF-`、ZIP 内的 `word/`/`ppt/`）。
- CORS 默认只允许 `https://verity077.github.io` 与本地开发地址。
- 日志只记录未处理异常的类型，不记录请求体、文件内容或密钥。
- 限流是**单个 Worker 实例内**的内存计数，重启清零、跨实例不共享，属于尽力而为的防滥用，不替代 Cloudflare 限流/WAF。
- DeepSeek 的数据处理取决于 DeepSeek 的数据政策；本 Worker 不做超出实现的保留/删除承诺。

## 测试与检查

```bash
cd worker
pnpm test          # 34 项 Node 原生测试：解析、结构、CORS、限制、AI 错误映射
pnpm dry-run       # 只打包，不上传；确认 bundle 体积
```

已在本机用 `wrangler dev --local` 验证：PDF/PPTX/DOCX 解析、mock 生成、CORS 预检、415/413/400/403/429，以及指向本地 DeepSeek 形状 stub 的真实请求路径（stub 收到 Bearer，响应不含密钥）。

## 尚未由本仓库验证

- **Worker 尚未部署**（需要你的 Cloudflare 账号授权）。
- **真实 DeepSeek 生成尚未验证**（需要你在 Cloudflare 设置 `DEEPSEEK_API_KEY`；本仓库没有、也不应该有任何真实密钥）。
- 部署后请按上面的 `/healthz` 与页面流程做一次真实生成；若 `configured: false` 或返回 `AI_NOT_CONFIGURED`，检查 Secret 名称是否为 `DEEPSEEK_API_KEY`。
