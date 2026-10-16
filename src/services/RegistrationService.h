#pragma once
#include <optional>
#include <string>
#include <vector>

#include "db/Database.h"

namespace emrs {

struct Registration {
    long long id = 0;
    long long eventId = 0;
    long long userId = 0;
    std::string status; // confirmed, waitlist, cancelled
    long long createdAt = 0;
    std::string eventTitle;
    std::string ticketCode;
};

class RegistrationService {
public:
    explicit RegistrationService(Database& db) : db_(db) {}

    enum class RegisterResult { Confirmed, Waitlisted, AlreadyRegistered, EventNotFound, EventCancelled };

    struct RegisterResponse {
        RegisterResult result;
        long long registrationId = 0;
        std::string ticketCode;
    };

    RegisterResponse registerAttendee(long long eventId, long long userId);
    bool cancelRegistration(long long registrationId, long long userId);
    std::vector<Registration> listUserRegistrations(long long userId);
    std::vector<Registration> listEventRegistrations(long long eventId);

private:
    Database& db_;
};

}  // namespace emrs
