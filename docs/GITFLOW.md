# Branching

This repository uses two kinds of branch, in the shape large C++ projects such as CMake use:

- **`main`** holds the development line. Everything that ships passes through it.
- **`release/<minor>`** holds a line that is being stabilised, for example `release/0.1`. It is cut
  from `main`, receives fixes only, and stays in the repository so a later patch release can be cut
  from it.

There is no `develop`: `main` is where work lands, and CI on `main` has to be green.

## Short-lived branches

Cut from `main`, named `<type>/<slug>` where the type is one of the Conventional Commit types:

| Branch                                         | Cut from          | Opens a pull request against | Purpose                                                     |
| ---------------------------------------------- | ----------------- | ---------------------------- | ----------------------------------------------------------- |
| `feature/*`                                    | `main`            | `main`                       | A user-visible capability or a refactor                     |
| `fix/*`, `chore/*`, `docs/*`, `test/*`, `ci/*` | `main`            | `main`                       | A small correction of one kind                              |
| `refactor/*`, `perf/*`                         | `main`            | `main`                       | Behaviour-preserving or speed work                          |
| `hotfix/*`                                     | `main`            | `main`                       | An urgent repair, also merged into the affected `release/*` |
| `fix/*`, `chore/*`, `docs/*`, `test/*`, `ci/*` | `release/<minor>` | the same `release/<minor>`   | A fix that must reach the next patch release                |

Names are short and kebab-cased: `feature/probe-cache`, `fix/route-403`, `release/0.2`.

## Merge rules

- Every merge is a **merge commit**, never a squash and never a rebase, so the branch keeps its own
  shape in the history and the pull request keeps a record:

  ```sh
  git switch main
  git merge --no-ff feature/probe-cache -m "Merge branch 'feature/probe-cache'"
  ```

- Never push straight to `main` or to a `release/*` branch. The repository rules require a pull
  request and two green status checks, and the `Check where the pull request comes from` job refuses
  a branch whose name does not fit the table above.

## Commits

Messages follow Conventional Commits, with a scope where it helps:

```text
feat(host): register the servers this bundle owns
fix(client): keep a masked secret out of the patch
test: cover the route refusals
ci: verify every push and pull request
docs: describe the three server sources
chore: scaffold the typescript package
```

Types in use: `feat`, `fix`, `test`, `ci`, `docs`, `chore`, `refactor`, `style`, `perf`, `revert`.
The summary is imperative and lower case, at most 100 characters, the body explains why the change is
needed, and one commit does one thing. The `Commit messages` job checks this on every push.

## Release

A release is cut from `main` on a `release/<minor>` branch, and the version only exists once the
release branch is merged back:

```sh
git switch main
git switch -c release/0.2
npm version minor --no-git-tag-version   # or major; patch goes through the hotfix flow
# move the CHANGELOG entries from Unreleased to 0.2.0
git commit -am "chore(release): 0.2.0"
git push -u origin release/0.2
```

Then:

1. Fixes found during the freeze land on `fix/*` branches and are pulled into `release/0.2` by pull
   request, so CI proves the release branch is green.
2. Tag the release branch once it is final:
   `git tag -a v0.2.0 -m "v0.2.0" && git push origin v0.2.0`.
3. Open `release/0.2` against `main` and merge it with **Create a merge commit**. The tag is already
   an ancestor of `main` at that point.
4. Leave `release/0.2` in place. A patch release is a `hotfix/*` branch merged into `main` and into
   `release/0.2`, tagged `v0.2.1`.

A release pull request is the only kind that reaches `main` with a version bump: nothing else touches
`package.json`'s version or moves the `CHANGELOG` entries out of `Unreleased`.

## Hotfix

```sh
git switch main
git switch -c hotfix/route-403
# fix, test, commit
git push -u origin hotfix/route-403
```

1. Open `hotfix/route-403` against `main`, merge with a merge commit.
2. Tag `v0.2.1` on `main`.
3. Open the same branch against the affected `release/0.2` and merge it there too, so the release line
   carries the fix.

## Forks and outside contributions

Fork the repository, clone the fork, and add the source repository as `upstream`:

```sh
git remote add upstream git@github.com:fhffug-code/mcp-manager.git
git fetch upstream
git switch -c fix/route-403 upstream/main
```

Push the branch to **your fork** and open the pull request against this repository's `main`, not
against a `feature/*` branch. Keep the branch rebased on `upstream/main`, run the full verification
loop first, and tick _Allow edits from maintainers_.
