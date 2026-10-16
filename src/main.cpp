#include <cstdlib>
#include <iostream>

#include "api/Routes.h"
#include "db/Database.h"

int main() {
    const char* dbPath = std::getenv("EMRS_DB");
    const char* portEnv = std::getenv("EMRS_PORT");
    int port = portEnv ? std::atoi(portEnv) : 8080;

    try {
        emrs::Database db(dbPath ? dbPath : "emrs.db");
        httplib::Server server;
        server.set_mount_point("/", std::getenv("EMRS_WEB_DIR") ? std::getenv("EMRS_WEB_DIR") : "web");
        emrs::registerRoutes(server, db);
        std::cout << "EMRS server listening on http://0.0.0.0:" << port << std::endl;
        if (!server.listen("0.0.0.0", port)) {
            std::cerr << "failed to bind port " << port << std::endl;
            return 1;
        }
    } catch (const std::exception& e) {
        std::cerr << "fatal: " << e.what() << std::endl;
        return 1;
    }
    return 0;
}
