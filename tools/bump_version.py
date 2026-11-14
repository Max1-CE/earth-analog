# SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
# SPDX-License-Identifier: MIT

"""Set a new cache-busting version for the site (run before each push).

GitHub Pages lets browsers cache every file for 10 minutes. Without a version,
a browser can combine a new index.html with an old js/app.js right after a
deploy. This script:
  - writes a new version (UTC timestamp) into <meta name="app-version">,
  - appends ?v=<version> to css/style.css and js/app.js in index.html,
  - does the same for infographic.html (css/style.css, js/infographic.js),
  - regenerates the import map so every module in js/ is loaded as js/x.js?v=<version>
    (relative imports such as './data.js' inside the modules are remapped too).
js/data.js reads the same meta tag and appends ?v= to the CSV / JSON requests.

Usage:  python tools/bump_version.py          # new timestamp version
        python tools/bump_version.py 1.2.3    # explicit version
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"

version = sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
if not re.fullmatch(r"[0-9A-Za-z._-]+", version):
    sys.exit(f"bad version: {version!r}")

html = INDEX.read_text(encoding="utf-8")

# 1) meta tag
html, n_meta = re.subn(r'(<meta name="app-version" content=")[^"]*(">)', rf"\g<1>{version}\2", html)
if not n_meta:
    sys.exit('index.html has no <meta name="app-version" content="...">')

# 2) stylesheet and entry script
html = re.sub(r'href="css/style\.css(\?v=[^"]*)?"', f'href="css/style.css?v={version}"', html)
html = re.sub(r'src="js/app\.js(\?v=[^"]*)?"', f'src="js/app.js?v={version}"', html)

# 3) import map for all modules in js/
modules = sorted(p.name for p in (ROOT / "js").glob("*.js"))
imports = {f"./js/{m}": f"./js/{m}?v={version}" for m in modules}
block = (
    '<script type="importmap" id="app-importmap">\n'
    + json.dumps({"imports": imports}, indent=2)
    + "\n  </script>"
)
html, n_map = re.subn(r'<script type="importmap" id="app-importmap">.*?</script>', block, html, flags=re.S)
if not n_map:
    sys.exit('index.html has no <script type="importmap" id="app-importmap">')

INDEX.write_text(html, encoding="utf-8")

# 4) infographic.html: standalone page (no import map; js/infographic.js has no imports)
INFO = ROOT / "infographic.html"
if INFO.exists():
    page = INFO.read_text(encoding="utf-8")
    page = re.sub(r'(<meta name="app-version" content=")[^"]*(">)', rf"\g<1>{version}\2", page)
    page = re.sub(r'href="css/style\.css(\?v=[^"]*)?"', f'href="css/style.css?v={version}"', page)
    page = re.sub(r'src="js/infographic\.js(\?v=[^"]*)?"', f'src="js/infographic.js?v={version}"', page)
    INFO.write_text(page, encoding="utf-8")
print(f"version {version}: {len(modules)} modules ({', '.join(modules)})")
