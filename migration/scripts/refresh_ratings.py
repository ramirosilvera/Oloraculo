"""
Actualiza elo_snapshot.csv y fifa_rankings.csv descargando datos actuales.
Usado por el GitHub Action de actualización automática de ratings.

Uso:
  python migration/scripts/refresh_ratings.py
"""

import csv
import re
import sys
from datetime import date
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: Instalá las dependencias: pip install requests beautifulsoup4")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "Oloraculo.Web" / "Data"

TODAY = date.today().isoformat()
ELO_URL = "https://www.international-football.net/elo-ratings-table"
FIFA_URL = "https://en.wikipedia.org/w/index.php?title=Module:SportsRankings/data/FIFA_World_Rankings&action=raw"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; OloraculoBot/1.0)"}


def fetch_elo():
    """Descarga tabla ELO de international-football.net"""
    print(f"Descargando ELO desde {ELO_URL}...")
    resp = requests.get(ELO_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    rows = []
    table = soup.find("table", {"id": "elo-table"}) or soup.find("table")
    if not table:
        print("WARN: No se encontró tabla ELO, saltando actualización de ELO")
        return None

    for i, tr in enumerate(table.find_all("tr")[1:], 1):
        cols = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
        if len(cols) >= 3:
            try:
                rank = int(re.sub(r"\D", "", cols[0]) or str(i))
                team = cols[1]
                elo  = float(re.sub(r"[^\d.]", "", cols[2]))
                rows.append({
                    "rank": rank,
                    "team": team,
                    "elo_rating": elo,
                    "rating_date": TODAY,
                    "source": ELO_URL,
                    "source_original": "https://www.eloratings.net/",
                })
            except (ValueError, IndexError):
                continue

    print(f"  → {len(rows)} equipos encontrados")
    return rows


def fetch_fifa():
    """Descarga rankings FIFA desde Wikipedia"""
    print(f"Descargando FIFA rankings desde Wikipedia...")
    resp = requests.get(FIFA_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    text = resp.text

    rows = []
    # Format: name = "Argentina", points = "1877.27", rank = "1"
    entries = re.findall(r'\["([^"]+)"\]\s*=\s*\{([^}]+)\}', text)
    for team, body in entries:
        pts_m  = re.search(r'points\s*=\s*"?([\d.]+)"?', body)
        rank_m = re.search(r'rank\s*=\s*"?(\d+)"?', body)
        chg_m  = re.search(r'change\s*=\s*"?([+-]?\d+)"?', body)
        if pts_m:
            rows.append({
                "rank": int(rank_m.group(1)) if rank_m else 9999,
                "team": team,
                "rank_change_since_previous": int(chg_m.group(1)) if chg_m else 0,
                "points": float(pts_m.group(1)),
                "ranking_date": TODAY,
            })

    rows.sort(key=lambda r: r["rank"])
    print(f"  → {len(rows)} equipos encontrados")
    return rows


def save_elo(rows):
    out = DATA_DIR / "elo_snapshot.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["rank", "team", "elo_rating", "rating_date", "source", "source_original"])
        w.writeheader()
        w.writerows(rows)
    print(f"  Guardado en {out}")


def save_fifa(rows):
    out = DATA_DIR / "fifa_rankings.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["rank", "team", "rank_change_since_previous", "points", "ranking_date"])
        w.writeheader()
        w.writerows(rows)
    print(f"  Guardado en {out}")


def main():
    elo_rows = fetch_elo()
    if elo_rows:
        save_elo(elo_rows)

    fifa_rows = fetch_fifa()
    if fifa_rows:
        save_fifa(fifa_rows)

    print("Listo. Ahora corré generate_data.py --only-ratings para actualizar ratings.json")


if __name__ == "__main__":
    main()
