import { vi } from "vitest";

// "server-only" is a marker package that throws unless the bundler applies
// Next.js's "react-server" export condition (see ARCHITECTURE.md §3.2 for
// modules that import it). Vitest runs plain Node, so it never sets that
// condition; this mock keeps the marker's intent (documented in source)
// without failing every test that imports a server-only module.
vi.mock("server-only", () => ({}));
