# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An **MCP** entry in the sidebar, after **Plugins** and the plugin marketplace, opening an **MCP management** page that lists the three sources of servers: the static `@deepseek-ai/dsh-mcp-client` rows of the profile, the servers this bundle owns, and the servers other plugins registered on `mcpManager`.
- Switching a server on or off from that list: a profile row goes through the plugin manager, which rewrites only `disabled` in the profile patch; a server this bundle owns is toggled in its own row.
- A test call that prefills its arguments from the tool's input schema and shows the answer as JSON, as a foldable tree, or as the raw request and response.
- Search boxes over the server list and the tool list, and tool rows that keep their description to two lines.
- In-place editing of a profile row through `configEditor.edit()`, with the raw layer preserved, `!!js` expressions round-tripped, and optional fields cleared with `null`.
- Adding, removing, enabling, disabling and restarting the servers this bundle owns, stored in its own config row.
- Probing a server over its own throwaway MCP connection: tool names, descriptions, input schemas, timings, a name and schema budget, and a staged failure report.
- A `mcp_workbench` tool with `list`, `detail`, `probe`, `call`, `save`, `add`, `remove`, `setEnabled` and `restart`; every change needs `confirm: true`.
- An English and a Chinese locale for the page and the bundle metadata.
- `POST /api/mcp-workbench`, a same-origin JSON endpoint, as the only channel between the page and the Host.
- A vitest suite of 152 tests, including a dependency-free stdio MCP fixture server that the probe and the call path exercise for real.
- GitHub Actions: the verification pipeline, a check that a pull request comes from a branch of the right kind, and a Conventional Commit check.

### Changed

- The MCP page moved out of Settings → Plugins into its own sidebar entry; the settings tab is gone, and the bundle now injects the sidebar and layout client packages instead of the settings page.
- The default `maxToolSchemas` is 200 rather than 64, so a server with a large toolset still reports every input schema.
- The repository is organised around `main` and `release/<minor>`, with every contribution landing on `main` through a pull request and a merge commit; there is no `develop` branch.

### Fixed

- A profile row inserted by the patch reported empty `env` and `headers`, because its raw config arrives in the inherited layer while the override stays empty; saving such a row would have written the config without its environment.
- The page used theme tokens that do not exist, so its text, borders, cards and buttons kept the light palette in dark mode; every colour now comes from a real `--dsw-alias-*` token.

[Unreleased]: https://github.com/fhffug/mcp-manager/commits/main
