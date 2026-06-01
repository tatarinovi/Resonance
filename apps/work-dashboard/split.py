import os

base_dir = r"c:\Users\katamy\Documents\Coding\Server\dashboard\work-dashboard"
js_dir = os.path.join(base_dir, "js")
css_dir = os.path.join(base_dir, "css")

os.makedirs(js_dir, exist_ok=True)
os.makedirs(css_dir, exist_ok=True)

with open(os.path.join(base_dir, "app.js"), "r", encoding="utf-8") as f:
    js_lines = f.readlines()

def get_js(start, end):
    # start and end are 1-indexed line numbers
    return "".join(js_lines[start-1:end]) + "\n"

state_js = get_js(1, 49) + get_js(497, 518)
api_js = get_js(116, 147) + get_js(296, 379) + get_js(380, 496) + get_js(558, 631)
cache_js = get_js(148, 295)
auth_js = get_js(65, 115)
ui_js = get_js(50, 64) + get_js(519, 557) + get_js(632, 798) + get_js(799, 809) + get_js(810, 894) + get_js(895, 1468) + get_js(1503, 1639) + get_js(1640, 1669) + get_js(1670, 1771) + get_js(1772, 1862) + get_js(1863, 1968)
app_js = get_js(1469, 1502) + get_js(1969, 2007)

with open(os.path.join(js_dir, "state.js"), "w", encoding="utf-8") as f: f.write(state_js)
with open(os.path.join(js_dir, "api.js"), "w", encoding="utf-8") as f: f.write(api_js)
with open(os.path.join(js_dir, "cache.js"), "w", encoding="utf-8") as f: f.write(cache_js)
with open(os.path.join(js_dir, "auth.js"), "w", encoding="utf-8") as f: f.write(auth_js)
with open(os.path.join(js_dir, "ui.js"), "w", encoding="utf-8") as f: f.write(ui_js)
with open(os.path.join(js_dir, "app.js"), "w", encoding="utf-8") as f: f.write(app_js)

with open(os.path.join(base_dir, "style.css"), "r", encoding="utf-8") as f:
    css_lines = f.readlines()

def get_css(start, end):
    return "".join(css_lines[start-1:end]) + "\n"

layout_css = get_css(1, 43) + get_css(190, 205) + get_css(312, 359) + get_css(715, 723)
components_css = get_css(44, 189) + get_css(690, 714) + get_css(724, 793)
modals_css = get_css(206, 311) + get_css(960, 1130)
detail_css = get_css(360, 689) + get_css(794, 959) + get_css(1131, len(css_lines))

with open(os.path.join(css_dir, "layout.css"), "w", encoding="utf-8") as f: f.write(layout_css)
with open(os.path.join(css_dir, "components.css"), "w", encoding="utf-8") as f: f.write(components_css)
with open(os.path.join(css_dir, "modals.css"), "w", encoding="utf-8") as f: f.write(modals_css)
with open(os.path.join(css_dir, "detail.css"), "w", encoding="utf-8") as f: f.write(detail_css)

print("Split completed successfully.")
