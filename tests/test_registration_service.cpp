#include <gtest/gtest.h>

#include "db/Database.h"
#include "db/Schema.h"
#include "services/EventService.h"
#include "services/RegistrationService.h"
#include "services/UserService.h"

TEST(RegistrationService, ConfirmsAndManagesWaitlist) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);
    emrs::UserService users(db);
    emrs::EventService events(db);
    emrs::RegistrationService registrations(db);

    long long orgId = users.createUser("Organizer", "org@test.com", "9876543210", "Organizer", "hash");
    long long u1 = users.createUser("User 1", "u1@test.com", "9876543210", "Attendee", "hash");
    long long u2 = users.createUser("User 2", "u2@test.com", "9876543210", "Attendee", "hash");

    // Event with capacity of 1
    long long evId = events.createEvent(orgId, "Limited Workshop", "Only 1 seat", "Workshop",
                                        "2026-12-01", "Lab 1", 1, 0.0);

    // User 1 registers -> Confirmed
    auto r1 = registrations.registerAttendee(evId, u1);
    EXPECT_EQ(r1.result, emrs::RegistrationService::RegisterResult::Confirmed);
    EXPECT_FALSE(r1.ticketCode.empty());

    // User 2 registers -> Waitlisted
    auto r2 = registrations.registerAttendee(evId, u2);
    EXPECT_EQ(r2.result, emrs::RegistrationService::RegisterResult::Waitlisted);

    // Duplicate registration rejected
    auto rDuplicate = registrations.registerAttendee(evId, u1);
    EXPECT_EQ(rDuplicate.result, emrs::RegistrationService::RegisterResult::AlreadyRegistered);

    // User 1 cancels -> User 2 promoted from waitlist to confirmed!
    EXPECT_TRUE(registrations.cancelRegistration(r1.registrationId, u1));

    auto user2Registrations = registrations.listUserRegistrations(u2);
    ASSERT_EQ(user2Registrations.size(), 1u);
    EXPECT_EQ(user2Registrations[0].status, "confirmed");
}
