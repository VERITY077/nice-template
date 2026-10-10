# Verity · 个人博客

用 Markdown 写作、Jekyll 渲染、GitHub Actions 自动发布的静态个人博客。

- **线上地址**：https://verity077.github.io/nice-template/
- **仓库地址**：https://github.com/VERITY077/nice-template

## 这个博客怎么工作

```text
_posts/某篇文章.md
      ↓  git push
GitHub 仓库
      ↓  GitHub Actions 运行 Jekyll
静态 HTML
      ↓  deploy
https://verity077.github.io/nice-template/
```

写作只需要关心 `_posts/*.md`。**本地不需要安装 Ruby、Jekyll、Node.js 或 npm**，编译发生在 GitHub 的服务器上。

## 站点配置

关键信息都集中在 `_config.yml`：

```yaml
title: Verity · 个人博客
description: 记录编程、数学与写作的个人博客
timezone: Asia/Shanghai
author: Verity
email: 1362691318@qq.com
github_username: VERITY077
url: https://verity077.github.io
baseurl: ""
permalink: /posts/:title/
```

改了 `email` 或 `github_username`，首页的邮件按钮和页脚链接会自动跟着变，不用去改 HTML。

## 文件都在做什么

```text
_posts/                       文章（Markdown）
_config.yml                   站点配置：标题、描述、时区、邮箱、GitHub 用户名
index.html                    首页：首屏文案 + 项目卡片
about.md                      关于页
assets/style.css              全部样式与配色
_layouts/default.html         页面框架：导航、页脚、<head>
_layouts/post.html            文章页模板
.github/workflows/pages.yml   自动构建与发布
README.md                     这份说明（已在 _config.yml 中 exclude，不会出现在网站上）
```

常用改动对照：

| 想改什么 | 改哪个文件 |
| --- | --- |
| 网站标题、描述、时区、邮箱 | `_config.yml` |
| 首页文案、项目卡片 | `index.html` |
| 关于页 | `about.md` |
| 配色和排版 | `assets/style.css` |
| 文章正文 | `_posts/*.md` |
| 导航和页脚 | `_layouts/default.html` |

## 写一篇新文章

1. 在 `_posts/` 新建文件，**文件名必须是 `YYYY-MM-DD-标题.md`**，例如 `2026-10-15-c-array-notes.md`。
2. 开头必须有 Front Matter，`layout: post` 不能省：

```yaml
---
layout: post
title: 文章标题
date: 2026-10-15
excerpt: 一句话摘要，会显示在首页卡片和文章顶部
tags:
  - 学习笔记
---
```

3. 第二个 `---` 之后直接写 Markdown 正文：标题、列表、链接、引用、代码块都可以用。

代码块这样写，会按等宽字体排版：

````text
```c
int main(void) { return 0; }
```
````

文章网址由文件名里的标题部分自动生成：`2026-10-15-c-array-notes.md` → `/posts/c-array-notes/`。

### 放图片

图片先放进 `assets/` 目录，正文里用相对路径引用：

```markdown
![说明文字](../assets/图片名.png)
```

暂时没有图片也没关系，不影响发布。

## 发布流程

```bash
cd ~/Desktop/网页

git status                  # 先看改了什么
git diff                    # 再看具体改了哪些行

git add -A                  # 或只加指定文件：git add _posts/新文章.md
git commit -m "新增：文章标题"
git push
```

推送后打开仓库的 **Actions** 页面，等 `Build and deploy Jekyll site` 变成绿色（通常 40 秒左右），刷新博客就能看到。

只改一两个字时，也可以直接在 GitHub 网页上编辑文件并提交，效果一样。

## 一个要注意的限制

**这台电脑无法本地预览。** 系统自带的 Ruby 是 2.6.10，而 Jekyll 现在的依赖要求 Ruby ≥ 3.0，装不上，所以本地跑不了 `jekyll serve`。

含义是：**写完直接 push，然后看线上结果**。如果构建出错，Actions 页面会变红，日志里能直接看到原因。正常写 Markdown 不会出问题。

## 约定

- 不引入 React、Vue、Node.js、npm、外部 CDN 或新的构建工具。样式只写在 `assets/style.css` 里。
- 字体使用系统字体栈，不加载外部字体。
- Front Matter 里的 `date` 要和文件名里的日期一致，也不要写成未来的日期，否则首页排序会显得奇怪。

## 仓库设置（一般不用动）

- 可见性：public（GitHub Pages 免费账户只支持公开仓库）
- Pages 来源：**Settings → Pages → Source = GitHub Actions**（已配好）
- 部署分支：`main`

## 给 Agent 的说明

```text
这是一个 Jekyll 静态个人博客，线上地址 https://verity077.github.io/nice-template/。
请先读取 _config.yml、index.html、_layouts 和 _posts，再动手修改。

新增文章只在 _posts/ 里创建 YYYY-MM-DD-title.md，使用现有 Front Matter 与 layout: post。
不要引入 React、Vue、Node.js、npm、外部 CDN 或新的构建工具；不要重写整个模板。
改完检查 Front Matter、相对路径、文章链接和 git diff，然后 commit 并 push 到 main。
推送后确认 GitHub Actions 的 Build and deploy Jekyll site 成功，并核对线上页面可访问。
```
