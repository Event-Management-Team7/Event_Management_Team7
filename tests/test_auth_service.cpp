#include <gtest/gtest.h>

#include "auth/PasswordHasher.h"
#include "db/Database.h"
#include "db/Schema.h"
#include "services/AuthService.h"
#include "services/UserService.h"

TEST(AuthService, LoginSucceedsWithValidCredentials) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);
    emrs::UserService users(db);
    emrs::PasswordHasher hasher(1000);
    emrs::AuthService auth(db, users, hasher);

    users.createUser("Vaishali", "vaishali@test.com", "9876543210", "Organizer", hasher.hash("SecurePass1"));

    auto res = auth.login("vaishali@test.com", "SecurePass1");
    EXPECT_EQ(res.status, emrs::LoginResult::Status::Ok);
    EXPECT_FALSE(res.token.empty());
    EXPECT_EQ(res.user.email, "vaishali@test.com");

    auto authedUser = auth.authenticate(res.token);
    ASSERT_TRUE(authedUser.has_value());
    EXPECT_EQ(authedUser->name, "Vaishali");

    EXPECT_TRUE(auth.logout(res.token));
    EXPECT_FALSE(auth.authenticate(res.token).has_value());
}

TEST(AuthService, LoginFailsWithInvalidCredentials) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);
    emrs::UserService users(db);
    emrs::PasswordHasher hasher(1000);
    emrs::AuthService auth(db, users, hasher);

    users.createUser("Vaishali", "vaishali@test.com", "9876543210", "Organizer", hasher.hash("SecurePass1"));

    auto res = auth.login("vaishali@test.com", "WrongPassword");
    EXPECT_EQ(res.status, emrs::LoginResult::Status::InvalidCredentials);
}
