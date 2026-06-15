#!/usr/bin/env python3
"""
Generate static JSON data files for the Oloráculo soccer prediction app.

Usage:
  python generate_data.py              # regenerate all files
  python generate_data.py --only-ratings  # regenerate only ratings.json
"""

import csv
import json
import os
import re
import sys
import unicodedata
from itertools import combinations
from datetime import date

ONLY_RATINGS = "--only-ratings" in sys.argv

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT       = os.path.dirname(SCRIPT_DIR)
DATA_DIR   = os.path.join(ROOT, "Oloraculo.Web", "Data")
OUT_DIR    = os.path.join(SCRIPT_DIR, "public", "data")

os.makedirs(OUT_DIR, exist_ok=True)

# ── Team ID normalization ──────────────────────────────────────────────────────

ALIASES = {
    "usa": "United States",
    "u.s.a": "United States",
    "usmnt": "United States",
    "united states of america": "United States",
    "bosnia": "Bosnia and Herzegovina",
    "bosnia herzegovina": "Bosnia and Herzegovina",
    "korea republic": "South Korea",
    "republic of korea": "South Korea",
    "south korea": "South Korea",
    "turkiye": "Turkey",
    "türkiye": "Turkey",
    "czech republic": "Czechia",
    "cote d'ivoire": "Ivory Coast",
    "côte d'ivoire": "Ivory Coast",
    "dr congo": "Congo DR",
    "congo dr": "Congo DR",
    "dem. rep. of congo": "Congo DR",
    "dem rep of congo": "Congo DR",
    "democratic republic of congo": "Congo DR",
    "democratic republic of the congo": "Congo DR",
    "iran": "Iran",
    "ir iran": "Iran",
}


def remove_diacritics(s: str) -> str:
    """NFD normalize then strip non-spacing marks."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def to_id(name: str) -> str:
    """Convert a team name to a slug ID matching C# TeamNameNormalizer.ToId."""
    # Step 1: apply aliases (case-insensitive, after removing diacritics)
    stripped = remove_diacritics(name).lower().strip()
    if stripped in ALIASES:
        name = ALIASES[stripped]

    # Step 2: remove diacritics
    s = remove_diacritics(name)

    # Step 3: lowercase
    s = s.lower()

    # Step 4: replace non-alphanumeric runs with '-'
    s = re.sub(r"[^a-z0-9]+", "-", s)

    # Step 5: strip leading/trailing '-'
    s = s.strip("-")

    return s


# ── 1. teams.json & 2. groups.json ────────────────────────────────────────────

groups: dict[str, list[dict]] = {}  # group_name -> list of {id, name}

with open(f"{DATA_DIR}/wc2026_groups.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        group = row["group"].strip()
        team_name = row["team"].strip()
        team_id = to_id(team_name)
        if group not in groups:
            groups[group] = []
        groups[group].append({"id": team_id, "name": team_name})

# teams.json
teams = []
for group_name in sorted(groups.keys()):
    for t in groups[group_name]:
        teams.append({"id": t["id"], "name": t["name"], "group": group_name})

teams_path = f"{OUT_DIR}/teams.json"
with open(teams_path, "w", encoding="utf-8") as f:
    json.dump(teams, f, separators=(",", ":"), ensure_ascii=False)
print(f"teams.json: {len(teams)} teams")

# groups.json
groups_list = []
for group_name in sorted(groups.keys()):
    team_ids = [t["id"] for t in groups[group_name]]
    groups_list.append({"name": group_name, "team_ids": team_ids})

groups_path = f"{OUT_DIR}/groups.json"
with open(groups_path, "w", encoding="utf-8") as f:
    json.dump(groups_list, f, separators=(",", ":"), ensure_ascii=False)
print(f"groups.json: {len(groups_list)} groups")

# ── 3. fixtures.json ───────────────────────────────────────────────────────────

fixtures = []
for g in groups_list:
    group_name = g["name"]
    team_ids = g["team_ids"]
    for home_id, away_id in combinations(team_ids, 2):
        fixture_id = f"grp:{group_name}:{home_id}:{away_id}"
        fixtures.append({
            "id": fixture_id,
            "group_name": group_name,
            "home_team_id": home_id,
            "away_team_id": away_id,
            "neutral_venue": True,
            "is_played": False,
        })

fixtures_path = f"{OUT_DIR}/fixtures.json"
with open(fixtures_path, "w", encoding="utf-8") as f:
    json.dump(fixtures, f, separators=(",", ":"), ensure_ascii=False)
print(f"fixtures.json: {len(fixtures)} fixtures")

# ── 4. ratings.json ────────────────────────────────────────────────────────────

ratings = []

# ELO ratings
with open(f"{DATA_DIR}/elo_snapshot.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        team_name = row["team"].strip()
        elo_rating = int(row["elo_rating"].strip())
        rating_date = row["rating_date"].strip()
        ratings.append({
            "team_id": to_id(team_name),
            "type": "elo",
            "value": elo_rating,
            "as_of": rating_date,
        })

# FIFA rankings
with open(f"{DATA_DIR}/fifa_rankings.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        team_name = row["team"].strip()
        points = float(row["points"].strip())
        ranking_date = row["ranking_date"].strip()
        ratings.append({
            "team_id": to_id(team_name),
            "type": "fifa",
            "value": points,
            "as_of": ranking_date,
        })

ratings_path = f"{OUT_DIR}/ratings.json"
with open(ratings_path, "w", encoding="utf-8") as f:
    json.dump(ratings, f, separators=(",", ":"), ensure_ascii=False)
print(f"ratings.json: {len(ratings)} ratings")

# ── 5. historical_results.json ─────────────────────────────────────────────────

CUTOFF = date(1990, 1, 1)

cols = ["date", "home_id", "away_id", "home_goals", "away_goals", "tournament", "neutral"]
rows = []
skipped = 0

with open(f"{DATA_DIR}/historical_results.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Parse date
        try:
            match_date = date.fromisoformat(row["date"].strip())
        except ValueError:
            skipped += 1
            continue

        # Filter to 1990+
        if match_date < CUTOFF:
            continue

        # Parse scores – skip invalid
        try:
            home_goals = int(row["home_score"].strip())
            away_goals = int(row["away_score"].strip())
        except (ValueError, KeyError):
            skipped += 1
            continue

        home_id = to_id(row["home_team"].strip())
        away_id = to_id(row["away_team"].strip())
        tournament = row["tournament"].strip()

        neutral_raw = row["neutral"].strip().upper()
        neutral = neutral_raw in ("TRUE", "1", "YES")

        rows.append([
            row["date"].strip(),
            home_id,
            away_id,
            home_goals,
            away_goals,
            tournament,
            neutral,
        ])

hist_path = f"{OUT_DIR}/historical_results.json"
with open(hist_path, "w", encoding="utf-8") as f:
    json.dump({"cols": cols, "rows": rows}, f, separators=(",", ":"), ensure_ascii=False)

print(f"historical_results.json: {len(rows)} results (skipped {skipped})")

# ── Report file sizes ──────────────────────────────────────────────────────────

for fname in ["teams.json", "groups.json", "fixtures.json", "ratings.json", "historical_results.json"]:
    path = f"{OUT_DIR}/{fname}"
    size = os.path.getsize(path)
    if size >= 1024 * 1024:
        size_str = f"{size / (1024*1024):.2f} MB"
    elif size >= 1024:
        size_str = f"{size / 1024:.1f} KB"
    else:
        size_str = f"{size} B"
    print(f"  {fname}: {size_str}")
