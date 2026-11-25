## What this changes

<!-- One paragraph. What a person can now do that they could not before. -->

## How it was verified

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`
- [ ] `npm test` (and the coverage still passes its thresholds)
- [ ] `npm run build && npm run verify:bundle`
- [ ] If the bundle runs in a profile: reinstalled, and `mcp_workbench` answered `list`

## Checklist

- [ ] The branch is a `<type>/<slug>` cut from `main` (or `release`, for a freeze fix)
- [ ] This pull request carries the whole change: several commits are fine, a second pull request for a follow-up is not
- [ ] The commits are Conventional Commits, one thing each
- [ ] `CHANGELOG.md` has a line if a person can notice the change
- [ ] The docs that describe the touched surface still match the code
- [ ] Merged with **Create a merge commit**, never a squash or a rebase
