#!/usr/bin/env python3
"""
Diagnostic FirstCycling — à lancer une fois sur GitHub Actions.
Récupère une vraie page FirstCycling et affiche sa structure, pour comprendre
pourquoi le parsing plante. Ne touche pas à Supabase.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests
from bs4 import BeautifulSoup

# Tour de France 2026, page résultats étape 1
URLS = {
    "startlist Tour 2026":  "https://firstcycling.com/race.php?r=17&y=2026&k=start",
    "resultat etape 1":     "https://firstcycling.com/race.php?r=17&y=2026&e=1",
    "general Tour 2026":    "https://firstcycling.com/race.php?r=17&y=2026",
}

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

for label, url in URLS.items():
    print(f"\n{'='*70}\n{label}\n{url}\n{'='*70}")
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        print(f"statut HTTP : {r.status_code}, taille : {len(r.text)} caractères")
        soup = BeautifulSoup(r.text, "lxml")

        # Y a-t-il un h1 ? (c'est ce qui plante)
        h1 = soup.find("h1")
        print(f"balise <h1> présente : {h1 is not None}")
        if h1:
            print(f"  contenu h1 : {h1.get_text()[:80]!r}")

        # Combien de tables, et lesquelles ont des lignes de coureurs
        tables = soup.find_all("table")
        print(f"nombre de <table> : {len(tables)}")
        for i, t in enumerate(tables[:6]):
            cls = t.get("class")
            rows = t.find_all("tr")
            # chercher un lien vers un coureur (rider.php) dans la table
            rider_links = t.find_all("a", href=lambda h: h and "rider.php" in h)
            print(f"  table[{i}] class={cls} lignes={len(rows)} liens_coureur={len(rider_links)}")
            if rider_links[:3]:
                for a in rider_links[:3]:
                    print(f"      exemple coureur : {a.get_text().strip()!r}")
    except Exception as e:
        print(f"ERREUR : {type(e).__name__}: {e}")

print("\n\nDiagnostic terminé.")
