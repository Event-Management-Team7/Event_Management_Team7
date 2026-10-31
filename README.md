# Event_Management_Team7
An Event Management and Registration System (EMRS) featuring event creation, attendee discovery, RSVP registration, automated waitlisting, QR e-ticket issuance, and real-time admission check-in.

Project Manager - Aariz

Development Lead - Dhanraj Rathod

Product Owner - Vaishali Krishnan

Testing - Avinash Julakatti

**Link to jira space:** https://vaishaliam313.atlassian.net/jira/software/projects/EMT/summary

## Tech Stack
- **Backend:** Node.js & Express REST API, SQLite3 (`better-sqlite3`)
- **Frontend:** React.js (Vite) Single-Page Application (`frontend/`)
- **Security:** Salted bcrypt password hashing, JWT bearer tokens, parameterized SQL queries
- **Tests & Quality:** Node.js native test runner (`node:test`) with experimental coverage, ESLint 9+ flat configuration
- **CI/CD:** GitHub Actions (Node.js unit tests with coverage, ESLint static analysis, React production build, Docker container build and GHCR publish)

## Getting Started

### Prerequisites
- Node.js >= 20 (v22 recommended)
- npm >= 10

### Running the Application

1. **Install dependencies:**
   ```bash
   npm --prefix backend install
   npm --prefix frontend install
   npm install
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

## Running the Tests & Quality Checks

### 1. Backend Unit, Service & API Tests (Node.js)
Runs all 61 automated tests covering input validation, authentication, event management, registrations, waitlists, tickets, and SQLite database operations with full coverage reporting:
```bash
npm test
```

### 2. Static Analysis & Linting (ESLint)
Runs ESLint across backend and frontend code:
```bash
npm run lint
```

## Documentation
All software engineering specifications and architecture models are located in the [`docs/`](docs/) directory:
- [Software Requirements Specification (SRS)](docs/Software%20Requirements%20Specification%20(SRS).docx)
- [Software Architecture Document (SAD)](docs/EMRS_SAD_v1_1_UML_Aligned.pdf)
- [System Test Plan](docs/EMRS_Test_Plan_v1_1.pdf)
- [Sprint 1 Test Plan (EMT-20)](docs/Sprint_1_Test_Plan.md)
- [Branch Protection & CI Quality Gates (EMT-30)](docs/BRANCH_PROTECTION.md)
- [UML Component Diagram](docs/EMRS_component_diagram_updated.png)

![EMRS UML Component Diagram](docs/EMRS_component_diagram_updated.png)

## Repository Structure
```
Event_Management_Team7/
├── .github/
│   └── workflows/
│       ├── cd.yml                  # Publish Docker container to GHCR on main branch merge
│       ├── ci.yml                  # CI: Node.js tests & coverage, ESLint, React build, Docker build
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
│   │   ├── api.js                  # API client fetch wrappers
│   │   ├── main.jsx                # React root bootstrap
│   │   └── styles.css              # Application CSS styling
│   ├── package.json
│   └── vite.config.js
├── docs/                           # Project requirements, architecture specs & test plans
├── Dockerfile                      # Multi-stage production Dockerfile (Node.js 22 + React)
├── eslint.config.js                # Modern flat ESLint configuration
├── package.json                    # Root workspace package.json
├── package-lock.json               # Root lockfile
└── README.md
```

## Docker
Build and run the production container:
```bash
docker build -t emrs .
docker run -p 8080:8080 emrs
```
The container builds the React frontend, runs the Node.js Express server, and serves the frontend on port 8080. Health check endpoint: `GET /api/health`.

### Email configuration (EMT-52)

The backend defaults to `MAIL_TRANSPORT=memory`, which keeps messages in process memory and is intended for tests and local development; it does not deliver email. Set `MAIL_TRANSPORT=smtp` to enable delivery through Nodemailer. SMTP mode requires valid configuration:

- `SMTP_HOST` — SMTP server host
- `SMTP_PORT` — SMTP server port (for example, `587` or `465`)
- `SMTP_USER` — SMTP authentication username
- `SMTP_PASS` — SMTP authentication password
- `MAIL_FROM` — sender address/name
- `APP_BASE_URL` — public application base URL used to construct email verification links (for example, `https://events.example.com`, or `http://localhost:8080` for local development)

Keep SMTP credentials in the environment rather than committing them to source control. Configure all SMTP settings before selecting `MAIL_TRANSPORT=smtp`.

#### Email verification (EMT-28)

On registration, EMRS emails a verification link built from `APP_BASE_URL`: `<APP_BASE_URL>/#verify-email=<token>`. The token is in the URL fragment so it is never sent to the server or written to access logs. The page calls `POST /api/auth/verify-email` with `{ "token": "..." }`.

- Tokens are random, stored only as a SHA-256 hash, valid for 24 hours and work once. An unknown, expired or used token returns `400` and changes nothing.
- Unverified users **can sign in**, but `POST /api/events` and `POST /api/events/:id/register` return `403 {"error":"Please verify your email"}` until they verify. `GET /api/auth/me` and the login response include `emailVerified`.
- `POST /api/auth/resend-verification` (signed-in, unverified users) issues a new link and invalidates the old one. It is limited to 3 requests per hour per user (`429` with `Retry-After`); an already verified account gets `409`.
- Accounts created before this feature are unverified. Resend a link to them, or run `UPDATE users SET email_verified = 1 WHERE ...` for trusted accounts.
- Admin accounts created through `provisionUser` are verified automatically.

A successful event registration sends a plain-text confirmation with the event title, date/time, and ticket code. Waitlisted registrations do not receive a confirmed-registration email.

EMT-52 tests cover SMTP configuration and mocked delivery, verification email content and token handling, registration confirmation content, waitlist behavior, and email-failure isolation. Waitlist promotion and event cancellation emails are deferred to EMT-47; password-reset emails are deferred to EMT-13.

## Workflow
1. Developer creates a feature branch per Jira story (e.g. `EMT-30-ci-cd-node-react`), with concise commits prefixed with the story key.
2. Pull requests target `main` directly.
3. CI status checks (`Build, unit tests, coverage`, `Static analysis (JavaScript syntax & lint)`, `Docker image builds`) must pass green before merge.
4. QA / Tester (Avinash Julakatti) and Development Lead (Dhanraj Rathod) review and approve the PR.
5. Merging to `main` triggers automated container build and publication to GHCR via CD.
