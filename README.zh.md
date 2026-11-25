# MCP 工作台

[English](README.md) | 中文

一个 DeepSeek Harness 插件，在左侧栏【插件】和插件市场之后加一个 **MCP** 入口。它列出当前 profile 挂载的 MCP 服务器，编辑官方 `@deepseek-ai/dsh-mcp-manager` 那一行里的服务器，启停它们，探测它们对外提供的工具，并允许你带着按工具 schema 预填的参数直接发起调用——在页面上可以做，模型通过一个工具也能做。

## 它能做什么

- **看见全部服务器。** profile 补丁里的静态 `@deepseek-ai/dsh-mcp-client` 行、profile 的 `@deepseek-ai/dsh-mcp-manager` 行里的服务器、以及其它插件通过 `mcpManager` 注册的服务器，都在同一个可搜索列表里，带传输方式、运行状态与端点。
- **管理管理器那一行。** 新增、编辑、启停、删除服务器——每次写入都通过 `ctx.configEditor.edit()` 落到那一行的 `servers` 映射里，补丁别处的注释与 `!!js` 表达式因此得以保留，写入前还会先校验该行。
- **别的地方一概不碰。** profile 里的静态行、以及其它插件注册的服务器都只读展示；它们仍然可以被探测、被调用。profile 里其它内容不会被改动。
- **探测工具。** 每个服务器一份自己的 MCP 会话——首次使用时打开，后续探测与调用复用，写入、重启或插件停止时关闭——所以它能测已禁用的服务器，不打扰 agent 正在用的连接，并按名字与 schema 预算返回工具名、描述与输入 schema。
- **试调用。** 选一个工具，参数按输入 schema 预填，发送，然后用三种方式读结果：JSON、可折叠树、或原始请求与响应。
- **一套逻辑，两个入口。** 页面和面向模型的工具调用同一个 Host 服务，行为一致。
- **跟随界面语言。** 页面文案跟随「设置 → 通用 → 语言」，支持 Harness 自带的八种语言，切换后立即生效，无需刷新。

## 环境要求

- 带侧栏与插件管理器的 DeepSeek Harness（Desktop 与 Web 外壳都具备）。
- Node.js 22 或更新，用来构建 bundle。

## 安装

profile 永远不手改。先构建包，因为安装器复制的是磁盘上的内容：

```sh
npm ci
npm run build
npm run verify:bundle
```

然后把这个目录作为 profile bundle 安装，并重启 Harness：

```text
plugin_manager  action=install_bundle  target="<绝对路径>"
```

bundle 会跨重启保留，属于 profile 而不属于某个会话。侧栏里的 **MCP** 打开页面，`mcp_workbench` 是那个工具。

## 服务器的三个来源

| 来源      | 是什么                                                 | 本插件能做什么                 |
| --------- | ------------------------------------------------------ | ------------------------------ |
| `profile` | 补丁里的静态 `@deepseek-ai/dsh-mcp-client` 行          | 查看、探测、调用它的工具       |
| `managed` | profile 的 `@deepseek-ai/dsh-mcp-manager` 行里的服务器 | 新增、编辑、启停、删除         |
| `manager` | 其它插件通过 `ctx.mcpManager` 注册的服务器             | 查看、探测、调用它的工具、重启 |

本插件只往一个地方写：名字为 `@deepseek-ai/dsh-mcp-manager` 的 profile 行的 `servers` 映射。新增、编辑、启停、删除都落在那里，所以这个页面是那支官方管理器的编辑器，而不是自己另养一支。

profile 里的行在这里不能编辑，也根本不可写：`configEditor.edit()` 能改一行的 `config`，但 profile 补丁里的几个 MCP 行通常一起待在同一个 `insert:` 组里，而插件管理器覆盖不了自己那层插入的行（它会答 `overridden`）。所以 profile 行只读展示——仍然可以探测、可以调用它的工具——页面会提示你：想让它能启停，就把它搬进管理器那一行。正是这次搬迁让它变得可控：

```yaml
# 取代一组 @deepseek-ai/dsh-mcp-client 的 `- insert:` 行：
- id: mcp-manager
  config:
    servers:
      clion:
        transport: streamable-http
        url: http://127.0.0.1:64362/stream
      github:
        transport: stdio
        command: 'D:/Program Files/DeepSeek Harness/github-mcp-server.exe'
        args: [stdio]
        env:
          GITHUB_PERSONAL_ACCESS_TOKEN: '${credential:github-token}'
```

映射的键就是服务器名，工具前缀（`mcp__<名字>__`）保持不变。profile 补丁会整体替换它所命名的行的 config，所以这一行必须列出整支队伍要跑的每个服务器。

映射里的每个值都是数据：那一行的 schema 要求 `env` 与 `headers` 是字符串，因此其中的 `!!js` 表达式写不回去——页面会拒绝这次改动并给出路径，因为配置编辑器正是按数据去校验这个标记的。把秘密放进凭据库并写 `${credential:<名字>}`（管理器启动服务器时会解析），或者直接写字面量。

其它插件通过 `mcpManager` 注册的服务器这里同样只读：它属于那个插件。可以探测、可以调用工具、可以重启。

## 页面

一张由嵌套区块组成的页面，区块之间用细线分隔：服务器占五分之一，工具占十分之三，剩下的留给工具本身。拖动任意一条分隔线可以改变占比；也可以聚焦某条分隔线后按方向键（按住 `Shift` 步子更大，`Home` 与 `End` 到两端），双击则把那块复位。占比存在页面自己的 `localStorage` 里，下次打开还在。

- **服务器**（左边五分之一）。profile 挂载的每个服务器，带来源、传输方式与状态。页面标题右侧的 **添加服务器** 会往管理器那一行写一个新服务器。managed 服务器的行上有开关，点击后立刻显示新状态，还有一个齿轮打开它的配置；属于 profile 或其它插件的行没有这两样，因为这里改不了它。搜索按名字、来源与端点过滤。拒绝信息显示在拒绝它的那一行下面，而不只是页面顶部。
- **工具条**（右侧顶部）。左边是 **测试连接**，右边是工具搜索。探测只连一次，之后按钮变成 **重新测试**；旁边的摘要报告工具数量或连接失败的原因。
- **工具**（右侧十分之三）。每行显示工具名与两行描述；搜索同时匹配两者。
- **单个工具**（剩下的十分之三，再次横向划分）。上栏是描述，下栏是调用，占满剩余高度。参数按该工具的输入 schema 预填（先 `default`，再 `examples[0]`，再 `enum` 的第一个成员，最后是该类型的空值），并保持为可编辑的 JSON。**重置** 把预填参数放回去。每个服务器的每个工具都记得你为它输入过的参数：离开这个工具再回来——或者再次点击同一行——都会保留你的文本，而不是覆盖它。

按 **发送**，然后以 **JSON**、由可折叠节点组成的 **树形**、或 **原始** 的请求与响应成对来读结果。工具返回 `isError` 仍算一次结果，而不是请求失败，页面会说明拿到的是哪一种。

开关就是对管理器那一行的普通配置写入，所以它能跨重启存活，那一行的其它配置不受影响。先读结果再下结论：只有列表确认之后才报告为已切换，否则页面会在那一行下面显示原因。

配置表单是齿轮后面的对话框，同一个表单也用来新建服务器：

- **传输方式** 在 `stdio`（命令、参数、工作目录）与 `streamable-http`（URL）之间切换。编辑时也能切换，而且对话框开着的时候两侧各自保留自己的值，所以切到 `streamable-http` 再切回来不会丢掉你填的命令。保存只写选择器当前指向的那一侧，另一侧被丢弃。
- **环境变量** 与 **请求头** 按行编辑；名字看起来像秘密的值（`TOKEN`、`KEY`、`SECRET`、`PASSWORD`、`AUTH`、`CREDENTIAL`）以遮罩显示，且从不发送到浏览器。
- `!!js` 值以它背后的表达式显示，并原样写成表达式。
- **删除服务器** 在 managed 服务器的表单末尾，删除管理器行里的这一项之前会确认一次。取消则什么都不写。

拒绝会连同 Host 给出的原因一起显示：未知服务器、只读来源、名字已被占用、无法解析的值，或被 home 补丁覆盖的字段。

## 工具

`mcp_workbench` 接受一个 `action` 与该动作需要的字段：

| 动作         | 字段                        | 需要确认 |
| ------------ | --------------------------- | -------- |
| `list`       | —                           | 否       |
| `detail`     | `name`                      | 否       |
| `probe`      | `name`、`force`             | 否       |
| `call`       | `name`、`tool`、`arguments` | 否       |
| `save`       | `name`、`patch`             | 是       |
| `add`        | `name`、`spec`              | 是       |
| `remove`     | `name`                      | 是       |
| `setEnabled` | `name`、`enabled`           | 是       |
| `restart`    | `name`                      | 是       |

```json
{ "action": "probe", "name": "github" }
{ "action": "call", "name": "github", "tool": "search_repositories", "arguments": { "query": "mcp" } }
{ "action": "save", "name": "github", "patch": { "toolCallTimeoutMs": 90000 }, "confirm": true }
```

任何会改动东西的动作，在没有 `confirm: true` 时都返回 "Nothing was changed."，并且答案是有界的：列表被截断时会提示你去页面看剩下的部分。

## bundle 配置

本 bundle 挂载的那一行接受这些选项：

| 键                  | 默认值   | 含义                                |
| ------------------- | -------- | ----------------------------------- |
| `probeTimeoutMs`    | `10000`  | 一次探测最多花多久                  |
| `toolCallTimeoutMs` | `60000`  | 一次试调用最多花多久                |
| `probeCacheTtlMs`   | `30000`  | 一次探测结果被复用的时长            |
| `resultMaxBytes`    | `262144` | 一次试调用可返回内容的字节预算      |
| `maxToolSchemas`    | `200`    | 一次探测最多收集多少个工具的 schema |

服务器不是 bundle 选项：它们住在 profile 的 `@deepseek-ai/dsh-mcp-manager` 行里。本 bundle 配置里残留的 `servers` 键会被忽略，并在日志里留下一条警告。

## 安全

- **秘密不离开 Host。** 遮罩值以存在标记显示，不显示文本；只有你输入新值时才会写回。
- **凭据保持为引用。** `${credential:名字}` 模板从不被本插件解析：探测会把它报告为未解析的凭据，而不是去读凭据库。
- **探测有自己的会话。** 它自己启动命令或打开 URL，移除 `DSH_*` 与形似秘密的环境变量，并在请求之间保持这个会话，而不是每次都开新的。写入服务器、重启它或停止插件都会关闭该会话；丢了会话的工具调用会被如实报告而不会重放，因为服务器可能已经执行过它。
- **路由只认同源。** `POST /api/mcp-workbench` 会拒绝 `Sec-Fetch-Site` 或 `Origin` 表明来自其它页面的请求。

## 开发

```sh
npm ci
npm run typecheck     # host 与 client
npm run lint
npm run format:check
npm test              # vitest，含一个真实的 stdio MCP 夹具服务器
npm run build         # 先清理，再 tsc + 客户端 bundle
npm run verify:bundle # 校验 manifest、补丁与两个产物
npm run pack          # 生成 dist/dsh-mcp-workbench-<版本>.zip，可直接上传
```

目录结构：

- `src/index.ts` —— 入口：一个服务、一条路由、一个工具。
- `src/inventory.ts` —— 三个服务器来源，合并成一个列表。
- `src/edit.ts` —— 字段遮罩与保持 `!!js` 原样的补丁应用器。
- `src/service.ts` —— 页面与工具共用的每个操作。
- `src/route.ts` —— 同源 JSON 端点。
- `src/tool.ts` —— 面向模型的定义。
- `src/probe.ts` —— 通过连接池的会话探测并调用服务器。
- `src/connection.ts` —— 每个服务器一个活动 MCP 会话，按需复用与关闭。
- `src/deadline.ts` —— 两者共用的超时包装。
- `src/client/` —— 侧栏面板：页面、工具编辑器、schema 预填与两种结果视图。
- `tests/` —— 测试套件，含 `tests/fixtures/stdio-server.mjs`。

`main` 是开发主线，`release` 是发布线：改动经 PR 落到 `main`，版本在 `release` 上准备，在那边
`git push origin v<版本>` 就会让 **Release** workflow 打包并发布。见 [docs/GITFLOW.md](docs/GITFLOW.md)。
改动记录在 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT
