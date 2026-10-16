#pragma once
#include <optional>
#include <string>
#include <vector>

#include "db/Database.h"

namespace emrs {

struct Event {
    long long id = 0;
    long long organizerId = 0;
    std::string title;
    std::string description;
    std::string category;
    std::string eventDate;
    std::string venue;
    int capacity = 50;
    double price = 0.0;
    std::string status; // active, cancelled
    long long createdAt = 0;
    int registeredCount = 0;
};

class EventService {
public:
    explicit EventService(Database& db) : db_(db) {}

    long long createEvent(long long organizerId, const std::string& title, const std::string& description,
                          const std::string& category, const std::string& date, const std::string& venue,
                          int capacity, double price);

    std::optional<Event> getEvent(long long id);
    std::vector<Event> listEvents(const std::string& category = "", const std::string& search = "");
    std::vector<Event> listOrganizerEvents(long long organizerId);
    bool cancelEvent(long long eventId, long long organizerId);

private:
    Database& db_;
};

}  // namespace emrs
