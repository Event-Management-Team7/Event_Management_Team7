# Sprint 1 Test Plan: Authentication & Event Creation (EMT-20)

**Project:** Event Management and Registration System (EMRS)  
**Sprint:** EMT Sprint 1  
**Author / QA Tester:** Avinash Julakatti (PES1UG24AM347)  
**Date:** 19/Oct/2026 - 23/Oct/2026  

---

## 1. Objective & Scope
The objective of Sprint 1 testing is to ensure core user registration, authentication, input validation, cryptographic password hashing, and event creation logic function securely and reliably.

Sprint 1 covers the following Jira user stories:
- **EMT-11:** User Registration & Input Validation
- **EMT-12:** User Login & Session Authentication
- **EMT-14:** Event Creation & Organizer Authorization
- **EMT-25:** Frontend registration and login pages
- **EMT-26:** Frontend organizer create-event form

---

## 2. Test Harness & Automation Infrastructure

### 2.1 Node.js Native Test Runner (`backend/test/`)
The automated backend and API test suite uses Node.js's native test runner (`node:test`) and strict assertions (`node:assert/strict`):
- Initializes an isolated SQLite in-memory database (`:memory:`) with full schema migrations.
- Executes full lifecycle REST API and service tests across validation, authentication, event creation, registration waitlists, and tickets.
- Fast execution: all 61 tests run in ~1.9 seconds.

```bash
npm test
# or
npm --prefix backend test
```

### 2.2 Frontend Browser Tests (Sprint 1 Archive)
> **Note (EMT-30):** The legacy HTML5 `web/` client and its associated pytest + Playwright test suite were retired during Sprint 2 (EMT-30) following the full migration to the React SPA (`frontend/`). End-to-end browser tests for the React application are tracked and deferred to **EMT-33**.

The original test cases executed for Sprint 1 sign-off covered:


| Jira | Test ID | Description |
| :--- | :--- | :--- |
| **EMT-25** | `TC-FE-01`, `TC-FE-02` | Register then log in from the browser; login email is prefilled after registering |
| **EMT-25** | `TC-FE-03` to `TC-FE-05` | Invalid input shows inline field errors without a page reload; duplicate email (409) and server `fields` errors appear under the matching input |
| **EMT-25** | `TC-FE-06` | Submit button is disabled while the request is in flight |
| **EMT-25** | `TC-FE-07` to `TC-FE-09` | Wrong password, empty fields and 429 lockout show inline messages |
| **EMT-25** | `TC-FE-10` to `TC-FE-12` | Token persists across reload, logout clears it, an unreachable server or rejected token never shows a signed-in user |
| **EMT-25** | `TC-FE-13` to `TC-FE-16` | Dialog roles, focus trap, Escape to close, autocomplete attributes, keyboard-only login |
| **EMT-25** | `TC-FE-17` | Modal fits 360px, 768px and 1440px viewports with no horizontal scroll |
| **EMT-26** | `TC-EVT-FE-01` to `TC-EVT-FE-04` | Create-event tab and form are hidden from logged-out users and attendees, visible to organizers, and closed on logout |
| **EMT-26** | `TC-EVT-FE-05` to `TC-EVT-FE-08` | Organizer creates an event end to end; virtual venue and ticket details are saved; empty price means free; confirmation and "create another" |
| **EMT-26** | `TC-EVT-FE-09` to `TC-EVT-FE-11` | Required fields and invalid values (past date, capacity, negative price) are flagged inline before submit with no API call; errors clear on edit |
| **EMT-26** | `TC-EVT-FE-12` to `TC-EVT-FE-15` | Server field errors shown inline after submit; network failure never reports success; no double submit; expired session signs the user out |
| **EMT-26** | `TC-EVT-FE-16`, `TC-EVT-FE-17` | Labelled controls; form fits 360px, 768px and 1440px viewports |

Note: the API stores a single `venue` string and `description`, so the form saves a virtual venue as `Virtual: <platform or link>` and appends ticket details to the description as `Ticket details: ...`.

---

## 3. Test Cases Traceability Matrix (EMT-11, EMT-12, EMT-14)

| Jira Story | Test ID | Type | Description | Target Endpoint / Module | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EMT-11** | `TC-REG-POS-01` | Positive | Register new Attendee/Organizer with valid fields | `POST /api/auth/register` | HTTP 201 Created; user object returned without passwordHash. |
| **EMT-11** | `TC-REG-NEG-01` | Negative | Register with an already registered email | `POST /api/auth/register` | HTTP 409 Conflict; "An account with this email already exists." |
| **EMT-11** | `TC-REG-NEG-02` | Negative | Register with invalid email format (e.g. `bademail`) | `POST /api/auth/register` | HTTP 400 Bad Request; field error on `email`. |
| **EMT-11** | `TC-REG-NEG-03` | Negative | Register with weak password (<8 chars or no numbers) | `POST /api/auth/register` | HTTP 400 Bad Request; field error on `password`. |
| **EMT-11** | `TC-REG-NEG-04` | Negative | Register with missing required fields (empty name/email) | `POST /api/auth/register` | HTTP 400 Bad Request; field error map listing missing fields. |
| **EMT-11** | `TC-REG-NEG-05` | Negative | Register with invalid role (e.g. `SuperUser`) | `POST /api/auth/register` | HTTP 400 Bad Request; field error on `role`. |
| **EMT-12** | `TC-AUTH-POS-01` | Positive | Login with correct registered email and password | `POST /api/auth/login` | HTTP 200 OK; returns bearer session token and user profile. |
| **EMT-12** | `TC-AUTH-POS-02` | Positive | Access protected endpoint (`/api/auth/me`) with valid token | `GET /api/auth/me` | HTTP 200 OK; returns authenticated user profile. |
| **EMT-12** | `TC-AUTH-NEG-01` | Negative | Login with incorrect password for existing user | `POST /api/auth/login` | HTTP 401 Unauthorized; invalid credentials error. |
| **EMT-12** | `TC-AUTH-NEG-02` | Negative | Login with unregistered email address | `POST /api/auth/login` | HTTP 401 Unauthorized; invalid credentials error. |
| **EMT-12** | `TC-AUTH-NEG-05` | Negative | Repeated failed logins for one account (5 failures) | `POST /api/auth/login` | HTTP 429 Too Many Requests; "Too many failed attempts. Account temporarily locked." |
| **EMT-12** | `TC-AUTH-NEG-03` | Negative | Access protected endpoint without Authorization token | `GET /api/auth/me` | HTTP 401 Unauthorized; "Missing authentication token". |
| **EMT-12** | `TC-AUTH-NEG-04` | Negative | Access protected endpoint with invalid or expired token | `GET /api/auth/me` | HTTP 401 Unauthorized; "Invalid or expired session token". |
| **EMT-14** | `TC-EVT-POS-01` | Positive | Organizer creates event with all required future details | `POST /api/events` | HTTP 201 Created; returns event ID; event stored with correct organizer. |
| **EMT-14** | `TC-EVT-NEG-01` | Negative | Create event with missing title, date, or venue | `POST /api/events` | HTTP 400 Bad Request; validation errors on required fields. |
| **EMT-14** | `TC-EVT-NEG-02` | Negative | Create event with non-positive capacity or negative price | `POST /api/events` | HTTP 400 Bad Request; validation errors on capacity/price. |
| **EMT-14** | `TC-EVT-NEG-03` | Negative | Create event with past date (e.g. `2020-01-01`) | `POST /api/events` | HTTP 400 Bad Request; "Event date cannot be in the past." |
| **EMT-14** | `TC-EVT-NEG-04` | Negative | Attendee attempts to create event | `POST /api/events` | HTTP 403 Forbidden; "Only organizers can create events." |
| **EMT-14** | `TC-EVT-NEG-05` | Negative | Unauthenticated request to create event | `POST /api/events` | HTTP 401 Unauthorized; "Missing authentication token". |

---

## 4. Entry and Exit Criteria

### 4.1 Entry Criteria
1. Feature branch created adhering to naming convention (e.g., `EMT-11-user-registration`).
2. Pull Request submitted targeting the `test` branch.
3. Node.js backend tests and React frontend build complete with no errors.
4. Test environment and ephemeral in-memory database initialize successfully.

### 4.2 Exit Criteria
1. 100% of automated unit and API tests pass (`npm test`).
2. Frontend production build completes cleanly (`npm run build:frontend`).
3. ESLint static analysis passes without errors (`npm run lint`).
4. Docker container build and `/api/health` smoke test pass.
5. All positive and negative test cases documented in Section 3 are verified and signed off.

---

## 5. Verification Workflow & Approvals
- **Pull Requests to `main`:** All PRs target `main` directly. Required status checks (`Build, unit tests, coverage`, `Static analysis (JavaScript syntax & lint)`, `Docker image builds`) must pass green.
- **QA Sign-off:** Merging into `main` requires QA sign-off (Avinash Julakatti) and Development Lead approval (Dhanraj Rathod).
- **Deployment:** Every merge to `main` triggers container build and publication to GHCR via CD workflow.
