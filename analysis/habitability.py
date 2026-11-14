# SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
# SPDX-License-Identifier: MIT

"""Conditions for humans at every site: "Can humans live here?" (infographic.html).

Input:  data/sites.csv (life columns from tools/import_life_xlsx.py), data/limits.json
Output: data/habitability.csv            one row per site_id
        data/habitability_constants.json physical constants, body constants, phase curve,
                                         sources — everything the infographic draws
                                         (the page itself holds no numbers)

Does NOT touch the similarity index (metrics.py / scores.csv / ranking.csv): these
parameters are the same for the whole Earth and are not part of the metric.

Run from anywhere:  python analysis/habitability.py
"""
import csv
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# ---------------------------------------------------------------- constants
# Water triple point: 611.657 Pa, 0.01 °C — IAPWS R14-08 (2011), "Revised release on the
# pressure along the melting and sublimation curves of ordinary water substance".
TRIPLE_POINT_PA = 611.657
TRIPLE_POINT_C = 0.01
# Armstrong limit ≈ 6.3 kPa: water boils at body temperature (37 °C); below it a
# pressure suit is required. NASA, "Bioastronautics Data Book" (NASA SP-3006, 1973).
ARMSTRONG_LIMIT_PA = 6300
# Solar constant (total solar irradiance at 1 AU): 1361 W/m² — Kopp & Lean 2011,
# Geophys. Res. Lett. 38, L01706.
SOLAR_CONSTANT_W_M2 = 1361
# Mean distance from the Sun, AU. Mars semi-major axis 1.524 AU — NASA NSSDC Mars Fact Sheet.
SUN_DISTANCE_AU = {"Earth": 1.0, "Moon": 1.0, "Mars": 1.524}
# Surface gravity, m/s² — NASA NSSDC Planetary Fact Sheets (Earth: standard gravity, rounded).
GRAVITY_M_S2 = {"Earth": 9.81, "Mars": 3.71, "Moon": 1.62}
# One-way light time: Moon ≈1.3 s (384 400 km / c); Mars 3–22 min depending on the
# Earth–Mars distance (0.37–2.68 AU) — NASA Mars Exploration, "Communications".
COMM_DELAY = {"Earth": "0", "Moon": "~1.3 s one way", "Mars": "~3–22 min one way"}
# Breathable air: below 19.5 % O2 at sea level the air is "oxygen-deficient" — OSHA
# 29 CFR 1910.134. As a partial pressure: 0.195 × 101 325 Pa.
O2_MIN_FRACTION = 0.195
SEA_LEVEL_PA = 101325
# Moon surface pressure, night: 3·10⁻¹⁵ bar = 3·10⁻¹⁰ Pa — NASA NSSDC Moon Fact Sheet.
# Shown next to the limits.json value; the conflict is listed in TODO.md section 7.
MOON_PRESSURE_NSSDC_PA = 3e-10

SOURCES = {
    "sites": "data/sites.csv (life columns imported from data/raw/sites_life_2.xlsx)",
    "limits": "data/limits.json (team document «Limits of the analogy»)",
    "triple_point": "IAPWS R14-08 (2011): water triple point 611.657 Pa, 0.01 °C",
    "armstrong": "NASA SP-3006 Bioastronautics Data Book (1973): Armstrong limit ≈6.3 kPa",
    "buck": "Buck, A. L. (1981, revised 1996), J. Appl. Meteor. 20: saturation vapour pressure over water",
    "solar": "Kopp & Lean (2011), GRL 38 L01706: total solar irradiance 1361 W/m² at 1 AU",
    "nssdc": "NASA NSSDC Planetary Fact Sheets (gravity, Mars distance, Moon night pressure)",
    "osha": "OSHA 29 CFR 1910.134: oxygen-deficient atmosphere below 19.5 % O₂",
    "comm": "Light time: Moon 384 400 km; Mars 0.37–2.68 AU",
}


# ---------------------------------------------------------------- formulas
def vapour_pressure_kpa(t_c):
    """Buck equation: saturation vapour pressure over liquid water, kPa (T in °C)."""
    return 0.61121 * math.exp((18.678 - t_c / 234.5) * t_c / (257.14 + t_c))


def t_boil_c(p_pa, lo=-20.0, hi=120.0):
    """Boiling point at pressure p (Pa): solves e(T) = p by bisection on [lo, hi] °C.
    Returns None below the triple point (no liquid water at any temperature)."""
    if p_pa is None or p_pa < TRIPLE_POINT_PA:
        return None
    p_kpa = p_pa / 1000
    for _ in range(200):
        mid = (lo + hi) / 2
        if vapour_pressure_kpa(mid) < p_kpa:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def solar_max(body, sun_elev_max_deg):
    """Top-of-atmosphere upper bound, W/m²: S0 / r² · sin(max(0, h)) (no air, no dust)."""
    if sun_elev_max_deg is None:
        return None
    s0 = SOLAR_CONSTANT_W_M2 / SUN_DISTANCE_AU[body] ** 2
    return s0 * math.sin(math.radians(max(0.0, sun_elev_max_deg)))


# ---------------------------------------------------------------- helpers
def num(v):
    v = (v or "").strip()
    try:
        return float(v)
    except ValueError:
        return None


def fmt(v, digits=3):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    r = round(v, digits)
    return str(int(r)) if r == int(r) and abs(r) >= 1 else repr(r)


def status_kind(status_life):
    """Badge for the life columns: literature / computed / estimate / check."""
    s = (status_life or "").strip().lower()
    if not s:
        return "check"
    if s == "check" or "звірити" in s:
        return "check"
    if s == "earth_constant" or s.startswith("оцінка") or s.startswith("estimate"):
        return "estimate"
    if s in ("literature", "computed"):
        return s
    return "check"


def mars_mean_pressure_from_limits(limits):
    """'~600 Pa (~0.6 kPa), mostly CO2' → 600 (read, not typed)."""
    target = next(f["target"] for f in limits["mars"]["factors"] if f["id"] == "atmosphere")
    m = re.search(r"([\d.]+)\s*Pa", target)
    return float(m.group(1)) if m else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(DATA / "sites.csv", encoding="utf-8-sig", newline="") as f:
        sites = [r for r in csv.DictReader(f) if not r["site_id"].startswith("#")]
    limits = json.loads((DATA / "limits.json").read_text(encoding="utf-8"))

    out = []
    for s in sites:
        body = s["body"]
        p = num(s["pressure_pa"])
        tmin, tmean, tmax = num(s["t_surf_min_c"]), num(s["t_surf_mean_c"]), num(s["t_surf_max_c"])
        tb = t_boil_c(p)
        window = tb if tb is not None else 0.0
        if p is None or tmin is None or tmax is None:
            water_now = None
        else:
            water_now = window > 0 and tmin <= tb and tmax >= 0
        sun = num(s["sun_elev_max_deg"])
        solar = 0.0 if s["site_id"] == "MOON-SHK-PSR" else solar_max(body, sun)  # permanent shadow
        rad_day = num(s["radiation_msv_day"])
        o2 = num(s["o2_pct"])
        out.append({
            "site_id": s["site_id"],
            "body": body,
            "role": s["role"],
            "pressure_pa": s["pressure_pa"],
            "o2_pct": s["o2_pct"],
            "co2_pct": s["co2_pct"],
            "o2_partial_pa": fmt(p * o2 / 100 if p is not None and o2 is not None else None, 3),
            "t_surf_min_c": s["t_surf_min_c"],
            "t_surf_mean_c": s["t_surf_mean_c"],
            "t_surf_max_c": s["t_surf_max_c"],
            "t_boil_c": fmt(tb, 2),
            "liquid_window_c": fmt(window, 2) if tb is not None else "0",
            "water_possible_now": fmt(water_now),
            "sun_elev_max_deg": s["sun_elev_max_deg"],
            "solar_max_w_m2": fmt(solar, 1),
            "gravity_m_s2": fmt(GRAVITY_M_S2[body], 2),
            "comm_delay": COMM_DELAY[body],
            "radiation_msv_day": s["radiation_msv_day"],
            "radiation_msv_year": fmt(rad_day * 365 if rad_day is not None else None, 3),
            "uvc_surface": s["uvc_surface"],
            "wind_desc_uk": s["wind_desc_uk"],
            "toxic_salts_uk": s["toxic_salts_uk"],
            "status_life": s["status_life"],
            "data_status": status_kind(s["status_life"]),
        })

    with open(DATA / "habitability.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(out)

    # Liquid–vapour curve for the phase diagram, from the triple point to 120 °C.
    curve = [{"t_c": TRIPLE_POINT_C, "p_pa": TRIPLE_POINT_PA}]
    for t in range(1, 121):
        curve.append({"t_c": t, "p_pa": round(vapour_pressure_kpa(t) * 1000, 3)})

    constants = {
        "generated_by": "analysis/habitability.py",
        "triple_point": {"p_pa": TRIPLE_POINT_PA, "t_c": TRIPLE_POINT_C, "source": "triple_point", "status": "literature"},
        "armstrong_limit_pa": {"value": ARMSTRONG_LIMIT_PA, "source": "armstrong", "status": "literature"},
        "solar_constant_w_m2": {"value": SOLAR_CONSTANT_W_M2, "source": "solar", "status": "literature"},
        "o2_breathable_min_pa": {"value": round(O2_MIN_FRACTION * SEA_LEVEL_PA, 1), "source": "osha", "status": "literature"},
        "bodies": {
            b: {"gravity_m_s2": GRAVITY_M_S2[b], "sun_distance_au": SUN_DISTANCE_AU[b], "comm_delay": COMM_DELAY[b]}
            for b in ("Earth", "Mars", "Moon")
        },
        "mars_mean_pressure_pa": {"value": mars_mean_pressure_from_limits(limits), "source": "limits", "status": "literature",
                                  "note": "planetary mean; site values differ with elevation"},
        "moon_pressure_nssdc_pa": {"value": MOON_PRESSURE_NSSDC_PA, "source": "nssdc", "status": "check",
                                   "note": "night-time value; limits.json gives ~1e-12 Pa (TODO.md section 7)"},
        "vapour_curve": curve,
        "sources": SOURCES,
    }
    (DATA / "habitability_constants.json").write_text(json.dumps(constants, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"habitability.csv: {len(out)} sites")
    for r in out:
        print(f"  {r['site_id']:<13} P={r['pressure_pa']:>8} Pa  T_boil={r['t_boil_c'] or '—':>6}  "
              f"water_now={r['water_possible_now'] or 'no data':<5}  solar={r['solar_max_w_m2']:>6} W/m²  "
              f"dose={r['radiation_msv_year']:>6} mSv/yr  [{r['data_status']}]")


if __name__ == "__main__":
    main()
