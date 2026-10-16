#include <gtest/gtest.h>

#include "db/Database.h"
#include "db/Schema.h"
#include "services/EventService.h"
#include "services/RegistrationService.h"
#include "services/TicketService.h"
#include "services/UserService.h"

TEST(TicketService, ValidatesTicketAndPerformsCheckIn) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);
    emrs::UserService users(db);
    emrs::EventService events(db);
    emrs::RegistrationService registrations(db);
    emrs::TicketService tickets(db);

    long long orgId = users.createUser("Organizer", "org@test.com", "9876543210", "Organizer", "hash");
    long long userId = users.createUser("Attendee", "att@test.com", "9876543210", "Attendee", "hash");
    long long evId = events.createEvent(orgId, "Gala Night", "Fun night", "Social", "2026-12-31", "Hall A", 50, 0.0);

    auto reg = registrations.registerAttendee(evId, userId);
    ASSERT_EQ(reg.result, emrs::RegistrationService::RegisterResult::Confirmed);

    auto ticketInfo = tickets.getTicketByCode(reg.ticketCode);
    ASSERT_TRUE(ticketInfo.has_value());
    EXPECT_FALSE(ticketInfo->checkedIn);
    EXPECT_EQ(ticketInfo->eventTitle, "Gala Night");

    // Perform check-in
    EXPECT_TRUE(tickets.checkIn(reg.ticketCode));

    // Second check-in must fail (already checked in)
    EXPECT_FALSE(tickets.checkIn(reg.ticketCode));

    auto updatedTicket = tickets.getTicketByCode(reg.ticketCode);
    ASSERT_TRUE(updatedTicket.has_value());
    EXPECT_TRUE(updatedTicket->checkedIn);
    EXPECT_GT(updatedTicket->checkedInAt, 0);
}
