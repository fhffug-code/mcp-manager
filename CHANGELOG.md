# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An **MCP** entry in the sidebar, after **Plugins** and the plugin marketplace, opening an **MCP management** page that lists the three sources of servers: the static `@deepseek-ai/dsh-mcp-client` rows of the profile (read-only), the servers of the profile's `@deepseek-ai/dsh-mcp-manager` row (editable), and the servers other plugins registered on `mcpManager` (read-only).
- The `managed` source as the one place this plugin writes: a server of that row's `servers` map can be edited, switched on or off, restarted and removed, because `enabled` is an ordinary field of the map.
- Adding a server to that map from the page, and deleting one from the form footer after a confirmation, both through `configEditor.edit()` with the rest of the row preserved.
- Switching a server between `streamable-http` and `stdio` in its form, in edit mode as well as when adding: both halves keep their own draft while the form is open, and saving writes the half the selector points at and drops the other.
- A test call that prefills its arguments from the tool's input schema and shows the answer as JSON, as a foldable tree, or as the raw request and response.
- Search boxes over the server list and the tool list, and tool rows that keep their description to two lines.
- Read-only rows that still probe and still take test calls, with the reason they cannot be edited shown on the row.
- Probing a server over its own MCP session: tool names, descriptions, input schemas, timings, a name and schema budget, and a staged failure report. The session is opened on first use, reused by later probes and test calls, and closed when the server is written, restarted, or the plugin stops.
- A `mcp_workbench` tool with `list`, `detail`, `probe`, `call`, `save`, `add`, `remove`, `setEnabled` and `restart`; every change needs `confirm: true`.
- An English and a Chinese locale for the page and the bundle metadata.
- `POST /api/mcp-workbench`, a same-origin JSON endpoint, as the only channel between the page and the Host.
- A vitest suite of 186 tests, including a dependency-free stdio MCP fixture server that the probe and the call path exercise for real, a unit suite over the connection pool, and a jsdom test of the page's switch and its bands.
- GitHub Actions: the verification pipeline, a check that a pull request comes from a branch of the right kind, and a Conventional Commit check.

### Changed

- The page is one nested set of bands rather than three side-by-side cards: a third for the servers, then a third for the tools and two thirds for the selected tool, separated by hairlines; the server search stays in the server band and the tool search sits beside the test button.
- The MCP page moved out of Settings → Plugins into its own sidebar entry; the settings tab is gone, and the bundle now injects the sidebar and layout client packages instead of the settings page.
- The default `maxToolSchemas` is 200 rather than 64, so a server with a large toolset still reports every input schema.
- The repository is organised around `main` and `release/<minor>`, with every contribution landing on `main` through a pull request and a merge commit; there is no `develop` branch.
- The plugin no longer keeps a server set of its own: the `servers` key of its own config is gone and a profile that still sets it gets a warning instead. Every mutation now lands on the profile's `@deepseek-ai/dsh-mcp-manager` row, which is the only row this plugin writes.

### Fixed

- The switch on a server row looked inert: the click was ignored until the list was re-read, and a re-read taken before the profile write landed put the old state back. The row now shows the new state at once, reconciles with the profile afterwards, and reports a refusal under the row.
- A switch the plugin manager could not apply was reported as done and then reverted two seconds later, because the manager answers `overridden` for a row the profile patch inserts onto itself. Such a row is now offered as read-only, with that reason on the row, instead of a switch that cannot work.
- A profile row inserted by the patch reported empty `env` and `headers`, because its raw config arrives in the inherited layer while the override stays empty; saving such a row would have written the config without its environment.
- The page used theme tokens that do not exist, so its text, borders, cards and buttons kept the light palette in dark mode; every colour now comes from a real `--dsw-alias-*` token.
- Test connection and test calls opened a new MCP session, and a new process, on every request: a streamable HTTP server saw one session per click. One session per server is now kept and reused, and a call whose session died is reported instead of being replayed.
- The test suite is type-checked: `tsconfig.test.json` covers `src/` and `tests/`, `npm run typecheck` runs it, and the type errors the IDE was reporting (a mock logger, a textually typed status table, an untyped mock tuple) are fixed.

[Unreleased]: https://github.com/fhffug/mcp-manager/commits/main
