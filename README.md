# MCP Workbench

A DeepSeek Harness plugin that shows the MCP servers this profile mounts, edits their configuration, probes them for the tools they expose, and sends a tool call with arguments you type — from a Settings page and from a tool the model can use.

**中文简介**：这个插件在「设置 → 插件」里加一个「MCP 工作台」页面，可以查看当前 profile 挂载的所有 MCP 服务器、就地修改配置、探测工具数量与入参 schema、并直接传参调用工具；同时注册一个 `mcp_workbench` 工具，让模型也能做同样的事。所有改动都走 DSH 官方的 ConfigEditor，不会手写 profile 配置文件。

## What it does

- **See every server.** Profile rows (`@deepseek-ai/dsh-mcp-client` entries in the profile patch), the servers this bundle owns, and servers other plugins registered through `mcpManager` appear in one list with their transport, live state, and endpoint.
- **Edit in place.** A profile row is edited through `ctx.configEditor.edit()`, so comments and `!!js` expressions survive and the row is validated before it is written. A missing field keeps its stored value, an empty one removes it.
- **Probe for tools.** The probe opens its own short-lived MCP connection, so it works on a disabled server, does not disturb the connection the agent is using, and returns tool names, descriptions and input schemas with a name and schema budget.
- **Test a call.** Pick a tool, type a JSON argument object, and read what came back: text, images, resources, or a tool-level error.
- **One logic, two surfaces.** The Settings page and the model-facing tool call the same Host service, so both behave the same way.

## Requirements

- DeepSeek Harness with the Settings → Plugins section (the Desktop and Web shells both have it).
- Node.js 22 or newer to build the bundle.

## Install

The profile is never edited by hand. Build the package first, because the installer copies what is on disk:

```sh
npm ci
npm run build
npm run verify:bundle
```

Then install the folder as a profile bundle and restart the Harness:

```text
plugin_manager  action=install_bundle  target="<absolute path to this folder>"
```

The bundle stays installed across restarts and belongs to the profile, not to one session. Settings → Plugins → **MCP Workbench** is the page, and `mcp_workbench` is the tool.

## The three sources of a server

| Source    | What it is                                              | What this plugin may do                     |
| --------- | ------------------------------------------------------- | ------------------------------------------- |
| `profile` | A static `@deepseek-ai/dsh-mcp-client` row in the patch | Edit its configuration in place             |
| `plugin`  | A server stored in this bundle's own `servers` config   | Add, remove, enable, disable, edit, restart |
| `manager` | A server another plugin registered on `ctx.mcpManager`  | Read it, restart it                         |

A profile row cannot be added, removed or disabled here: those are entry options that
`configEditor.edit()` does not write. A profile row also cannot be restarted, because the
manager does not govern it. The page says so instead of pretending otherwise.

## The page

Pick a server on the left. The right pane shows the fields the row actually stores:

- **Transport** switches the form between `stdio` (command, arguments, working directory) and `streamable-http` (URL).
- **Environment** and **headers** are edited row by row; a value whose name looks like a secret (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `CREDENTIAL`) is shown masked and is never sent to the browser.
- A `!!js` value is shown as the expression behind it and is written back as an expression.
- **Probe** lists the tools with their descriptions and schemas; **Call** sends one tool call with the JSON arguments you typed.

Refusals are shown with the reason the Host gave: an unknown server, a read-only source, a name that is already taken, a value that would not parse, or a field a home patch overrides.

## The tool

`mcp_workbench` takes an `action` and the fields that action needs:

| Action       | Fields                      | Confirm needed |
| ------------ | --------------------------- | -------------- |
| `list`       | —                           | no             |
| `detail`     | `name`                      | no             |
| `probe`      | `name`, `force`             | no             |
| `call`       | `name`, `tool`, `arguments` | no             |
| `save`       | `name`, `patch`             | yes            |
| `add`        | `name`, `spec`              | yes            |
| `remove`     | `name`                      | yes            |
| `setEnabled` | `name`, `enabled`           | yes            |
| `restart`    | `name`                      | yes            |

```json
{ "action": "probe", "name": "github" }
{ "action": "call", "name": "github", "tool": "search_repositories", "arguments": { "query": "mcp" } }
{ "action": "save", "name": "github", "patch": { "toolCallTimeoutMs": 90000 }, "confirm": true }
```

Every action that changes something returns "Nothing was changed." unless it is given
`confirm: true`, and the answers are bounded: a truncated list tells you to open the page for the rest.

## Bundle configuration

The row this bundle mounts takes these options:

| Key                 | Default  | Meaning                                           |
| ------------------- | -------- | ------------------------------------------------- |
| `servers`           | `{}`     | The servers this bundle owns and registers        |
| `probeTimeoutMs`    | `10000`  | How long one probe may take                       |
| `toolCallTimeoutMs` | `60000`  | How long one test call may take                   |
| `probeCacheTtlMs`   | `30000`  | How long a probe result is reused                 |
| `resultMaxBytes`    | `262144` | The budget for the content a test call may return |
| `maxToolSchemas`    | `64`     | How many tool schemas one probe may collect       |

## Safety

- **No secret leaves the Host.** Masked values are shown as a presence marker, not as their text, and are written back only when you type a new one.
- **Credentials stay references.** A `${credential:NAME}` template is never resolved by this plugin: the probe reports it as an unresolved credential instead of reading the credential store.
- **The probe is a separate connection.** It starts the command or opens the URL itself, with `DSH_*` and secret-shaped environment variables removed, and always closes what it opened.
- **The route is same-origin only.** `POST /api/mcp-workbench` refuses a request whose `Sec-Fetch-Site` or `Origin` says it came from another page.

## Development

```sh
npm ci
npm run typecheck     # host and client
npm run lint
npm run format:check
npm test              # vitest, includes a real stdio MCP fixture server
npm run build         # tsc + the client bundle
npm run verify:bundle # checks the manifest, the patch and both artifacts
```

The layout:

- `src/index.ts` — the entry: one service, one route, one tool.
- `src/inventory.ts` — the three server sources, merged in one list.
- `src/edit.ts` — the field mask and the patch applier that keeps `!!js` intact.
- `src/service.ts` — every operation the page and the tool share.
- `src/route.ts` — the same-origin JSON endpoint.
- `src/tool.ts` — the model-facing definition.
- `src/probe.ts` — the throwaway MCP connection used by probe and call.
- `src/client/` — the Settings tab.
- `tests/` — the suite, including `tests/fixtures/stdio-server.mjs`.

Branches follow Git Flow: see [docs/GITFLOW.md](docs/GITFLOW.md). Changes are logged in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
