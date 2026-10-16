#pragma once
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>

#include "auth/PasswordHasher.h"
#include "db/Database.h"
#include "services/UserService.h"

namespace emrs {

struct LoginResult {
    enum class Status { Ok, InvalidCredentials, Locked } status = Status::InvalidCredentials;
    std::string token;
    long long expiresAt = 0;
    User user;
};

class AuthService {
public:
    using Clock = std::function<long long()>;
    static constexpr long long kSessionTtl = 24 * 3600;
    static constexpr int kMaxFailures = 5;
    static constexpr long long kLockSeconds = 300;

    AuthService(Database& db, UserService& users, PasswordHasher hasher, Clock clock = nullptr);

    LoginResult login(const std::string& email, const std::string& password);
    std::optional<User> authenticate(const std::string& token);
    bool logout(const std::string& token);

private:
    struct Attempts {
        int failures = 0;
        long long lockedUntil = 0;
    };

    Database& db_;
    UserService& users_;
    PasswordHasher hasher_;
    Clock clock_;
    std::string dummyHash_;
    std::mutex mutex_;
    std::map<std::string, Attempts> attempts_;
};

}  // namespace emrs
