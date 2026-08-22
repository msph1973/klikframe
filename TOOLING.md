# Local Agent Tooling — KlikFrame

- **Status:** Local development convenience; not a product/runtime specification
- **Last updated:** 20 Agustus 2026
- **Canonical project state:** `AGENTS.md` and `.junie/memory/`; MCP memory is never canonical

## Scope

`opencode.json` configures optional local agent providers and MCP servers. The application, CI, preview, and production deployment must not depend on this file or any configured MCP service.

## Trust Boundary

- Remote MCP/provider endpoints can receive prompts, selected repository context, and tool requests. Enable only services approved for the data classification of the current task.
- Provider/MCP credentials must use `{env:VARIABLE}` references. Never commit raw token, cookie, private endpoint, account ID, or header value.
- `JUNIE_BASE_URL`, `JUNIE_API_KEY`, `GITHUB_TOKEN`, and `KERNEL_TOKEN` belong in the local secret store/environment and must not appear in `.env.example`, logs, screenshots, or handoff memory.
- Workspace access uses relative `.` paths so the config does not reveal or depend on a developer home path.
- MCP `memory` is an optional ephemeral cache. Decisions, context, and handoff required by future sessions remain in versioned repository files.

## Supply-Chain Policy

The current local commands use package launchers. Before sharing/enabling them in a trusted environment:

1. Verify package owner, source, integrity, license, and required permissions.
2. Replace floating package tags such as `latest` and unversioned `npx -y` packages with reviewed exact versions.
3. Prefer an immutable local install/lockfile and disable servers not required by the task.
4. Review filesystem roots, remote URLs, headers, and provider model routing after every config change.
5. Run secret scan and JSON/schema validation before Git initialization or commit.

Do not assume an MCP server is sandboxed merely because it is launched locally. Filesystem and command-capable servers receive least-privilege roots and are used only in a trusted repository.

## Pre-Git Checklist

- [ ] No literal private IP/URL, credential, token, cookie, or personal path.
- [ ] All environment references are documented locally but values are excluded from Git.
- [ ] Remote services and repository data sharing are approved.
- [ ] Local packages are pinned and lockfile integrity is verified.
- [ ] Unneeded MCP servers are disabled.
- [ ] `opencode.json` parses and matches its declared schema.
- [ ] Repository state needed across sessions exists under `.junie/memory/`, not only MCP memory.