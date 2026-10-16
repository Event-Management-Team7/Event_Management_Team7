#include <gtest/gtest.h>

#include "db/Database.h"
#include "db/Schema.h"
#include "services/EventService.h"
#include "services/UserService.h"

TEST(EventService, CreatesAndListsEvents) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);
    emrs::UserService users(db);
    emrs::EventService events(db);

    long long orgId = users.createUser("Dhanraj", "dhanraj@test.com", "9876543210", "Organizer", "hash");

    long long evId = events.createEvent(orgId, "Tech Symposium 2026", "Annual technical fest", "Conference",
                                        "2026-11-20", "Main Auditorium", 100, 0.0);
    EXPECT_GT(evId, 0);

    auto list = events.listEvents("Conference", "Tech");
    ASSERT_EQ(list.size(), 1u);
    EXPECT_EQ(list[0].title, "Tech Symposium 2026");
    EXPECT_EQ(list[0].capacity, 100);

    auto ev = events.getEvent(evId);
    ASSERT_TRUE(ev.has_value());
    EXPECT_EQ(ev->venue, "Main Auditorium");

    EXPECT_TRUE(events.cancelEvent(evId, orgId));
    auto cancelledList = events.listEvents();
    EXPECT_TRUE(cancelledList.empty());
}
