# MCP Workbench

A DeepSeek Harness plugin that adds an **MCP** page to the sidebar, right after **Plugins** and the plugin marketplace. It lists the MCP servers this profile mounts, edits their configuration, switches them on and off, probes them for the tools they expose, and lets you send a tool call with arguments that were prefilled from the tool's own schema — from that page and from a tool the model can use.

**中文简介**：这个插件在左侧栏【插件】【插件市场】之后加一个「MCP」入口，进来是「MCP 管理」页面：查看当前 profile 挂载的所有 MCP 服务器、就地修改配置、启动或关闭服务器、探测工具并直接传参调用（参数按该工具的 inputSchema 预填）；同时注册一个 `mcp_workbench` 工具，让模型也能做同样的事。所有改动都走 DSH 官方的 ConfigEditor 与 plugin_manager，不会手写 profile 配置文件。

## What it does

- **See every server.** Profile rows (`@deepseek-ai/dsh-mcp-client` entries in the profile patch), the servers this bundle owns, and servers other plugins registered through `mcpManager` appear in one searchable list with their transport, live state, and endpoint.
- **Switch a server on or off.** A profile row is toggled through the official plugin manager, which rewrites only `disabled` in the profile patch; a server the profile hands to `@deepseek-ai/dsh-mcp-manager` is toggled in that row's `servers` map; a server this bundle owns is toggled in its own row.
- **Edit in place.** A profile row is edited through `ctx.configEditor.edit()`, so comments and `!!js` expressions survive and the row is validated before it is written. A missing field keeps its stored value, an empty one removes it.
- **Probe for tools.** The probe opens its own short-lived MCP connection, so it works on a disabled server, does not disturb the connection the agent is using, and returns tool names, descriptions and input schemas with a name and schema budget.
- **Test a call.** Pick a tool, get its arguments prefilled from the input schema, send them, and read the answer three ways: JSON, a foldable tree, or the raw request and response.
- **One logic, two surfaces.** The page and the model-facing tool call the same Host service, so both behave the same way.

## Requirements

- DeepSeek Harness with the sidebar and the plugin manager (the Desktop and Web shells both have them).
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

The bundle stays installed across restarts and belongs to the profile, not to one session. **MCP** in the sidebar opens the page, and `mcp_workbench` is the tool.

## The three sources of a server

| Source    | What it is                                                   | What this plugin may do                     |
| --------- | ------------------------------------------------------------ | ------------------------------------------- |
| `profile` | A static `@deepseek-ai/dsh-mcp-client` row in the patch      | Edit its configuration, switch it on or off |
| `managed` | A server in the profile's `@deepseek-ai/dsh-mcp-manager` row | Edit it, switch it on or off, remove it     |
| `plugin`  | A server stored in this bundle's own `servers` config        | Add, remove, enable, disable, edit, restart |
| `manager` | A server another plugin registered on `ctx.mcpManager`       | Read it, restart it                         |

A profile row cannot be added or removed here: those are entry options that
`configEditor.edit()` does not write. It can be switched on and off, because that is what the
plugin manager writes — unless the patch mounts it inside an `insert:` group, which is the one
case a patch layer cannot override, and then the page reports that refusal instead of pretending
it switched. A profile row also cannot be restarted, because the manager does not govern it.

A `managed` server lives in the `servers` map of a profile row whose name is
`@deepseek-ai/dsh-mcp-manager`. That fleet treats `enabled` as an ordinary field of the map, so a
switch here is a plain config write and takes effect at once. Moving a static row into that map is
what makes it switchable:

```yaml
# instead of a `- insert:` group of @deepseek-ai/dsh-mcp-client rows:
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
          GITHUB_PERSONAL_ACCESS_TOKEN: !!js process.env.GITHUB_PERSONAL_ACCESS_TOKEN
```

The map key is the server name, and the tool prefix (`mcp__<name>__`) stays the same. A profile
patch replaces the whole config of the row it names, so this row must list every server the fleet
should run.

A row the patch mounts inside an `insert:` group is edited by writing a top-level row that
carries the whole configuration, because that is the row `configEditor.edit()` can address;
the insert child stays as it was and the new row takes precedence. Removing the last change
removes that row again, so the file returns to what it held before.

## The page

One page of nested bands, each separated from the next by a hairline: a third for the servers,
the rest split again a third to the tools and two thirds to the tool itself.

- **Servers** (the left third). Every server the profile mounts, with its source, transport and
  state. The switch on the right of a row turns it on or off and shows the new state as soon as
  you click it; the gear opens its configuration. The search filters by name, source and
  endpoint. A refusal appears under the row that refused, not only at the top of the page.
- **Tool bar** (top of the right side). **Test connection** on the start, the tool search on the
  end. The probe connects once, and the button becomes **Test again**; the summary beside it
  reports the tool count or why the connection failed.
- **Tools** (a third of the right side). Each row shows the tool name and two lines of its
  description; the search filters on both.
- **One tool** (two thirds of the right side, split again). The upper third is the description,
  the lower third the test call, which takes whatever height is left. The arguments are
  prefilled from the tool's input schema (`default`, then `examples[0]`, then the first `enum`
  member, then an empty value of the right type), and stay editable as JSON.

Press **Send** and read the answer as **JSON**, as a **Tree** of foldable nodes, or as the
**Raw** request and response pair. A tool that reports `isError` is still a result, not a
failed request, and the page says which one it got.

Switching a server is the profile's own switch: the Host calls `pluginManager.setPluginEnabled`
for the row, so the state survives a restart and the row's configuration is left alone. The
answer is read before anything is claimed: the row is only reported as switched once the
composition agrees, otherwise the page shows the manager's reason under that row.

The configuration form is a dialog behind the gear:

- **Transport** switches the form between `stdio` (command, arguments, working directory) and `streamable-http` (URL).
- **Environment** and **headers** are edited row by row; a value whose name looks like a secret (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `CREDENTIAL`) is shown masked and is never sent to the browser.
- A `!!js` value is shown as the expression behind it and is written back as an expression.

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
| `maxToolSchemas`    | `200`    | How many tool schemas one probe may collect       |

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
- `src/client/` — the sidebar panel: the page, the tool editor, the schema prefill and the two result views.
- `tests/` — the suite, including `tests/fixtures/stdio-server.mjs`.

`main` is the development line and `release/<minor>` branches hold a version being stabilised: see
[docs/GITFLOW.md](docs/GITFLOW.md). Changes are logged in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
