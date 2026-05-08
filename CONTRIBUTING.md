# Contributing

Thanks for helping improve `add-eks`.

## Setup

```sh
npm install
npm run typecheck
npm test
npm run build
```

## Development Notes

- Keep kubectl runtime dependencies out of the shell helper. It must not require Node.js, jq, Python, npx, or bun.
- Keep kubeconfig changes safe: backup before write, preserve unrelated fields, and prefer atomic writes.
- Add focused tests for behavior changes.
- Do not run live AWS tests in the default test suite.

## Commit Style

Use small focused commits, for example:

```text
feat: add cache management commands
fix: preserve AWS token identity in cache helper
docs: update quick start
```

## Pull Requests

Include:

- Summary of the change.
- Test commands run.
- Notes about compatibility or migration risks.

## npm Release

The npm package is published as `@eatingcookieman/add-eks`.

Before publishing:

```sh
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

For a patch release:

```sh
npm version patch
npm publish --access=public
git push --follow-tags
```

Notes:

- Scoped public packages require `--access=public`.
- `npm publish` may require one-time-password or web authentication.
- `npm pack --dry-run` should include `assets/add-eks-token.sh`, `dist/`, `README.md`, `README.ko.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `LICENSE`.
- Do not publish a new version until the GitHub `main` branch contains the release commit.
