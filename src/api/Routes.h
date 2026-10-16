#pragma once
#include <httplib.h>

#include "auth/PasswordHasher.h"
#include "db/Database.h"

namespace emrs {

// Registers every REST endpoint on the server.
void registerRoutes(httplib::Server& server, Database& db,
                    int pbkdf2Iterations = PasswordHasher::kDefaultIterations);

}  // namespace emrs
