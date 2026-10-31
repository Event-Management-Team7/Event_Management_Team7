# Sprint 2 Test Plan (EMT-33, EMT-51)

**Project:** Event Management and Registration System (EMRS)  
**Sprint:** EMT Sprint 2 (25/Oct/2026 - 01/Nov/2026)  
**Jira:** EMT-33 (Sprint 2 test plan and automated tests), EMT-51 (registration, cancellation, waitlist and check-in sign-off)  
**Authors:** EMT-51 sections: Avinash Julakatti (PES1UG24AM347). EMT-33 sections: Aariz Dudekula  
**Last updated:** 31/Oct/2026  
**SRS Traceability:** EMRS-F-001, F-006, F-007, F-008, F-010, F-011, F-012, F-014, F-016, EMRS-SEC-003, EMRS-SEC-004 (EMRS-F-013 deferred)

---

## 1. Objective & Scope

This plan covers the Sprint 2 stories the same way the Sprint 1 plan covered EMT-11, EMT-12 and EMT-14. Every acceptance criterion (AC) in scope is mapped to a test case ID, to the SRS requirement ID and RTM test case ID, and to the automated test that verifies it.

| Jira | Story | SRS requirement | Status in this plan |
| :--- | :--- | :--- | :--- |
| EMT-15 | Update event (with audit log) | EMRS-F-006, EMRS-SEC-003 | Covered (section 3.2) |
| EMT-16 | Cancel event (notify attendees) | EMRS-F-007, EMRS-F-014 | Covered (section 3.3) |
| EMT-27 | Email service core (in-memory transport) | EMRS-F-014, EMRS-NF-005 | Covered (section 3.7) |
| EMT-28 | Email verification | EMRS-F-001 | Covered (section 3.4) |
| EMT-29 | Rate limiting and CAPTCHA | EMRS-SEC-004 | Covered (section 3.5) |
| EMT-36 | Search by date range and location | EMRS-F-008 | Covered (section 3.6) |
| EMT-52 | SMTP and confirmation emails | EMRS-F-014, EMRS-F-012 | Covered, 2 defects (sections 3.7, 7) |
| EMT-51 | Registration, cancellation, waitlist, check-in | EMRS-F-010, F-011, F-012, F-016 | Covered (section 3.1) |
| EMT-38 | Simulated payment | EMRS-F-013, EMRS-SEC-005 | **Not implemented (deferred, To Do)**: no tests possible (section 6) |

**Out of scope here (deferred to the iteration phase):** password reset tests (EMT-13) and browser/Playwright tests for the new React flows. The React helpers (Retry-After formatting, verification link parsing) have unit tests in `frontend/test/`.

---

## 2. Test Harness & Automation Infrastructure

### 2.1 Node.js native test runner (`backend/test/`)
Tests use `node:test` and strict assertions against ephemeral in-memory SQLite databases. They run in CI on every pull request (`Build, unit tests, coverage` job).

```bash
npm --prefix backend test      # backend: 151 tests, with coverage
npm --prefix frontend test     # frontend helpers
npm run lint                   # ESLint for backend and frontend
```

### 2.2 No real emails and no real CAPTCHA calls
- **Mail:** tests use the in-memory mail transport (the default when no mailer is given), so sent messages are read back in assertions.
- **CAPTCHA:** tests use the offline CAPTCHA test mode (any token passes except `test-fail`), and provider integrations are tested against a stubbed `fetch`.
- **Guard:** `npm test` loads `backend/test-support/no-external-network.js`, which makes any connection to a non-local host throw. A test run therefore cannot send a real email or call Turnstile/reCAPTCHA even by accident. `backend/test/no-external-network.test.js` proves the guard works and that an app with default configuration needs no network.

### 2.3 Traceability guard
`backend/test/traceability.test.js` reads this document and fails the build if (a) any acceptance criterion in scope has no row, (b) a row marked PASS names an automated test that does not exist, or (c) a row without a test is not marked DEFERRED or DEFECT. The plan and the tests cannot drift apart silently.

---

## 3. Acceptance Criteria Traceability

Reference format in the last-but-one column: `file :: part of the test title`. Status values: **PASS**, **PARTIAL**, **DEFECT** (expected behaviour is not implemented, see section 7), **DEFERRED**.

### 3.1 Registration, cancellation, waitlist and check-in (EMT-51)

These 22 test cases were written and signed off in EMT-51 (QA: Avinash Julakatti).

| SRS ID | Jira Key | Test ID | Target Component | Acceptance Criteria / Description | Expected Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **EMRS-F-010** | EMT-51 | `TC-REG-POS-01` | `POST /api/events/:id/register` | Seats left: Attendee registers with valid future event having available capacity | HTTP 200 OK; `status: 'confirmed'`, `ticketCode` issued (`EMRS-[0-9a-f]{8}`) | **PASS** |
| **EMRS-F-010** | EMT-51 | `TC-REG-POS-02` | `POST /api/events/:id/register` | Event full: Attendee registers when capacity is reached | HTTP 200 OK; `status: 'waitlist'`, attendee placed on waitlist | **PASS** |
| **EMRS-F-010** | EMT-51 | `TC-REG-NEG-01` | `POST /api/events/:id/register` | Duplicate registration: Attendee attempts to register twice for the same event | HTTP 409 Conflict; "You are already registered for this event" | **PASS** |
| **EMRS-F-010** | EMT-51 | `TC-REG-NEG-02` | `POST /api/events/:id/register` | Cancelled event: Attendee attempts to register for an event marked cancelled | HTTP 400 Bad Request; "Event has been cancelled" | **PASS** |
| **EMRS-F-010** | EMT-51 | `TC-REG-NEG-03` | `POST /api/events/:id/register` | Started event: Attendee attempts to register for an event whose start time is in the past | HTTP 400 Bad Request; "Event has already started" | **PASS** |
| **EMRS-F-010** | EMT-51 | `TC-REG-NEG-04` | `POST /api/events/:id/register` | Logged out: Unauthenticated request to register | HTTP 401 Unauthorized; "Missing authentication token" | **PASS** |
| **EMRS-F-010** | EMT-51 | `TC-REG-INV-01` | `RegistrationService.register` | Concurrency invariant: Multiple concurrent registrations never exceed event capacity | Confirmed count equals capacity; surplus users waitlisted | **PASS** |
| **EMRS-F-011** | EMT-51 | `TC-CAN-POS-01` | `DELETE /api/registrations/:id` | Cancel before start: Attendee cancels own confirmed registration before event start time | HTTP 200 OK; "Registration cancelled successfully"; seat freed | **PASS** |
| **EMRS-F-011** | EMT-51 | `TC-CAN-SEC-01` | `DELETE /api/registrations/:id` | Revoke ticket: Cancelled registration ticket immediately stops working | Check-in with ticket returns HTTP 400 "Ticket has been cancelled" | **PASS** |
| **EMRS-F-011** | EMT-51 | `TC-CAN-NEG-01` | `DELETE /api/registrations/:id` | Started event: Attendee attempts to cancel registration after event has started | HTTP 400 Bad Request; "Cannot cancel registration for an event that has already started" | **PASS** |
| **EMRS-F-011** | EMT-51 | `TC-CAN-NEG-02` | `DELETE /api/registrations/:id` | Ownership scope: Attendee attempts to cancel another user's registration | HTTP 404 Not Found (prevents registration ID enumeration and unauthorised cancellation) | **PASS** |
| **EMRS-F-011** | EMT-51 | `TC-CAN-NEG-03` | `DELETE /api/registrations/:id` | Logged out: Unauthenticated cancellation attempt | HTTP 401 Unauthorized; "Missing authentication token" | **PASS** |
| **EMRS-F-012** | EMT-51 | `TC-WTL-POS-01` | `RegistrationService.cancel` | Auto-promotion: Seat freed promotes earliest waitlisted attendee automatically | Status updated to `confirmed`; ticket code issued to promoted attendee | **PASS** |
| **EMRS-F-012** | EMT-51 | `TC-WTL-POS-02` | `RegistrationService.cancel` | Multiple cancellations: Two seats freed promote two distinct waitlisted attendees | Two distinct waitlisted users promoted; no duplicate tickets or double promotion | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-CHK-POS-01` | `POST /api/tickets/checkin` | Valid check-in: Event organizer checks in valid ticket | HTTP 200 OK; "Check-in successful!"; attendee admitted and time recorded | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-CHK-NEG-01` | `POST /api/tickets/checkin` | Repeat check-in: Checking in the same ticket code a second time | HTTP 409 Conflict; "Ticket has already been checked in" | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-CHK-SEC-01` | `POST /api/tickets/checkin` | Authorization: Another event's organizer attempts to check in ticket | HTTP 403 Forbidden; "Only the event organizer can check in attendees for this event." | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-CHK-SEC-02` | `POST /api/tickets/checkin` | Non-organizer: Attendee attempts to check in ticket | HTTP 403 Forbidden; "Only organizers can check in attendees." | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-CHK-NEG-02` | `POST /api/tickets/checkin` | Unknown code: Checking in an unknown or non-existent ticket code | HTTP 404 Not Found; "Invalid ticket code" | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-CHK-NEG-03` | `POST /api/tickets/checkin` | Cancelled ticket: Checking in a ticket from a cancelled registration or cancelled event | HTTP 400 Bad Request; "Ticket has been cancelled" | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-VAL-POS-01` | `GET /api/tickets/:code` | Ticket lookup: Event organizer validates ticket details and check-in status | HTTP 200 OK; returns `ticketCode`, `eventTitle`, `attendeeName`, `checkedIn`, `checkedInAt` | **PASS** |
| **EMRS-F-016** | EMT-51 | `TC-VAL-SEC-01` | `GET /api/tickets/:code` | Unauthorized lookup: Another organizer attempts to validate ticket | HTTP 403 Forbidden; "Only the event organizer can validate tickets for this event." | **PASS** |

Automated tests behind these rows:

| Requirement | Automated tests |
| :--- | :--- |
| EMRS-F-010 | `api.test.js :: POST /api/events/:id/register verifies all EMRS-F-010 acceptance criteria`<br>`registration-service.test.js :: capacity is never exceeded under multiple registrations` |
| EMRS-F-011 | `api.test.js :: DELETE /api/registrations/:id verifies all EMRS-F-011 acceptance criteria` |
| EMRS-F-012 | `registration-service.test.js :: two cancellations promote exactly two distinct waitlisted attendees`<br>`api.test.js :: registration cancellation promotes the earliest waitlisted attendee` |
| EMRS-F-016 | `api.test.js :: Check-in verifies all EMRS-F-016 acceptance criteria`<br>`ticket-service.test.js :: validates ticket and performs check-in only once` |

### 3.2 Update event (EMT-15, EMRS-F-006, EMRS-SEC-003, RTM TC-Event-03)

| Story AC | Test ID | RTM ID | Scenario | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| EMT-15 AC1 | `TC-UPD-01` | TC-Event-03 | Owner of an upcoming event submits valid new details | 200; event shows the new values | `api.test.js :: event owner can update an event and audit records only changed fields` | PASS |
| EMT-15 AC2 | `TC-UPD-02` | TC-Event-03 | New values break the create-event rules (past start, end before start, capacity < 1 ...) | 400 "Validation failed" listing each invalid field; event unchanged | `api.test.js :: event updates use create-event validation and leave invalid events unchanged` | PASS |
| EMT-15 AC3 | `TC-UPD-03` | TC-Event-03 | Capacity set below the confirmed registrations | 400; event and audit log unchanged | `api.test.js :: event update rejects capacity below confirmed registrations without changing the event`<br>`api.test.js :: Sprint 2 QA: an organizer can lower capacity to exactly the confirmed count but not below it` | PASS |
| EMT-15 AC4 | `TC-UPD-04` | TC-Event-03 | Another organizer or an attendee tries to edit | 403 (Admin is allowed) | `api.test.js :: event update authorization allows admins and rejects attendees, other organizers, and anonymous users` | PASS |
| EMT-15 AC5 | `TC-UPD-05` | TC-Event-03 | Edit without a valid token | 401 | `api.test.js :: event update authorization allows admins and rejects attendees, other organizers, and anonymous users` | PASS |
| EMT-15 AC6 | `TC-UPD-06` | TC-Event-03 | Event start time has passed | 409 "Event has already started" | `api.test.js :: started and cancelled events cannot be updated` | PASS |
| EMT-15 AC7 | `TC-UPD-07` | TC-Event-03 | Event is cancelled | 409 (message names the cancelled state) | `api.test.js :: started and cancelled events cannot be updated` | PASS |
| EMT-15 AC8 | `TC-UPD-08` | TC-Event-03 | Title and venue changed | Two audit rows with user id, time, old and new value; unchanged fields write no rows; history readable only by owner or Admin; update rolls back if the audit insert fails | `api.test.js :: event owner can update an event and audit records only changed fields`<br>`api.test.js :: event audit history is restricted to the event owner or an admin`<br>`event-service.test.js :: rolls back the event update when audit insertion fails` | PASS |
| EMT-15 AC9 | `TC-UPD-09` | TC-Event-03 | Event id does not exist | 404 | `api.test.js :: event update authorization allows admins and rejects attendees, other organizers, and anonymous users` | PASS |

### 3.3 Cancel event (EMT-16, EMRS-F-007, EMRS-F-014, RTM TC-Event-04)

| Story AC | Test ID | RTM ID | Scenario | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| EMT-16 AC1 | `TC-ECN-01` | TC-Event-04 | Owner cancels an upcoming event | 200; status `cancelled`; audit row written | `api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once` | PASS |
| EMT-16 AC2 | `TC-ECN-02` | TC-Event-04 | 3 confirmed and 2 waitlisted attendees | Each of the 5 gets one email naming the event and date; people who already cancelled get none | `api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once`<br>`api.test.js :: Sprint 2 QA: cancelling an event emails confirmed and waitlisted attendees but not people who already cancelled` | PASS |
| EMT-16 AC3 | `TC-ECN-03` | TC-Event-04 | Check in a ticket of the cancelled event | 400 "cancelled"; registrations marked cancelled | `api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once`<br>`ticket-service.test.js :: rejects check-in for cancelled registration, cancelled event, or unknown code` | PASS |
| EMT-16 AC4 | `TC-ECN-04` | TC-Event-04 | Another organizer or an attendee tries to cancel | 403; nothing changes, no emails | `api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once`<br>`api.test.js :: event cancellation is owner-scoped, hides the event, and prevents registration` | PASS |
| EMT-16 AC5 | `TC-ECN-05` | TC-Event-04 | Cancel without a token | 401 | `api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once` | PASS |
| EMT-16 AC6 | `TC-ECN-06` | TC-Event-04 | Cancel an already cancelled event | 409; no emails sent again; no second audit row | `api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once` | PASS |
| EMT-16 AC7 | `TC-ECN-07` | TC-Event-04 | Cancel after the start time | 409 "Event has already started"; state unchanged | `api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once`<br>`event-service.test.js :: rejects cancellation after the event starts without changing state` | PASS |
| EMT-16 AC8 | `TC-ECN-08` | TC-Event-04 | Mail server is down | Event still cancelled, failure logged without the message body, response 200 | `api.test.js :: DELETE /api/events/:id stays successful and logs individual mail failures` | PASS |
| EMT-16 AC9 | `TC-ECN-09` | TC-Event-04 | Attendee registers for a cancelled event | 400 "Event has been cancelled" | `api.test.js :: event cancellation is owner-scoped, hides the event, and prevents registration` | PASS |

### 3.4 Email verification (EMT-28, EMRS-F-001)

| Story AC | Test ID | RTM ID | Scenario | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| EMT-28 AC1 | `TC-VER-01` | TC-Auth-06 | Register a new account | A verification email is sent (link `<app>/#verify-email=<token>`, token only as a hash in the database); `email_verified = 0`; login still works | `api.test.js :: registration sends a verification link to the web app while preserving immediate login` | PASS |
| EMT-28 AC2 | `TC-VER-02` | TC-Auth-06 | `POST /api/auth/verify-email` with a valid unused token | 200; `email_verified = 1`; a plain GET never verifies (link scanners cannot use the token); concurrent clicks verify once | `api.test.js :: registration sends a verification link to the web app while preserving immediate login`<br>`api.test.js :: verification is a POST: opening the link as a plain GET never changes the account`<br>`api.test.js :: Sprint 2 QA: concurrent clicks on one verification link verify once and reject the rest` | PASS |
| EMT-28 AC3 | `TC-VER-03` | TC-Auth-06 | Expired (24 h), used or unknown token | 400; nothing changes; works up to the last second before expiry | `api.test.js :: invalid, expired and used verification tokens return 400 and change nothing`<br>`api.test.js :: a link works just before it expires` | PASS |
| EMT-28 AC4 | `TC-VER-04` | TC-Auth-08 | Unverified user creates an event or registers for one | 403 "Please verify your email"; user can still sign in | `api.test.js :: unverified users can sign in but cannot create events or register for events (403)` | PASS |
| EMT-28 AC5 | `TC-VER-05` | TC-Auth-08 | Verified user creates an event or registers | Works as before | `api.test.js :: after verifying, creating and registering for events work as before` | PASS |
| EMT-28 AC6 | `TC-VER-06` | TC-Auth-07 | Resend verification (signed in, unverified) | Old link stops working, new email sent; 4th request within an hour returns 429 with Retry-After; limit is per user; verified user gets 409 | `api.test.js :: resend requires sign-in, replaces the old link and sends a new one`<br>`api.test.js :: resend is limited to 3 per hour per user and the limit is not shared between users`<br>`api.test.js :: resending for an already verified account returns 409 and sends nothing` | PASS |
| EMT-28 AC7 | `TC-VER-07` | TC-Auth-06 | Token exposure | The token is never in any API response, header or log; a failed email never fails the request | `api.test.js :: the verification token never appears in an API response or in the logs`<br>`api.test.js :: a failed verification email never fails registration or resend` | PASS |

### 3.5 Rate limiting and CAPTCHA (EMT-29, EMRS-SEC-004)

| Story AC | Test ID | RTM ID | Scenario | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| EMT-29 AC1 | `TC-SEC-01` | TC-Sec-01 | 11 login requests from one IP within a minute | 11th returns 429 with a `Retry-After` header; same 10/minute limit on register and resend-verification | `api.test.js :: EMT-29 AC1: the 11th login request from one IP within a minute returns 429 with Retry-After`<br>`api.test.js :: EMT-29: registration and resend-verification are limited to 10 requests per minute per IP` | PASS |
| EMT-29 AC2 | `TC-SEC-02` | TC-Sec-02 | Register without a CAPTCHA token | 400 "CAPTCHA required"; no account | `api.test.js :: EMT-29 AC2: registration without a CAPTCHA token` | PASS |
| EMT-29 AC3 | `TC-SEC-03` | TC-Sec-02 | Register with a failed CAPTCHA check, or provider outage | 400 and no account; provider outage returns 503 (fails closed) | `api.test.js :: EMT-29 AC3: a failed CAPTCHA check returns 400 and creates no account`<br>`api.test.js :: EMT-29: a CAPTCHA provider outage blocks registration with 503` | PASS |
| EMT-29 AC4 | `TC-SEC-04` | TC-Sec-03 | 3 failed logins for an email (or from an IP) | Next login needs a CAPTCHA token: missing 400, failed 400, valid proceeds; success clears the email count | `api.test.js :: EMT-29 AC4: after 3 failed logins for an email the next login needs a CAPTCHA token`<br>`api.test.js :: EMT-29: three failures from one IP across different emails also require a CAPTCHA` | PASS |
| EMT-29 AC5 | `TC-SEC-05` | TC-Sec-01 | Normal user within the limits | Login and registration behave as before | `api.test.js :: EMT-29 AC5: within the limits, login and registration behave exactly as before` | PASS |
| EMT-29 AC6 | `TC-SEC-06` | TC-Sec-04 | Limit, CAPTCHA pass/fail, Retry-After, trust proxy | Real client IP used behind a proxy; spoofed X-Forwarded-For ignored without it; Turnstile and reCAPTCHA requests built correctly; outages and timeouts fail closed | `api.test.js :: EMT-29: with TRUST_PROXY the limiter uses the real client IP`<br>`captcha.test.js :: a provider that never answers times out as unavailable`<br>`captcha.test.js :: test mode needs no keys and accepts any token except "test-fail"`<br>`failureTracker.test.js :: failures expire after the window and each new failure extends it`<br>`trustProxy.test.js :: "true" is refused because it would let clients forge their IP` | PASS |

### 3.6 Search and filter events (EMT-36, EMRS-F-008, RTM TC-Event-05)

| Story AC | Test ID | RTM ID | Scenario | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| EMT-36 AC1 | `TC-SRC-01` | TC-Event-05 | Events on 1, 10 and 20 Nov, filter 5 Nov to 15 Nov | Only the 10 Nov event; both dates inclusive (an event late on the "to" date is included) | `api.test.js :: GET /api/events filters by date range, both dates inclusive`<br>`api.test.js :: Sprint 2 QA: the "to" date of a search includes an event that starts late that evening`<br>`event-service.test.js :: filters by date range with inclusive boundaries` | PASS |
| EMT-36 AC2 | `TC-SRC-02` | TC-Event-05 | Venue "Auditorium Hall A", search location `hall a` | Matches, ignoring case; `%` and `_` treated literally | `api.test.js :: GET /api/events filters by location, ignoring case`<br>`event-service.test.js :: filters by location case-insensitively and treats wildcards literally` | PASS |
| EMT-36 AC3 | `TC-SRC-03` | TC-Event-05 | `from` after `to`, or an invalid date | 400 naming the field | `api.test.js :: GET /api/events rejects invalid filters with 400 naming the field` | PASS |
| EMT-36 AC4 | `TC-SRC-04` | TC-Event-05 | Several filters at once | Only events matching all of them | `api.test.js :: GET /api/events combines date, location, category and search with AND`<br>`event-service.test.js :: date, location, category and search filters combine with AND` | PASS |
| EMT-36 AC5 | `TC-SRC-05` | TC-Event-05 | Cancelled events | Never returned | `api.test.js :: GET /api/events never returns cancelled events when filtering`<br>`event-service.test.js :: cancelled events are never returned by any filter` | PASS |
| EMT-36 AC6 | `TC-SRC-06` | TC-Event-05 | Filters at mobile width and with the keyboard | Usable | - | DEFERRED (browser tests) |
| EMT-36 AC7 | `TC-SRC-07` | TC-Event-05 | Each filter alone and in combination | Covered by TC-SRC-01 to TC-SRC-05 | `api.test.js :: GET /api/events filters by date range, both dates inclusive`<br>`api.test.js :: GET /api/events filters by location, ignoring case` | PASS |

### 3.7 Email service and notifications (EMT-27, EMT-52, EMRS-F-014, EMRS-NF-005)

| Story AC | Test ID | RTM ID | Scenario | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| EMT-27 AC1 | `TC-EML-01` | TC-Notif-03 | Send mail with the test transport | Recipient, subject and body readable in a test | `mailer.test.js :: memory transport sends mail and keeps recipient, subject, and body readable` | PASS |
| EMT-27 AC2 | `TC-EML-02` | TC-Notif-03 | The transport throws | Caller carries on; failure logged without password, token or full body | `mailer.test.js :: smtp failures are isolated and do not log the password, token, or message body` | PASS |
| EMT-27 AC3 | `TC-EML-03` | TC-Notif-03 | `createApp` without a mailer | In-memory transport used | `mailer.test.js :: createApp uses the in-memory mailer when no mailer is provided` | PASS |
| EMT-27 AC4 | `TC-EML-04` | TC-Notif-03 | Interface, transport selection and failure path | Unit tests cover them | `mailer.test.js :: unsupported mail transport is rejected`<br>`mailer.test.js :: smtp transport passes configuration and messages to the injected Nodemailer transport` | PASS |
| EMT-52 AC1 | `TC-EML-05` | TC-Notif-02 | Attendee registers and is confirmed | One email with the event title, date and ticket code | `api.test.js :: confirmed registrations email event details and ticket code, but waitlisted registrations do not` | PASS |
| EMT-52 AC2 | `TC-EML-06` | TC-Notif-02 | Registration lands on the waitlist | Email says "waitlisted", not "confirmed" | `api.test.js :: BUG-S2-03` | DEFECT (BUG-S2-03) |
| EMT-52 AC3 | `TC-EML-07` | TC-Notif-04 | First waitlisted attendee promoted after a cancellation | Promoted person receives one email with the ticket code | `api.test.js :: BUG-S2-02` | DEFECT (BUG-S2-02) |
| EMT-52 AC4 | `TC-EML-08` | TC-Notif-03 | SMTP server down | The API request still succeeds; failure logged without secrets | `api.test.js :: verification and registration mail failures do not fail the API or log message secrets`<br>`mailer.test.js :: smtp failures are isolated and do not log the password, token, or message body` | PASS |
| EMT-52 AC5 | `TC-EML-09` | TC-Notif-02 | Unit tests for each template | Verification, registration confirmation and cancellation templates are tested; promotion, waitlist and password-reset templates do not exist yet | `api.test.js :: confirmed registrations email event details and ticket code, but waitlisted registrations do not`<br>`api.test.js :: DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once` | PARTIAL |

---

## 4. Requirements Traceability Matrix: additions for SRS section 8

The SRS RTM currently lists only EMRS-F-001, F-002, F-003, F-005, F-006 and F-007. Its text says the remaining requirements and test cases will be added as the Test Plan is finalized. These rows (same ID style as the existing ones) are ready to paste into the RTM.

| Requirement ID | Requirement | RTM test case IDs | Detailed test IDs (this plan) | Status |
| :--- | :--- | :--- | :--- | :--- |
| EMRS-F-001 (extend) | User Registration (email verification) | TC-Auth-01, TC-Auth-02 (existing), **TC-Auth-06, TC-Auth-07, TC-Auth-08** | TC-VER-01 to TC-VER-07 | Passed |
| EMRS-F-006 | Update Event | TC-Event-03 | TC-UPD-01 to TC-UPD-09 | Passed |
| EMRS-F-007 | Cancel Event | TC-Event-04 | TC-ECN-01 to TC-ECN-09 | Passed |
| EMRS-F-008 | Browse / Search Events | **TC-Event-05** | TC-SRC-01 to TC-SRC-05, TC-SRC-07 (TC-SRC-06 deferred) | Passed (UI deferred) |
| EMRS-F-010 | Register for Event | **TC-Reg-01, TC-Reg-02** | TC-REG-POS-01/02, TC-REG-NEG-01 to 04, TC-REG-INV-01 | Passed |
| EMRS-F-011 | Cancel Registration | **TC-Reg-03** | TC-CAN-POS-01, TC-CAN-SEC-01, TC-CAN-NEG-01 to 03 | Passed |
| EMRS-F-012 | Waitlist Management | **TC-Reg-04** | TC-WTL-POS-01/02; BUG-S2-01, BUG-S2-02 open | **Partial (2 defects)** |
| EMRS-F-013 | Payment Processing | **TC-Pay-01** | None: EMT-38 not implemented | **Deferred** |
| EMRS-F-014 | Notifications | **TC-Notif-01** (cancellation), **TC-Notif-02** (registration), **TC-Notif-03** (email service), **TC-Notif-04** (promotion) | TC-ECN-02, TC-ECN-08, TC-EML-01 to TC-EML-09 | Passed except TC-Notif-04 (BUG-S2-02) |
| EMRS-F-016 | Event Check-in | **TC-Chk-01, TC-Chk-02** | TC-CHK-POS-01, TC-CHK-NEG-01 to 03, TC-CHK-SEC-01/02, TC-VAL-POS-01, TC-VAL-SEC-01 | Passed |
| EMRS-SEC-003 | Audit log of event changes | **TC-Sec-05** | TC-UPD-08, TC-ECN-01 | Passed |
| EMRS-SEC-004 | Rate limiting and CAPTCHA | **TC-Sec-01** (limits), **TC-Sec-02** (registration CAPTCHA), **TC-Sec-03** (login CAPTCHA), **TC-Sec-04** (trust proxy, provider failures) | TC-SEC-01 to TC-SEC-06 | Passed |

---

## 5. Regression: Sprint 1 tests

All Sprint 1 tests (EMT-11, EMT-12, EMT-14) run as part of the full suite on every change: 151 backend tests, 148 passing, 0 failing, 3 expected failures (the defects in section 7).

Sprint 1 behaviour was deliberately refined by Sprint 2 stories, so these Sprint 1 plan rows were corrected to match the current, tested behaviour (the tests themselves already assert the new behaviour):

| Sprint 1 test ID | What changed | Source |
| :--- | :--- | :--- |
| `TC-REG-NEG-01` | Duplicate email message is now "Email already registered" | EMT-11 |
| `TC-REG-NEG-03` | Password rule is 8-72 characters with an uppercase letter, a lowercase letter and a digit | EMT-11 |
| `TC-REG-POS-01`, `TC-REG-NEG-*` | Registration also needs a `captchaToken` | EMT-29 |
| `TC-AUTH-POS-01` | Login returns a signed JWT (1 hour) plus `expiresAt` and the user | EMT-12 |
| `TC-AUTH-NEG-05` | After 3 failed logins a CAPTCHA token is needed; the 5th failure locks the account (429 with Retry-After) | EMT-29 |
| New row `TC-EVT-NEG-06` | An organizer with an unverified email gets 403 "Please verify your email" | EMT-28 |
| Section 4.1 | Pull requests target `main` (there is no `test` branch) | EMT-30 |

---

## 6. Deferred and out of scope

| Item | Reason |
| :--- | :--- |
| Simulated payment (EMT-38, EMRS-F-013, EMRS-SEC-005) | Not implemented: ticket is To Do and labelled deferred. Tests for the pay endpoint, transaction statuses, hold expiry and duplicate payment must be written with the feature. |
| Password reset (EMT-13) | Deferred to the iteration phase |
| Browser / Playwright tests for the React flows (EMT-31, EMT-32, EMT-36 filters) | Deferred to the iteration phase. The pure logic is unit tested in `frontend/test/` and the screens were smoke-tested in a simulated DOM |
| Password reset, promotion and waitlist email templates | Not implemented (see BUG-S2-02, BUG-S2-03) |

---

## 7. Defects found

Found by exploratory testing and by checking the implementation against the Jira acceptance criteria and the SRS. Each is captured as an automated `todo` test in `backend/test/api.test.js`: it describes the expected behaviour and is reported on every run without failing the build. Remove `todo` when the defect is fixed. Raise each as a Bug issue linked to the story in the table.

| ID | Severity | Linked story / SRS | Summary | Steps to reproduce | Expected | Actual | Automated test |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| BUG-S2-01 | Medium | EMT-15, EMRS-F-012 | Raising an event's capacity does not promote waitlisted attendees | 1. Capacity 1 event. 2. Two attendees register (one confirmed, one waitlisted). 3. Organizer updates capacity to 5. | The waitlisted attendee is promoted (and notified): seats are now free | The attendee stays waitlisted until someone else cancels | `api.test.js :: BUG-S2-01` |
| BUG-S2-02 | Medium | EMT-52 AC3, EMRS-F-012 | A promoted waitlisted attendee is never emailed | 1. Full event with a waitlist. 2. A confirmed attendee cancels. | Promoted attendee gets an email with the ticket code ("notify the next eligible Attendee") | Promotion happens silently; no email is sent. EMT-52's title says the promotion email is deferred, but EMRS-F-012 requires it | `api.test.js :: BUG-S2-02` |
| BUG-S2-03 | Low | EMT-52 AC2 | No email when a registration is placed on the waitlist | Register for a full event | An email that says "waitlisted" | No email is sent (the current test asserts this) | `api.test.js :: BUG-S2-03` |

---

## 8. Test execution summary

- **Backend:** 151 tests: 148 pass, 0 fail, 3 todo (known defects).
- **Frontend:** 16 tests pass; production build succeeds.
- **Backend coverage:** lines 97.34%, branches 91.85%, functions 98.61%.
- **ESLint:** zero errors and zero warnings.
- **Network guard:** active; no test made a real network connection.

### Entry and exit criteria

- [x] All Sprint 2 acceptance criteria in scope have at least one automated test (enforced by `traceability.test.js`)
- [x] Mail and CAPTCHA are tested with the in-memory transport and test mode only
- [x] Sprint 1 tests re-run and passing
- [x] Failures found are documented as defects with linked stories (section 7)
- [ ] Defects BUG-S2-01 to BUG-S2-03 raised as Jira Bugs and linked to the stories
- [ ] CI run on the pull request is green
- [ ] QA sign-off for EMT-33 (Avinash Julakatti) and development lead approval (Dhanraj Rathod)
