# Sprint 2 Test Plan: Registration, Cancellation, Waitlist & Check-in Sign-Off (EMT-51)

**Project:** Event Management and Registration System (EMRS)  
**Sprint:** EMT Sprint 2  
**Author / QA Tester:** Avinash Julakatti (PES1UG24AM347)  
**Date:** 25/Oct/2026 - 01/Nov/2026  
**Jira Story:** EMT-51  
**SRS Traceability:** EMRS-F-010 (High), EMRS-F-011 (Medium), EMRS-F-012 (Medium), EMRS-F-016 (High)  

---

## 1. Objective & Scope

The objective of this test plan and sign-off verification is to ensure complete test coverage and verification of all acceptance criteria for event registration, registration cancellation, automatic waitlist promotion, and ticket check-in and validation, as required by the Software Requirements Specification (SRS).

These core features form the backbone of the attendee event lifecycle and organizer event admission:
- **EMRS-F-010:** Event Registration & Capacity Management
- **EMRS-F-011:** Registration Cancellation
- **EMRS-F-012:** Waitlist Queue Management & Auto-Promotion
- **EMRS-F-016:** QR Ticket Check-in & Admission Authorization

---

## 2. Test Harness & Automation Infrastructure

### 2.1 Node.js Native Test Runner (`backend/test/`)
Testing is executed using Node.js's native test runner (`node:test`) and strict assertions (`node:assert/strict`) against ephemeral in-memory SQLite databases:
- Fast and fully deterministic execution without external service dependencies.
- Atomic transaction testing ensuring concurrent registration safety and waitlist promotion atomicity.
- 78 passing unit and integration tests executed in ~2.5 seconds with **96.45% line coverage** and **88.94% branch coverage**.

```bash
npm test
# or
npm --prefix backend test
```

### 2.2 Quality & Linting Gates
- ESLint checks across backend and frontend code (`npm run lint`).
- Frontend production bundle build verification (`npm run build:frontend`).

---

## 3. Requirements Traceability Matrix & Test Case Mapping

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

---

## 4. Test Execution Summary

- **Total Test Cases Executed:** 22 Acceptance Criteria Tests + 56 Existing Regression Tests = **78 Total Tests**
- **Passed:** 78 (100%)
- **Failed:** 0 (0%)
- **Code Coverage:**
  - Lines: **96.45%** (Threshold: >80%)
  - Branches: **88.94%** (Threshold: >75%)
  - Functions: **98.59%** (Threshold: >90%)
- **Defects Discovered & Resolved:**
  1. *Missing event start time check:* Added start time validation in `RegistrationService.register` and `RegistrationService.cancel` to reject operations on started events with HTTP 400.
  2. *Cross-event organizer check-in leak:* Restricted check-in and ticket validation in `createTicketsRouter` to the specific event's organizer (or Admin) with HTTP 403.
  3. *Cancelled ticket detection:* Preserved cancelled ticket references to distinguish between unknown codes (HTTP 404) and cancelled tickets (HTTP 400 rejected) at check-in.

---

## 5. Entry & Exit Criteria Sign-Off

### 5.1 Verification Checklist
- [x] All 22 acceptance criteria mapped to SRS requirements (EMRS-F-010, F-011, F-012, F-016) are implemented and verified.
- [x] Concurrency invariant verified: capacity cannot be exceeded under simultaneous registrations.
- [x] Automated test suite executed cleanly (`npm test`).
- [x] ESLint analysis passed with zero errors (`npm run lint`).
- [x] Frontend builds cleanly with zero errors (`npm run build:frontend`).

### 5.2 Sign-Off
**Signed off by:** Avinash Julakatti (PES1UG24AM347)  
**Role:** QA / Test Engineer  
**Status:** **APPROVED & READY FOR MERGE**
