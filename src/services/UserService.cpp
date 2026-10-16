#include "services/UserService.h"

#include <chrono>

namespace emrs {

namespace {
long long nowSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

User rowToUser(const Database::Row& r) {
    User u;
    u.id = std::stoll(r[0]);
    u.name = r[1];
    u.email = r[2];
    u.phone = r[3];
    u.role = r[4];
    u.passwordHash = r[5];
    u.createdAt = std::stoll(r[6]);
    return u;
}
}  // namespace

long long UserService::createUser(const std::string& name, const std::string& email,
                                  const std::string& phone, const std::string& role,
                                  const std::string& passwordHash) {
    long long now = nowSeconds();
    std::string userRole = role.empty() ? "Attendee" : role;
    db_.execute(
        "INSERT INTO users (name, email, phone, role, password_hash, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?);",
        {name, email, phone, userRole, passwordHash, std::to_string(now)});
    return db_.lastInsertId();
}

std::optional<User> UserService::findById(long long id) {
    auto rows = db_.query("SELECT id, name, email, phone, role, password_hash, created_at FROM users WHERE id = ?;",
                          {std::to_string(id)});
    if (rows.empty()) return std::nullopt;
    return rowToUser(rows[0]);
}

std::optional<User> UserService::findByEmail(const std::string& email) {
    auto rows = db_.query("SELECT id, name, email, phone, role, password_hash, created_at FROM users WHERE email = ?;",
                          {email});
    if (rows.empty()) return std::nullopt;
    return rowToUser(rows[0]);
}

bool UserService::emailExists(const std::string& email) {
    auto rows = db_.query("SELECT 1 FROM users WHERE email = ? LIMIT 1;", {email});
    return !rows.empty();
}

bool UserService::updateProfile(long long id, const std::string& name, const std::string& phone) {
    db_.execute("UPDATE users SET name = ?, phone = ? WHERE id = ?;",
                {name, phone, std::to_string(id)});
    return true;
}

}  // namespace emrs
