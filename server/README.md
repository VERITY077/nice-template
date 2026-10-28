# 学习资料生成后端

给博客 `/study/` 页面使用的轻量 API：接收课程文件，解析文字，调用 OpenAI 兼容模型，返回结构化的中文课件 JSON。

- 前端：GitHub Pages 静态页面，只发起请求，不持有任何密钥。
- 后端：本目录的 Python 服务（标准库 HTTP + `pypdf`），可部署在 Render / Fly.io / Railway / 任意 Docker 主机。
- 密钥：只从服务端环境变量读取，响应和日志里都不会出现。

## 目录

```text
server/
  app.py            HTTP 服务、路由、CORS、限流、multipart 解析
  config.py         环境变量配置
  extract.py        DOCX / PPTX / PDF / TXT / MD 文本提取
  ai.py             OpenAI 兼容调用、JSON 解析、修复重试
  schema.py         输出结构校验与规范化
  requirements.txt  唯一第三方依赖 pypdf
  Dockerfile        以仓库根目录为构建上下文
  .env.example      环境变量模板（不要提交真实密钥）
  tests/            解析、结构、API 的自动化测试与样本文件
```

## 接口

```text
GET  /healthz         健康检查，不返回密钥
POST /api/study-pack  multipart/form-data，字段名 files（可多个）
```

成功响应：

```json
{
  "ok": true,
  "pack": {
    "title": "...",
    "course": "...",
    "sourceLanguage": "English",
    "overview": "...",
    "learningGoals": ["..."],
    "sections": [
      {"id": "s1", "title": "...", "summary": "...", "keyPoints": [{"text": "...", "sources": [{"file": "a.pptx", "locator": "slide 3"}]}], "terms": [{"term": "...", "explanation": "..."}], "sources": [{"file": "a.pptx", "locator": "slide 3"}]}
    ],
    "glossary": [{"original": "...", "translation": "...", "note": "..."}],
    "quiz": [{"id": "q1", "type": "single", "question": "...", "options": ["..."], "answer": "...", "explanation": "...", "sources": [{"file": "a.pptx", "locator": "slide 3"}]}],
    "sources": [{"file": "a.pptx", "locator": "slide 1"}],
    "warnings": ["..."]
  },
  "meta": {"model": "deepseek-chat", "elapsedMs": 12345, "mock": false, "files": [{"name": "a.pptx", "kind": "pptx", "units": 12}], "warnings": []}
}
```

失败响应统一为：

```json
{"ok": false, "error": {"code": "FILE_TOO_LARGE", "message": "「x.pdf」超过单个文件上限 20 MB。", "hint": "...", "details": []}}
```

常见状态码：`400` 请求问题、`403` 来源不允许、`413` 文件过大、`415` 格式不支持、`422` 无法解析或内容不足、`429` 频率/并发限制、`503` 未配置密钥、`504` AI 超时。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `AI_API_KEY` | 是 | 无 | 服务端密钥，绝不返回给前端 |
| `AI_API_BASE` | 否 | `https://api.deepseek.com/v1` | OpenAI 兼容地址（不要带结尾斜杠） |
| `AI_MODEL` | 否 | `deepseek-chat` | 模型名 |
| `ALLOWED_ORIGINS` | 否 | `https://verity077.github.io` | 允许的站点来源，逗号分隔 |
| `PORT` | 否 | `8787` | 监听端口（Render 会自动注入） |
| `AI_TIMEOUT_SECONDS` | 否 | `120` | 调用模型超时 |
| `MAX_FILES` | 否 | `5` | 单次最多文件数 |
| `MAX_FILE_MB` | 否 | `20` | 单文件上限 |
| `MAX_TOTAL_MB` | 否 | `40` | 单次合计上限 |
| `MAX_EXTRACTED_CHARS` | 否 | `120000` | 送进模型的文本上限，超出会截断并提示 |
| `RATE_LIMIT_PER_HOUR` | 否 | `20` | 每 IP 每小时请求数（进程内内存计数） |
| `MAX_CONCURRENT_JOBS` | 否 | `2` | 同时生成的任务数 |
| `AI_MOCK` | 否 | `0` | 仅本地联调：`1` 返回模拟课件，不调用模型 |

`AI_API_BASE` 兼容 OpenAI、DeepSeek、Moonshot、通义、OpenRouter，以及本地 Ollama（把 base 指向 `http://host:11434/v1` 并填任意 key）。

## 本地运行

```bash
cd <仓库根目录>
python3 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt

cp server/.env.example server/.env    # 填入 AI_API_KEY 等
set -a; . server/.env; set +a         # 本服务不会自动加载 .env

python -m server.app
```

没有密钥也想看页面效果时：

```bash
AI_MOCK=1 PORT=8787 python -m server.app
```

## 部署到 Render（推荐，免费额度即可）

1. 打开 [Render](https://render.com) → **New → Web Service**，连接 GitHub 仓库 `VERITY077/nice-template`。
2. Language 选 **Docker**；**Dockerfile Path** 填 `server/Dockerfile`；**Docker Context Directory** 填 `.`（必须是仓库根目录，因为镜像里要保留 `server/` 这个包）。
3. 在 **Environment** 里添加：
   - `AI_API_KEY`（Secret）
   - `AI_API_BASE`（例如 `https://api.deepseek.com/v1`）
   - `AI_MODEL`（例如 `deepseek-chat`）
   - `ALLOWED_ORIGINS=https://verity077.github.io`
4. 部署完成后打开 `https://<服务名>.onrender.com/healthz`，确认 `"configured": true`。
5. 回到博客仓库，把 `_config.yml` 里的 `study_api_base` 改成这个地址，push。

> Render 免费实例在闲置后会休眠，第一次请求要等几十秒唤醒；前端超时是 180 秒，通常够用。

其他平台同理：只要能用 `server/Dockerfile` 构建，或能运行 `pip install -r server/requirements.txt` + `python -m server.app` 即可。注意 `ALLOWED_ORIGINS` 必须写博客的 origin（协议 + 域名，不带路径）。

## 前端接入

`_config.yml`：

```yaml
study_api_base: "https://<你的后端地址>"   # 留空时页面显示「后端尚未接入」
study_max_files: 5
study_max_file_mb: 20
study_max_total_mb: 40
```

后端与前端限制应保持一致或更严格。

## 安全与隐私

- 密钥只在服务端环境变量中；前端代码、静态资源、仓库里都没有密钥。
- 文件只在内存中解析，不写入磁盘，也不进入仓库或公开存储。
- CORS 只允许 `ALLOWED_ORIGINS` 中的来源；`OPTIONS` 预检返回 204。
- 前后端都校验扩展名与大小；后端还会核对文件头（`%PDF-`、ZIP 内的 `word/`/`ppt/`），拒绝改后缀的伪造文件。
- 日志只有方法、路径、状态码和耗时，不记录文件内容或密钥。
- 限流是**单进程内存计数**，重启会清零，也不能替代 WAF；多实例部署时各实例独立计数。

需要如实说明的边界：**没有账号、没有历史记录、没有文件删除接口**（因为根本不落盘）；AI 服务商如何处理数据取决于你选择的提供商，本服务不做额外承诺。

## 测试

```bash
cd <仓库根目录>
python -m unittest discover -s server/tests -t .
```

测试使用 `tests/fixtures/` 里的小样本（DOCX/PPTX/PDF/TXT），并启动一个 mock AI 的本地服务，覆盖：文本提取与出处标记、扩展名/文件头校验、结构规范化、CORS、格式与大小拒绝、限流、未配置密钥。

## 已知限制

- 扫描版 PDF（纯图片）无法提取文字，会明确报错并要求先 OCR。
- 旧版 `.ppt` / `.doc` 不支持，需要另存为 `.pptx` / `.docx`。
- 超长材料按 `MAX_EXTRACTED_CHARS` 截断，并在结果里提示。
- DOCX 没有真实页码，出处用章节标题；PPTX 按幻灯片编号，PDF 按页码。
- 模型输出质量取决于所选模型；结构由 `schema.py` 强校验，缺关键内容会重试一次，仍失败则报错而不是伪造。
