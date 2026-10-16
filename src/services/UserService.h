#pragma once
#include <optional>
#include <string>
#include <vector>

#include "db/Database.h"

namespace emrs {

struct User {
    long long id = 0;
    std::string name;
    std::string email;
    std::string phone;
    std::string role;
    std::string passwordHash;
    long long createdAt = 0;
};

class UserService {
public:
    explicit UserService(Database& db) : db_(db) {}

    long long createUser(const std::string& name, const std::string& email, const std::string& phone,
                         const std::string& role, const std::string& passwordHash);

    std::optional<User> findById(long long id);
    std::optional<User> findByEmail(const std::string& email);
    bool emailExists(const std::string& email);
    bool updateProfile(long long id, const std::string& name, const std::string& phone);

private:
    Database& db_;
};

}  // namespace emrs
