#include <algorithm>
#include <gtest/gtest.h>

#include "db/Database.h"
#include "db/Schema.h"

TEST(Database, InitializesSchemaAndExecutesQueries) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);

    db.execute(
        "INSERT INTO users "
        "(name, email, role, password_hash, created_at) "
        "VALUES (?, ?, ?, ?, ?);",
        {"Avinash", "avinash@test.com", "Attendee", "hash123", "12345678"});

    long long id = db.lastInsertId();
    EXPECT_GT(id, 0);

    auto rows = db.query(
        "SELECT name, email FROM users WHERE id = ?;",
        {std::to_string(id)});

    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0][0], "Avinash");
    EXPECT_EQ(rows[0][1], "avinash@test.com");
}

TEST(Database, HandlesTransactionsRollbackOnFailure) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);

    EXPECT_THROW(
        db.transaction([&] {
            db.execute(
                "INSERT INTO users "
                "(name, email, role, password_hash, created_at) "
                "VALUES (?, ?, ?, ?, ?);",
                {"Temp", "temp@test.com", "Attendee", "hash",
                 "12345678"});

            throw std::runtime_error("Simulated failure");
        }),
        std::runtime_error);

    auto rows = db.query(
        "SELECT * FROM users WHERE email = ?;",
        {"temp@test.com"});

    EXPECT_TRUE(rows.empty());
}

TEST(Database, RejectsDuplicateEmailAtDatabaseLevel) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);

    db.execute(
        "INSERT INTO users "
        "(name, email, role, password_hash, created_at) "
        "VALUES (?, ?, ?, ?, ?);",
        {"First User", "duplicate@test.com", "Attendee", "hash1",
         "100"});

    EXPECT_THROW(
        db.execute(
            "INSERT INTO users "
            "(name, email, role, password_hash, created_at) "
            "VALUES (?, ?, ?, ?, ?);",
            {"Second User", "duplicate@test.com", "Attendee", "hash2",
             "200"}),
        std::runtime_error);
}

TEST(Database, SchemaContainsRequiredEventFields) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);

    auto rows = db.query("PRAGMA table_info(events);");

    ASSERT_FALSE(rows.empty());

    std::vector<std::string> columns;

    for (const auto& row : rows) {
        ASSERT_GE(row.size(), 2u);
        columns.push_back(row[1]);
    }

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "id"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "organizer_id"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "title"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "description"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "category"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "start_time"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "venue_type"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "venue"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "capacity"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "ticket_details"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "price"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "status"),
        columns.end());

    EXPECT_NE(
        std::find(columns.begin(), columns.end(), "created_at"),
        columns.end());
}

TEST(Database, SchemaInitializationDoesNotDropExistingData) {
    emrs::Database db(":memory:");
    emrs::initSchema(db);

    db.execute(
        "INSERT INTO users "
        "(name, email, role, password_hash, created_at) "
        "VALUES (?, ?, ?, ?, ?);",
        {"Persistent User", "persistent@test.com", "Attendee",
         "hash", "12345678"});

    // Re-running schema initialization must not remove existing data.
    emrs::initSchema(db);

    auto rows = db.query(
        "SELECT name FROM users WHERE email = ?;",
        {"persistent@test.com"});

    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0][0], "Persistent User");
}