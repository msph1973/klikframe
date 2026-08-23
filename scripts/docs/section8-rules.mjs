// TESTING.md §8 checks: cross-document route/status/role vocabulary
// consistency, traceability completeness, and Ably scope consistency.
// Each rule reads the canonical source documents and verifies every other
// Markdown file (and the canonical docs themselves) agree with them.

import path from "node:path";
import { readFileSync } from "node:fs";
import {
  ALL_CANONICAL_STATUSES,
  POST_MVP_ONLY_ROLES,
  API_SPEC_FILE,
  REQUIREMENTS_FILE,
  SCHEMA_FILE,
  TESTING_FILE,
  ROADMAP_FILE,
  CANONICAL_API_ROUTE_SET,
  CANONICAL_QUALIFIED_PREFIX,
  CANONICAL_PORTAL_ACTION_SCOPES,
  CANONICAL_ABLY_CHANNEL_PATTERNS,
  CANONICAL_REALTIME_EVENTS,
} from "./canonical-vocabulary.mjs";
import { STATUS_STOPWORDS } from "./stopwords.mjs";

const REQUIREMENT_ID_PATTERN = /\b((?:KF|NFR)-[A-Z]+-\d{3})\b/;
// Phase cell: one or more comma-separated phase expressions. Canonical
// docs write "Phase 0", "Phase 0–4", and the shorthand "Phase 0,4" /
// "Phase 0, 4–5" where subsequent numbers reuse the leading keyword.
// Whitespace is normalized away before matching.
const PHASE_CELL_PATTERN = /^(?:Phase|Fase)\d+(?:[–-]\d+)?(?:,(?:Phase|Fase)?\d+(?:[–-]\d+)?)*$/;
const ROUTE_PATTERN = /`((?:GET|POST|PATCH|PUT|DELETE) \/[a-zA-Z0-9_\-/:{}[\].]+)`/g;
const STATUS_TOKEN_PATTERN = /`([a-z][a-z_]+)`/g;
const ACTION_SCOPE_PATTERN = /`((?:contract|invoice|album):[a-z_:]+)`/g;
const CHANNEL_TOKEN_PATTERN = /`((?:workspace|portal):[^`\s]+)`/g;
// Same event vocabulary, but also matches when the name is embedded in a
// quoted JSON fragment inside backticks ("event_type": "contract.signed").
const EMBEDDED_EVENT_NAME_PATTERN =
  /\b((?:contract|invoice|payment|gallery|selection)\.[a-z]+)\b/g;
// `workspace_...` / `portal_...` identifiers: look like channel attempts
// but use `_` instead of the required `:` namespace delimiter.
const MALFORMED_CHANNEL_PATTERN = /`(?:workspace|portal)_[a-z0-9_]+`/g;
// Canonical DATABASE_SCHEMA.md column/table identifiers that share a
// channel-namespace prefix. They are schema vocabulary, never channels.
const SCHEMA_COLUMN_IDENTIFIERS = new Set([
  "workspace_id",
  "workspace_members",
  "portal_token_id",
  "portal_access_tokens",
]);

function readLines(cwd, relativePath) {
  return readFileSync(path.join(cwd, relativePath), "utf8").split("\n");
}

function isCanonicalDoc(file) {
  return [API_SPEC_FILE, SCHEMA_FILE, REQUIREMENTS_FILE].includes(path.basename(file));
}

/**
 * Extracts the requirement → phase mapping from a traceability matrix.
 * Returns { rows: Map<reqId, normalizedPhase>, malformedRows: string[] }.
 * A row whose last column is not a valid phase expression is reported as
 * malformed rather than silently skipped — but only when the table's
 * header actually has a roadmap/phase column; matrices without one (e.g.
 * PRODUCT_REQUIREMENTS §11, whose columns are requirement/data/API/
 * security/test/roadmap under different names) are matched by their
 * roadmap column position instead of assuming the last cell.
 */
export function extractTraceabilityRows(lines) {
  const rows = new Map();
  const malformedRows = [];
  let inTable = false;
  let roadmapColumnIndex = -1;
  lines.forEach((line, index) => {
    if (/^\|\s*Requirement\s*\||^\|\s*ID\s*\|/.test(line)) {
      inTable = true;
      const headers = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().toLowerCase());
      roadmapColumnIndex = headers.findIndex((h) => h.includes("roadmap") || h.includes("fase") || h.includes("phase"));
      return;
    }
    if (!inTable) return;
    if (!line.trim().startsWith("|")) {
      inTable = false;
      roadmapColumnIndex = -1;
      return;
    }
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const idMatch = REQUIREMENT_ID_PATTERN.exec(cells[0] ?? "");
    if (!idMatch) {
      const firstCell = cells[0] ?? "";
      if (firstCell && !/^[-\s:]+$/.test(firstCell)) {
        malformedRows.push(`line ${index + 1}: unrecognized traceability row "${firstCell}"`);
      }
      return;
    }
    // No roadmap column declared → this matrix doesn't track phases.
    if (roadmapColumnIndex === -1 || roadmapColumnIndex >= cells.length) return;
    const phaseCellRaw = cells[roadmapColumnIndex];
    const phaseCell = phaseCellRaw.replace(/\s+/g, "");
    if (!PHASE_CELL_PATTERN.test(phaseCell)) {
      malformedRows.push(
        `line ${index + 1}: requirement ${idMatch[1]} has invalid roadmap cell "${phaseCellRaw}"`,
      );
      return;
    }
    rows.set(idMatch[1], phaseCell);
  });
  return { rows, malformedRows };
}

/**
 * Traceability completeness: both canonical matrices must cover exactly
 * the same requirement IDs with the same roadmap phase, and every phase
 * they reference must exist as a "## Fase N" heading in ROADMAP.md.
 */
export function checkTraceabilityCompleteness({ files, cwd }) {
  void files;
  const findings = [];
  const testingLines = readLines(cwd, TESTING_FILE);
  const requirementsLines = readLines(cwd, REQUIREMENTS_FILE);

  const testing = extractTraceabilityRows(testingLines);
  const requirements = extractTraceabilityRows(requirementsLines);
  for (const row of testing.malformedRows) findings.push(`${TESTING_FILE} ${row}`);
  for (const row of requirements.malformedRows) findings.push(`${REQUIREMENTS_FILE} ${row}`);

  for (const id of requirements.rows.keys()) {
    if (!testing.rows.has(id)) {
      findings.push(`${TESTING_FILE}: requirement ${id} defined in ${REQUIREMENTS_FILE} is missing from the traceability matrix`);
    }
  }
  for (const id of testing.rows.keys()) {
    if (!requirements.rows.has(id)) {
      findings.push(`${REQUIREMENTS_FILE}: requirement ${id} in the traceability matrix has no definition`);
    }
  }
  for (const [id, prPhase] of requirements.rows) {
    const testPhase = testing.rows.get(id);
    if (testPhase !== undefined && testPhase !== prPhase) {
      findings.push(
        `traceability contradiction: ${id} maps to "${prPhase}" in ${REQUIREMENTS_FILE} but "${testPhase}" in ${TESTING_FILE}`,
      );
    }
  }

  const roadmapContent = readFileSync(path.join(cwd, ROADMAP_FILE), "utf8");
  const roadmapFases = new Set(
    [...roadmapContent.matchAll(/^##\s+Fase\s+(\d+)/gm)].map((m) => m[1]),
  );
  const referencedPhases = new Set();
  for (const phase of [...requirements.rows.values(), ...testing.rows.values()]) {
    for (const m of phase.matchAll(/(?:Phase|Fase)(\d+)/g)) {
      referencedPhases.add(m[1]);
    }
  }
  for (const num of referencedPhases) {
    if (!roadmapFases.has(num)) {
      findings.push(`${ROADMAP_FILE}: matrices reference Phase ${num} but no "## Fase ${num}" heading exists`);
    }
  }
  return findings;
}

/**
 * Route vocabulary: any HTTP route reference outside API_SPEC.md must be
 * either declared there (bare or under the canonical `/api/v1` prefix) or
 * be an auth-provider proxy route (`/api/auth/*`, which API_SPEC §1 places
 * outside `/api/v1`). Next.js implementation file paths are not routes.
 */
export function checkRouteVocabulary({ files, cwd }) {
  const findings = [];
  for (const file of files) {
    if (path.basename(file) === API_SPEC_FILE) continue;
    const lines = readLines(cwd, file);
    lines.forEach((line, index) => {
      ROUTE_PATTERN.lastIndex = 0;
      let match;
      while ((match = ROUTE_PATTERN.exec(line)) !== null) {
        const route = match[1];
        // The `/api/v1` prefix qualifies the *path*; strip it from after
        // the method, not from position 0 of the whole string.
        const spaceIndex = route.indexOf(" ");
        const pathPart = spaceIndex === -1 ? "" : route.slice(spaceIndex + 1);
        const barePath = pathPart.startsWith(CANONICAL_QUALIFIED_PREFIX)
          ? pathPart.slice(CANONICAL_QUALIFIED_PREFIX.length)
          : pathPart;
        const bare = spaceIndex === -1 ? route : `${route.slice(0, spaceIndex)} ${barePath}`;
        const isAuthProviderRoute = pathPart.startsWith("/api/auth/");
        if (!CANONICAL_API_ROUTE_SET.has(bare) && !isAuthProviderRoute) {
          findings.push(`${file}:${index + 1} references undeclared route "${route}" (not in ${API_SPEC_FILE})`);
        }
      }
    });
  }
  return findings;
}

/**
 * Status vocabulary: backticked lowercase snake_case tokens on a line that
 * also discusses "status" must belong to at least one canonical enum from
 * DATABASE_SCHEMA.md — unless they are known non-status identifiers
 * (table names, review-process words, etc.). The stoplist keeps the check
 * at zero false positives; a genuinely wrong status token near a "status"
 * mention is exactly the contradiction TESTING.md §8 targets.
 */
export function checkStatusVocabulary({ files, cwd }) {
  const findings = [];
  for (const file of files) {
    if (isCanonicalDoc(file)) continue;
    const lines = readLines(cwd, file);
    lines.forEach((line, index) => {
      if (!/\bstatus\b/i.test(line)) return;
      for (const token of extractStatusCandidates(line)) {
        if (!ALL_CANONICAL_STATUSES.has(token)) {
          findings.push(
            `${file}:${index + 1} uses unknown status token \`${token}\` near a "status" mention (not in ${SCHEMA_FILE} enums)`,
          );
        }
      }
    });
  }
  return findings;
}

/**
 * Status candidates are backticked lowercase snake_case tokens appearing
 * on a line that also discusses "status". This intentionally accepts the
 * small false-negative surface (a wrong token not on a status line) in
 * exchange for zero false positives on ordinary identifiers.
 */
function extractStatusCandidates(line) {
  const candidates = [];
  STATUS_TOKEN_PATTERN.lastIndex = 0;
  let match;
  while ((match = STATUS_TOKEN_PATTERN.exec(line)) !== null) {
    const token = match[1];
    // "status" itself is the trigger keyword, never a value.
    if (token === "status") continue;
    if (/^[a-z][a-z_]{2,}$/.test(token) && !STATUS_STOPWORDS.has(token)) {
      candidates.push(token);
    }
  }
  return candidates;
}

/**
 * Role vocabulary: `admin` / `assistant` must never appear as an active
 * MVP role. They may only be mentioned inside an explicit exclusion
 * context: a Post-MVP marker on the same line, or within an
 * out-of-scope/lifecycle section ("Di Luar Cakupan MVP", "Post-MVP",
 * "Evolusi"). A bare mention like "role `admin` performs X" contradicts
 * the owner-only MVP and fails the gate.
 */
export function checkRoleVocabulary({ files, cwd }) {
  const findings = [];
  const lineMarkers = [
    "post-mvp",
    "postmvp",
    "tidak memiliki",
    "tidak ada",
    "adalah post",
    "hanya `owner`",
    "mvp hanya",
    "di luar cakupan",
    "out of scope",
    "bukan dependency",
    "tidak masuk",
    // Delegation-plan files describe agent role assignments (BOT roles),
    // not product roles; `admin` there refers to GitHub permissions.
    "izin",
    "permission",
  ];
  for (const file of files) {
    const lines = readLines(cwd, file);
    let activeSectionAllowsPostMvpRoles = false;
    lines.forEach((line, index) => {
      const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
      if (headingMatch) {
        const heading = headingMatch[1].toLowerCase();
        activeSectionAllowsPostMvpRoles =
          /post-mvp|di luar cakupan|out of scope|evolusi|fase 6/.test(heading);
        return;
      }
      const lowered = line.toLowerCase();
      for (const role of POST_MVP_ONLY_ROLES) {
        if (!lowered.includes(`\`${role}\``)) continue;
        const hasLineMarker = lineMarkers.some((marker) => lowered.includes(marker));
        if (!hasLineMarker && !activeSectionAllowsPostMvpRoles) {
          findings.push(
            `${file}:${index + 1} mentions role \`${role}\` outside a Post-MVP/out-of-scope context (MVP roles are owner-only per ${SCHEMA_FILE})`,
          );
        }
      }
    });
  }
  return findings;
}

/**
 * Ably scope consistency (TESTING.md §8 "kontradiksi scope Ably"):
 * - portal action scopes must come from API_SPEC §7's allowlist;
 * - channel names must use exactly the two canonical placeholder shapes
 *   (or a concrete example derived from them);
 * - realtime event names must exist canonically and pair with the right
 *   resource type in envelope examples;
 * - server-only rules: docs must never describe exposing ABLY_API_KEY or
 *   granting a publish capability to the browser without a negation.
 */
export function checkAblyScopeConsistency({ files, cwd }) {
  const findings = [];
  const legalScopes = new Set(CANONICAL_PORTAL_ACTION_SCOPES);
  const eventResource = new Map(Object.entries(CANONICAL_REALTIME_EVENTS));

  for (const file of files) {
    const lines = readLines(cwd, file);
    lines.forEach((line, index) => {
      const lowered = line.toLowerCase();

      ACTION_SCOPE_PATTERN.lastIndex = 0;
      let match;
      while ((match = ACTION_SCOPE_PATTERN.exec(line)) !== null) {
        if (!legalScopes.has(match[1])) {
          findings.push(`${file}:${index + 1} uses unknown portal action scope \`${match[1]}\` (not in ${API_SPEC_FILE} §7)`);
        }
      }

      CHANNEL_TOKEN_PATTERN.lastIndex = 0;
      while ((match = CHANNEL_TOKEN_PATTERN.exec(line)) !== null) {
        const shaped = CANONICAL_ABLY_CHANNEL_PATTERNS.some((pattern) => pattern.test(match[1]));
        const concreteExample =
          /^workspace:[a-zA-Z0-9_-]+$/.test(match[1]) || /^portal:[a-zA-Z0-9_:-]+$/.test(match[1]);
        if (!shaped && !concreteExample) {
          findings.push(`${file}:${index + 1} uses non-canonical Ably channel name \`${match[1]}\``);
        }
      }

      // A backticked identifier starting with a channel namespace but
      // missing the `:` delimiter (e.g. `workspace_of_owners`) is a
      // malformed channel attempt — but ONLY on a channel-discussing line,
      // and never for known DATABASE_SCHEMA.md column identifiers
      // (`workspace_id`, `portal_token_id`, `workspace_members`), which are
      // ordinary schema vocabulary, not channel names.
      if (/\bchannel\b/i.test(line)) {
        MALFORMED_CHANNEL_PATTERN.lastIndex = 0;
        while ((match = MALFORMED_CHANNEL_PATTERN.exec(line)) !== null) {
          if (SCHEMA_COLUMN_IDENTIFIERS.has(match[0].replace(/`/g, ""))) continue;
          findings.push(`${file}:${index + 1} uses malformed Ably channel name \`${match[0]}\` (missing ":" namespace delimiter)`);
        }
      }


      // Event → resource pairing. Matches the event name both standalone
      // (backticked) and embedded inside a quoted JSON fragment, since
      // envelope examples often wrap the whole JSON snippet in backticks.
      EMBEDDED_EVENT_NAME_PATTERN.lastIndex = 0;
      while ((match = EMBEDDED_EVENT_NAME_PATTERN.exec(line)) !== null) {
        const eventName = match[1];
        const expected = eventResource.get(eventName);
        if (!expected) {
          findings.push(`${file}:${index + 1} uses unknown realtime event \`${eventName}\``);
          continue;
        }
        const resourceMention = /"(?:type)":\s*"(contract|invoice|album)"/.exec(line);
        if (resourceMention && resourceMention[1] !== expected) {
          findings.push(
            `${file}:${index + 1} pairs event \`${eventName}\` with resource type "${resourceMention[1]}" but canonical mapping requires "${expected}"`,
          );
        }
      }

      // Server-only rules. Negations ("tidak pernah", "never", ...) state
      // the documented rule and are fine; affirmative exposure statements
      // contradict SECURITY.md §1.2 / DEPLOYMENT.md §3.
      if (
        /ably_api_key/.test(lowered) &&
        /\b(kirim|mengirim|send|expose|exposed|leak|leaked|receive)\b/.test(lowered) &&
        !/(tidak pernah|never|tidak boleh|must not|no )/.test(lowered)
      ) {
        findings.push(`${file}:${index + 1} appears to describe exposing ABLY_API_KEY without a negation`);
      }
      if (
        /publish capability/.test(lowered) &&
        /(browser|klien)/.test(lowered) &&
        /(diberikan|granted|menerima|receives|memiliki|has)/.test(lowered) &&
        !/(denied|ditolak|tidak|never|no |tanpa)/.test(lowered)
      ) {
        findings.push(`${file}:${index + 1} appears to grant a publish capability to the browser`);
      }
    });
  }
  return findings;
}
