# Contributing

## Setup

```sh
git switch develop
npm ci
npm run build
npm test
```

Node.js 22 or newer. The package is private and is installed into a DeepSeek Harness profile as a bundle; it is not published to a registry.

## The loop

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build && npm run verify:bundle
```

CI runs exactly these on Node 22, plus the coverage run. Keep the branch green before opening a pull request.

## Rules of the house

- **Do not depend on a `@deepseek-ai/*` package.** The bundle resolves those from the running installation, so they are neither imported nor declared. `src/types/dsh.ts` holds the hand-written contracts the plugin relies on; extend it when a seam grows.
- **Never write the profile config by hand.** Reads go through `ctx.configEditor.entries()` and `configuration()`, writes through `edit()`. A raw value that is a `{ __jsExpr }` map must be written back unchanged.
- **No secret in a browser payload.** `src/edit.ts` masks a value whose key looks like a secret; the client receives a presence marker and nothing more.
- **One operation, one method.** A new capability is a method on `Workbench`, then an action on the route, then a row in the tool definition, then a control on the page. Do not put logic in the route, the tool or the component.
- **Every failure carries a code.** `WorkbenchFailure` with a `FailureCode`; the route maps it to a status, the tool renders it as `<code>: <message>`.
- **Tests come with the change.** A new action needs its refusal paths, and a parser change needs the value that used to break.

## Adding a server field

1. Add it to `McpServerSpec` and to `validateServerSpec` in `src/config.ts`.
2. Teach `applyPatch` and `validatePatched` in `src/edit.ts` how to set and clear it.
3. Show it in `fieldsOf` and accept it in `patchOf` (`src/client/format.ts`).
4. Cover it in `tests/config.test.ts`, `tests/edit.test.ts` and `tests/format.test.ts`.

## Branches and commits

Git Flow, Conventional Commits, `--no-ff` merges: see [docs/GITFLOW.md](docs/GITFLOW.md). A `main` pull request must come from `release/*` or `hotfix/*`.
