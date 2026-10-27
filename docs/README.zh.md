# dsh-plugin-github-issues（中文说明）

在 DeepSeek Harness 里浏览 GitHub Issue，并把一个 Issue 交给 Agent 处理。

插件会给 DSH Web GUI 增加一个 **GitHub 面板**：选择仓库或 Projects v2 项目，查看
「分配给我 / 我创建的 / 全部 Open」的 Issue，读出状态、Milestone、标签、优先级、
assignee 与关联 PR 的状态；把 Issue 拖进输入框（或输入框下方的交办条），就能让 Agent
拿到一份结构化的任务 prompt。

**只读**：插件不会向 GitHub 写入任何内容。

## 功能

| 界面 | 位置 | 内容 |
|---|---|---|
| GitHub 面板 | 左侧栏图标 → 主面板 | 筛选、列表、详情（正文、Milestone 进度、标签、优先级、assignee、关联/提及 PR 的 checks 与 review 状态） |
| 交办条 | 输入框下方 | 显示当前固定的 Issue，一键填入草稿/直接发送，支持拖放 |
| GitHub 设置 | 设置 → GitHub | `gh` 登录状态与权限、交办行为、Prompt 模板 |

## 前置条件

- 带 Web GUI 的 DSH Desktop（开发验证于 0.2.1-rc.3）。
- 已登录的 `gh` CLI：`gh auth login`（token 留在系统钥匙串）。
- 需要 Projects v2 时，一次性补权限：
  `gh auth refresh -h github.com -s read:project`

  没有该权限时面板照常工作，只是项目选择器会说明缺什么。

## 安装

```sh
# 从本地目录安装（link 方式；改代码后需重新 build 并重启）
dsh plugin --profile desktop add /path/to/dsh-plugin-github-issues
```

也可以在 设置 → 插件 → 添加插件 里传入同一个绝对路径，然后重启 DSH 并刷新页面。

卸载：

```sh
dsh plugin --profile desktop remove dsh-plugin-github-issues
```

## 使用

1. 点击左侧栏的 GitHub 图标。
2. 选择 **分配给我 / 我创建的 / 全部 Open**，或某个仓库、某个项目。
3. 点一行查看详情；点 `owner/repo#123` 在浏览器打开 GitHub。
4. 交给 Agent：
   - 详情里的 **交给 Agent**：跳到对话并把 prompt 填进输入框（审阅后回车）。
   - **拖拽** 行到输入框（原生文本拖放）或输入框下方的交办条。
   - 交办条随时可以 **填入草稿 / 直接发送** 当前固定的 Issue。
5. 设置 → GitHub：查看授权与权限、选择「只填草稿/直接发送」、编辑 Prompt 模板。

模板变量：`{{repo}}` `{{number}}` `{{title}}` `{{url}}` `{{state}}`
`{{milestone}}` `{{priority}}` `{{assignees}}` `{{labels}}` `{{prs}}`。

## 隐私与 token

- token 由 Host 进程向 `gh` 读取，只在内存中短暂复用；不进页面、不进插件配置、不进日志。
- Issue 数据由 Host 进程请求 GitHub，再以纯视图模型转给浏览器。
- 落盘的只有界面偏好（选中的仓库/项目、固定的 Issue、模板），位于
  `$DSH_HOME/github-issues/state.json`。

## 限制（v0.1）

- 只读：不发评论、不改标签/指派/状态。
- Projects v2 需要 `read:project`；优先级按「项目字段 → 组织 Issue Field → `P0`–`P4` 标签」回退。
- 列表在可见时每 60–120 秒轮询一次；需要立刻更新请点刷新。
- 右栏页签形态在后续版本；当前拖拽目标是输入框。

## 开发

```sh
npm install
npm run typecheck     # 含浏览器半的整仓类型检查
npm test              # node --test（查询、VM 映射、prompt、状态）
npm run build         # Host 半（tsc）+ 浏览器 bundle（esbuild）
npm run verify:client # 校验 bundle 的加载契约与槽位注册
```

架构：Host 半读 token 并调 GraphQL；浏览器半自挂载手写的 Typert Remote 命名空间
（`ctx.remote.$mount`），通过 `ctx.get('remote.githubIssues')` 调用。浏览器 bundle
只从页面模块表取 React，不 import 任何 Harness 客户端包，因此 DSH 升级不会因内部
组件签名变化而弄坏它。

## License

MIT
