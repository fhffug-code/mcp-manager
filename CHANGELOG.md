# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An **MCP** entry in the sidebar, after **Plugins** and the plugin marketplace, opening an **MCP management** page that lists the three sources of servers: the static `@deepseek-ai/dsh-mcp-client` rows of the profile, the servers this bundle owns, and the servers other plugins registered on `mcpManager`.
- Switching a server on or off from that list: a profile row goes through the plugin manager, which rewrites only `disabled` in the profile patch; a server the profile gives to `@deepseek-ai/dsh-mcp-manager` is switched in that row's `servers` map; a server this bundle owns is toggled in its own row.
- The `managed` source: the servers of a profile row whose name is `@deepseek-ai/dsh-mcp-manager` are listed, and can be edited, switched and removed, because `enabled` is an ordinary field of that map. Moving a static row into that map is the supported way to get a working switch.
- A test call that prefills its arguments from the tool's input schema and shows the answer as JSON, as a foldable tree, or as the raw request and response.
- Search boxes over the server list and the tool list, and tool rows that keep their description to two lines.
- In-place editing of a profile row through `configEditor.edit()`, with the raw layer preserved, `!!js` expressions round-tripped, and optional fields cleared with `null`.
- Adding, removing, enabling, disabling and restarting the servers this bundle owns, stored in its own config row.
- Probing a server over its own MCP session: tool names, descriptions, input schemas, timings, a name and schema budget, and a staged failure report. The session is opened on first use, reused by later probes and test calls, and closed when the server is written, restarted, or the plugin stops.
- A `mcp_workbench` tool with `list`, `detail`, `probe`, `call`, `save`, `add`, `remove`, `setEnabled` and `restart`; every change needs `confirm: true`.
- An English and a Chinese locale for the page and the bundle metadata.
- `POST /api/mcp-workbench`, a same-origin JSON endpoint, as the only channel between the page and the Host.
- A vitest suite of 193 tests, including a dependency-free stdio MCP fixture server that the probe and the call path exercise for real, a unit suite over the connection pool, and a jsdom test of the page's switch and its bands.
- GitHub Actions: the verification pipeline, a check that a pull request comes from a branch of the right kind, and a Conventional Commit check.

### Changed

- The page is one nested set of bands rather than three side-by-side cards: a third for the servers, then a third for the tools and two thirds for the selected tool, separated by hairlines; the server search stays in the server band and the tool search sits beside the test button.
- The MCP page moved out of Settings → Plugins into its own sidebar entry; the settings tab is gone, and the bundle now injects the sidebar and layout client packages instead of the settings page.
- The default `maxToolSchemas` is 200 rather than 64, so a server with a large toolset still reports every input schema.
- The repository is organised around `main` and `release/<minor>`, with every contribution landing on `main` through a pull request and a merge commit; there is no `develop` branch.

### Fixed

- The switch on a server row looked inert: the click was ignored until the list was re-read, and a re-read taken before the profile write landed put the old state back. The row now shows the new state at once, reconciles with the profile afterwards, and reports a refusal under the row.
- A switch the plugin manager could not apply was reported as done and then reverted two seconds later. The plugin manager answers `overridden` for a row the profile patch inserts, because a patch layer cannot override a row it inserts itself, so the switch is now refused with that reason and the row keeps its state.
- A profile row inserted by the patch reported empty `env` and `headers`, because its raw config arrives in the inherited layer while the override stays empty; saving such a row would have written the config without its environment.
- The page used theme tokens that do not exist, so its text, borders, cards and buttons kept the light palette in dark mode; every colour now comes from a real `--dsw-alias-*` token.
- Test connection and test calls opened a new MCP session, and a new process, on every request: a streamable HTTP server saw one session per click. One session per server is now kept and reused, and a call whose session died is reported instead of being replayed.
- The test suite is type-checked: `tsconfig.test.json` covers `src/` and `tests/`, `npm run typecheck` runs it, and the type errors the IDE was reporting (a mock logger, a textually typed status table, an untyped mock tuple) are fixed.

[Unreleased]: https://github.com/fhffug/mcp-manager/commits/main
