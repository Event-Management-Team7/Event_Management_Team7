"""EMT-26: browser tests for the organizer create-event form."""
import pytest

from helpers import fill_event, future_datetime, list_events, sign_in_as


# --- Access control ---------------------------------------------------------

def test_logged_out_user_cannot_reach_create_event_form(page):
    """TC-EVT-FE-01: no create-event tab for logged-out visitors."""
    assert not page.is_visible("#tabCreateEvent")
    assert not page.is_visible("#createEventForm")


def test_attendee_cannot_reach_create_event_form(page, unique_email):
    """TC-EVT-FE-02: attendees do not see the tab or the form."""
    sign_in_as(page, unique_email, "Attendee")
    assert not page.is_visible("#tabCreateEvent")
    assert not page.is_visible("#createEventForm")


def test_organizer_sees_create_event_tab(page, unique_email):
    """TC-EVT-FE-03: organizers see the tab and the form opens."""
    sign_in_as(page, unique_email, "Organizer")
    assert page.is_visible("#tabCreateEvent")
    page.click("#tabCreateEvent")
    assert page.is_visible("#createEventForm")


def test_logout_closes_the_create_event_form(page, unique_email):
    """TC-EVT-FE-04: logging out while on the form hides it and returns to Browse Events."""
    sign_in_as(page, unique_email, "Organizer")
    page.click("#tabCreateEvent")
    page.click("#btnLogout")
    page.wait_for_selector("#btnOpenAuthModal", state="visible")
    assert not page.is_visible("#tabCreateEvent")
    assert not page.is_visible("#createEventForm")
    assert page.is_visible("#eventsTab")


# --- End to end -------------------------------------------------------------

def test_organizer_creates_event_end_to_end(page, unique_email):
    """TC-EVT-FE-05: fill the form, publish, see the confirmation and the event in Browse Events."""
    sign_in_as(page, unique_email, "Organizer")
    fill_event(page, title="Campus Hack Night")
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#createEventSuccess:not([hidden])")
    assert "Campus Hack Night" in page.inner_text("#createEventSuccessText")
    assert page.input_value("#eventTitle") == ""  # form reset
    page.click("#btnViewEvents")
    page.wait_for_selector("#eventsTab.active")
    page.wait_for_selector("text=Campus Hack Night")
    saved = next(e for e in list_events(page) if e["title"] == "Campus Hack Night")
    assert saved["capacity"] == 100 and saved["price"] == 150 and saved["category"] == "Technical"
    assert saved["venue"] == "Auditorium Hall A"


def test_virtual_venue_and_ticket_details_are_saved(page, unique_email):
    """TC-EVT-FE-06: venue type and ticket details are persisted with the event."""
    sign_in_as(page, unique_email, "Organizer")
    fill_event(
        page,
        title="Online Workshop",
        virtual=True,
        venue="Google Meet",
        ticket_details="Certificate included",
    )
    assert "Platform or meeting link" in page.inner_text("#eventVenueLabel")
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#createEventSuccess:not([hidden])")
    saved = next(e for e in list_events(page) if e["title"] == "Online Workshop")
    assert saved["venue"] == "Virtual: Google Meet"
    assert "Ticket details: Certificate included" in saved["description"]


def test_free_event_when_price_left_empty(page, unique_email):
    """TC-EVT-FE-07: an empty price is treated as free."""
    sign_in_as(page, unique_email, "Organizer")
    fill_event(page, title="Free Talk", price="")
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#createEventSuccess:not([hidden])")
    assert next(e for e in list_events(page) if e["title"] == "Free Talk")["price"] == 0


def test_create_another_event_returns_focus_to_title(page, unique_email):
    """TC-EVT-FE-08: 'Create another event' hides the confirmation and focuses the title."""
    sign_in_as(page, unique_email, "Organizer")
    fill_event(page, title="First Event")
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#createEventSuccess:not([hidden])")
    page.click("#btnCreateAnother")
    assert not page.is_visible("#createEventSuccess")
    assert page.evaluate("document.activeElement.id") == "eventTitle"


# --- Validation before submit -----------------------------------------------

def test_required_fields_are_flagged_before_submit(page, unique_email):
    """TC-EVT-FE-09: empty required fields show inline errors and no API call is made."""
    sign_in_as(page, unique_email, "Organizer")
    calls = []
    page.on("request", lambda r: calls.append(r.url) if r.method == "POST" and "/api/events" in r.url else None)
    page.click("#tabCreateEvent")
    page.fill("#eventCapacity", "")
    page.click("#btnSubmitEvent")
    for field in ("Title", "Description", "Category", "Date", "Venue", "Capacity"):
        assert page.locator(f"#event{field}Error").is_visible(), field
    assert page.evaluate("document.activeElement.id") == "eventTitle"
    assert calls == []


@pytest.mark.parametrize(
    "override,error_id,text",
    [
        ({"date": "2020-01-01T10:00"}, "#eventDateError", "past"),
        ({"capacity": "0"}, "#eventCapacityError", "greater than zero"),
        ({"capacity": "2.5"}, "#eventCapacityError", "whole number"),
        ({"price": "-5"}, "#eventPriceError", "negative"),
    ],
)
def test_invalid_values_are_flagged_before_submit(page, unique_email, override, error_id, text):
    """TC-EVT-FE-10: invalid values are flagged inline and never sent."""
    sign_in_as(page, unique_email, "Organizer")
    calls = []
    page.on("request", lambda r: calls.append(r.url) if r.method == "POST" and "/api/events" in r.url else None)
    fill_event(page, **override)
    page.click("#btnSubmitEvent")
    assert page.locator(error_id).is_visible()
    assert text in page.inner_text(error_id)
    assert page.get_attribute(error_id[: -len("Error")], "aria-invalid") == "true"
    assert calls == []


def test_error_clears_when_the_field_is_edited(page, unique_email):
    """TC-EVT-FE-11: an inline error disappears as soon as the user edits that field."""
    sign_in_as(page, unique_email, "Organizer")
    page.click("#tabCreateEvent")
    page.click("#btnSubmitEvent")
    assert page.locator("#eventTitleError").is_visible()
    page.fill("#eventTitle", "Something")
    assert not page.locator("#eventTitleError").is_visible()


# --- Validation after submit and failures -----------------------------------

def test_server_field_errors_are_shown_inline(page, unique_email):
    """TC-EVT-FE-12: when the API rejects the event, each message appears under its own field."""
    sign_in_as(page, unique_email, "Organizer")
    page.route(
        "**/api/events",
        lambda route: route.fulfill(
            status=400,
            content_type="application/json",
            body='{"error":"Validation failed","fields":{"title":"Server says bad title","venue":"Server says bad venue"}}',
        )
        if route.request.method == "POST"
        else route.continue_(),
    )
    fill_event(page)
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#eventTitleError:not([hidden])")
    assert page.inner_text("#eventTitleError") == "Server says bad title"
    assert page.inner_text("#eventVenueError") == "Server says bad venue"
    assert not page.is_visible("#createEventSuccess")


def test_network_failure_never_reports_success(page, unique_email):
    """TC-EVT-FE-13: if the server cannot be reached the form shows an error, not a fake success."""
    sign_in_as(page, unique_email, "Organizer")
    page.route("**/api/events", lambda route: route.abort() if route.request.method == "POST" else route.continue_())
    fill_event(page, title="Ghost Event")
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#createEventFormError:not([hidden])")
    assert "Network error" in page.inner_text("#createEventFormError")
    assert not page.is_visible("#createEventSuccess")
    assert page.input_value("#eventTitle") == "Ghost Event"  # the organizer keeps what they typed
    assert all(e["title"] != "Ghost Event" for e in list_events(page))


def test_submit_button_is_disabled_while_publishing(page, unique_email):
    """TC-EVT-FE-14: no double submit while a request is in flight."""
    sign_in_as(page, unique_email, "Organizer")
    seen = {}

    def slow(route):
        if route.request.method == "POST":
            seen["disabled"] = page.evaluate("document.getElementById('btnSubmitEvent').disabled")
        route.continue_()

    page.route("**/api/events", slow)
    fill_event(page, title="Once Only")
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#createEventSuccess:not([hidden])")
    assert seen["disabled"] is True
    assert page.is_enabled("#btnSubmitEvent")
    assert len([e for e in list_events(page) if e["title"] == "Once Only"]) == 1


def test_expired_session_is_handled(page, unique_email):
    """TC-EVT-FE-15: a 401 from the API signs the user out and hides the form."""
    sign_in_as(page, unique_email, "Organizer")
    page.route(
        "**/api/events",
        lambda route: route.fulfill(status=401, content_type="application/json", body='{"error":"Invalid or expired session token"}')
        if route.request.method == "POST"
        else route.continue_(),
    )
    fill_event(page)
    page.click("#btnSubmitEvent")
    page.wait_for_selector("#btnOpenAuthModal", state="visible")
    assert not page.is_visible("#createEventForm")
    assert page.evaluate("localStorage.getItem('emrs_token')") is None


# --- Accessibility and responsiveness ---------------------------------------

def test_form_controls_have_labels(page, unique_email):
    """TC-EVT-FE-16: every input is reachable by its label."""
    sign_in_as(page, unique_email, "Organizer")
    page.click("#tabCreateEvent")
    for label in ("Event Title", "Description", "Category", "Date & Time", "Max Capacity", "Ticket Price", "Ticket details"):
        assert page.get_by_label(label, exact=False).count() >= 1, label
    assert page.get_by_label("Physical").is_checked()


@pytest.mark.parametrize("width,height", [(360, 640), (768, 1024), (1440, 900)])
def test_form_fits_viewport_without_horizontal_scroll(browser, server_url, unique_email, width, height):
    """TC-EVT-FE-17: works at mobile, tablet and desktop widths."""
    ctx = browser.new_context(viewport={"width": width, "height": height})
    pg = ctx.new_page()
    pg.goto(server_url)
    sign_in_as(pg, unique_email, "Organizer")
    pg.click("#tabCreateEvent")
    assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    pg.locator("#btnSubmitEvent").scroll_into_view_if_needed()
    assert pg.locator("#btnSubmitEvent").is_visible()
    ctx.close()
