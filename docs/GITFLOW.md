# Branching

This repository uses classic Git Flow. Two long-lived branches carry the history:

- **`main`** holds released code only. Every commit on it is a release.
- **`develop`** holds the integration state. It is where work lands and where CI has to be green.

Work happens on short-lived branches, all cut from `develop`:

| Branch      | Cut from  | Merges into          | Purpose                                     |
| ----------- | --------- | -------------------- | ------------------------------------------- |
| `feature/*` | `develop` | `develop`            | A user-visible capability or a refactor     |
| `release/*` | `develop` | `main` and `develop` | Freeze a version, bump it, finish the notes |
| `hotfix/*`  | `main`    | `main` and `develop` | Repair a released version                   |

Branch names are short and kebab-cased: `feature/probe-cache`, `release/0.2.0`, `hotfix/route-403`.

## Merge rules

- Every merge uses `--no-ff`, so the branch keeps its own shape in the history:

  ```sh
  git switch develop
  git merge --no-ff feature/probe-cache -m "Merge branch 'feature/probe-cache' into develop"
  ```

- Never commit directly to `main` or `develop`.
- `main` only ever receives a merge from `release/*` or `hotfix/*`. `.github/workflows/git-flow.yml` enforces this on pull requests.
- A `release/*` or `hotfix/*` branch is merged into **both** `main` and `develop`, so the fix or the version bump is not lost for the next release.

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

Types in use: `feat`, `fix`, `test`, `ci`, `docs`, `chore`, `refactor`, `style`, `perf`.
The summary is imperative and lower case, the body explains why the change is needed, and one commit does one thing.

## Release

```sh
git switch develop
git switch -c release/0.2.0
npm version minor --no-git-tag-version   # or patch/major
# move the CHANGELOG entries from Unreleased to 0.2.0
git commit -am "chore(release): 0.2.0"
git switch main
git merge --no-ff release/0.2.0 -m "Merge branch 'release/0.2.0'"
git tag -a v0.2.0 -m "v0.2.0"
git switch develop
git merge --no-ff release/0.2.0 -m "Merge branch 'release/0.2.0' into develop"
git branch -d release/0.2.0
git push origin main develop --follow-tags
```

## Hotfix

```sh
git switch main
git switch -c hotfix/route-403
# fix, test, commit
git switch main
git merge --no-ff hotfix/route-403 -m "Merge branch 'hotfix/route-403'"
git tag -a v0.2.1 -m "v0.2.1"
git switch develop
git merge --no-ff hotfix/route-403 -m "Merge branch 'hotfix/route-403' into develop"
git push origin main develop --follow-tags
```
