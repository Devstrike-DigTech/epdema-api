# OpenAPI freeze policy

`api/openapi.json` is the contract.  Three clients consume it: the web app
(via `openapi-typescript` → `web/src/lib/api-generated.ts`), the future
mobile app (via `openapi_generator_cli` for Dart, landing in 5.5·A4), and
any third‑party integrator we choose to expose later.

This file documents how to evolve that contract without breaking those
clients silently.

---

## Versioning rule

The `info.version` field in `openapi.json` follows **semver-ish** rules.
The version constant lives in `api/scripts/generate-openapi.ts` as
`OPENAPI_VERSION` — bump it there, then regenerate.

| Change kind | Bump | Example |
|---|---|---|
| **Breaking** (major) | `1.x.y → 2.0.0` | Renamed/removed field, narrowed enum, made an optional field required, changed an HTTP status, removed an endpoint, renamed an `operationId`, switched an auth scheme. |
| **Additive** (minor) | `1.5.y → 1.6.0` | New endpoint, new optional field on a response, new optional query param, new enum variant on an open enum, new schema. |
| **Cosmetic** (patch) | `1.5.3 → 1.5.4` | Description rewording, example update, tag reorder, JSDoc tweaks that only affect human-readable output. The spec hash changes but no consumer code needs to. |

Bump the *highest-severity* tier that applies. A PR that adds an endpoint
AND removes a field is **major**, not minor + major.

## Workflow per PR

1. Make the controller / DTO change.
2. `pnpm openapi:generate` — regenerates `openapi.json`.
3. Inspect the diff. If it's:
   - **Breaking** → bump `OPENAPI_VERSION` major. Coordinate with `web/` and
     `mobile/` — those clients need a matching release.
   - **Additive** → bump minor. Clients keep working unchanged on old code;
     new code can use the new shape.
   - **Cosmetic** → bump patch.
4. `pnpm openapi:generate` again (the version bump is in the script — regen
   picks it up).
5. Commit `openapi.json` together with the controller change in the same
   PR. Reviewers can read the spec diff to verify the version bump matches
   the change.
6. Web side: `pnpm codegen` regenerates `web/src/lib/api-generated.ts`.
   Commit that too — same PR.
7. Mobile side (once 5.5·A4 lands): `tool/codegen.sh` regenerates the Dart
   client.

## CI guard (when CI lands in Phase 10)

```yaml
- run: pnpm --filter api openapi:check
- run: pnpm --filter web codegen:check
```

Both scripts regenerate the artifact and `git diff --exit-code` it. A PR
that changes a controller without updating `openapi.json` (or `api-generated.ts`)
fails the build loudly.

## Breaking-change checklist

Before merging a major bump, confirm:

- [ ] `OPENAPI_VERSION` bumped in `api/scripts/generate-openapi.ts`.
- [ ] `api/openapi.json` regenerated and committed.
- [ ] `web/src/lib/api-generated.ts` regenerated and committed.
- [ ] All web call sites that reference the removed/renamed surface updated.
- [ ] Once mobile is live: Dart client regenerated, Flutter call sites
      updated, mobile release scheduled to ship with the API release (or
      the API gates the breaking endpoint behind a header until the
      mobile rollout is complete).
- [ ] PR description names the breaking change explicitly so downstream
      consumers reading the changelog know what to look for.

## What is NOT a breaking change

These shapes are safe to assume stable even though they look like they
could shift:

- **Adding fields to a response object.** Clients are written to ignore
  unknown fields — the generated TS types just gain a new optional
  property, and existing code keeps compiling.
- **Adding endpoints, tags, schemas.** Pure addition; consumers don't
  reference what they don't know about.
- **Loosening a constraint** (e.g. making a `required` field optional in
  a request, widening a `maxLength`). Clients sending the stricter old
  shape still validate.

Any of these counts as *additive* — minor bump only.

## What IS a breaking change (and easy to miss)

- **Tightening a constraint** on a request DTO (a previously valid value
  now 422s).
- **Changing the case** of an enum value (`yes` → `Yes`) — clients hard-
  code these.
- **Removing an `operationId`** even if the route stays — codegen method
  names disappear.
- **Reordering positional path params** in a route template.

When in doubt, bump major.

---

Current version: see `OPENAPI_VERSION` in `api/scripts/generate-openapi.ts`.
