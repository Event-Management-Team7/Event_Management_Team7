# Test Architecture (EMRS)

This repository follows the prescribed tech stack: **JavaScript (Node.js & React.js)** with **Python** for automated browser testing.

---

## 1. Backend & Unit Tests (JavaScript / Node.js)
Located in [`backend/test/`](../backend/test/). Built using Node.js's native test runner (`node:test`) and strict assertions (`node:assert/strict`).

### Test Suites:
- `validation.test.js`: Input validation, boundary checks, RFC email formatting, password strength, event data, ticket pricing.
- `auth-service.test.js`: Password hashing (bcrypt + PBKDF2 backwards compatibility), user provisioning, role-based access.
- `api.test.js`: REST API endpoints, JWT sessions, lockout policies, event lifecycle, waitlist queueing, check-in.
- `event-service.test.js`: Event CRUD, organizer scoping, filtering, and event cancellations.
- `registration-service.test.js`: Capacity tracking, waitlisting, and promotion logic.
- `ticket-service.test.js`: Ticket generation, code verification, check-in idempotency.
- `database.test.js`: SQLite schema, foreign keys, and migration integrity.
- `mailer.test.js`: Transactional emails and notification handlers.

### How to Run:
```bash
npm test
# or
npm --prefix backend test
```

---

## 2. Frontend & Browser UI Tests (Python / Playwright)
Located in [`tests/frontend/`](./frontend/). Built using Python (`pytest` + `playwright`) to test user journeys against the running server.

### Test Suites:
- `test_auth_ui.py`: Authentication, registration modals, inline errors, focus traps, session persistence.
- `test_create_event_ui.py`: Organizer event creation form, validations, and responsive layouts.

### How to Run:
```bash
pip install -r tests/frontend/requirements.txt
playwright install chromium
pytest -v
```
The test harness in `tests/frontend/conftest.py` automatically spins up the Node.js backend server (`node backend/src/server.js`) on an ephemeral port with an in-memory database.
