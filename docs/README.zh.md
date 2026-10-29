# dsh-plugin-github-issues

[English](../README.md) | 中文

[![ci](https://github.com/ckanner/dsh-plugin-github-issues/actions/workflows/ci.yml/badge.svg)](https://github.com/ckanner/dsh-plugin-github-issues/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-github-issues.svg)](https://www.npmjs.com/package/dsh-plugin-github-issues)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 增加一个 GitHub Issue 工作区：
按组织 / 仓库浏览 Issue，查看详情，并把 Issue 交给 Agent。交办会在匹配的
Workspace 里新开一个 Session，并在输入框内以"附件卡片"的形式暂存这个 Issue；点击发送时卡片会
转成 Issue 的提示词。已交办的 Issue 会显示处理它的 Session，可以进入，也可以解除关联；同一个
Issue 可以关联多个 Session。

![GitHub 面板：固定筛选栏 + 独立滚动的详情栏](../assets/panel.png)

插件对 GitHub **只读**，不会写入任何内容。

## 安装

从 npm 安装（推荐，包内已带构建好的 Host 半和浏览器 bundle）：

```sh
dsh plugin --profile <name> add dsh-plugin-github-issues
```

锁定版本：

```sh
dsh plugin --profile <name> add dsh-plugin-github-issues@0.4.7
```

安装后重启 DSH（profile 在启动时组装）。卸载：

```sh
dsh plugin --profile <name> remove dsh-plugin-github-issues
```

从源码目录安装（link 方式，改代码后需要重新 build 并重启）：

```sh
npm install
npm run build
dsh plugin --profile <name> add /path/to/dsh-plugin-github-issues
```

每个 [Release](https://github.com/ckanner/dsh-plugin-github-issues/releases) 也附带打包好的
`dsh-plugin-github-issues.tgz`，可以通过路径安装。

## 前置条件

- DSH Desktop（Web GUI；开发与验证于 `0.2.1-rc.3`）。
- 已登录的 `gh` CLI：`gh auth login`。token 留在系统钥匙串，不会写进插件配置。
- 面板以仓库为范围：先选组织、再选仓库（会自动选中默认项），然后按里程碑、assignee、状态收窄。

## 功能

| 界面 | 位置 | 内容 |
|---|---|---|
| GitHub 面板 | 左侧栏图标 → 主面板 | 组织 → 仓库 → **里程碑** → assignee → 状态 级联筛选（记住上次选择）固定在一行；组织和仓库会自动选中默认项，里程碑下拉只列当前仓库的里程碑；只有列表滚动，搜索在列表上方固定；详情栏独立滚动（正文、Milestone 进度、标签、优先级、assignee、关联/提及 PR 的 checks 与 review） |
| Issues 右栏 | 右侧栏页签 | 与对话同屏的同一份筛选列表，用于拖拽交办 |
| 输入框卡片 | 输入框内部 | 暂存的 Issue：`[GitHub] owner/repo#number ×`。可以补充自己的文字，也可以不写；发送时卡片转成提示词 |
| 已关联 chip | 输入框下方 dock | 当前 Session 关联的 Issue：状态圆点（open 绿 / closed 红）+ `owner/repo#number`；点击看详情，× 解除关联 |
| 交办操作 | Issue 详情 | 一键「进入 Session」（最新关联）、「再开一个 Session」；处理中的 Session 列表里每一项都能进入或解除 |
| GitHub 设置 | 设置 → GitHub | `gh` 登录状态与权限、交办行为、Prompt 模板 |

## 使用

1. 点击左侧栏 **GitHub** 图标。
2. 选择组织和仓库（默认自动选中第一个），再选里程碑、assignee 和状态。选择会记在 profile 的
   UI 状态里（不在插件配置中）。
3. 点一行查看详情；点 `owner/repo#number` 在浏览器打开 GitHub。
4. 交办：
   - 详情里点「交给 Agent」/「再开一个 Session」：在匹配的 Workspace 新开 Session，输入框内出现
     Issue 卡片；
   - 从右栏 **Issues** 页签拖一行到输入框：暂存到**当前** Session；
   - 输入想补充的内容（可不填）后发送：卡片转成 Issue 提示词（模板来自设置）+ 你输入的内容，
     同时记录 Issue ↔ Session 关联；
5. 输入框下方出现已关联 chip。之后可以进入那个 Session、再开一个，或解除关联（解除不会删除
   Session）。
6. 右栏可以从面板右上角「右栏」按钮打开，也可以在右侧栏自己的添加菜单里选 **Issues** 页签。

### 交办会去哪个 Session？

- 已关联：主按钮进入最新关联的那个；下方 Session 列表可以逐个进入；
- 新交办选择 Workspace 的优先级：当前 Session 的 Workspace → 已关联同仓库 Session 的 Workspace →
  目录名/标题与仓库名匹配的 Workspace → Host 当前/最近 Workspace。

### Prompt 模板

设置 → GitHub → Prompt 模板。变量：`{{repo}}`、`{{number}}`、`{{title}}`、`{{url}}`、`{{state}}`、
`{{milestone}}`、`{{priority}}`、`{{assignees}}`、`{{labels}}`、`{{prs}}`。

## 隐私与 token

- token 由 Host 进程从 `gh` 读取，只在内存中复用；不进页面、不进插件配置、不进日志。
- GitHub 请求都在 Host 完成，浏览器只拿到视图模型。
- 落盘的只有筛选偏好、Prompt 模板和 Issue ↔ Session 关联，位于
  `$DSH_HOME/github-issues/state.json`（权限 `0600`）。

## 限制

- 只读：不发评论、不改标签/指派/状态。
- 列表使用仓库的 `issues` 连接，状态、assignee、里程碑都由 GitHub 服务端过滤（总数也是权威的）；
  里程碑通过 `filterBy.milestoneNumber` 按编号过滤。
- 里程碑的可选项来自当前仓库的完整里程碑列表（含已关闭）。
- 优先级回退顺序：组织 Issue Field → `P0`–`P4` 标签（不再读取 Projects v2 项目字段）。
- 列表可见时每 60–120 秒轮询一次；需要立刻更新点「刷新」。
- 详情先请求正文，交叉引用 PR 懒加载，慢的 timeline 不阻塞面板。
- "发送时卡片转提示词"依赖 composer 的 DOM（原生发送按钮 / 回车），DSH 升级后需要重新核对。
- 新交办的 Workspace 匹配是上面的启发式优先级，不是固定映射。

## 开发

```sh
npm install
npm run typecheck
npm test               # node --test（查询、VM 映射、prompt、状态、workspace 规则）
npm run test:render    # 离线 react-dom/server 渲染烟测
npm run build          # Host (tsc) + 浏览器 bundle (esbuild)
npm run verify:client  # bundle 的加载契约与槽位/Remote 注册
npm run verify:package # npm publish 实际会带上的文件
npm run check          # 以上全部
```

## 发布

`ci.yml` 在 push / PR 时运行；`release.yml` 在 `v*` tag（或手动）时运行：重复所有检查、发布 npm
（仓库 `NPM_TOKEN` secret 或 npm trusted publishing），并创建携带 `dsh-plugin-github-issues.tgz`
的 GitHub Release。维护者说明见 [RELEASING.md](https://github.com/ckanner/dsh-plugin-github-issues/blob/main/docs/RELEASING.md)。

## License

MIT © Kanner
