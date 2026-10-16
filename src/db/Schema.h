#pragma once
#include "db/Database.h"

namespace emrs {

// Creates all database tables if they do not exist.
void initSchema(Database& db);

}  // namespace emrs
