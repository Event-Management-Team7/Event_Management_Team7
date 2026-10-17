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

TEST(PasswordHasher, SamePasswordGivesDifferentHashesDueToSalt) {
    emrs::PasswordHasher hasher(1000);
    std::string pass = "SecurePass2026";
    std::string h1 = hasher.hash(pass);
    std::string h2 = hasher.hash(pass);

    EXPECT_NE(h1, h2);
    EXPECT_TRUE(hasher.verify(pass, h1));
    EXPECT_TRUE(hasher.verify(pass, h2));
    EXPECT_FALSE(hasher.verify("DifferentPass2026", h1));
    EXPECT_FALSE(hasher.verify("DifferentPass2026", h2));
}
