#include <gtest/gtest.h>

#include "db/Database.h"
#include "db/Schema.h"

TEST(Database, InitializesSchemaAndExecutesQueries) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);

    db.execute("INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?);",
               {"Avinash", "avinash@test.com", "Attendee", "hash123", "12345678"});
    long long id = db.lastInsertId();
    EXPECT_GT(id, 0);

    auto rows = db.query("SELECT name, email FROM users WHERE id = ?;", {std::to_string(id)});
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0][0], "Avinash");
    EXPECT_EQ(rows[0][1], "avinash@test.com");
}

TEST(Database, HandlesTransactionsRollbackOnFailure) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);

    EXPECT_THROW(db.transaction([&] {
        db.execute("INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?);",
                   {"Temp", "temp@test.com", "Attendee", "hash", "12345678"});
        throw std::runtime_error("Simulated failure");
    }), std::runtime_error);

    auto rows = db.query("SELECT * FROM users WHERE email = ?;", {"temp@test.com"});
    EXPECT_TRUE(rows.empty());
}
