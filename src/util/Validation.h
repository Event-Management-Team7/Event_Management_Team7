#pragma once
#include <map>
#include <string>

namespace emrs {

// field name -> human readable error message. Empty map means input is valid.
using FieldErrors = std::map<std::string, std::string>;

std::string trim(const std::string& s);

bool isValidName(const std::string& name);        // 2-60 chars
bool isValidEmail(const std::string& email);      // RFC-5322 subset
bool isValidPhone(const std::string& phone);      // 10 digits
bool isValidPassword(const std::string& pw);      // 8-128 chars, >=1 letter & >=1 digit
bool isValidRole(const std::string& role);        // Attendee, Organizer, Admin
bool isPastDate(const std::string& dateStr);      // Rejects dates prior to current time

struct RegistrationInput {
    std::string name;
    std::string email;
    std::string phone;
    std::string password;
    std::string role; // Default: Attendee
};

FieldErrors validateRegistration(const RegistrationInput& in);

struct EventInput {
    std::string title;
    std::string description;
    std::string category;
    std::string date;
    std::string venue;
    int capacity = 0;
    double price = 0.0;
};

FieldErrors validateEvent(const EventInput& in);

}  // namespace emrs
