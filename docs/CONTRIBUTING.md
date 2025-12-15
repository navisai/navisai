# Contributing to Navis AI

Thank you for considering contributing!

---

## 1. Code of Conduct

All participants must follow `CODE_OF_CONDUCT.md`.

---

## 2. Monorepo Layout

Navis uses pnpm workspaces:

```
apps/
packages/
```

Install dependencies:

```
pnpm install
```

Run daemon + PWA:

```
pnpm dev
```

---

## 3. Development Standards

- Use JS or TS with JSDoc (no strict TS requirement)
- Prefer functional modules in `packages/core`
- All database operations must use `@navisai/db` repositories
- Write small, modular commit messages

---

## 4. Pull Requests

PRs should include:

- Description of change
- Issue reference
- Tests if applicable
- Docs updates if needed

---

## 5. Testing

Testing stack TBD (vitest or tap), but all new logic should include minimal coverage.

---

## 6. Branching

- `main`: stable
- `dev`: active integration
- `feature/*`: new features  
- `fix/*`: bug fixes

---

## 7. Communication

Use GitHub issues for:

- Bugs  
- Feature proposals  
- Enhancement requests  

Security issues must be emailed privately.

---
