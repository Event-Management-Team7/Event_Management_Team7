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

---

## 2. Test Harness & Automation Infrastructure

### 2.1 Reusable Test Server (`tests/TestServer.h`)
The automated API test suite uses an ephemeral in-process test server (`TestServer`):
- Initializes an isolated SQLite in-memory database (`:memory:`) with full schema.
- Dynamically binds the HTTP server (`cpp-httplib`) to an available ephemeral operating system port (`bind_to_any_port("127.0.0.1")`).
- Uses reduced PBKDF2 iterations (1,000 iterations instead of 100,000) during test execution to ensure fast test suites.
- Provides an automated HTTP client (`s.client()`) for sending REST requests and validating responses.
- Cleans up threads and databases automatically on test fixture destruction.

### 2.2 GoogleTest & CTest Discovery
GoogleTest is linked statically and registered with CMake:
```bash
ctest --test-dir build --output-on-failure
```
Every test case registered with `TEST(Suite, CaseName)` is automatically discovered and reported in the CI pipeline on every Pull Request.

---

## 3. Test Cases Traceability Matrix (EMT-11, EMT-12, EMT-14)

| Jira Story | Test ID | Type | Description | Target Endpoint / Module | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EMT-11** | `TC-REG-POS-01` | Positive | Register new Attendee/Organizer with valid fields | `POST /api/auth/register` | HTTP 201 Created; user object returned without passwordHash. |
| **EMT-11** | `TC-REG-NEG-01` | Negative | Register with an already registered email | `POST /api/auth/register` | HTTP 409 Conflict; "Email is already registered". |
| **EMT-11** | `TC-REG-NEG-02` | Negative | Register with invalid email format (e.g. `bademail`) | `POST /api/auth/register` | HTTP 400 Bad Request; field error on `email`. |
| **EMT-11** | `TC-REG-NEG-03` | Negative | Register with weak password (<8 chars or no numbers) | `POST /api/auth/register` | HTTP 400 Bad Request; field error on `password`. |
| **EMT-11** | `TC-REG-NEG-04` | Negative | Register with missing required fields (empty name/email) | `POST /api/auth/register` | HTTP 400 Bad Request; field error map listing missing fields. |
| **EMT-11** | `TC-REG-NEG-05` | Negative | Register with invalid role (e.g. `SuperUser`) | `POST /api/auth/register` | HTTP 400 Bad Request; field error on `role`. |
| **EMT-12** | `TC-AUTH-POS-01` | Positive | Login with correct registered email and password | `POST /api/auth/login` | HTTP 200 OK; returns bearer session token and user profile. |
| **EMT-12** | `TC-AUTH-POS-02` | Positive | Access protected endpoint (`/api/auth/me`) with valid token | `GET /api/auth/me` | HTTP 200 OK; returns authenticated user profile. |
| **EMT-12** | `TC-AUTH-NEG-01` | Negative | Login with incorrect password for existing user | `POST /api/auth/login` | HTTP 401 Unauthorized; invalid credentials error. |
| **EMT-12** | `TC-AUTH-NEG-02` | Negative | Login with unregistered email address | `POST /api/auth/login` | HTTP 401 Unauthorized; invalid credentials error. |
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
1. Feature branch created adhering to naming convention (e.g., `EMRS-11-user-registration`).
2. Pull Request submitted targeting the `test` branch.
3. CMake build completes with no compilation warnings or errors.
4. Test environment and ephemeral in-memory database initialize successfully.

### 4.2 Exit Criteria
1. 100% of automated unit and API tests pass (`ctest --output-on-failure`).
2. Code coverage threshold of ≥80% is met across `src/`.
3. Static analysis (`cppcheck`) passes with 0 warnings/errors (`--error-exitcode=1`).
4. QA / Tester (Avinash Julakatti) executes an exploratory pass on the deployed `test` branch.
5. All positive and negative test cases documented in Section 3 are verified and signed off.

---

## 5. Verification Workflow & Approvals
- **Verification on `test` branch:** QA / Tester (**Avinash Julakatti**) reviews the automated CI test and coverage reports on every PR into `test`. Upon green CI and manual exploratory verification, QA approves the PR.
- **Merge to `main`:** Merging from `test` into `main` requires QA sign-off and Development Lead (**Dhanraj Rathod**) approval. Merge to `main` automatically triggers container build and publication to GHCR.
