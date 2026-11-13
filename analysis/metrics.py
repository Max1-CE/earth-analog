"""Індекс схожості земних аналогів з еталонами Марса і Місяця.

Вхід:  sites.csv, rock_similarity.csv (поруч зі скриптом)
Вихід: scores.csv  — схожість кожного аналога з кожним еталоном (по критеріях)
       ranking.csv — рейтинг аналогів окремо для кожного еталона

Зміни проти попередньої версії:
- температура порівнюється в кельвінах через логарифм відношення (а не різницею в °C,
  яка для Місяця завжди давала 0);
- лід порівнюється в логарифмічній шкалі (раніше R=0.5 робив «схожими» майже все);
- для еталонів Місяця автоматично береться сценарій moon_base, для Марса — mars_landing;
- рейтинг будується окремо для кожного еталона.
"""
import numpy as np
import pandas as pd
from pathlib import Path

# CSV-файли лежать у ../data відносно цього скрипта (структура репозиторію сайту).
try:
    DATA = Path(__file__).resolve().parent.parent / "data"
except NameError:
    DATA = Path.cwd()

def load_csv(name, **kw):
    """Читає CSV з комою або крапкою з комою; десятковий роздільник — крапка."""
    path = DATA / name
    with open(path, encoding="utf-8-sig") as f:
        head = f.readline()
    sep = ";" if head.count(";") > head.count(",") else ","
    return pd.read_csv(path, sep=sep, encoding="utf-8-sig", **kw)

sites = load_csv("sites.csv")
rock = load_csv("rock_similarity.csv", index_col=0)

unknown = set(sites.rock_class.dropna()) - set(rock.index)
if unknown:
    raise ValueError(f"Класи порід, яких немає в rock_similarity.csv: {unknown}")

# --- похідні величини ---
sites["t_mean_K"] = sites.t_surf_mean_c + 273.15
sites["t_range"] = sites.t_surf_max_c - sites.t_surf_min_c          # добова/сезонна амплітуда, °C
sites["crater_log"] = np.log10(sites.crater_density_1e6km2 + 1)      # порядки величини
sites["ice_log"] = np.log10(sites.ice_water_frac + 1e-3)             # від 0.001 до 1 -> від -3 до 0

# критерій: (стовпець, масштаб R). Схожість = 1 - min(1, |a - r| / R)
NUM = {
    "temp_mean":  ("t_mean_log", np.log(3)),  # спеціальний випадок, див. similarity()
    "temp_range": ("t_range",    200),        # °C
    "craters":    ("crater_log", 5),          # порядки величини
    "slope":      ("slope_mean_deg", 20),     # °
    "relief":     ("relief_m",   1000),       # м
    "ice":        ("ice_log",    3),          # порядки величини
    "sun":        ("sun_elev_max_deg", 60),   # °
}

SCENARIOS = {
    "equal":        dict(temp_mean=1, temp_range=.5, craters=1, slope=1, relief=1, ice=1, sun=1, rock=1),
    "moon_base":    dict(temp_mean=1, temp_range=1, craters=1, slope=1, relief=.5, ice=3, sun=3, rock=1),
    "mars_landing": dict(temp_mean=1, temp_range=.5, craters=1, slope=3, relief=2, ice=1, sun=.5, rock=2),
}
TARGET_SCENARIO = {"Moon": "moon_base", "Mars": "mars_landing"}

def similarity(a, r):
    """Схожість аналога a з еталоном r за кожним критерієм (0..1)."""
    s = {}
    for k, (col, R) in NUM.items():
        if k == "temp_mean":
            if pd.notna(a.t_mean_K) and pd.notna(r.t_mean_K):
                s[k] = 1 - min(1, abs(np.log(a.t_mean_K / r.t_mean_K)) / R)
            continue
        if pd.notna(a[col]) and pd.notna(r[col]):
            s[k] = 1 - min(1, abs(a[col] - r[col]) / R)
    if pd.notna(a.rock_class) and pd.notna(r.rock_class):
        s["rock"] = float(rock.loc[a.rock_class, r.rock_class])
    return s

def total(s, w):
    used = [k for k in s if w.get(k, 0) > 0]
    W = sum(w[k] for k in used)
    score = sum(w[k] * s[k] for k in used) / W if W else np.nan
    coverage = W / sum(w.values())
    return score, coverage

analogs = sites[sites.role == "analog"]
refs = sites[sites.role == "reference"]

rows = []
for _, a in analogs.iterrows():
    for _, r in refs.iterrows():
        s = similarity(a, r)
        for name, w in SCENARIOS.items():
            score, cov = total(s, w)
            rows.append(dict(analog_id=a.site_id, reference_id=r.site_id, target_body=r.body,
                             scenario=name, is_pair=(a.pair_id == r.site_id),
                             score=round(score, 3), coverage=round(cov, 2),
                             **{f"s_{k}": round(v, 3) for k, v in s.items()}))
scores = pd.DataFrame(rows)
scores.to_csv(DATA / "scores.csv", index=False)

# рейтинг окремо для кожного еталона, у сценарії його тіла
rank = scores[scores.scenario == scores.target_body.map(TARGET_SCENARIO)].copy()
rank["rank"] = rank.groupby("reference_id").score.rank(ascending=False, method="min").astype(int)
rank = rank.sort_values(["reference_id", "rank"])
rank.to_csv(DATA / "ranking.csv", index=False)

for ref_id, g in rank.groupby("reference_id", sort=False):
    top = g.head(3)
    print(f"{ref_id:14s} -> " + ", ".join(f"{r.analog_id} ({r.score:.2f})" for r in top.itertuples()))
