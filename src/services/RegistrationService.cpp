#include "services/RegistrationService.h"

#include <chrono>
#include "auth/PasswordHasher.h"

namespace emrs {

namespace {
long long nowSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}
}  // namespace

RegistrationService::RegisterResponse RegistrationService::registerAttendee(long long eventId, long long userId) {
    RegisterResponse resp;

    // Check event exists and is active
    auto evRows = db_.query("SELECT capacity, status FROM events WHERE id = ?;", {std::to_string(eventId)});
    if (evRows.empty()) {
        resp.result = RegisterResult::EventNotFound;
        return resp;
    }
    if (evRows[0][1] == "cancelled") {
        resp.result = RegisterResult::EventCancelled;
        return resp;
    }
    int capacity = std::stoi(evRows[0][0]);

    // Check existing registration
    auto existing = db_.query(
        "SELECT id, status FROM registrations WHERE event_id = ? AND user_id = ?;",
        {std::to_string(eventId), std::to_string(userId)});
    if (!existing.empty() && existing[0][1] != "cancelled") {
        resp.result = RegisterResult::AlreadyRegistered;
        return resp;
    }

    // Count confirmed attendees
    auto countRows = db_.query(
        "SELECT COUNT(*) FROM registrations WHERE event_id = ? AND status = 'confirmed';",
        {std::to_string(eventId)});
    int confirmedCount = countRows.empty() ? 0 : std::stoi(countRows[0][0]);

    long long now = nowSeconds();
    std::string status = (confirmedCount < capacity) ? "confirmed" : "waitlist";

    if (!existing.empty()) {
        long long regId = std::stoll(existing[0][0]);
        db_.execute("UPDATE registrations SET status = ?, created_at = ? WHERE id = ?;",
                    {status, std::to_string(now), std::to_string(regId)});
        resp.registrationId = regId;
    } else {
        db_.execute("INSERT INTO registrations (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?);",
                    {std::to_string(eventId), std::to_string(userId), status, std::to_string(now)});
        resp.registrationId = db_.lastInsertId();
    }

    if (status == "confirmed") {
        std::string code = "EMRS-" + randomHex(4);
        std::string qrData = "TICKET:" + code + ":EVENT:" + std::to_string(eventId) + ":USER:" + std::to_string(userId);
        db_.execute("INSERT OR REPLACE INTO tickets (registration_id, ticket_code, qr_data, checked_in) VALUES (?, ?, ?, 0);",
                    {std::to_string(resp.registrationId), code, qrData});
        resp.result = RegisterResult::Confirmed;
        resp.ticketCode = code;
    } else {
        resp.result = RegisterResult::Waitlisted;
    }

    return resp;
}

bool RegistrationService::cancelRegistration(long long registrationId, long long userId) {
    auto rows = db_.query("SELECT event_id, status FROM registrations WHERE id = ? AND user_id = ?;",
                          {std::to_string(registrationId), std::to_string(userId)});
    if (rows.empty()) return false;

    long long eventId = std::stoll(rows[0][0]);
    std::string prevStatus = rows[0][1];

    db_.execute("UPDATE registrations SET status = 'cancelled' WHERE id = ?;", {std::to_string(registrationId)});
    db_.execute("DELETE FROM tickets WHERE registration_id = ?;", {std::to_string(registrationId)});

    // If a confirmed registration was cancelled, auto-promote the earliest waitlisted attendee
    if (prevStatus == "confirmed") {
        auto waitlisted = db_.query(
            "SELECT id, user_id FROM registrations WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at ASC LIMIT 1;",
            {std::to_string(eventId)});
        if (!waitlisted.empty()) {
            long long promotedId = std::stoll(waitlisted[0][0]);
            long long promotedUserId = std::stoll(waitlisted[0][1]);
            db_.execute("UPDATE registrations SET status = 'confirmed' WHERE id = ?;", {std::to_string(promotedId)});
            std::string code = "EMRS-" + randomHex(4);
            std::string qrData = "TICKET:" + code + ":EVENT:" + std::to_string(eventId) + ":USER:" + std::to_string(promotedUserId);
            db_.execute("INSERT INTO tickets (registration_id, ticket_code, qr_data, checked_in) VALUES (?, ?, ?, 0);",
                        {std::to_string(promotedId), code, qrData});
        }
    }
    return true;
}

std::vector<Registration> RegistrationService::listUserRegistrations(long long userId) {
    auto rows = db_.query(
        "SELECT r.id, r.event_id, r.user_id, r.status, r.created_at, e.title, COALESCE(t.ticket_code, '') "
        "FROM registrations r "
        "JOIN events e ON r.event_id = e.id "
        "LEFT JOIN tickets t ON r.id = t.registration_id "
        "WHERE r.user_id = ? AND r.status != 'cancelled' "
        "ORDER BY r.created_at DESC;",
        {std::to_string(userId)});

    std::vector<Registration> res;
    for (const auto& row : rows) {
        Registration reg;
        reg.id = std::stoll(row[0]);
        reg.eventId = std::stoll(row[1]);
        reg.userId = std::stoll(row[2]);
        reg.status = row[3];
        reg.createdAt = std::stoll(row[4]);
        reg.eventTitle = row[5];
        reg.ticketCode = row[6];
        res.push_back(reg);
    }
    return res;
}

std::vector<Registration> RegistrationService::listEventRegistrations(long long eventId) {
    auto rows = db_.query(
        "SELECT r.id, r.event_id, r.user_id, r.status, r.created_at, e.title, COALESCE(t.ticket_code, '') "
        "FROM registrations r "
        "JOIN events e ON r.event_id = e.id "
        "LEFT JOIN tickets t ON r.id = t.registration_id "
        "WHERE r.event_id = ? "
        "ORDER BY r.created_at ASC;",
        {std::to_string(eventId)});

    std::vector<Registration> res;
    for (const auto& row : rows) {
        Registration reg;
        reg.id = std::stoll(row[0]);
        reg.eventId = std::stoll(row[1]);
        reg.userId = std::stoll(row[2]);
        reg.status = row[3];
        reg.createdAt = std::stoll(row[4]);
        reg.eventTitle = row[5];
        reg.ticketCode = row[6];
        res.push_back(reg);
    }
    return res;
}

}  // namespace emrs
