# Security policy

## Supported versions

Security fixes are applied to the latest tagged release and the `main` branch.

## Report privately

Please do not open a public issue for a suspected vulnerability. Use GitHub's **Security → Report a vulnerability** flow so maintainers can coordinate a fix and disclosure.

Include the affected version, reproduction steps, impact, and any suggested mitigation. Do not include real publication data or credentials.

## Security model

- The server performs one kind of remote operation: an unauthenticated `GET` of the configured public RSS feed.
- It has no Substack login, cookie, OAuth-token, private-endpoint, or publishing support.
- It listens on no network port; MCP communication is stdio.
- SQLite files are set to user-only permissions where the operating system supports them.
- Metric inputs are post-level snapshots supplied deliberately by the MCP caller.
- Unexpected upstream formats fail closed before storage.

The project does not protect against a malicious local user who can already read the process environment or files owned by the same operating-system account.
