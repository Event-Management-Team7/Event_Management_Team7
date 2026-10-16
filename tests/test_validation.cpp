#include <gtest/gtest.h>

#include "util/Validation.h"

TEST(Validation, ValidatesNamesCorrectly) {
    EXPECT_TRUE(emrs::isValidName("Aariz"));
    EXPECT_TRUE(emrs::isValidName("Dhanraj Rathod"));
    EXPECT_TRUE(emrs::isValidName("Vaishali Krishnan"));
    EXPECT_TRUE(emrs::isValidName("Avinash Julakatti"));
    EXPECT_FALSE(emrs::isValidName(""));
    EXPECT_FALSE(emrs::isValidName("A"));
    EXPECT_FALSE(emrs::isValidName("User123"));
}

TEST(Validation, ValidatesEmailsCorrectly) {
    EXPECT_TRUE(emrs::isValidEmail("test@example.com"));
    EXPECT_TRUE(emrs::isValidEmail("user.name+tag@sub.domain.org"));
    EXPECT_FALSE(emrs::isValidEmail("invalid-email"));
    EXPECT_FALSE(emrs::isValidEmail("@nodomain.com"));
    EXPECT_FALSE(emrs::isValidEmail("user@.com"));
}

TEST(Validation, ValidatesPasswordsCorrectly) {
    EXPECT_TRUE(emrs::isValidPassword("password123"));
    EXPECT_TRUE(emrs::isValidPassword("SecurePass2026"));
    EXPECT_FALSE(emrs::isValidPassword("short1"));
    EXPECT_FALSE(emrs::isValidPassword("allletters"));
    EXPECT_FALSE(emrs::isValidPassword("1234567890"));
}

TEST(Validation, ValidatesRegistrationInput) {
    emrs::RegistrationInput validIn{"Aariz", "aariz@example.com", "9876543210", "Secret123", "Organizer"};
    EXPECT_TRUE(emrs::validateRegistration(validIn).empty());

    emrs::RegistrationInput invalidIn{"", "bad-email", "123", "weak", "InvalidRole"};
    auto errs = emrs::validateRegistration(invalidIn);
    EXPECT_FALSE(errs.empty());
    EXPECT_NE(errs.find("name"), errs.end());
    EXPECT_NE(errs.find("email"), errs.end());
    EXPECT_NE(errs.find("phone"), errs.end());
    EXPECT_NE(errs.find("password"), errs.end());
    EXPECT_NE(errs.find("role"), errs.end());
}
