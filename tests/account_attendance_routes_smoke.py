from pathlib import Path

root = Path(__file__).resolve().parents[1]
worker = (root / "src" / "index.ts").read_text()
home = (root / "public" / "index.html").read_text()
account = (root / "public" / "account.html").read_text()
account_js = (root / "public" / "account.js").read_text()
attendance = (root / "public" / "attendance.html").read_text()
attendance_js = (root / "public" / "attendance.js").read_text()
invitation_js = (root / "public" / "invitation.js").read_text()
styles = (root / "public" / "styles.css").read_text()

for route in [
    '"/account": "account.html"',
    '"/account/": "account.html"',
    '"/prezenta": "attendance.html"',
    '"/prezenta/": "attendance.html"',
]:
    assert route in worker, f"Missing static route mapping: {route}"

assert '<script src="/account.js" defer></script>' in account
assert '<script src="/attendance.js" defer></script>' in attendance
assert '<a id="account-settings-toggle" href="/account"' in home
assert 'href="/prezenta">Deschide prezența</a>' in home
assert 'href="/invitation">Deschide invitații, contacte și membri</a>' in home

# Account settings must not add the phone form to the first screen; it is revealed by one button.
assert 'id="phone-change-toggle"' in account and 'Schimbă numărul' in account
assert 'id="phone-change-panel" class="phone-change-panel" hidden' in account
assert ".account-page-content[hidden], .attendance-page-content[hidden]" in styles
assert "document.documentElement.dataset.accentTheme" in (root / "public" / "app.js").read_text()
assert 'id="phone-form"' not in home, "Phone form should not remain on the main dashboard"
assert 'id="preferences-form"' not in home, "Palette form should be on /account"

# Attendance is now an independently addressable page, and exports remain client-side.
assert 'id="attendance-form"' in attendance
assert 'id="attendance-export-xlsx"' in attendance
assert 'id="attendance-export-md"' in attendance
assert 'downloadAttendanceXlsx(matrix)' in attendance_js
assert 'downloadAttendanceMarkdown(matrix)' in attendance_js
assert '"/api/conductor/attendance"' in attendance_js
assert '"/api/account/preferences"' in account_js
assert 'await applySavedAccentTheme()' in invitation_js

# Bright palette colours, including the requested coral, must be wired to the saved theme.
for color in ["#DE7356", "#5B9BD5", "#9B8AFB", "#7DBB91", "#F3B760", "#56B9B0", "#A7B5C7", "#D778A5"]:
    assert color in styles, f"Missing palette colour: {color}"

print("Account/attendance route smoke test passed: routes, compact phone form, exports, and bright palettes.")
