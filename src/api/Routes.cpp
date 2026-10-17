#include "api/Routes.h"

#include <nlohmann/json.hpp>

#include "auth/PasswordHasher.h"
#include "db/Schema.h"
#include "services/AuthService.h"
#include "services/EventService.h"
#include "services/RegistrationService.h"
#include "services/TicketService.h"
#include "services/UserService.h"
#include "util/Validation.h"

using nlohmann::json;

namespace emrs {

namespace {

std::optional<std::string> extractBearerToken(const httplib::Request& req) {
    auto auth = req.get_header_value("Authorization");
    if (auth.rfind("Bearer ", 0) == 0 && auth.size() > 7) {
        return auth.substr(7);
    }
    return std::nullopt;
}

void jsonResponse(httplib::Response& res, int status, const json& body) {
    res.status = status;
    res.set_content(body.dump(), "application/json");
}

}  // namespace

void registerRoutes(httplib::Server& server, Database& db, int pbkdf2Iterations) {
    initSchema(db);

    auto users = std::make_shared<UserService>(db);
    auto hasher = PasswordHasher(pbkdf2Iterations);
    auto auth = std::make_shared<AuthService>(db, *users, hasher);
    auto events = std::make_shared<EventService>(db);
    auto registrations = std::make_shared<RegistrationService>(db);
    auto tickets = std::make_shared<TicketService>(db);

    // Health Check
    server.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        jsonResponse(res, 200, {
            {"status", "ok"},
            {"app", "Event Management and Registration System (EMRS)"},
            {"version", "1.0.0"}
        });
    });

    // Auth: Register (EMRS-F-001)
    server.Post("/api/auth/register", [users, hasher](const httplib::Request& req, httplib::Response& res) {
        json parsed;
        try {
            parsed = json::parse(req.body);
            if (!parsed.is_object()) {
                jsonResponse(res, 400, {{"error", "Request body must be a JSON object"}});
                return;
            }
        } catch (...) {
            jsonResponse(res, 400, {{"error", "Malformed JSON"}});
            return;
        }

        RegistrationInput in;
        if (parsed.contains("name") && parsed["name"].is_string()) in.name = parsed["name"];
        if (parsed.contains("email") && parsed["email"].is_string()) in.email = parsed["email"];
        if (parsed.contains("phone") && parsed["phone"].is_string()) in.phone = parsed["phone"];
        if (parsed.contains("password") && parsed["password"].is_string()) in.password = parsed["password"];
        if (parsed.contains("role") && parsed["role"].is_string()) in.role = parsed["role"];

        auto errs = validateRegistration(in);
        if (!errs.empty()) {
            jsonResponse(res, 400, {{"error", "Validation failed"}, {"fields", errs}});
            return;
        }

        if (users->emailExists(in.email)) {
            jsonResponse(res, 409, {{"error", "An account with this email already exists."}});
            return;
        }

        std::string hash = hasher.hash(in.password);
        long long userId = users->createUser(in.name, in.email, in.phone, in.role, hash);
        auto createdUser = users->findById(userId);

        json uJson = {
            {"id", createdUser->id},
            {"name", createdUser->name},
            {"email", createdUser->email},
            {"phone", createdUser->phone},
            {"role", createdUser->role},
            {"createdAt", createdUser->createdAt}
        };

        jsonResponse(res, 201, {{"message", "Registration successful"}, {"user", uJson}});
    });

    // Auth: Login (EMRS-F-002)
    server.Post("/api/auth/login", [auth](const httplib::Request& req, httplib::Response& res) {
        json parsed;
        try {
            parsed = json::parse(req.body);
        } catch (...) {
            jsonResponse(res, 400, {{"error", "Malformed JSON"}});
            return;
        }

        std::string email = parsed.value("email", "");
        std::string password = parsed.value("password", "");

        auto loginRes = auth->login(email, password);
        if (loginRes.status == LoginResult::Status::Locked) {
            jsonResponse(res, 429, {{"error", "Too many failed attempts. Account temporarily locked."}});
            return;
        }
        if (loginRes.status == LoginResult::Status::InvalidCredentials) {
            jsonResponse(res, 401, {{"error", "Invalid email or password."}});
            return;
        }

        jsonResponse(res, 200, {
            {"token", loginRes.token},
            {"expiresAt", loginRes.expiresAt},
            {"user", {
                {"id", loginRes.user.id},
                {"name", loginRes.user.name},
                {"email", loginRes.user.email},
                {"role", loginRes.user.role}
            }}
        });
    });

    // Auth: Logout
    server.Post("/api/auth/logout", [auth](const httplib::Request& req, httplib::Response& res) {
        auto token = extractBearerToken(req);
        if (!token || !auth->logout(*token)) {
            jsonResponse(res, 400, {{"error", "Invalid or missing token"}});
            return;
        }
        jsonResponse(res, 200, {{"message", "Logged out successfully"}});
    });

    // Auth: Me
    server.Get("/api/auth/me", [auth](const httplib::Request& req, httplib::Response& res) {
        auto token = extractBearerToken(req);
        if (!token) {
            jsonResponse(res, 401, {{"error", "Missing authentication token"}});
            return;
        }
        auto user = auth->authenticate(*token);
        if (!user) {
            jsonResponse(res, 401, {{"error", "Invalid or expired session token"}});
            return;
        }
        jsonResponse(res, 200, {
            {"user", {
                {"id", user->id},
                {"name", user->name},
                {"email", user->email},
                {"phone", user->phone},
                {"role", user->role}
            }}
        });
    });

    // Events: List (EMRS-F-008)
    server.Get("/api/events", [events](const httplib::Request& req, httplib::Response& res) {
        std::string category = req.has_param("category") ? req.get_param_value("category") : "";
        std::string search = req.has_param("search") ? req.get_param_value("search") : "";

        auto list = events->listEvents(category, search);
        json arr = json::array();
        for (const auto& ev : list) {
            arr.push_back({
                {"id", ev.id},
                {"organizerId", ev.organizerId},
                {"title", ev.title},
                {"description", ev.description},
                {"category", ev.category},
                {"date", ev.eventDate},
                {"venue", ev.venue},
                {"capacity", ev.capacity},
                {"price", ev.price},
                {"registeredCount", ev.registeredCount},
                {"status", ev.status}
            });
        }
        jsonResponse(res, 200, {{"events", arr}});
    });

    // Events: Create (EMRS-F-005)
    server.Post("/api/events", [auth, events](const httplib::Request& req, httplib::Response& res) {
        auto token = extractBearerToken(req);
        if (!token) {
            jsonResponse(res, 401, {{"error", "Missing authentication token"}});
            return;
        }
        auto user = auth->authenticate(*token);
        if (!user) {
            jsonResponse(res, 401, {{"error", "Invalid or expired session token"}});
            return;
        }
        if (user->role != "Organizer" && user->role != "Admin") {
            jsonResponse(res, 403, {{"error", "Only organizers can create events."}});
            return;
        }

        json parsed;
        try {
            parsed = json::parse(req.body);
        } catch (...) {
            jsonResponse(res, 400, {{"error", "Malformed JSON"}});
            return;
        }

        EventInput in;
        if (parsed.contains("title") && parsed["title"].is_string()) in.title = parsed["title"];
        if (parsed.contains("description") && parsed["description"].is_string()) in.description = parsed["description"];
        if (parsed.contains("category") && parsed["category"].is_string()) in.category = parsed["category"];
        if (parsed.contains("date") && parsed["date"].is_string()) in.date = parsed["date"];
        if (parsed.contains("venue") && parsed["venue"].is_string()) in.venue = parsed["venue"];
        if (parsed.contains("capacity") && parsed["capacity"].is_number()) in.capacity = parsed["capacity"];
        if (parsed.contains("price") && parsed["price"].is_number()) in.price = parsed["price"];

        auto errs = validateEvent(in);
        if (!errs.empty()) {
            jsonResponse(res, 400, {{"error", "Validation failed"}, {"fields", errs}});
            return;
        }

        long long eventId = events->createEvent(user->id, in.title, in.description, in.category,
                                                in.date, in.venue, in.capacity, in.price);
        jsonResponse(res, 201, {{"message", "Event created successfully"}, {"eventId", eventId}});
    });

    // Events: Register (EMRS-F-010, EMRS-F-012, EMRS-F-015)
    server.Post(R"(/api/events/(\d+)/register)", [auth, registrations](const httplib::Request& req, httplib::Response& res) {
        auto token = extractBearerToken(req);
        if (!token) {
            jsonResponse(res, 401, {{"error", "Missing authentication token"}});
            return;
        }
        auto user = auth->authenticate(*token);
        if (!user) {
            jsonResponse(res, 401, {{"error", "Invalid or expired session token"}});
            return;
        }

        long long eventId = std::stoll(req.matches[1]);
        auto resp = registrations->registerAttendee(eventId, user->id);

        if (resp.result == RegistrationService::RegisterResult::EventNotFound) {
            jsonResponse(res, 404, {{"error", "Event not found"}});
            return;
        }
        if (resp.result == RegistrationService::RegisterResult::EventCancelled) {
            jsonResponse(res, 400, {{"error", "Event has been cancelled"}});
            return;
        }
        if (resp.result == RegistrationService::RegisterResult::AlreadyRegistered) {
            jsonResponse(res, 409, {{"error", "You are already registered for this event"}});
            return;
        }

        if (resp.result == RegistrationService::RegisterResult::Confirmed) {
            jsonResponse(res, 200, {
                {"status", "confirmed"},
                {"registrationId", resp.registrationId},
                {"ticketCode", resp.ticketCode},
                {"message", "Registration confirmed! Your QR ticket is ready."}
            });
        } else {
            jsonResponse(res, 200, {
                {"status", "waitlist"},
                {"registrationId", resp.registrationId},
                {"message", "Event is full. You have been placed on the waitlist."}
            });
        }
    });

    // Tickets: Check-in Scanner (EMRS-F-016)
    server.Post("/api/tickets/checkin", [auth, tickets](const httplib::Request& req, httplib::Response& res) {
        auto token = extractBearerToken(req);
        if (!token) {
            jsonResponse(res, 401, {{"error", "Missing authentication token"}});
            return;
        }
        auto user = auth->authenticate(*token);
        if (!user || (user->role != "Organizer" && user->role != "Admin")) {
            jsonResponse(res, 403, {{"error", "Only organizers can check in attendees."}});
            return;
        }

        json parsed;
        try {
            parsed = json::parse(req.body);
        } catch (...) {
            jsonResponse(res, 400, {{"error", "Malformed JSON"}});
            return;
        }

        std::string ticketCode = parsed.value("ticketCode", "");
        if (ticketCode.empty()) {
            jsonResponse(res, 400, {{"error", "Ticket code is required"}});
            return;
        }

        auto info = tickets->getTicketByCode(ticketCode);
        if (!info) {
            jsonResponse(res, 404, {{"error", "Invalid ticket code"}});
            return;
        }
        if (info->checkedIn) {
            jsonResponse(res, 409, {{"error", "Ticket has already been checked in"}});
            return;
        }

        tickets->checkIn(ticketCode);
        jsonResponse(res, 200, {
            {"message", "Check-in successful!"},
            {"attendeeName", info->attendeeName},
            {"eventTitle", info->eventTitle}
        });
    });

    // Registrations: Current user registrations (EMRS-F-010)
    server.Get("/api/registrations/my", [auth, registrations](const httplib::Request& req, httplib::Response& res) {
        auto token = extractBearerToken(req);
        if (!token) {
            jsonResponse(res, 401, {{"error", "Missing authentication token"}});
            return;
        }
        auto user = auth->authenticate(*token);
        if (!user) {
            jsonResponse(res, 401, {{"error", "Invalid or expired session token"}});
            return;
        }

        auto list = registrations->listUserRegistrations(user->id);
        json arr = json::array();
        for (const auto& reg : list) {
            arr.push_back({
                {"id", reg.id},
                {"eventId", reg.eventId},
                {"eventTitle", reg.eventTitle},
                {"status", reg.status},
                {"ticketCode", reg.ticketCode},
                {"createdAt", reg.createdAt}
            });
        }
        jsonResponse(res, 200, {{"registrations", arr}});
    });
}

}  // namespace emrs
