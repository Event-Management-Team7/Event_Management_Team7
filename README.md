# Event_Management_Team7
An Event Management and Registration System (EMRS) featuring event creation, attendee discovery, RSVP registration, automated waitlisting, QR e-ticket issuance, and real-time admission check-in.

Project Manager - Aariz

Development Lead - Dhanraj Rathod

Product Owner - Vaishali Krishnan

Testing - Avinash Julakatti

**Link to jira space:** https://vaishaliam313.atlassian.net/jira/software/projects/EMT/summary

## Tech Stack
- **Backend:** Node.js & Express REST API, SQLite3 (`better-sqlite3`)
- **Frontend:** React.js (Vite) Single-Page Application (`frontend/`) and responsive HTML5 / CSS3 / JavaScript client (`web/`)
- **Security:** Salted bcrypt password hashing, JWT bearer tokens, parameterized SQL queries
- **Tests:** Node.js native test runner (`node:test`) for unit and integration suites, pytest + Playwright for automated browser UI tests
- **CI/CD:** GitHub Actions (Node.js unit tests, React build, Playwright browser test, Docker container build and GHCR publish)

## Getting Started

### Prerequisites
- Node.js >= 20 (v22 recommended)
- npm >= 10
- Python 3.11+ (for browser UI tests)

### Running the Application

1. **Install dependencies:**
   ```bash
   npm --prefix backend install
   npm --prefix frontend install
   ```

2. **Start Backend Server:**
   ```bash
   npm run start:backend
   # Backend runs on http://localhost:8080
   ```

3. **Start Frontend (Vite Dev Server):**
   ```bash
   npm run dev:frontend
   # Frontend runs on http://localhost:5173 (proxied to backend on 8080)
   ```

4. **Build Frontend for Production:**
   ```bash
   npm run build:frontend
   ```

## Running the Tests

### 1. Backend Unit & API Tests (Node.js)
Runs all 61 automated tests covering input validation, authentication, event management, registrations, waitlists, tickets, and SQLite database operations:
```bash
npm test
```

### 2. Frontend Browser UI Tests (Python + Playwright)
```bash
pip install -r frontend/test/requirements.txt   # one time
playwright install chromium                     # one time
pytest -v                                       # browser tests against Node.js backend
```

## Documentation
All software engineering specifications and architecture models are located in the [`docs/`](docs/) directory:
- [Software Requirements Specification (SRS)](docs/Software%20Requirements%20Specification%20(SRS).docx)
- [Software Architecture Document (SAD)](docs/EMRS_SAD_v1_1_UML_Aligned.pdf)
- [System Test Plan](docs/EMRS_Test_Plan_v1_1.pdf)
- [Sprint 1 Test Plan (EMT-20)](docs/Sprint_1_Test_Plan.md)
- [Branch Protection & CI Quality Gates (EMT-19)](docs/BRANCH_PROTECTION.md)
- [UML Component Diagram](docs/EMRS_component_diagram_updated.png)

![EMRS UML Component Diagram](docs/EMRS_component_diagram_updated.png)

## Repository Structure
```
Event_Management_Team7/
├── .github/
│   └── workflows/
│       ├── cd.yml                  # Publish Docker container to GHCR on main branch merge
│       ├── ci.yml                  # CI: Node.js tests, React build, Playwright test, Docker build
│       └── codeql.yml              # CodeQL security static analysis
├── backend/                        # Node.js + Express backend service
│   ├── src/
│   │   ├── auth/                   # Passwords and crypto (bcrypt, pbkdf2)
│   │   ├── db/                     # SQLite connection, schema & migrations
│   │   ├── middleware/             # JWT authentication middleware
│   │   ├── routes/                 # Express API route handlers
│   │   ├── services/               # Business logic (Auth, Events, Registrations, Tickets)
│   │   ├── util/                   # Input validation and sanitization
│   │   ├── app.js                  # Express app setup and route configuration
│   │   └── server.js               # Application HTTP server entry point
│   ├── test/                       # Node.js automated test suites (node:test)
│   │   ├── api.test.js             # End-to-end REST API & session test suite
│   │   ├── auth-service.test.js    # Auth service & password hashing tests
│   │   ├── database.test.js        # SQLite schema & migration tests
│   │   ├── event-service.test.js   # Event CRUD & access control tests
│   │   ├── mailer.test.js          # Email notification tests
│   │   ├── registration-service.test.js # Registration & waitlist tests
│   │   ├── ticket-service.test.js  # Ticket & check-in tests
│   │   └── validation.test.js      # Input validation test suite
│   ├── package.json
│   └── package-lock.json
├── frontend/                       # React.js (Vite) Single-Page Application
│   ├── src/
│   │   ├── components/             # Reusable UI components (AuthPanel, EventCard, EventForm, etc.)
│   │   ├── pages/                  # Per-tab views (EventsPage, CreateEventPage, CheckInPage, etc.)
│   │   ├── hooks/                  # Custom React hooks (useEventActions)
│   │   ├── App.jsx                 # Main application layout
│   │   └── api.js                  # API client fetch wrappers
│   ├── test/                       # Frontend browser UI test suite (Python + Playwright)
│   │   ├── conftest.py             # Server & browser test fixtures
│   │   ├── helpers.py              # Test helper functions
│   │   ├── test_auth_ui.py         # Registration & login UI tests
│   │   ├── test_create_event_ui.py # Event creation UI tests
│   │   └── requirements.txt        # Playwright dependencies
│   ├── package.json
│   └── vite.config.js
├── web/                            # Static web client assets (served by backend)
├── docs/                           # Project requirements, architecture specs & test plans
├── Dockerfile                      # Multi-stage production Dockerfile (Node.js 22)
├── package.json                    # Root workspace package.json
└── README.md
```

## Docker
```bash
docker build -t emrs . && docker run -p 8080:8080 emrs
```

## Workflow
1. Developer works on one feature branch per Jira story (e.g. `EMRS-1-user-registration`), one commit per story.
2. Pull request into `test`; CI must be green.
3. Tester verifies on `test`, then merges `test` into `main`.
4. Merge to `main` publishes the Docker image (CD).

Commit messages start with the Jira key, e.g. `EMRS-1: Add user registration and validation`.
