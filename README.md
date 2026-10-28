# Course Studio

自托管的本地音频课程播放器：课程分类、搜索、进度同步、连续播放、播放队列、定时停止、课程及课时收藏。

播放页可复制或系统分享课时链接，接收者登录后可直接打开对应课时。

## 开始使用

需要 Node.js 24 或更新版本。Windows、macOS、Linux 均可运行，无需外部数据库。

```sh
git clone https://github.com/cicadabear/course-studio.git
cd course-studio
npm ci
npm run setup
npm start
```

打开 http://localhost:3000，在本机注册账号。每门课程放在单独的文件夹中，默认目录为 `media/courses/课程名/` 和 `media/youth/课程名/`；支持常见音频及配套 PDF。只管理自己有权使用的文件，本仓库不包含课程内容。

## 配置

`npm run setup` 从 `config.example.json` 创建本机 `config.json`，不会覆盖已有配置。

- `mediaRoot` / `mediaRoots`：主课程目录和附加目录，可改成绝对路径；`collections` 中的 `root` 要保持一致。
- `collections`：目录名称与分组；`shelf` 为 `courses` 或 `youth`，分别显示在课程和少年课程中。
- `host` / `port`：默认仅本机访问；需要局域网访问时把 `host` 改为 `0.0.0.0`，并自行设置防火墙。
- `publicHosts`：可选的额外禁止注册地址列表。公网域名默认禁止注册，无需逐个添加。应用直接读取 `X-Forwarded-For`（缺省使用 `X-Real-IP`）和 `X-Forwarded-Proto`，无需代理 IP 白名单；代理应传递访问域名并覆盖访客地址。
- `scanRulesFile`：可选扫描排除规则；参考 `scan-rules.example.json`，留空则不使用规则。

首次启动自动扫描；新增文件后执行 `npm run scan`，扫描不修改原文件。学习数据保存在 `data/`，可用 `COURSE_DATA_DIR` 指定独立目录，不能放进媒体目录。

## 维护

`npm test` 运行测试；`npm run backup` 备份数据库。更新前保留本机配置和整个 `data/` 目录。

注册要求来源 IP 属于本机或局域网，且访问地址为 `localhost` 或本机/局域网 IP；通过公网域名访问时关闭注册，已有账号仍可登录。同一 IP 密码连续错误 5 次锁定 12 小时。iOS 桌面 Web App 的后台恢复可能受系统限制。

数据库、媒体、日志、实际配置和证书均已加入 `.gitignore`；不要把账号凭据或真实配置提交到仓库。
