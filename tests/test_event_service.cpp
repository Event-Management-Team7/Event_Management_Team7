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

TEST(EventService, CreatedEventStoredWithCorrectOrganizer) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);
    emrs::UserService users(db);
    emrs::EventService events(db);

    long long org1 = users.createUser("Organizer 1", "org1@test.com", "9876543210", "Organizer", "hash");
    long long org2 = users.createUser("Organizer 2", "org2@test.com", "9876543211", "Organizer", "hash");

    long long evId = events.createEvent(org1, "AI Workshop", "Deep learning hands-on", "Workshop",
                                        "2099-10-15", "Lab 3", 50, 10.0);
    EXPECT_GT(evId, 0);

    auto ev = events.getEvent(evId);
    ASSERT_TRUE(ev.has_value());
    EXPECT_EQ(ev->organizerId, org1);
    EXPECT_EQ(ev->title, "AI Workshop");
    EXPECT_EQ(ev->capacity, 50);

    // Verify organizer specific event list
    auto org1Events = events.listOrganizerEvents(org1);
    ASSERT_EQ(org1Events.size(), 1u);
    EXPECT_EQ(org1Events[0].id, evId);

    auto org2Events = events.listOrganizerEvents(org2);
    EXPECT_TRUE(org2Events.empty());

    // Unauthorized organizer cannot cancel event
    EXPECT_FALSE(events.cancelEvent(evId, org2));
    EXPECT_TRUE(events.getEvent(evId).has_value());
    EXPECT_EQ(events.getEvent(evId)->status, "active");

    // Nonexistent event returns nullopt
    EXPECT_FALSE(events.getEvent(99999).has_value());
}
