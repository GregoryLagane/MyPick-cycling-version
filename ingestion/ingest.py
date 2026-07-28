#!/usr/bin/env python3
"""
MyPick Vélo — ingestion FirstCycling + DIAGNOSTIC intégré.

Cette version affiche d'abord un diagnostic de la structure des pages
FirstCycling (pour comprendre pourquoi le parsing échoue), PUIS tente
l'ingestion normale. Le diagnostic apparaît en haut des logs.

Une fois la structure comprise, ce fichier sera remplacé par la version
corrigée définitive.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


# ===========================================================================
# DIAGNOSTIC — analyse la structure réelle des pages FirstCycling
# ===========================================================================

def diagnostic():
    import requests
    from bs4 import BeautifulSoup

    urls = {
        "startlist Tour 2026": "https://firstcycling.com/race.php?r=17&y=2026&k=start",
        "resultat etape 1":    "https://firstcycling.com/race.php?r=17&y=2026&e=1",
        "general Tour 2026":   "https://firstcycling.com/race.php?r=17&y=2026",
    }
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
               "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

    print("\n" + "#"*70)
    print("# DIAGNOSTIC DE LA STRUCTURE FIRSTCYCLING")
    print("#"*70)

    for label, url in urls.items():
        print(f"\n{'='*68}\n{label}\n{url}\n{'='*68}")
        try:
            r = requests.get(url, headers=headers, timeout=30)
            print(f"statut HTTP : {r.status_code} | taille : {len(r.text)} caractères")
            soup = BeautifulSoup(r.text, "lxml")

            h1 = soup.find("h1")
            print(f"balise <h1> : {'OUI' if h1 else 'NON (voilà la cause du plantage)'}")
            if h1:
                print(f"   texte h1 : {h1.get_text()[:80]!r}")

            tables = soup.find_all("table")
            print(f"nombre de <table> : {len(tables)}")
            for i, t in enumerate(tables[:8]):
                rows = t.find_all("tr")
                rider_links = t.find_all("a", href=lambda h: h and "rider.php" in h)
                cls = t.get("class")
                marque = "  <-- COUREURS ICI" if rider_links else ""
                print(f"   table[{i}] class={cls} lignes={len(rows)} coureurs={len(rider_links)}{marque}")
                for a in rider_links[:2]:
                    print(f"        ex: {a.get_text().strip()!r}")
        except Exception as e:
            print(f"ERREUR : {type(e).__name__}: {e}")

    print("\n" + "#"*70)
    print("# FIN DU DIAGNOSTIC — l'ingestion normale suit (elle peut échouer,")
    print("# c'est le diagnostic ci-dessus qui compte pour l'instant)")
    print("#"*70 + "\n")


# ===========================================================================
# INGESTION NORMALE (inchangée)
# ===========================================================================

PARTICULES = {"van", "der", "den", "de", "del", "di", "da", "le", "la",
              "von", "ten", "ter", "af", "av", "dos", "das", "el", "y"}

def fc_to_name(fc_name):
    if not fc_name or not str(fc_name).strip():
        return None
    parts = str(fc_name).strip().split()
    if len(parts) == 1:
        return parts[0]
    given = parts[-1]
    surname = parts[:-1]
    return f"{given} {' '.join(surname)}"


def _riders_from_table(df, top_n=None):
    if df is None or "Rider" not in df.columns:
        return []
    names = []
    rows = df["Rider"].tolist()
    if top_n:
        rows = rows[:top_n]
    for raw in rows:
        n = fc_to_name(raw)
        if n:
            names.append(n)
    return names


def get_startlist(race_id, year):
    from first_cycling_api import RaceEdition
    edition = RaceEdition(race_id, year)
    sl = edition.startlist()
    df = getattr(sl, "startlist_table", None) or getattr(sl, "table", None)
    riders = []
    if df is not None and "Rider" in df.columns:
        for raw in df["Rider"].tolist():
            n = fc_to_name(raw)
            if n:
                riders.append(n)
    seen, out = set(), []
    for r in riders:
        if r not in seen:
            seen.add(r); out.append(r)
    return out


def get_oneday_result(race_id, year, top_n=10):
    from first_cycling_api import RaceEdition
    edition = RaceEdition(race_id, year)
    res = edition.results()
    return _riders_from_table(getattr(res, "results_table", None), top_n)


def get_stage_result(race_id, year, stage_n, top_n=10):
    from first_cycling_api import RaceEdition
    try:
        edition = RaceEdition(race_id, year)
        res = edition.results(stage_num=stage_n)
        return _riders_from_table(getattr(res, "results_table", None), top_n)
    except Exception as e:
        print(f"      étape {stage_n} : pas de résultat ({type(e).__name__})")
        return []


def get_gc_result(race_id, year, top_n=10):
    from first_cycling_api import RaceEdition
    try:
        edition = RaceEdition(race_id, year)
        res = edition.results(classification_num=1)
        return _riders_from_table(getattr(res, "results_table", None), top_n)
    except Exception:
        return []


class Supabase:
    def __init__(self, url, key):
        self.url = url.rstrip("/")
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json"}

    def get_races(self):
        import requests
        r = requests.get(f"{self.url}/rest/v1/races", headers=self.headers,
                         params={"select": "*", "fc_race_id": "not.is.null"}, timeout=30)
        r.raise_for_status()
        return r.json()

    def get_stages(self, race_id):
        import requests
        r = requests.get(f"{self.url}/rest/v1/stages", headers=self.headers,
                         params={"select": "*", "race_id": f"eq.{race_id}", "order": "n"}, timeout=30)
        r.raise_for_status()
        return r.json()

    def update_race(self, race_id, patch):
        import requests
        r = requests.patch(f"{self.url}/rest/v1/races", headers=self.headers,
                           params={"id": f"eq.{race_id}"}, json=patch, timeout=30)
        r.raise_for_status()

    def update_stage(self, race_id, n, patch):
        import requests
        r = requests.patch(f"{self.url}/rest/v1/stages", headers=self.headers,
                           params={"race_id": f"eq.{race_id}", "n": f"eq.{n}"}, json=patch, timeout=30)
        r.raise_for_status()


YEAR = 2026


# ===========================================================================
# DIAGNOSTIC (temporaire) — affiche la structure d'une vraie page FirstCycling
# pour comprendre pourquoi le parsing plante. Retiré une fois le bug corrigé.
# ===========================================================================
def _diagnostic():
    import requests
    from bs4 import BeautifulSoup
    HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
               "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}
    urls = {
        "startlist Tour 2026": "https://firstcycling.com/race.php?r=17&y=2026&k=start",
        "resultat etape 1":    "https://firstcycling.com/race.php?r=17&y=2026&e=1",
        "general Tour 2026":   "https://firstcycling.com/race.php?r=17&y=2026",
    }
    print("\n########## DIAGNOSTIC FIRSTCYCLING ##########")
    for label, url in urls.items():
        print(f"\n----- {label}\n{url}")
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            print(f"HTTP {r.status_code}, {len(r.text)} caracteres")
            soup = BeautifulSoup(r.text, "lxml")
            h1 = soup.find("h1")
            print(f"<h1> present : {h1 is not None}" + (f" -> {h1.get_text()[:60]!r}" if h1 else ""))
            tables = soup.find_all("table")
            print(f"nombre de <table> : {len(tables)}")
            for i, t in enumerate(tables[:8]):
                rows = t.find_all("tr")
                riders = t.find_all("a", href=lambda h: h and "rider.php" in h)
                print(f"  table[{i}] class={t.get('class')} lignes={len(rows)} coureurs={len(riders)}")
                for a in riders[:2]:
                    print(f"      ex: {a.get_text().strip()!r}")
        except Exception as e:
            print(f"ERREUR : {type(e).__name__}: {e}")
    print("\n########## FIN DIAGNOSTIC ##########\n")


def main():
    # --- DIAGNOSTIC en premier ---
    diagnostic()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERREUR : SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis.")
        sys.exit(1)

    _diagnostic()

    db = Supabase(url, key)
    races = db.get_races()
    print(f"{len(races)} course(s) avec un ID FirstCycling à suivre.\n")

    for race in races:
        rid = race["id"]
        fc_id = race["fc_race_id"]
        year = race.get("fc_year") or YEAR
        print(f"=== {race['name']} ({rid}) — id {fc_id}, année {year} ===")

        current_sl = race.get("startlist") or []
        if len(current_sl) == 0:
            try:
                sl = get_startlist(fc_id, year)
                if sl:
                    db.update_race(rid, {"startlist": sl})
                    print(f"    startlist : {len(sl)} coureurs ajoutés")
                else:
                    print("    startlist : vide")
            except Exception as e:
                print(f"    startlist : échec ({type(e).__name__}: {e})")
        else:
            print(f"    startlist : déjà {len(current_sl)} coureurs")

        time.sleep(2)

        if race["format"] == "oneday":
            if not race.get("result"):
                try:
                    res = get_oneday_result(fc_id, year)
                    if res:
                        db.update_race(rid, {"result": res})
                        print(f"    résultat : top {len(res)} enregistré")
                    else:
                        print("    résultat : pas encore disponible")
                except Exception as e:
                    print(f"    résultat : échec ({type(e).__name__}: {e})")
        else:
            stages = db.get_stages(rid)
            for s in stages:
                if s.get("result"):
                    continue
                res = get_stage_result(fc_id, year, s["n"])
                if res:
                    db.update_stage(rid, s["n"], {"result": res})
                    print(f"    étape {s['n']} : top {len(res)} enregistré")
                time.sleep(2)
            if not race.get("gc_result"):
                gc = get_gc_result(fc_id, year)
                if gc:
                    db.update_race(rid, {"gc_result": gc})
                    print(f"    général : top {len(gc)} enregistré")
        print()

    print("Terminé.")


if __name__ == "__main__":
    main()
