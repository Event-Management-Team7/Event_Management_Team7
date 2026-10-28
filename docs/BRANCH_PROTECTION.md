# Branch Protection Rules & CI Quality Gates (EMT-30)

## Overview
This document specifies the mandatory GitHub Branch Protection rules configured on the `main` branch for the `Event_Management_Team7` repository. All development pull requests target `main` directly. These rules enforce continuous integration quality gates so that no broken, untested, or unformatted code can be merged into production.

---

## 1. Protected Branch: `main`
The `main` branch contains production releases and triggers continuous deployment (CD) container image publication to GHCR.

### Rule Settings
1. **Branch name pattern:** `main`
2. **Protect matching branches:**
   - **Require a pull request before merging:** `Enabled`
     - **Required approvals:** `1` (QA / Tester sign-off or Dev Lead approval)
     - **Dismiss stale pull request approvals when new commits are pushed:** `Enabled`
   - **Require status checks to pass before merging:** `Enabled`
     - **Require branches to be up to date before merging:** `Enabled`
     - **Required status checks:**
       - `Build, unit tests, coverage` (`build-and-test` job in `.github/workflows/ci.yml`)
       - `Static analysis (JavaScript syntax & lint)` (`static-analysis` job in `.github/workflows/ci.yml`)
       - `Docker image builds` (`docker-build` job in `.github/workflows/ci.yml`)
   - **Require conversation resolution before merging:** `Enabled`
   - **Do not allow bypassing the above settings:** `Enabled`

---

## 2. CI Quality Gate Criteria
A Pull Request check shows a **red status** (failure) if:
- Node.js dependencies fail to install cleanly (`npm ci`).
- Any backend unit or API test fails during `npm test` (`node --test --experimental-test-coverage`).
- Backend test coverage falls below the required threshold.
- ESLint or syntax checks report any errors (`npm run lint`).
- React frontend production build (`npm run build`) fails.
- Docker multi-stage container build fails or fails the `/api/health` container smoke test.
- Merge is blocked until all required checks turn **green**.
