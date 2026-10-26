"""Shared helpers for the browser tests."""
import datetime as dt
import json

PASSWORD = "Passw0rdX1"


def future_datetime(days=30):
    """A datetime-local value (YYYY-MM-DDTHH:MM) safely in the future."""
    return (dt.datetime.now() + dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M")


def api_post(page, path, body, token=None):
    """POST JSON from the page's origin and return (status, json)."""
    return page.evaluate(
        """async ([path, body, token]) => {
            const headers = {'Content-Type': 'application/json'};
            if (token) headers.Authorization = 'Bearer ' + token;
            const r = await fetch(path, {method: 'POST', headers, body: JSON.stringify(body)});
            return [r.status, await r.json().catch(() => ({}))];
        }""",
        [path, body, token],
    )


def sign_in_as(page, email, role):
    """Create an account through the API, store its session token and reload the page."""
    status, _ = api_post(page, "/api/auth/register", {"name": "Test User", "email": email, "role": role, "password": PASSWORD})
    assert status == 201
    status, data = api_post(page, "/api/auth/login", {"email": email, "password": PASSWORD})
    assert status == 200
    page.evaluate("t => localStorage.setItem('emrs_token', t)", data["token"])
    page.reload()
    page.wait_for_selector("#userBadge", state="visible")
    return data["token"]


def list_events(page):
    return json.loads(page.evaluate("async () => JSON.stringify((await (await fetch('/api/events')).json()).events)"))


def fill_event(page, **overrides):
    values = dict(
        title="Campus Hack Night",
        description="An overnight hackathon.",
        category="Technical",
        date=future_datetime(),
        venue="Auditorium Hall A",
        capacity="100",
        price="150",
        ticket_details="",
        virtual=False,
    )
    values.update(overrides)
    page.click("#tabCreateEvent")
    page.wait_for_selector("#createEventTab.active")
    page.fill("#eventTitle", values["title"])
    page.fill("#eventDescription", values["description"])
    page.select_option("#eventCategory", values["category"])
    page.fill("#eventDate", values["date"])
    page.check("#venueTypeVirtual" if values["virtual"] else "#venueTypePhysical")
    page.fill("#eventVenue", values["venue"])
    page.fill("#eventCapacity", values["capacity"])
    page.fill("#eventPrice", values["price"])
    page.fill("#eventTicketDetails", values["ticket_details"])
