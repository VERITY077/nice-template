---
layout: post
title: 用 Git 和 GitHub Pages 发布这个博客
date: 2026-10-10
excerpt: 一篇文章从 Markdown 文件变成可访问网址的完整路径，以及我踩过的坑。
tags:
  - Git
  - GitHub Pages
  - 建站记录
---

这个博客用一条很短的流水线工作：

```text
_posts/某篇文章.md
        ↓  git push
GitHub 仓库
        ↓  GitHub Actions 运行 Jekyll
静态 HTML
        ↓  deploy
https://verity077.github.io/nice-template/
```

我本地不需要安装 Ruby、Jekyll 或任何构建工具，编译全部发生在 GitHub 的服务器上。

## 一次完整的发布

```bash
git status                      # 先看改了什么
git diff                        # 再看具体改了哪些行
git add _posts/2026-10-10-calculus-limits.md
git commit -m "新增：微积分极限笔记"
git push
```

推送后打开仓库的 **Actions** 页面，会看到一个叫 `Build and deploy Jekyll site` 的任务。它跑完后页面就更新了，通常一两分钟。

## 文件放哪里

| 想改什么 | 改哪个文件 |
| --- | --- |
| 网站标题、描述、时区 | `_config.yml` |
| 首页文案、项目卡片 | `index.html` |
| 关于页 | `about.md` |
| 配色和排版 | `assets/style.css` |
| 文章正文 | `_posts/*.md` |
| 文章页模板 | `_layouts/post.html` |

## 新增一篇文章的模板

文件名必须是 `YYYY-MM-DD-title.md`，开头的 Front Matter 不能少：

```yaml
---
layout: post
title: 文章标题
date: 2026-10-10
excerpt: 一句话摘要，会显示在首页卡片上
tags:
  - 学习笔记
---
```

第二个 `---` 之后才是正文。`layout: post` 决定它用文章页模板；`excerpt` 会自动出现在首页和文章顶部。

## 我踩过的两个坑

**一、Front Matter 里的日期写错了。** 日期既影响首页排序，也影响网址生成（`permalink: /posts/:title/`）。写成本地日期，别写成未来的日期，否则文章看起来"消失"了——其实只是排到了最前面或没有生成。

**二、Pages 的来源没有设成 GitHub Actions。** 模板里的 workflow 负责构建和部署，但如果仓库的 **Settings → Pages → Source** 还停在 "Deploy from a branch"，网页就一直显示 404。确认它是 **GitHub Actions** 之后，推送才会真正生效。

## 为什么用 Git

对我这种容易改坏东西的人，Git 最大的价值不是协作，而是**可以退回去**。每次提交是一次存档，配上 `git diff`，我能清楚看到自己这一次到底动了什么。写文章和写代码在这里变成了同一件事：小步修改，随时可回退。
