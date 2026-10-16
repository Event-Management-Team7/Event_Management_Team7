#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "TestServer.h"

using nlohmann::json;

TEST(LoginApi, AuthenticatesUserAndReturnsBearerToken) {
    TestServer s;

    // Register user first
    json regBody = {
        {"name", "Dhanraj Rathod"},
        {"email", "dhanraj@example.com"},
        {"phone", "9876543210"},
        {"password", "Password123"},
        {"role", "Organizer"}
    };
    auto regRes = s.client().Post("/api/auth/register", regBody.dump(), "application/json");
    ASSERT_EQ(regRes->status, 201);

    // Login
    json loginBody = {{"email", "dhanraj@example.com"}, {"password", "Password123"}};
    auto loginRes = s.client().Post("/api/auth/login", loginBody.dump(), "application/json");
    ASSERT_TRUE(loginRes);
    EXPECT_EQ(loginRes->status, 200);

    auto j = json::parse(loginRes->body);
    EXPECT_TRUE(j.contains("token"));
    EXPECT_EQ(j["user"]["role"], "Organizer");

    // Use token to fetch /api/auth/me
    std::string token = j["token"];
    httplib::Headers headers = {{"Authorization", "Bearer " + token}};
    auto meRes = s.client().Get("/api/auth/me", headers);
    ASSERT_TRUE(meRes);
    EXPECT_EQ(meRes->status, 200);
    EXPECT_EQ(json::parse(meRes->body)["user"]["email"], "dhanraj@example.com");
}

TEST(LoginApi, RejectsWrongPassword) {
    TestServer s;
    json body = {{"email", "nonexistent@example.com"}, {"password", "WrongPass1"}};
    auto res = s.client().Post("/api/auth/login", body.dump(), "application/json");
    ASSERT_TRUE(res);
    EXPECT_EQ(res->status, 401);
}
