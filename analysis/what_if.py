# SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
# SPDX-License-Identifier: MIT

"""What if we close the gap? Similarity of every Earth analog to its reference (pair_id)
after test-bed interventions → data/what_if.csv.

Input:  data/sites.csv, data/rock_similarity.csv, data/interventions.csv, analysis/metrics.py
Output: data/what_if.csv

How an intervention works: it changes parameters of the analog's TEST BED (not of the
site itself): `sets` = sites.csv columns, `value` = a literal (e.g. rock class
"anorthosite" for the LHS-1 simulant) or "reference" (the test bed is built to match the
reference), clipped to the facility limits [limit_min, limit_max] from the source.
The new score is NOT computed here: the changed rows are added as virtual analogs to a
copy of sites.csv and the real analysis/metrics.py is run on that copy in a temporary
folder, so the formula is exactly the metric's. data/ is never modified (except the output).

Default solution (shown first on the site): every "field" intervention whose criteria
have similarity < 0.5 for the pair and that raises the score on its own, in descending order of gain_per_effort
(gain of the intervention alone / effort). chamber, mechanical and partial interventions
are listed but not part of the default.

Run from anywhere:  python analysis/what_if.py
"""
import csv
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
THRESHOLD = 0.5                     # same as MITIGATION_THRESHOLD on the site
TARGET_SCENARIO = {"Moon": "moon_base", "Mars": "mars_landing"}  # = TARGET_SCENARIO in metrics.py
CRITERIA = ["temp_mean", "temp_range", "craters", "slope", "relief", "ice", "sun", "rock"]
SEP = "__"                          # virtual analog id: <analog>__<tag>


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if not next(iter(r.values()), "").startswith("#")]
    return rows


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def clip(v, lo, hi):
    if lo is not None:
        v = max(v, lo)
    if hi is not None:
        v = min(v, hi)
    return v


def fmt_num(v):
    return str(int(v)) if float(v).is_integer() else repr(round(v, 6))


def apply(row, ref, iv):
    """Analog row → test-bed row after intervention iv (returns a new dict)."""
    out = dict(row)
    lo, hi = num(iv["limit_min"]), num(iv["limit_max"])
    for col in [c for c in iv["sets"].split(";") if c]:
        if iv["value"] == "reference":
            rv = num(ref[col])
            out[col] = fmt_num(clip(rv, lo, hi)) if rv is not None else ref[col]
        else:
            out[col] = iv["value"]
    return out


def applies(iv, body):
    return body in iv["target_body"].split(";")


def run_metrics(sites, header):
    """Run the real metrics.py on a copy of data/ with `sites` as sites.csv; return scores rows."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "analysis").mkdir()
        (tmp / "data").mkdir()
        shutil.copy(ROOT / "analysis/metrics.py", tmp / "analysis/metrics.py")
        shutil.copy(DATA / "rock_similarity.csv", tmp / "data/rock_similarity.csv")
        with open(tmp / "data/sites.csv", "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
            w.writeheader()
            w.writerows(sites)
        run = subprocess.run([sys.executable, "-I", str(tmp / "analysis/metrics.py")],
                             capture_output=True, text=True, encoding="utf-8", errors="replace")
        if run.returncode:
            sys.exit(f"metrics.py failed:\n{run.stderr}")
        return read_csv(tmp / "data/scores.csv")


def compute():
    """All what-if rows (single interventions + default plans) and the plans per analog."""
    with open(DATA / "sites.csv", encoding="utf-8-sig", newline="") as f:
        header = next(csv.reader(f))
    sites = read_csv(DATA / "sites.csv")
    by_id = {s["site_id"]: s for s in sites}
    ivs = read_csv(DATA / "interventions.csv")
    metric_ivs = [iv for iv in ivs if iv["sets"]]
    analogs = [s for s in sites if s["role"] == "analog" and s["pair_id"] in by_id]

    # ---- pass 1: every single intervention on its own
    virtual = []
    for a in analogs:
        ref = by_id[a["pair_id"]]
        for iv in metric_ivs:
            if applies(iv, ref["body"]):
                v = apply(a, ref, iv)
                v["site_id"] = f"{a['site_id']}{SEP}{iv['intervention_id']}"
                virtual.append(v)
    scores = run_metrics(sites + virtual, header)

    def pick(analog_id, ref):
        scn = TARGET_SCENARIO[ref["body"]]
        return next(r for r in scores if r["analog_id"] == analog_id and r["reference_id"] == ref["site_id"] and r["scenario"] == scn)

    rows, plans = [], {}
    for a in analogs:
        ref = by_id[a["pair_id"]]
        base = pick(a["site_id"], ref)
        weak = {c for c in CRITERIA if num(base.get(f"s_{c}")) is not None and num(base[f"s_{c}"]) < THRESHOLD}
        single = []
        for iv in ivs:
            if not applies(iv, ref["body"]):
                continue
            crits = [c for c in iv["criteria"].split(";") if c]
            after = pick(f"{a['site_id']}{SEP}{iv['intervention_id']}", ref) if iv["sets"] else base
            gain = num(after["score"]) - num(base["score"])
            effort = num(iv["effort"])
            single.append({
                "analog_id": a["site_id"], "reference_id": ref["site_id"], "scenario": base["scenario"],
                "intervention_id": iv["intervention_id"], "class": iv["class"], "criteria": ";".join(crits),
                "weak_criteria": ";".join(c for c in crits if c in weak),
                "s_before": ";".join(f"{c}:{base.get('s_' + c, '')}" for c in crits),
                "s_after": ";".join(f"{c}:{after.get('s_' + c, '')}" for c in crits),
                "score_before": base["score"], "score_after": after["score"],
                "gain": f"{gain:.3f}", "effort": iv["effort"],
                "gain_per_effort": f"{gain / effort:.4f}" if effort else "",
                "in_default": "false", "default_rank": "", "score_after_cumulative": "",
                "status": iv["status"], "warning_en": iv["warning_en"],
            })
        # default plan: field interventions that touch a weak criterion, best gain per effort first
        plan = [r for r in single if r["class"] == "field" and r["weak_criteria"] and num(r["gain"]) > 0]
        plan.sort(key=lambda r: (-num(r["gain_per_effort"]), r["intervention_id"]))
        plans[a["site_id"]] = (a, ref, base, plan, weak)
        rows.extend(single)

    # ---- pass 2: the default plan applied cumulatively (1, 1+2, 1+2+3 …)
    virtual = []
    for aid, (a, ref, base, plan, weak) in plans.items():
        cur = dict(a)
        for k, r in enumerate(plan, 1):
            iv = next(i for i in ivs if i["intervention_id"] == r["intervention_id"])
            cur = apply(cur, ref, iv)
            v = dict(cur)
            v["site_id"] = f"{aid}{SEP}default{k}"
            virtual.append(v)
    scores = run_metrics(sites + virtual, header)

    for aid, (a, ref, base, plan, weak) in plans.items():
        final = base
        for k, r in enumerate(plan, 1):
            final = pick(f"{aid}{SEP}default{k}", ref)
            r["in_default"] = "true"
            r["default_rank"] = str(k)
            r["score_after_cumulative"] = final["score"]
        covered = {c for r in plan for c in r["weak_criteria"].split(";") if c}
        rows.append({
            "analog_id": aid, "reference_id": ref["site_id"], "scenario": base["scenario"],
            "intervention_id": "default", "class": "field", "criteria": ";".join(r["intervention_id"] for r in plan),
            "weak_criteria": ";".join(c for c in CRITERIA if c in weak),
            "s_before": ";".join(f"{c}:{base['s_' + c]}" for c in CRITERIA if c in weak),
            "s_after": ";".join(f"{c}:{final['s_' + c]}" for c in CRITERIA if c in weak),
            "score_before": base["score"], "score_after": final["score"],
            "gain": f"{num(final['score']) - num(base['score']):.3f}", "effort": "",
            "gain_per_effort": "", "in_default": "true", "default_rank": "", "score_after_cumulative": final["score"],
            "status": "computed",
            "warning_en": "; ".join(sorted(c for c in weak if c not in covered)),  # weak criteria no field fix covers
        })

    return rows, plans


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows, plans = compute()
    fields = list(rows[0])
    with open(DATA / "what_if.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    print(f"what_if.csv: {len(rows)} rows ({len(plans)} analogs × interventions + default plans)")
    for aid, (a, ref, base, plan, weak) in plans.items():
        d = next(r for r in rows if r["analog_id"] == aid and r["intervention_id"] == "default")
        steps = " → ".join(f"{r['intervention_id']} ({r['score_after_cumulative']})" for r in plan) or "already close, nothing to add"
        left = f"  [no field fix: {d['warning_en']}]" if d["warning_en"] else ""
        print(f"  {aid:<8} → {ref['site_id']:<13} {base['score']} → {d['score_after']}: {steps}{left}")


if __name__ == "__main__":
    main()
