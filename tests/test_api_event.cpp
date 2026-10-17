#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "TestServer.h"

using nlohmann::json;

namespace {

std::string registerAndLogin(TestServer& s, const std::string& name, const std::string& email,
                             const std::string& role) {
    json reg = {
        {"name", name},
        {"email", email},
        {"phone", "9876543210"},
        {"password", "Password123"},
        {"role", role}
    };
    auto regRes = s.client().Post("/api/auth/register", reg.dump(), "application/json");
    if (!regRes || regRes->status != 201) return "";

    json login = {{"email", email}, {"password", "Password123"}};
    auto loginRes = s.client().Post("/api/auth/login", login.dump(), "application/json");
    if (!loginRes || loginRes->status != 200) return "";

    return json::parse(loginRes->body)["token"];
}

json validEventBody() {
    return {
        {"title", "National Hackathon 2026"},
        {"description", "48-hour collaborative engineering hackathon"},
        {"category", "Technical"},
        {"date", "2099-11-20T10:00"},
        {"venue", "Tech Park Hall 4"},
        {"capacity", 150},
        {"price", 25.0}
    };
}

}  // namespace

TEST(EventApi, OrganizerCreatesEventSuccessfully) {
    TestServer s;
    std::string token = registerAndLogin(s, "Organizer User", "organizer@test.com", "Organizer");
    ASSERT_FALSE(token.empty());

    httplib::Headers headers = {{"Authorization", "Bearer " + token}};
    auto res = s.client().Post("/api/events", headers, validEventBody().dump(), "application/json");
    ASSERT_TRUE(res);
    EXPECT_EQ(res->status, 201);

    auto j = json::parse(res->body);
    EXPECT_TRUE(j.contains("eventId"));
    long long eventId = j["eventId"];
    EXPECT_GT(eventId, 0);

    // Verify event is listed in GET /api/events
    auto listRes = s.client().Get("/api/events");
    ASSERT_TRUE(listRes);
    EXPECT_EQ(listRes->status, 200);
    auto listJson = json::parse(listRes->body);
    ASSERT_GE(listJson["events"].size(), 1u);
    EXPECT_EQ(listJson["events"][0]["title"], "National Hackathon 2026");
    EXPECT_EQ(listJson["events"][0]["capacity"], 150);
}

TEST(EventApi, RejectsMissingRequiredFieldsAndNegativeValues) {
    TestServer s;
    std::string token = registerAndLogin(s, "Organizer User", "org2@test.com", "Organizer");
    ASSERT_FALSE(token.empty());

    httplib::Headers headers = {{"Authorization", "Bearer " + token}};

    // Missing title, missing date, capacity <= 0, negative price
    json badBody = {
        {"title", ""},
        {"description", ""},
        {"category", ""},
        {"date", ""},
        {"venue", ""},
        {"capacity", 0},
        {"price", -10.0}
    };

    auto res = s.client().Post("/api/events", headers, badBody.dump(), "application/json");
    ASSERT_TRUE(res);
    EXPECT_EQ(res->status, 400);

    auto j = json::parse(res->body);
    EXPECT_TRUE(j["fields"].contains("title"));
    EXPECT_TRUE(j["fields"].contains("description"));
    EXPECT_TRUE(j["fields"].contains("category"));
    EXPECT_TRUE(j["fields"].contains("date"));
    EXPECT_TRUE(j["fields"].contains("venue"));
    EXPECT_TRUE(j["fields"].contains("capacity"));
    EXPECT_TRUE(j["fields"].contains("price"));
}

TEST(EventApi, RejectsPastDates) {
    TestServer s;
    std::string token = registerAndLogin(s, "Organizer User", "org3@test.com", "Organizer");
    ASSERT_FALSE(token.empty());

    httplib::Headers headers = {{"Authorization", "Bearer " + token}};
    json pastBody = validEventBody();
    pastBody["date"] = "2020-01-01T10:00";

    auto res = s.client().Post("/api/events", headers, pastBody.dump(), "application/json");
    ASSERT_TRUE(res);
    EXPECT_EQ(res->status, 400);

    auto j = json::parse(res->body);
    EXPECT_TRUE(j["fields"].contains("date"));
    EXPECT_EQ(j["fields"]["date"], "Event date cannot be in the past.");
}

TEST(EventApi, RejectsAttendeeRoleWith403) {
    TestServer s;
    std::string token = registerAndLogin(s, "Attendee User", "attendee@test.com", "Attendee");
    ASSERT_FALSE(token.empty());

    httplib::Headers headers = {{"Authorization", "Bearer " + token}};
    auto res = s.client().Post("/api/events", headers, validEventBody().dump(), "application/json");
    ASSERT_TRUE(res);
    EXPECT_EQ(res->status, 403);

    auto j = json::parse(res->body);
    EXPECT_EQ(j["error"], "Only organizers can create events.");
}

TEST(EventApi, RejectsUnauthenticatedRequestsWith401) {
    TestServer s;

    // No Authorization header provided
    auto noAuthRes = s.client().Post("/api/events", validEventBody().dump(), "application/json");
    ASSERT_TRUE(noAuthRes);
    EXPECT_EQ(noAuthRes->status, 401);

    // Invalid bearer token provided
    httplib::Headers invalidHeaders = {{"Authorization", "Bearer bad-token-999"}};
    auto invalidRes = s.client().Post("/api/events", invalidHeaders, validEventBody().dump(), "application/json");
    ASSERT_TRUE(invalidRes);
    EXPECT_EQ(invalidRes->status, 401);
}
