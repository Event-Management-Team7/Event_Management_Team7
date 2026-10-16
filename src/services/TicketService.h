#pragma once
#include <optional>
#include <string>

#include "db/Database.h"

namespace emrs {

struct TicketInfo {
    long long ticketId = 0;
    long long registrationId = 0;
    std::string ticketCode;
    std::string qrData;
    bool checkedIn = false;
    long long checkedInAt = 0;
    std::string eventTitle;
    std::string attendeeName;
};

class TicketService {
public:
    explicit TicketService(Database& db) : db_(db) {}

    std::optional<TicketInfo> getTicketByCode(const std::string& code);
    bool checkIn(const std::string& code);

private:
    Database& db_;
};

}  // namespace emrs
