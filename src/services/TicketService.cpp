#include "services/TicketService.h"

#include <chrono>

namespace emrs {

namespace {
long long nowSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}
}  // namespace

std::optional<TicketInfo> TicketService::getTicketByCode(const std::string& code) {
    auto rows = db_.query(
        "SELECT t.id, t.registration_id, t.ticket_code, t.qr_data, t.checked_in, t.checked_in_at, e.title, u.name "
        "FROM tickets t "
        "JOIN registrations r ON t.registration_id = r.id "
        "JOIN events e ON r.event_id = e.id "
        "JOIN users u ON r.user_id = u.id "
        "WHERE t.ticket_code = ?;",
        {code});

    if (rows.empty()) return std::nullopt;

    TicketInfo info;
    info.ticketId = std::stoll(rows[0][0]);
    info.registrationId = std::stoll(rows[0][1]);
    info.ticketCode = rows[0][2];
    info.qrData = rows[0][3];
    info.checkedIn = (rows[0][4] == "1");
    info.checkedInAt = rows[0][5].empty() ? 0 : std::stoll(rows[0][5]);
    info.eventTitle = rows[0][6];
    info.attendeeName = rows[0][7];
    return info;
}

bool TicketService::checkIn(const std::string& code) {
    auto ticket = getTicketByCode(code);
    if (!ticket || ticket->checkedIn) return false;

    long long now = nowSeconds();
    db_.execute("UPDATE tickets SET checked_in = 1, checked_in_at = ? WHERE ticket_code = ?;",
                {std::to_string(now), code});
    return true;
}

}  // namespace emrs
