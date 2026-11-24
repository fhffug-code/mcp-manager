# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A **Settings → Plugins → MCP Workbench** page that lists the three sources of MCP servers: the static `@deepseek-ai/dsh-mcp-client` rows of the profile, the servers this bundle owns, and the servers other plugins registered on `mcpManager`.
- In-place editing of a profile row through `configEditor.edit()`, with the raw layer preserved, `!!js` expressions round-tripped, and optional fields cleared with `null`.
- Adding, removing, enabling, disabling and restarting the servers this bundle owns, stored in its own config row.
- Probing a server over its own throwaway MCP connection: tool names, descriptions, input schemas, timings, a name and schema budget, and a staged failure report.
- Sending one tool call with JSON arguments and reading text, image and resource content back within a byte budget.
- A `mcp_workbench` tool with `list`, `detail`, `probe`, `call`, `save`, `add`, `remove`, `setEnabled` and `restart`; every change needs `confirm: true`.
- An English and a Chinese locale for the page and the bundle metadata.
- `POST /api/mcp-workbench`, a same-origin JSON endpoint, as the only channel between the page and the Host.
- A vitest suite of 134 tests, including a dependency-free stdio MCP fixture server that the probe and the call path exercise for real.
- GitHub Actions: the verification pipeline, a check that a pull request comes from a branch of the right kind, and a Conventional Commit check.

### Changed

- The repository is organised around `main` and `release/<minor>`, with every contribution landing on `main` through a pull request and a merge commit; there is no `develop` branch.

### Fixed

- A profile row inserted by the patch reported empty `env` and `headers`, because its raw config arrives in the inherited layer while the override stays empty; saving such a row would have written the config without its environment.
- The page used theme tokens that do not exist, so its text, borders, cards and buttons kept the light palette in dark mode; every colour now comes from a real `--dsw-alias-*` token.

[Unreleased]: https://github.com/fhffug/mcp-manager/commits/main
