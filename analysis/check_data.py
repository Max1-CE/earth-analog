# SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
# SPDX-License-Identifier: MIT

"""Data consistency checks → CHECKS.md (table: check | OK/FAIL | details).

Run from anywhere (after analysis/habitability.py):  python analysis/check_data.py
Exit code 1 if any check FAILs (warnings count as FAIL, as the task asks), 0 otherwise.
Nothing in data/ is changed: metrics.py is run on a copy in a temporary folder.
"""
import csv
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT / "analysis"))
import habitability as hab  # noqa: E402  (formulas under test)

AXIAL_TILT = {"Earth": 23.44, "Mars": 25.19, "Moon": 1.54}  # same ε as analysis/CHANGES.md
SUN_TOL = 0.05
METRIC_TOL = 0.001

results = []  # (check, ok, details)


def check(name, ok, details=""):
    results.append((name, bool(ok), details))


def read_csv(name):
    with open(DATA / name, encoding="utf-8-sig", newline="") as f:
        return [r for r in csv.DictReader(f) if not next(iter(r.values()), "").startswith("#")]


def num(v):
    try:
        return float((v or "").strip())
    except ValueError:
        return None


sites = read_csv("sites.csv")
by_id = {s["site_id"]: s for s in sites}
limits = json.loads((DATA / "limits.json").read_text(encoding="utf-8"))
limits_uk = json.loads((DATA / "limits_uk.json").read_text(encoding="utf-8"))
const = json.loads((DATA / "habitability_constants.json").read_text(encoding="utf-8"))
hab_rows = read_csv("habitability.csv")

# ------------------------------------------------------------------ sites.csv
ids = [s["site_id"] for s in sites]
dups = [k for k, n in Counter(ids).items() if n > 1]
check("sites.csv: site_id unique", not dups, f"{len(ids)} rows" + (f"; duplicates: {dups}" if dups else ""))

bad = [f"{s['site_id']}→{s['pair_id']}" for s in sites if s["pair_id"]
       and (s["pair_id"] not in by_id or by_id[s["pair_id"]]["role"] != "reference")]
check("sites.csv: pair_id points to an existing reference", not bad, ", ".join(bad) or "all analogs paired")

bad = [f"{s['site_id']}={s['body']}" for s in sites if s["body"] not in ("Earth", "Mars", "Moon")]
check("sites.csv: body ∈ {Earth, Mars, Moon}", not bad, ", ".join(bad))

bad = [s["site_id"] for s in sites if not (-90 <= num(s["lat"]) <= 90 and -180 <= num(s["lon"]) <= 180)]
check("sites.csv: lat ∈ [−90, 90], lon ∈ [−180, 180]", not bad, ", ".join(bad))

bad = []
for s in sites:
    lo, mean, hi = num(s["t_surf_min_c"]), num(s["t_surf_mean_c"]), num(s["t_surf_max_c"])
    if None in (lo, mean, hi):
        bad.append(f"{s['site_id']}: missing")
    elif not lo <= mean <= hi:
        bad.append(f"{s['site_id']}: {lo} / {mean} / {hi}")
check("sites.csv: t_surf_min ≤ t_surf_mean ≤ t_surf_max", not bad, "; ".join(bad))

with open(DATA / "rock_similarity.csv", encoding="utf-8-sig", newline="") as f:
    rock_classes = {r[0] for r in list(csv.reader(f))[1:] if r}
bad = sorted({s["rock_class"] for s in sites if s["rock_class"] and s["rock_class"] not in rock_classes})
check("sites.csv: rock_class is in rock_similarity.csv", not bad, ", ".join(bad) or f"{len(rock_classes)} classes")

# ------------------------------------------------------------------ solar elevation
bad, n = [], 0
for s in sites:
    if s["site_id"] == "MOON-SHK-PSR":  # topographic_shadow: set by hand, not from latitude
        continue
    phi, eps = abs(num(s["lat"])), AXIAL_TILT[s["body"]]
    exp_max = 90 - max(0.0, phi - eps)
    exp_min = 90 - (phi + eps)
    for col, exp in (("sun_elev_max_deg", exp_max), ("sun_elev_min_deg", exp_min)):
        v = num(s[col])
        n += 1
        if v is None or abs(v - exp) > SUN_TOL:
            bad.append(f"{s['site_id']} {col}: CSV {v}, expected {exp:.2f}")
check(f"Solar elevation = 90 − |φ| ± ε (tolerance {SUN_TOL}°, MOON-SHK-PSR excluded)", not bad,
      "; ".join(bad) or f"{n} values match")

# ------------------------------------------------------------------ metric reproduces
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    (tmp / "analysis").mkdir()
    shutil.copytree(DATA, tmp / "data", ignore=shutil.ignore_patterns("raw"))
    shutil.copy(ROOT / "analysis/metrics.py", tmp / "analysis/metrics.py")
    run = subprocess.run([sys.executable, "-I", str(tmp / "analysis/metrics.py")], capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    if run.returncode:
        check("metrics.py reproduces scores.csv / ranking.csv", False, run.stderr.strip().splitlines()[-1])
    else:
        for name in ("scores.csv", "ranking.csv"):
            with open(DATA / name, encoding="utf-8-sig", newline="") as f:
                old = list(csv.DictReader(f))
            with open(tmp / "data" / name, encoding="utf-8-sig", newline="") as f:
                new = list(csv.DictReader(f))
            diffs = []
            if len(old) != len(new):
                diffs.append(f"{len(old)} vs {len(new)} rows")
            for a, b in zip(old, new):
                for k in a:
                    x, y = num(a[k]), num(b.get(k))
                    if x is None and y is None:
                        if a[k] != b.get(k):
                            diffs.append(f"{k}: {a[k]} vs {b.get(k)}")
                    elif x is None or y is None or abs(x - y) >= METRIC_TOL:
                        diffs.append(f"{a.get('analog_id')}/{a.get('reference_id')} {k}: {a[k]} vs {b.get(k)}")
            check(f"metrics.py reproduces {name} (|Δ| < {METRIC_TOL})", not diffs,
                  "; ".join(diffs[:5]) or f"{len(old)} rows identical within tolerance")

# ------------------------------------------------------------------ formula unit tests
for p, want, tol in ((611.657, 0.01, 1), (850, 4.6, 1), (101325, 100, 1)):
    got = hab.t_boil_c(p)
    check(f"T_boil({p:g} Pa) ≈ {want} °C (±{tol})", got is not None and abs(got - want) <= tol, f"{got:.3f} °C")
got = hab.solar_max("Mars", 90)
check("Solar max on Mars at h = 90° ≈ 586 W/m² (±1)", abs(got - 586) <= 1, f"{got:.1f} W/m²")
check("No liquid water below the triple point", hab.t_boil_c(600) is None, "T_boil(600 Pa) = None")

# ------------------------------------------------------------------ consistency between files
def factor(lim, body, fid):
    return next(f for f in lim[body]["factors"] if f["id"] == fid)


mars_rad = factor(limits, "mars", "radiation")["target"]
m = re.search(r"([\d.]+)\s*-\s*([\d.]+)\s*mSv/day", mars_rad)
lo, hi = (float(m.group(1)), float(m.group(2))) if m else (None, None)
vals = sorted({num(s["radiation_msv_day"]) for s in sites if s["body"] == "Mars"})
check("Mars radiation in sites.csv within limits.json range", m and all(lo <= v <= hi for v in vals),
      f"sites {vals} mSv/day; limits.json {lo}–{hi}")

moon_rad = factor(limits, "moon", "radiation")["target"]
m = re.search(r"([\d.]+)\s*mSv/day", moon_rad)
vals = sorted({num(s["radiation_msv_day"]) for s in sites if s["body"] == "Moon"})
check("Moon radiation in sites.csv = limits.json", m and vals == [float(m.group(1))],
      f"sites {vals}; limits.json {m.group(1) if m else 'not found'} mSv/day")

g_bad = []
for body, key in (("Mars", "mars"), ("Moon", "moon")):
    g = const["bodies"][body]["gravity_m_s2"]
    for lim, lang in ((limits, "en"), (limits_uk, "uk")):
        f = factor(lim, key, "gravity")
        txt = (f["target"] + " " + f["earth"]).replace(",", ".")
        found = [float(x) for x in re.findall(r"(\d+\.\d+)\s*(?:m/s|м/с)", txt)]
        if g not in found:
            g_bad.append(f"{body} {lang}: {found} vs {g}")
        if const["bodies"]["Earth"]["gravity_m_s2"] not in found:
            g_bad.append(f"Earth ({key}, {lang}): {found}")
hab_g = {(r["body"], num(r["gravity_m_s2"])) for r in hab_rows}
if len({b for b, _ in hab_g}) != len(hab_g):
    g_bad.append(f"habitability.csv not constant per body: {sorted(hab_g)}")
check("Gravity identical in habitability.py, habitability.csv, limits.json, limits_uk.json", not g_bad,
      "; ".join(g_bad) or "Earth 9.81, Mars 3.71, Moon 1.62 m/s²")

mean = const["mars_mean_pressure_pa"]["value"]
vals = sorted(num(s["pressure_pa"]) for s in sites if s["body"] == "Mars")
check("Mars pressure: site values vs planetary mean (limits.json)", True,
      f"sites {vals[0]:g}–{vals[-1]:g} Pa vs ~{mean:g} Pa mean — expected: sites lie below the mean datum; "
      "explained on the infographic (site value vs planetary mean)")

moon_p = sorted({num(s["pressure_pa"]) for s in sites if s["body"] == "Moon"})
nssdc = const["moon_pressure_nssdc_pa"]["value"]
check("Moon pressure: limits.json vs NASA NSSDC (warning)", False,
      f"sites.csv / limits.json {moon_p} Pa vs NSSDC night {nssdc:g} Pa (×{nssdc / moon_p[0]:.0f}); "
      "team to decide — TODO.md section 7")

# ------------------------------------------------------------------ hard-coded numbers in the site
sentinels = set()
for s in sites:
    for col in ("pressure_pa", "co2_pct", "o2_pct", "radiation_msv_day"):
        if s[col]:
            sentinels.add(s[col])
for v in (hab.SOLAR_CONSTANT_W_M2, hab.TRIPLE_POINT_PA, hab.ARMSTRONG_LIMIT_PA, *hab.GRAVITY_M_S2.values(),
          hab.SUN_DISTANCE_AU["Mars"], hab.MOON_PRESSURE_NSSDC_PA, hab.SEA_LEVEL_PA):
    sentinels.add(repr(v) if isinstance(v, float) and not float(v).is_integer() else str(int(v)) if float(v).is_integer() else repr(v))
sentinels = {v for v in sentinels if v not in ("0", "1")}  # too common to mean anything
# Lines that set colour / transparency use small numbers like 0.15 that can coincide with data.
STYLE_CONTEXT = re.compile(r"globalAlpha|withAlpha|hexAlpha|opacity|rgba?\(|lineWidth")
hits, ignored = [], []
for path in [ROOT / "index.html", ROOT / "infographic.html", *sorted((ROOT / "js").glob("*.js"))]:
    if not path.exists():
        continue
    in_block = False
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        # comments may cite numbers as examples: skip // …, /* … */ and <!-- … --> blocks
        stripped = line.strip()
        if in_block or stripped.startswith(("/*", "*", "<!--")):
            in_block = not ("*/" in stripped or "-->" in stripped) and (in_block or stripped.startswith(("/*", "<!--")))
            continue
        code = re.sub(r"//.*$", "", line)
        for v in sentinels:
            if re.search(rf"(?<![\w.#-]){re.escape(v)}(?![\w.])", code):
                where = f"{path.relative_to(ROOT).as_posix()}:{i} `{v}`"
                (ignored if STYLE_CONTEXT.search(code) else hits).append(where)
check("Site HTML/JS has no hard-coded data values", not hits,
      "; ".join(hits[:10]) or f"searched {len(sentinels)} values in index.html, infographic.html, js/*.js"
      + (f"; ignored (colour/opacity): {', '.join(ignored)}" if ignored else ""))

# ------------------------------------------------------------------ what-if (analysis/what_if.py)
if (DATA / "what_if.csv").exists():
    import what_if as wi  # noqa: E402

    wif = read_csv("what_if.csv")
    ivs = {i["intervention_id"]: i for i in read_csv("interventions.csv")}
    defaults = [r for r in wif if r["intervention_id"] == "default"]
    analog_ids = [s["site_id"] for s in sites if s["role"] == "analog"]

    bad = [r["analog_id"] for r in defaults if r["reference_id"] != by_id[r["analog_id"]]["pair_id"]]
    bad += [f"{a}: no default row" for a in analog_ids if a not in {r["analog_id"] for r in defaults}]
    check("what_if.csv: every Earth analog has a default plan for its pair_id", not bad,
          ", ".join(bad) or f"{len(defaults)} analogs")

    bad = []
    for r in wif:
        if r["in_default"] != "true" or r["intervention_id"] == "default":
            continue
        if r["class"] != "field":
            bad.append(f"{r['analog_id']}: {r['intervention_id']} is {r['class']}")
        if not r["weak_criteria"]:
            bad.append(f"{r['analog_id']}: {r['intervention_id']} touches no criterion < {wi.THRESHOLD}")
    check(f"what_if.csv: default plan = field interventions for criteria < {wi.THRESHOLD} only", not bad, "; ".join(bad))

    bad = []
    for d in defaults:
        plan = sorted((r for r in wif if r["analog_id"] == d["analog_id"] and r["in_default"] == "true"
                       and r["intervention_id"] != "default"), key=lambda r: int(r["default_rank"]))
        gpe = [num(r["gain_per_effort"]) for r in plan]
        if gpe != sorted(gpe, reverse=True):
            bad.append(f"{d['analog_id']}: not sorted by gain_per_effort")
        last = num(plan[-1]["score_after_cumulative"]) if plan else num(d["score_before"])
        if abs(last - num(d["score_after"])) >= METRIC_TOL:
            bad.append(f"{d['analog_id']}: cumulative {last} vs default {d['score_after']}")
    check("what_if.csv: plan order by gain_per_effort; last step = default score_after", not bad, "; ".join(bad))

    # recompute everything with the real metrics.py and compare
    fresh, _ = wi.compute()
    key = lambda r: (r["analog_id"], r["intervention_id"])  # noqa: E731
    fresh_by = {key(r): r for r in fresh}
    bad = []
    for r in wif:
        f = fresh_by.get(key(r))
        if f is None:
            bad.append(f"{key(r)} missing after recompute")
            continue
        for col in ("score_before", "score_after", "score_after_cumulative"):
            x, y = num(r[col]), num(f[col])
            if (x is None) != (y is None) or (x is not None and abs(x - y) >= METRIC_TOL):
                bad.append(f"{key(r)} {col}: {r[col]} vs {f[col]}")
    check(f"what_if.csv: score_after reproduces with metrics.py (|Δ| < {METRIC_TOL})", not bad,
          "; ".join(bad[:5]) or f"{len(wif)} rows")

    already = [d["analog_id"] for d in defaults if not d["weak_criteria"]]
    check("what_if.csv: analogs with no criterion < 0.5 (\"Already a close analog\")", True,
          ", ".join(already) or "none in the current data")

# ------------------------------------------------------------------ photos
bad = [s["site_id"] for s in sites if s["photo_url"] and not (s["photo_author"] and s["photo_license"])]
n = sum(1 for s in sites if s["photo_url"])
check("Every photo_url has photo_author and photo_license", not bad, ", ".join(bad) or f"{n} photos")

# ------------------------------------------------------------------ status summary
status_cols = [c for c in sites[0] if c.startswith("status_")]
flagged = []
for s in sites:
    for c in status_cols:
        v = s[c]
        kind = hab.status_kind(v) if c == "status_life" else (
            "test" if v == "test" else "estimate" if v.startswith("estimate") else "check" if v == "check" else None)
        if kind in ("test", "estimate", "check"):
            flagged.append((kind, s["site_id"], c, v))
summary = Counter(k for k, *_ in flagged)

# ------------------------------------------------------------------ CHECKS.md
fails = [r for r in results if not r[1]]
lines = [
    "# CHECKS — data consistency",
    "",
    f"Generated by `python analysis/check_data.py` on {date.today().isoformat()}. "
    f"**{len(results) - len(fails)} OK, {len(fails)} FAIL.** Data files are not modified by the checks.",
    "",
    "| Check | Result | Details |",
    "|---|---|---|",
]
for name, ok, details in results:
    cell = lambda t: t.replace("|", r"\|")  # keep '|' in |φ|, |Δ| from splitting the table
    lines.append(f"| {cell(name)} | {'OK' if ok else '**FAIL**'} | {cell(details)} |")
lines += [
    "",
    "## Values still marked test / estimate / check",
    "",
    f"Total: {sum(summary.values())} — test {summary['test']}, estimate {summary['estimate']}, check {summary['check']}.",
    "",
    "| Status | Site | Column | Value |",
    "|---|---|---|---|",
]
for kind, sid, col, v in sorted(flagged):
    lines.append(f"| {kind} | {sid} | `{col}` | {v} |")
(ROOT / "CHECKS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
for name, ok, details in results:
    print(f"{'OK  ' if ok else 'FAIL'}  {name}" + (f"  — {details}" if not ok else ""))
print(f"\n{len(results) - len(fails)} OK, {len(fails)} FAIL → CHECKS.md")
sys.exit(1 if fails else 0)
