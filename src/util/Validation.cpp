#include "util/Validation.h"

#include <algorithm>
#include <cctype>
#include <regex>

namespace emrs {

std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\n\r");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\n\r");
    return s.substr(start, end - start + 1);
}

bool isValidName(const std::string& name) {
    auto s = trim(name);
    if (s.size() < 2 || s.size() > 60) return false;
    for (char c : s) {
        if (!std::isalpha(static_cast<unsigned char>(c)) && c != ' ' && c != '.' && c != '\'' && c != '-') {
            return false;
        }
    }
    return true;
}

bool isValidEmail(const std::string& email) {
    auto s = trim(email);
    if (s.empty() || s.size() > 254) return false;
    static const std::regex kEmailRegex(R"(^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$)");
    return std::regex_match(s, kEmailRegex);
}

bool isValidPhone(const std::string& phone) {
    auto s = trim(phone);
    if (s.size() != 10) return false;
    if (s[0] < '6' || s[0] > '9') return false;
    return std::all_of(s.begin(), s.end(), [](char c) { return std::isdigit(static_cast<unsigned char>(c)); });
}

bool isValidPassword(const std::string& pw) {
    if (pw.size() < 8 || pw.size() > 128) return false;
    bool hasLetter = false;
    bool hasDigit = false;
    for (char c : pw) {
        if (std::isalpha(static_cast<unsigned char>(c))) hasLetter = true;
        if (std::isdigit(static_cast<unsigned char>(c))) hasDigit = true;
    }
    return hasLetter && hasDigit;
}

bool isValidRole(const std::string& role) {
    auto s = trim(role);
    return s == "Attendee" || s == "Organizer" || s == "Admin";
}

FieldErrors validateRegistration(const RegistrationInput& in) {
    FieldErrors errs;
    if (!isValidName(in.name)) {
        errs["name"] = "Name must be 2-60 characters and contain only letters, spaces, or hyphens.";
    }
    if (!isValidEmail(in.email)) {
        errs["email"] = "Please enter a valid email address.";
    }
    if (!in.phone.empty() && !isValidPhone(in.phone)) {
        errs["phone"] = "Phone must be a valid 10-digit number.";
    }
    if (!isValidPassword(in.password)) {
        errs["password"] = "Password must be at least 8 characters long and contain both letters and numbers.";
    }
    if (!in.role.empty() && !isValidRole(in.role)) {
        errs["role"] = "Role must be Attendee, Organizer, or Admin.";
    }
    return errs;
}

FieldErrors validateEvent(const EventInput& in) {
    FieldErrors errs;
    if (trim(in.title).empty() || in.title.size() > 120) {
        errs["title"] = "Title is required (maximum 120 characters).";
    }
    if (trim(in.description).empty()) {
        errs["description"] = "Description is required.";
    }
    if (trim(in.category).empty()) {
        errs["category"] = "Category is required.";
    }
    if (trim(in.date).empty()) {
        errs["date"] = "Date is required.";
    }
    if (trim(in.venue).empty()) {
        errs["venue"] = "Venue is required.";
    }
    if (in.capacity <= 0) {
        errs["capacity"] = "Capacity must be greater than zero.";
    }
    if (in.price < 0.0) {
        errs["price"] = "Price cannot be negative.";
    }
    return errs;
}

}  // namespace emrs
