#include <gtest/gtest.h>

#include "auth/PasswordHasher.h"

TEST(PasswordHasher, HashesAndVerifiesPassword) {
    emrs::PasswordHasher hasher(1000);  // low iterations for speed in tests
    std::string pass = "SuperSecret123";
    std::string hash = hasher.hash(pass);

    EXPECT_NE(hash.find("pbkdf2$1000$"), std::string::npos);
    EXPECT_TRUE(hasher.verify(pass, hash));
    EXPECT_FALSE(hasher.verify("WrongPass123", hash));
}

TEST(PasswordHasher, RejectsMalformedHashes) {
    emrs::PasswordHasher hasher(1000);
    EXPECT_FALSE(hasher.verify("pass", ""));
    EXPECT_FALSE(hasher.verify("pass", "invalid$format"));
    EXPECT_FALSE(hasher.verify("pass", "pbkdf2$notanumber$salt$hash"));
}
