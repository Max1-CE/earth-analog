"""Add the "conditions for life" columns to data/sites.csv from data/raw/sites_life_2.xlsx.

Source: sheet «Дані», green-header columns (pressure, CO2, O2, radiation, UV-C, wind,
toxic salts, life-conditions status). Only new columns are appended; every existing
column and value of sites.csv stays exactly as it is.

Rows that are not in the xlsx:
  * Earth sites: the values are the same for the whole Earth, so they are copied from
    the Namibia rows; status_life = earth_constant.
  * Moon: radiation from data/limits.json (1.4 mSv/day, Chang'E-4), O2 = CO2 = 0,
    UV-C yes, pressure = the limits.json value (order of 1e-12 Pa); status_life = check
    (NSSDC gives a different night-time value, see TODO.md).
  * wind / toxic salts stay empty there.

Run from the repo root:  python tools/import_life_xlsx.py
Re-running is safe: it refuses to run if the columns already exist.
"""
import csv
import io
import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data/raw/sites_life_2.xlsx"
SITES = ROOT / "data/sites.csv"
LIMITS = ROOT / "data/limits.json"

NEW_COLS = ["pressure_pa", "co2_pct", "o2_pct", "radiation_msv_day", "uvc_surface",
            "wind_desc_uk", "toxic_salts_uk", "status_life"]

# xlsx header → new column (green columns of sheet «Дані»)
XLSX_COLS = {
    "Тиск атмосфери, Па": "pressure_pa",
    "CO₂ в атмосфері, %": "co2_pct",
    "O₂ в атмосфері, %": "o2_pct",
    "Радіація на поверхні, мЗв/добу": "radiation_msv_day",
    "УФ-С на поверхні": "uvc_surface",
    "Вітер": "wind_desc_uk",
    "Токсичні солі в ґрунті": "toxic_salts_uk",
    "Статус: умови для життя": "status_life",
}

ID_MAP = {
    "NAM_RK": "NAM-RK", "NAM_DUN": "NAM-DUN", "NAM_BG": "NAM-GRV",
    "MCM_TAY": "MDV-TAY", "MCM_WRI": "MDV-WRI", "MCM_DJP": "MDV-DJP", "MCM_BEA": "MDV-BEA",
    "MARS_JEZ": "MARS-JEZ", "MARS_GALE": "MARS-GALE", "MARS_PHX": "MARS-PHX",
}

EMPTY_TEXT = {"немає даних"}  # means "no value" → empty cell; other notes are kept as text


def num(v):
    """Number as written in the xlsx (no rounding, no trailing .0 for integers)."""
    if v is None or v == "":
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def uvc(v):
    s = str(v or "").strip().lower()
    if s.startswith("так"):
        return "yes"
    if s.startswith("ні"):
        return "no"
    raise ValueError(f"unexpected UV-C value: {v!r}")


def text(v):
    s = str(v or "").strip()
    return "" if s.lower() in EMPTY_TEXT else s


def read_xlsx():
    ws = openpyxl.load_workbook(XLSX, data_only=True)["Дані"]
    header = [c.value for c in ws[1]]
    idx = {name: header.index(name) for name in list(XLSX_COLS) + ["ID"]}
    rows = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r[idx["ID"]]:
            continue
        sid = ID_MAP[r[idx["ID"]]]  # KeyError = an ID the task did not map
        v = {col: r[idx[h]] for h, col in XLSX_COLS.items()}
        rows[sid] = {
            "pressure_pa": num(v["pressure_pa"]),
            "co2_pct": num(v["co2_pct"]),
            "o2_pct": num(v["o2_pct"]),
            "radiation_msv_day": num(v["radiation_msv_day"]),
            "uvc_surface": uvc(v["uvc_surface"]),
            "wind_desc_uk": text(v["wind_desc_uk"]),
            "toxic_salts_uk": text(v["toxic_salts_uk"]),
            "status_life": text(v["status_life"]),
        }
    return rows


def moon_values():
    """Radiation and pressure as written in limits.json (team file)."""
    factors = {f["id"]: f["target"] for f in json.loads(LIMITS.read_text(encoding="utf-8"))["moon"]["factors"]}
    assert "1.4 mSv/day" in factors["radiation"], factors["radiation"]
    assert "1e-12 Pa" in factors["atmosphere"], factors["atmosphere"]
    return {"pressure_pa": "1e-12", "co2_pct": "0", "o2_pct": "0", "radiation_msv_day": "1.4",
            "uvc_surface": "yes", "wind_desc_uk": "", "toxic_salts_uk": "", "status_life": "check"}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    raw = SITES.read_text(encoding="utf-8")
    lines = raw.splitlines()
    header = next(csv.reader([lines[0]]))
    if any(c in header for c in NEW_COLS):
        sys.exit("sites.csv already has the life columns — nothing to do")

    xlsx = read_xlsx()
    earth = {k: xlsx["NAM-RK"][k] for k in ("pressure_pa", "co2_pct", "o2_pct", "radiation_msv_day", "uvc_surface")}
    # the "same for the whole Earth" values must really be the same in every Earth row of the xlsx
    for sid, v in xlsx.items():
        if not sid.startswith("MARS"):
            assert all(v[k] == earth[k] for k in earth), (sid, v)
    moon = moon_values()

    body_col = header.index("body")
    out = [lines[0] + "," + ",".join(NEW_COLS)]
    report = []
    for line in lines[1:]:
        if not line.strip() or line.startswith("#"):
            out.append(line)
            continue
        row = next(csv.reader([line]))
        sid, body = row[0], row[body_col]
        if sid in xlsx:
            vals, src = xlsx[sid], "xlsx"
        elif body == "Earth":
            vals, src = {**earth, "wind_desc_uk": "", "toxic_salts_uk": "", "status_life": "earth_constant"}, "earth constants"
        elif body == "Moon":
            vals, src = moon, "limits.json"
        else:
            sys.exit(f"{sid}: no source for life columns")
        buf = io.StringIO()
        csv.writer(buf, lineterminator="").writerow([vals[c] for c in NEW_COLS])
        out.append(line + "," + buf.getvalue())
        report.append(f"  {sid:<13} {src}")

    SITES.write_text("\n".join(out) + ("\n" if raw.endswith("\n") else ""), encoding="utf-8")
    print(f"sites.csv: added {len(NEW_COLS)} columns to {len(report)} rows")
    print("\n".join(report))
    missing = set(xlsx) - {r.split()[0] for r in report}
    if missing:
        print("xlsx rows not in sites.csv:", sorted(missing))


if __name__ == "__main__":
    main()
