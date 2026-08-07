# Contributing

Thank you for helping make publication analytics more durable and explainable.

## Ground rules

- Keep Substack access credential-free and read-only. Pull requests that add cookies, private endpoints, scraping, browser automation, or publishing will not be accepted.
- Preserve provenance. Never fill a missing metric with an estimate.
- Keep calculations deterministic and add tests for every formula or schema change.
- Avoid subscriber-level personal data. The storage model is post-level by design.
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Development

```bash
npm ci
npm run check
npm test
npm run build
```

Tests use fixtures and an in-memory SQLite database; they should not require network access or a Substack account.

## Pull requests

1. Open an issue for material tool-contract or database changes.
2. Keep each pull request focused.
3. Add or update tests and documentation.
4. Run all release checks locally.
5. Explain compatibility and migration impact in the pull request description.

By contributing, you agree that your contribution is licensed under Apache-2.0.
