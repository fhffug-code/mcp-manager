# Contributing

If you are an agent working in this repository, read [AGENTS.md](AGENTS.md) instead: it covers how to
run commands on this machine, the verification loop and the definition of done.

## Setup

```sh
git switch main
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
- **Every visible word comes from a dictionary.** `src/client/locales.ts` carries one entry per language the Harness ships with, `en` first: it defines the keys, and the other seven are typed against it, so a forgotten key fails `npm run typecheck`. A new string belongs there, with every language filled in — never inline in a component.
- **Keep the two manuals in step.** [README.md](README.md) is English and [README.zh.md](README.zh.md) is Chinese; a change to one is a change to the other. `locale/<id>.json` holds the bundle metadata for the same eight languages.
- **Tests come with the change.** A new action needs its refusal paths, and a parser change needs the value that used to break.

## Adding a server field

1. Add it to `McpServerSpec` and to `validateServerSpec` in `src/config.ts`.
2. Teach `applyPatch` and `validatePatched` in `src/edit.ts` how to set and clear it.
3. Show it in `fieldsOf` and accept it in `patchOf` (`src/client/format.ts`).
4. Cover it in `tests/config.test.ts`, `tests/edit.test.ts` and `tests/format.test.ts`.

## Branches and commits

Cut a branch from `main`, named `<type>/<slug>` after the Conventional Commit type it carries
(`feature/`, `fix/`, `chore/`, `docs/`, `test/`, `ci/`, `refactor/`, `perf/`); a release is prepared on
the long-lived `release` branch. Batch related work into one branch and one pull request — several
commits, one review, one merge commit — rather than one pull request per correction. Everything lands
through a pull request with a merge commit — never a squash, never a rebase. Details, including the fork
workflow, in [docs/GITFLOW.md](docs/GITFLOW.md).
