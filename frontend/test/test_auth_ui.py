"""EMT-25: browser tests for the registration and login pages."""
import pytest

PASSWORD = "Passw0rdX1"


def open_modal(page, tab="Sign In"):
    page.click("#btnOpenAuthModal")
    if tab != "Sign In":
        page.click("#modalTabRegister")
    page.wait_for_selector("#authModal.active")


def fill_register(page, name="Test User", email="a@example.com", phone="", role="Attendee", password=PASSWORD):
    page.fill("#regName", name)
    page.fill("#regEmail", email)
    page.fill("#regPhone", phone)
    page.select_option("#regRole", role)
    page.fill("#regPassword", password)


def register_and_login(page, email, role="Attendee"):
    open_modal(page, "Create Account")
    fill_register(page, email=email, role=role)
    page.click("#btnSubmitRegister")
    page.wait_for_selector("#loginForm.active")
    page.fill("#loginPassword", PASSWORD)
    page.click("#btnSubmitLogin")
    page.wait_for_selector("#userBadge", state="visible")


# --- Registration -----------------------------------------------------------

def test_register_then_login_from_browser(page, unique_email):
    """TC-FE-01: a new user can register and then log in."""
    register_and_login(page, unique_email)
    assert page.inner_text("#userName") == "Test User"
    assert page.inner_text("#userRoleBadge") == "Attendee"
    assert page.evaluate("localStorage.getItem('emrs_token')")


def test_register_prefills_login_email(page, unique_email):
    """TC-FE-02: after registering, the login tab has the email prefilled."""
    open_modal(page, "Create Account")
    fill_register(page, email=unique_email)
    page.click("#btnSubmitRegister")
    page.wait_for_selector("#loginForm.active")
    assert page.input_value("#loginEmail") == unique_email


@pytest.mark.parametrize(
    "field,kwargs,error_id",
    [
        ("name", {"name": "A"}, "#regNameError"),
        ("email", {"email": "bademail"}, "#regEmailError"),
        ("phone", {"phone": "12345"}, "#regPhoneError"),
        ("password", {"password": "short1"}, "#regPasswordError"),
        ("password", {"password": "onlyletters"}, "#regPasswordError"),
    ],
)
def test_register_invalid_input_shows_inline_error_without_reload(page, field, kwargs, error_id):
    """TC-FE-03: invalid input shows an inline message and does not reload or call the API."""
    calls = []
    page.on("request", lambda r: calls.append(r.url) if "/api/auth/register" in r.url else None)
    page.evaluate("window.__marker = 'still-here'")
    open_modal(page, "Create Account")
    fill_register(page, **kwargs)
    page.click("#btnSubmitRegister")
    err = page.locator(error_id)
    assert err.is_visible()
    assert err.inner_text().strip() != ""
    assert page.evaluate("window.__marker") == "still-here"  # no page reload
    assert calls == []  # blocked client-side


def test_register_duplicate_email_shows_inline_error(page, unique_email):
    """TC-FE-04: server 409 is shown under the email field."""
    open_modal(page, "Create Account")
    fill_register(page, email=unique_email)
    page.click("#btnSubmitRegister")
    page.wait_for_selector("#loginForm.active")
    page.click("#modalTabRegister")
    fill_register(page, email=unique_email)
    page.click("#btnSubmitRegister")
    page.wait_for_selector("#regEmailError:not([hidden])")
    assert "already exists" in page.inner_text("#regEmailError")


def test_register_server_field_errors_are_inline(page):
    """TC-FE-05: when the server returns `fields`, each message appears under its input."""
    page.route(
        "**/api/auth/register",
        lambda route: route.fulfill(
            status=400,
            content_type="application/json",
            body='{"error":"Validation failed","fields":{"email":"Server says bad email","phone":"Server says bad phone"}}',
        ),
    )
    open_modal(page, "Create Account")
    fill_register(page)
    page.click("#btnSubmitRegister")
    page.wait_for_selector("#regEmailError:not([hidden])")
    assert page.inner_text("#regEmailError") == "Server says bad email"
    assert page.inner_text("#regPhoneError") == "Server says bad phone"


def test_submit_button_disabled_while_request_in_flight(page, unique_email):
    """TC-FE-06: the submit button is disabled during the request (no double submit)."""
    seen = {}

    def slow(route):
        seen["disabled"] = page.evaluate("document.getElementById('btnSubmitRegister').disabled")
        route.continue_()

    page.route("**/api/auth/register", slow)
    open_modal(page, "Create Account")
    fill_register(page, email=unique_email)
    page.click("#btnSubmitRegister")
    page.wait_for_selector("#loginForm.active")
    assert seen["disabled"] is True
    assert page.is_enabled("#btnSubmitRegister")


# --- Login / session --------------------------------------------------------

def test_login_wrong_password_shows_inline_error(page, unique_email):
    """TC-FE-07: invalid credentials show an inline message, user stays signed out."""
    open_modal(page, "Create Account")
    fill_register(page, email=unique_email)
    page.click("#btnSubmitRegister")
    page.wait_for_selector("#loginForm.active")
    page.fill("#loginPassword", "WrongPass99")
    page.click("#btnSubmitLogin")
    page.wait_for_selector("#loginFormError:not([hidden])")
    assert "Invalid email or password" in page.inner_text("#loginFormError")
    assert not page.is_visible("#userBadge")


def test_login_empty_fields_show_inline_errors(page):
    """TC-FE-08: empty login shows field errors without calling the API."""
    calls = []
    page.on("request", lambda r: calls.append(r.url) if "/api/auth/login" in r.url else None)
    open_modal(page)
    page.click("#btnSubmitLogin")
    assert page.locator("#loginEmailError").is_visible()
    assert page.locator("#loginPasswordError").is_visible()
    assert calls == []


def test_login_lockout_message_is_shown(page):
    """TC-FE-09: the 429 lockout message from the server is shown inline."""
    page.route(
        "**/api/auth/login",
        lambda route: route.fulfill(
            status=429,
            content_type="application/json",
            body='{"error":"Too many failed attempts. Account temporarily locked."}',
        ),
    )
    open_modal(page)
    page.fill("#loginEmail", "a@example.com")
    page.fill("#loginPassword", "whatever1")
    page.click("#btnSubmitLogin")
    page.wait_for_selector("#loginFormError:not([hidden])")
    assert "temporarily locked" in page.inner_text("#loginFormError")


def test_session_persists_after_reload_and_logout_clears_it(page, unique_email):
    """TC-FE-10: token is stored and reused after reload; logout removes it."""
    register_and_login(page, unique_email)
    page.reload()
    page.wait_for_selector("#userBadge", state="visible")
    page.click("#btnLogout")
    page.wait_for_selector("#btnOpenAuthModal", state="visible")
    assert page.evaluate("localStorage.getItem('emrs_token')") is None
    assert not page.is_visible("#userBadge")


def test_unreachable_server_does_not_fake_login(page):
    """TC-FE-11: if /api/auth/me fails to connect, the user must not appear signed in."""
    page.evaluate("localStorage.setItem('emrs_token', 'abc')")
    page.route("**/api/auth/me", lambda route: route.abort())
    page.reload()
    page.wait_for_selector("#btnOpenAuthModal", state="visible")
    assert not page.is_visible("#userBadge")


def test_invalid_stored_token_is_discarded(page):
    """TC-FE-12: a rejected token is removed and the signed-out UI is shown."""
    page.evaluate("localStorage.setItem('emrs_token', 'not-a-real-token')")
    page.reload()
    page.wait_for_selector("#btnOpenAuthModal", state="visible")
    assert page.evaluate("localStorage.getItem('emrs_token')") is None


# --- Accessibility and responsiveness ---------------------------------------

def test_modal_dialog_semantics_and_escape_closes(page):
    """TC-FE-13: dialog role/aria, focus moves in, Escape closes and returns focus."""
    page.focus("#btnOpenAuthModal")
    open_modal(page)
    assert page.get_attribute("#authModal", "role") == "dialog"
    assert page.get_attribute("#authModal", "aria-modal") == "true"
    assert page.get_attribute("#modalClose", "aria-label") == "Close dialog"
    assert page.evaluate("document.activeElement.id") == "loginEmail"
    page.keyboard.press("Escape")
    assert not page.locator("#authModal.active").count()
    assert page.evaluate("document.activeElement.id") == "btnOpenAuthModal"


def test_focus_is_trapped_in_modal(page):
    """TC-FE-14: Tab never leaves the open dialog."""
    open_modal(page)
    for _ in range(12):
        page.keyboard.press("Tab")
        assert page.evaluate("document.getElementById('authModal').contains(document.activeElement)")


def test_autocomplete_attributes(page):
    """TC-FE-15: password managers can fill the forms correctly."""
    assert page.get_attribute("#loginPassword", "autocomplete") == "current-password"
    assert page.get_attribute("#regPassword", "autocomplete") == "new-password"
    assert page.get_attribute("#loginEmail", "autocomplete") == "email"


def test_keyboard_only_login(page, unique_email):
    """TC-FE-16: the whole login flow works with the keyboard (Enter submits)."""
    register_and_login(page, unique_email)
    page.click("#btnLogout")
    page.wait_for_selector("#btnOpenAuthModal", state="visible")
    page.focus("#btnOpenAuthModal")
    page.keyboard.press("Enter")
    page.fill("#loginEmail", unique_email)
    page.keyboard.press("Tab")
    page.keyboard.type(PASSWORD)
    page.keyboard.press("Enter")
    page.wait_for_selector("#userBadge", state="visible")


@pytest.mark.parametrize("width,height", [(360, 640), (768, 1024), (1440, 900)])
def test_modal_fits_viewport_without_horizontal_scroll(browser, server_url, width, height):
    """TC-FE-17: works at mobile, tablet and desktop widths."""
    ctx = browser.new_context(viewport={"width": width, "height": height})
    pg = ctx.new_page()
    pg.goto(server_url)
    open_modal(pg, "Create Account")
    box = pg.locator("#authModal .modal-dialog").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= width
    assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    # submit button must be reachable (scrolls within dialog if needed)
    pg.locator("#btnSubmitRegister").scroll_into_view_if_needed()
    assert pg.locator("#btnSubmitRegister").is_visible()
    ctx.close()
