# MCP Workbench

A DeepSeek Harness plugin that adds an **MCP** page to the sidebar, right after **Plugins** and the plugin marketplace. It shows the MCP servers this profile mounts, edits the ones the official `@deepseek-ai/dsh-mcp-manager` row holds, switches them on and off, probes them for the tools they expose, and lets you send a tool call with arguments that were prefilled from the tool's own schema — from that page and from a tool the model can use.

**中文简介**：这个插件在左侧栏【插件】【插件市场】之后加一个「MCP」入口，进来是「MCP 管理」页面：查看当前 profile 挂载的所有 MCP 服务器、编辑官方 `@deepseek-ai/dsh-mcp-manager` 那一行里的服务器（增删、改配置、启停）、探测工具并直接传参调用（参数按该工具的 inputSchema 预填）；同时注册一个 `mcp_workbench` 工具，让模型也能做同样的事。所有改动都走 DSH 官方的 ConfigEditor，不会手写 profile 配置文件。

## What it does

- **See every server.** Static `@deepseek-ai/dsh-mcp-client` rows of the profile patch, the servers in the profile's `@deepseek-ai/dsh-mcp-manager` row, and servers other plugins registered through `mcpManager` appear in one searchable list with their transport, live state, and endpoint.
- **Manage the manager row.** Add a server, edit it, switch it on or off, or delete it — each write goes into that row's `servers` map through `ctx.configEditor.edit()`, so comments and `!!js` expressions elsewhere in the patch survive and the row is validated before it is written.
- **Leave the rest alone.** A static profile row and a server another plugin registered are shown read-only; they can still be probed and called. Nothing else in the profile is touched.
- **Probe for tools.** The probe keeps its own MCP session per server — opened on first use, reused by later probes and calls, closed when the server is written, restarted or the plugin stops — so it works on a disabled server, does not disturb the connection the agent is using, and returns tool names, descriptions and input schemas with a name and schema budget.
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

| Source    | What it is                                                   | What this plugin may do                       |
| --------- | ------------------------------------------------------------ | --------------------------------------------- |
| `profile` | A static `@deepseek-ai/dsh-mcp-client` row in the patch      | Read it, probe it, call its tools             |
| `managed` | A server in the profile's `@deepseek-ai/dsh-mcp-manager` row | Add, edit, switch it on or off, remove it     |
| `manager` | A server another plugin registered on `ctx.mcpManager`       | Read it, probe it, call its tools, restart it |

This plugin writes in exactly one place: the `servers` map of the profile row whose name is
`@deepseek-ai/dsh-mcp-manager`. Everything it adds, edits, switches or removes lands there, so the
page is the editor of that official fleet rather than a fleet of its own.

A profile row cannot be edited here. It is not writable at all: `configEditor.edit()` can change a
row's `config`, but the five MCP rows of a profile patch usually sit inside one `insert:` group, and
the plugin manager cannot override a row its own layer inserts (it answers `overridden`). So a
profile row is shown read-only — you can still probe it and call its tools — and the page tells you
to move it into the manager row if you want it switchable. That move is what makes it switchable:

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
          GITHUB_PERSONAL_ACCESS_TOKEN: '${credential:github-token}'
```

The map key is the server name, and the tool prefix (`mcp__<name>__`) stays the same. A profile
patch replaces the whole config of the row it names, so this row must list every server the fleet
should run.

Every value in that map is data: the row's schema holds `env` and `headers` to strings, so a `!!js`
expression inside it cannot be written back — this page refuses the change and names the path,
because validating the marker as data is what the config editor does. Keep a secret in the
credential store and write `${credential:<name>}`, which the manager resolves when it starts the
server, or write a literal.

A server another plugin registered on `mcpManager` is read-only here too: it belongs to that
plugin. It can be probed, its tools called, and it can be restarted.

## The page

One page of nested bands, each separated from the next by a hairline: the servers take a fifth,
the tools three tenths, and the rest belongs to the tool itself. Drag any of the three separators
to change a share, or focus one and press the arrow keys (hold `Shift` for a bigger step, `Home`
and `End` for the ends); a double click puts that band back where it started. The shares are kept
in the page's own `localStorage`, so they come back the next time it opens.

- **Servers** (the left fifth). Every server the profile mounts, with its source, transport and
  state. **Add server** on the right of the page title writes a new one into the manager row. A
  managed server's row has a switch that turns it on or off and shows the new state as soon as you
  click it, plus a gear that opens its configuration; a row that belongs to the profile or to
  another plugin has neither, because nothing here can change it. The search filters by name,
  source and endpoint. A refusal appears under the row that refused, not only at the top of the
  page.
- **Tool bar** (top of the right side). **Test connection** on the start, the tool search on the
  end. The probe connects once, and the button becomes **Test again**; the summary beside it
  reports the tool count or why the connection failed.
- **Tools** (three tenths of the right side). Each row shows the tool name and two lines of its
  description; the search filters on both.
- **One tool** (the remaining three tenths, split again). The upper band is the description, the
  lower one the call, which takes whatever height is left. The arguments are prefilled from the
  tool's input schema (`default`, then `examples[0]`, then the first `enum` member, then an empty
  value of the right type), and stay editable as JSON. **Reset** puts the prefilled arguments
  back. Each tool of each server remembers the arguments you typed for it: leaving the tool and
  coming back — or clicking the same row again — keeps your text instead of overwriting it.

Press **Send** and read the answer as **JSON**, as a **Tree** of foldable nodes, or as the
**Raw** request and response pair. A tool that reports `isError` is still a result, not a
failed request, and the page says which one it got.

A switch is a plain config write on the manager row, so it survives a restart and the row's
configuration is left alone. The answer is read before anything is claimed: the row is only
reported as switched once the list agrees, otherwise the page shows the reason under that row.

The configuration form is a dialog behind the gear, and the same form creates a server:

- **Transport** switches between `stdio` (command, arguments, working directory) and
  `streamable-http` (URL). It is available while editing too, and each side keeps its own values
  while the dialog stays open, so flipping to `streamable-http` and back does not lose the command
  you typed. Saving writes the side the selector points at and drops the other one.
- **Environment** and **headers** are edited row by row; a value whose name looks like a secret (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `CREDENTIAL`) is shown masked and is never sent to the browser.
- A `!!js` value is shown as the expression behind it and is written back as an expression.
- **Delete server** sits at the end of a managed server's form and asks once before it removes the
  entry from the manager row. Cancel and nothing is written.

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
| `probeTimeoutMs`    | `10000`  | How long one probe may take                       |
| `toolCallTimeoutMs` | `60000`  | How long one test call may take                   |
| `probeCacheTtlMs`   | `30000`  | How long a probe result is reused                 |
| `resultMaxBytes`    | `262144` | The budget for the content a test call may return |
| `maxToolSchemas`    | `200`    | How many tool schemas one probe may collect       |

Servers are not a bundle option: they live in the profile's `@deepseek-ai/dsh-mcp-manager` row. A
`servers` key left in this bundle's config is ignored, with a warning in the log.

## Safety

- **No secret leaves the Host.** Masked values are shown as a presence marker, not as their text, and are written back only when you type a new one.
- **Credentials stay references.** A `${credential:NAME}` template is never resolved by this plugin: the probe reports it as an unresolved credential instead of reading the credential store.
- **The probe keeps its own session.** It starts the command or opens the URL itself, with `DSH_*` and secret-shaped environment variables removed, and holds that session between requests instead of opening a new one each time. Writing a server, restarting it or stopping the plugin closes it; a tool call that lost its session is reported rather than replayed, because the server may already have run it.
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
- `src/probe.ts` — probing and calling a server over the pool's session.
- `src/connection.ts` — one live MCP session per server, reused and closed on demand.
- `src/deadline.ts` — the timeout wrapper shared by both.
- `src/client/` — the sidebar panel: the page, the tool editor, the schema prefill and the two result views.
- `tests/` — the suite, including `tests/fixtures/stdio-server.mjs`.

`main` is the development line and `release/<minor>` branches hold a version being stabilised: see
[docs/GITFLOW.md](docs/GITFLOW.md). Changes are logged in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
