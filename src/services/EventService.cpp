#include "services/EventService.h"

#include <chrono>

namespace emrs {

namespace {
long long nowSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

Event rowToEvent(const Database::Row& r, Database& db) {
    Event e;
    e.id = std::stoll(r[0]);
    e.organizerId = std::stoll(r[1]);
    e.title = r[2];
    e.description = r[3];
    e.category = r[4];
    e.eventDate = r[5];
    e.venue = r[6];
    e.capacity = std::stoi(r[7]);
    e.price = std::stod(r[8]);
    e.status = r[9];
    e.createdAt = std::stoll(r[10]);

    // count active confirmed registrations
    auto countRow = db.query(
        "SELECT COUNT(*) FROM registrations WHERE event_id = ? AND status = 'confirmed';",
        {std::to_string(e.id)});
    if (!countRow.empty()) {
        e.registeredCount = std::stoi(countRow[0][0]);
    }
    return e;
}
}  // namespace

long long EventService::createEvent(long long organizerId, const std::string& title,
                                    const std::string& description, const std::string& category,
                                    const std::string& date, const std::string& venue,
                                    int capacity, double price) {
    long long now = nowSeconds();
    db_.execute(
        "INSERT INTO events (organizer_id, title, description, category, event_date, venue, capacity, price, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?);",
        {std::to_string(organizerId), title, description, category, date, venue,
         std::to_string(capacity), std::to_string(price), std::to_string(now)});
    return db_.lastInsertId();
}

std::optional<Event> EventService::getEvent(long long id) {
    auto rows = db_.query(
        "SELECT id, organizer_id, title, description, category, event_date, venue, capacity, price, status, created_at "
        "FROM events WHERE id = ?;",
        {std::to_string(id)});
    if (rows.empty()) return std::nullopt;
    return rowToEvent(rows[0], db_);
}

std::vector<Event> EventService::listEvents(const std::string& category, const std::string& search) {
    std::string sql =
        "SELECT id, organizer_id, title, description, category, event_date, venue, capacity, price, status, created_at "
        "FROM events WHERE status = 'active'";
    std::vector<Database::Param> params;

    if (!category.empty()) {
        sql += " AND category = ?";
        params.push_back(category);
    }
    if (!search.empty()) {
        sql += " AND (title LIKE ? OR description LIKE ? OR venue LIKE ?)";
        std::string pattern = "%" + search + "%";
        params.push_back(pattern);
        params.push_back(pattern);
        params.push_back(pattern);
    }
    sql += " ORDER BY event_date ASC;";

    auto rows = db_.query(sql, params);
    std::vector<Event> list;
    list.reserve(rows.size());
    for (const auto& r : rows) {
        list.push_back(rowToEvent(r, db_));
    }
    return list;
}

std::vector<Event> EventService::listOrganizerEvents(long long organizerId) {
    auto rows = db_.query(
        "SELECT id, organizer_id, title, description, category, event_date, venue, capacity, price, status, created_at "
        "FROM events WHERE organizer_id = ? ORDER BY created_at DESC;",
        {std::to_string(organizerId)});
    std::vector<Event> list;
    list.reserve(rows.size());
    for (const auto& r : rows) {
        list.push_back(rowToEvent(r, db_));
    }
    return list;
}

bool EventService::cancelEvent(long long eventId, long long organizerId) {
    auto ev = getEvent(eventId);
    if (!ev || ev->organizerId != organizerId) return false;
    db_.execute("UPDATE events SET status = 'cancelled' WHERE id = ?;", {std::to_string(eventId)});
    return true;
}

}  // namespace emrs
