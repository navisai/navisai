# Navis AI — Release Process

Version: v0.1

---

## 1. Goals

- Maintain a stable OSS core.
- Ship predictable versions to npm.
- Prepare for future premium/private packages.
- Keep process simple enough for a small team.

---

## 2. Versioning Strategy

Navis uses **Semantic Versioning (SemVer)**:

- `MAJOR.MINOR.PATCH`

Rules:

- Breaking changes → MAJOR
- Backwards-compatible features → MINOR
- Bug fixes and small changes → PATCH

---

## 3. Monorepo + pnpm

Navis uses **pnpm workspaces**:

- Root: `pnpm-workspace.yaml`
- Packages:
  - `apps/*`
  - `packages/*`

All commands and releases are run from monorepo root.

---

## 4. Packages to Publish (OSS)

Initial OSS publish targets:

- CLI bootstrap:
  - `create-navis` (global scaffolding tool)
- Workspaces:
  - `@navisai/cli`
  - `@navisai/core`
  - `@navisai/discovery`
  - `@navisai/db`
  - `@navisai/api-contracts`
  - `@navisai/logging` (if split as a package)

PWA (`apps/pwa`) and daemon (`apps/daemon`) are publish targets to support an npm-first end-user installation flow:

- `@navisai/daemon`
- `@navisai/pwa`

---

## 5. Release Steps (Manual MVP Flow)

1. **Ensure tests pass**

   ```bash
   pnpm test
   ```

2. **Update docs**

   - `README.md`
   - `navis_prd.md` (if scope changed)
   - `RELEASE_NOTES.md` / `CHANGELOG.md`

3. **Bump Versions**

   For MVP, manually update `version` fields in:

   - `create-navis/package.json`
   - `packages/*/package.json`

   Later we can adopt Changesets.

4. **Format & Build**

   ```bash
   pnpm format:check  # Verify formatting
   pnpm build         # Build all packages
   ```

5. **Login and publish**

   ```bash
   npm login
   pnpm -r publish --access public
   ```

   Or publish individually:

   ```bash
   cd packages/core
   pnpm publish --access public
   ```

6. **Create GitHub Release**

   - Tag: `vX.Y.Z`
   - Release notes summarizing changes.

---

## 6. Tags & Branches

- `main` — stable
- `dev` — integration branch
- `feature/*` — new work
- `fix/*` — bug fixes

Tag releases from `main`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## 7. Future Automation

Later adoption:

- **Changesets** for automated versioning:
  - `changeset` files per PR
  - Automated `version` and `publish` steps
- **GitHub Actions** pipeline:
  - On tag:
    - run tests
    - build
    - publish to npm
    - publish GitHub Release

---
