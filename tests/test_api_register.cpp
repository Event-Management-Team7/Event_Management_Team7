#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "TestServer.h"

using nlohmann::json;

namespace {
json goodBody() {
    return {
        {"name", "Avinash Julakatti"},
        {"email", "avinash@example.com"},
        {"phone", "9876543210"},
        {"password", "SecretPass123"},
        {"role", "Attendee"}
    };
}
httplib::Result post(TestServer& s, const std::string& body) {
    return s.client().Post("/api/auth/register", body, "application/json");
}
}  // namespace

TEST(RegisterApi, CreatesAccountAndNeverEchoesSecrets) {
    TestServer s;
    auto res = post(s, goodBody().dump());
    ASSERT_TRUE(res);
    EXPECT_EQ(res->status, 201);
    auto j = json::parse(res->body);
    EXPECT_EQ(j["user"]["email"], "avinash@example.com");
    EXPECT_EQ(res->body.find("SecretPass123"), std::string::npos);
    EXPECT_EQ(res->body.find("passwordHash"), std::string::npos);
}

TEST(RegisterApi, ValidationErrorsListEachField) {
    TestServer s;
    auto res = post(s, R"({"name":"","email":"bademail","phone":"12","password":"x","role":"Invalid"})");
    ASSERT_TRUE(res);
    EXPECT_EQ(res->status, 400);
    EXPECT_GE(json::parse(res->body)["fields"].size(), 4u);
}

TEST(RegisterApi, DuplicateEmailReturns409) {
    TestServer s;
    ASSERT_EQ(post(s, goodBody().dump())->status, 201);
    EXPECT_EQ(post(s, goodBody().dump())->status, 409);
}

TEST(RegisterApi, MalformedJsonReturns400) {
    TestServer s;
    EXPECT_EQ(post(s, "{invalid json")->status, 400);
    EXPECT_EQ(post(s, "[1,2,3]")->status, 400);
    EXPECT_EQ(post(s, "")->status, 400);
}
