# SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
# SPDX-License-Identifier: MIT

"""Check that data/limits_uk.json is a faithful translation of data/limits.json.

Same structure (ids, addresses, criteria, references, list lengths) and the same
numbers in every text field. Decimal commas, superscripts and signs are normalised
before comparing. Run from the repo root:  python tools/check_limits_uk.py
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉⁻", "01234567890123456789-")
KEEP = {"id", "addresses", "criteria", "references"}  # must be identical
SKIP = {"translation_of", "translation_note"}         # only in the translation


def numbers(text):
    t = text.translate(SUP)
    t = re.sub(r"(\d),(\d)", r"\1.\2", t)               # 0,6 -> 0.6
    t = re.sub(r"\b1e-(\d+)", r"10^\1", t)              # 1e-12 -> 10^12 (uk: 10⁻¹²)
    t = re.sub(r"10-(\d+)", r"10^\1", t)
    return Counter(re.findall(r"\d+(?:\.\d+)?", t))


def walk(en, uk, path, errors):
    if isinstance(en, dict):
        for k in en:
            if k not in uk:
                errors.append(f"{path}.{k}: missing in limits_uk.json")
                continue
            walk(en[k], uk[k], f"{path}.{k}", errors)
        for k in uk:
            if k not in en and k not in SKIP:
                errors.append(f"{path}.{k}: not in limits.json")
    elif isinstance(en, list):
        if len(en) != len(uk):
            errors.append(f"{path}: {len(en)} items vs {len(uk)}")
            return
        for i, (a, b) in enumerate(zip(en, uk)):
            walk(a, b, f"{path}[{i}]", errors)
    elif isinstance(en, str):
        key = path.rsplit(".", 1)[-1].split("[")[0]
        if key in KEEP:
            if en != uk:
                errors.append(f"{path}: '{en}' vs '{uk}'")
        elif numbers(en) != numbers(uk):
            errors.append(f"{path}: numbers differ\n    en {sorted(numbers(en).elements())}\n    uk {sorted(numbers(uk).elements())}")


def main():
    en = json.loads((ROOT / "data/limits.json").read_text(encoding="utf-8"))
    uk = json.loads((ROOT / "data/limits_uk.json").read_text(encoding="utf-8"))
    errors = []
    walk(en, uk, "$", errors)
    sys.stdout.reconfigure(encoding="utf-8")
    if errors:
        print("limits_uk.json differs from limits.json:")
        print("\n".join(f"  {e}" for e in errors))
        sys.exit(1)
    print("limits_uk.json OK: same structure and numbers as limits.json")


if __name__ == "__main__":
    main()
