#include "services/AuthService.h"

#include <chrono>

namespace emrs {

namespace {
long long defaultNow() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}
}  // namespace

AuthService::AuthService(Database& db, UserService& users, PasswordHasher hasher, Clock clock)
    : db_(db),
      users_(users),
      hasher_(hasher),
      clock_(clock ? clock : defaultNow),
      dummyHash_(hasher.hash("dummy-pass-never-matches-anything")) {}

LoginResult AuthService::login(const std::string& email, const std::string& password) {
    long long now = clock_();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = attempts_.find(email);
        if (it != attempts_.end() && it->second.lockedUntil > now) {
            LoginResult res;
            res.status = LoginResult::Status::Locked;
            return res;
        }
    }

    auto userOpt = users_.findByEmail(email);
    const std::string& storedHash = userOpt ? userOpt->passwordHash : dummyHash_;
    bool verified = hasher_.verify(password, storedHash) && userOpt.has_value();

    if (!verified) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto& att = attempts_[email];
        att.failures++;
        if (att.failures >= kMaxFailures) {
            att.lockedUntil = now + kLockSeconds;
            att.failures = 0;
            LoginResult res;
            res.status = LoginResult::Status::Locked;
            return res;
        }
        LoginResult res;
        res.status = LoginResult::Status::InvalidCredentials;
        return res;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        attempts_.erase(email);
    }

    std::string token = randomHex(32);
    long long expiresAt = now + kSessionTtl;

    db_.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?);",
                {token, std::to_string(userOpt->id), std::to_string(expiresAt)});

    LoginResult res;
    res.status = LoginResult::Status::Ok;
    res.token = token;
    res.expiresAt = expiresAt;
    res.user = *userOpt;
    return res;
}

std::optional<User> AuthService::authenticate(const std::string& token) {
    long long now = clock_();
    auto rows = db_.query("SELECT user_id, expires_at FROM sessions WHERE token = ?;", {token});
    if (rows.empty()) return std::nullopt;

    long long expiresAt = std::stoll(rows[0][1]);
    if (expiresAt < now) {
        db_.execute("DELETE FROM sessions WHERE token = ?;", {token});
        return std::nullopt;
    }

    long long userId = std::stoll(rows[0][0]);
    return users_.findById(userId);
}

bool AuthService::logout(const std::string& token) {
    auto rows = db_.query("SELECT token FROM sessions WHERE token = ?;", {token});
    if (rows.empty()) return false;
    db_.execute("DELETE FROM sessions WHERE token = ?;", {token});
    return true;
}

}  // namespace emrs
