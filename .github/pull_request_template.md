## Summary

<!-- Brief description of the changes in this PR -->

## Linked issue

<!-- Fixes #123 / Relates to #123. Every feature or bug fix needs a tracking issue, see AGENTS.md. Platform migration work links its epic (program #54). -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] CI/CD or infrastructure change

## Changes Made

-
-
-

## Testing

<!-- Check the commands you ran; see docs/TESTING.md -->

- [ ] `cd apps/api && npm test` (Jest unit + mocked integration)
- [ ] `cd apps/api && npm run typecheck`
- [ ] `cd apps/web && npm run test:run` (Vitest)
- [ ] `cd apps/web && npm run typecheck && npm run typecheck:test`
- [ ] `npm run cli:build`, `npm run typecheck --workspace=cli` and `npm run test:run --workspace=cli` (CLI changes; bump `apps/cli/package.json` once per PR)
- [ ] E2E (`tests/e2e`, if applicable)
- [ ] Manual testing completed

## Docs updated

<!-- Check the one that applies -->

- [ ] Architecture / API / Security docs (`docs/*.md`)
- [ ] Spec (`docs/specs/*.md`)
- [ ] Platform adoption (`docs/platform-adoption/*.md`)
- [ ] README
- [ ] AGENTS.md / CLAUDE.md
- [ ] None needed

## Checklist

- [ ] I have performed a self-review of my own code
- [ ] My changes generate no new warnings
- [ ] A behaviour change carries its tests
- [ ] No installed migration was edited or renamed
- [ ] No real people, companies or user material in code, tests, docs or commit messages
- [ ] Any dependent changes have been merged and published

## Additional Notes

<!-- Add any additional notes for reviewers -->
