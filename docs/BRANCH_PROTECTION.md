# Branch Protection Rules & CI Quality Gates (EMT-19)

## Overview
This document specifies the mandatory GitHub Branch Protection rules configured on the `test` and `main` branches for the `Event_Management_Team7` repository. These rules enforce continuous integration quality gates so that no broken, untested, or vulnerable code can be merged into staging (`test`) or production (`main`).

---

## 1. Protected Branch: `test`
The `test` branch serves as the staging branch where integration testing and verification take place before code reaches `main`.

### Rule Settings
1. **Branch name pattern:** `test`
2. **Protect matching branches:**
   - **Require a pull request before merging:** `Enabled`
     - **Required approvals:** `1` (QA / Tester: Avinash Julakatti or Development Lead)
     - **Dismiss stale pull request approvals when new commits are pushed:** `Enabled`
     - **Require review from Code Owners:** `Enabled` (when CODEOWNERS is defined)
   - **Require status checks to pass before merging:** `Enabled`
     - **Require branches to be up to date before merging:** `Enabled`
     - **Required status checks:**
       - `Build, unit tests, coverage` (`build-and-test` job in `.github/workflows/ci.yml`)
       - `Static analysis (cppcheck)` (`static-analysis` job in `.github/workflows/ci.yml`)
   - **Require conversation resolution before merging:** `Enabled`
   - **Do not allow bypassing the above settings:** `Enabled` (enforced for Administrators as well)

---

## 2. Protected Branch: `main`
The `main` branch contains production releases and triggers continuous deployment (CD) container image publication to GHCR.

### Rule Settings
1. **Branch name pattern:** `main`
2. **Protect matching branches:**
   - **Require a pull request before merging:** `Enabled`
     - **Required approvals:** `2` (QA / Tester sign-off and Product Owner / Dev Lead approval)
     - **Dismiss stale pull request approvals when new commits are pushed:** `Enabled`
   - **Require status checks to pass before merging:** `Enabled`
     - **Required status checks:**
       - `Build, unit tests, coverage`
       - `Static analysis (cppcheck)`
       - `Docker image builds`
   - **Do not allow bypassing the above settings:** `Enabled`

---

## 3. CI Quality Gate Criteria
A Pull Request check shows a **red status** (failure) if:
- CMake configuration or compilation fails.
- Any GoogleTest unit or API test fails during `ctest`.
- Cppcheck detects any warning, portability, performance issue, or error (`--error-exitcode=1`).
- Merge is blocked until all required checks turn **green**.
