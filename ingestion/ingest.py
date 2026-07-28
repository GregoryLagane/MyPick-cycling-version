#!/usr/bin/env python3
"""
MyPick Vélo — ingestion des données depuis FirstCycling vers Supabase.

Pourquoi FirstCycling plutôt que ProCyclingStats : PCS bloque les scripts
avec Cloudflare, ce qui rend l'ingestion peu fiable. FirstCycling n'a pas
cette barrière et expose les mêmes données (startlists, résultats, général).

Ce script :
  1. lit la table `races` de Supabase pour savoir quelles courses suivre ;
  2. pour chaque course dont le `fc_race_id` est renseigné, récupère la
     startlist et, si disponibles, les résultats ;
  3. écrit tout ça dans Supabase.

Il est CONÇU POUR ÊTRE RELANCÉ SANS DANGER : il n'écrase que des champs de
résultat, jamais les pronostics des joueurs.

La correspondance des courses se fait via la colonne `fc_race_id` de la table
`races` (ajoutée par le fichier SQL 05). Une course sans `fc_race_id` est
ignorée.

Variables d'environnement attendues (fournies par GitHub Actions) :
  SUPABASE_URL          — l'URL du projet (même valeur que dans l'app)
  SUPABASE_SERVICE_KEY  — la clé SECRETE (sb_secret_...), jamais publique
"""

import os
import sys
import time

# La librairie first_cycling_api est copiée à côté de ce script par le
# workflow (elle n'est pas publiée sur PyPI). On l'ajoute au chemin Python.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Conversion des noms FirstCycling -> format lisible
# FirstCycling renvoie "Pogacar Tadej" (nom puis prénom, particules en
# minuscules) ; on veut "Tadej Pogacar". Le prénom est toujours le DERNIER mot.
# Note : FirstCycling retire les accents (Pogacar, pas Pogačar). Comme la
# startlist ET les résultats viennent de la même source, les noms restent
# cohérents entre eux et le calcul des points fonctionne.
# ---------------------------------------------------------------------------

def fc_to_name(fc_name):
    if not fc_name or not str(fc_name).strip():
        return None
    parts = str(fc_name).strip().split()
    if len(parts) == 1:
        return parts[0]
    given = parts[-1]
    surname = parts[:-1]
    return f"{given} {' '.join(surname)}"


# ---------------------------------------------------------------------------
# Accès FirstCycling via la librairie first_cycling_api
# ---------------------------------------------------------------------------

def _riders_from_table(df, top_n=None):
    """Extrait la colonne Rider d'un DataFrame de résultats, format base."""
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
    """Liste des coureurs au départ, format base."""
    from first_cycling_api import RaceEdition
    edition = RaceEdition(race_id, year)
    sl = edition.startlist()
    # la startlist expose un tableau ; selon les versions l'attribut varie
    df = getattr(sl, "startlist_table", None)
    if df is None:
        df = getattr(sl, "table", None)
    riders = []
    if df is not None and "Rider" in df.columns:
        for raw in df["Rider"].tolist():
            n = fc_to_name(raw)
            if n:
                riders.append(n)
    # dédoublonne en gardant l'ordre
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
    """Classement général final (classification 1 = GC)."""
    from first_cycling_api import RaceEdition
    try:
        edition = RaceEdition(race_id, year)
        res = edition.results(classification_num=1)
        return _riders_from_table(getattr(res, "results_table", None), top_n)
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Accès Supabase via l'API REST
# ---------------------------------------------------------------------------

class Supabase:
    def __init__(self, url, key):
        self.url = url.rstrip("/")
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def get_races(self):
        import requests
        r = requests.get(
            f"{self.url}/rest/v1/races",
            headers=self.headers,
            params={"select": "*", "fc_race_id": "not.is.null"},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def get_stages(self, race_id):
        import requests
        r = requests.get(
            f"{self.url}/rest/v1/stages",
            headers=self.headers,
            params={"select": "*", "race_id": f"eq.{race_id}", "order": "n"},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def update_race(self, race_id, patch):
        import requests
        r = requests.patch(
            f"{self.url}/rest/v1/races",
            headers=self.headers,
            params={"id": f"eq.{race_id}"},
            json=patch,
            timeout=30,
        )
        r.raise_for_status()

    def update_stage(self, race_id, n, patch):
        import requests
        r = requests.patch(
            f"{self.url}/rest/v1/stages",
            headers=self.headers,
            params={"race_id": f"eq.{race_id}", "n": f"eq.{n}"},
            json=patch,
            timeout=30,
        )
        r.raise_for_status()


# ---------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------

YEAR = 2026

def main():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERREUR : SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis.")
        sys.exit(1)

    db = Supabase(url, key)
    races = db.get_races()
    print(f"{len(races)} course(s) avec un ID FirstCycling à suivre.\n")

    for race in races:
        rid = race["id"]
        fc_id = race["fc_race_id"]
        print(f"=== {race['name']} ({rid}) — FirstCycling id {fc_id} ===")

        # 1) Startlist, seulement si absente
        current_sl = race.get("startlist") or []
        if len(current_sl) == 0:
            try:
                sl = get_startlist(fc_id, YEAR)
                if sl:
                    db.update_race(rid, {"startlist": sl})
                    print(f"    startlist : {len(sl)} coureurs ajoutés")
                else:
                    print("    startlist : vide (pas encore publiée ?)")
            except Exception as e:
                print(f"    startlist : échec ({type(e).__name__}: {e})")
        else:
            print(f"    startlist : déjà {len(current_sl)} coureurs, on ne touche pas")

        time.sleep(2)

        # 2) Résultats
        if race["format"] == "oneday":
            if not race.get("result"):
                try:
                    res = get_oneday_result(fc_id, YEAR)
                    if res:
                        db.update_race(rid, {"result": res})
                        print(f"    résultat : top {len(res)} enregistré")
                    else:
                        print("    résultat : pas encore disponible")
                except Exception as e:
                    print(f"    résultat : échec ({type(e).__name__}: {e})")
            else:
                print("    résultat : déjà présent")
        else:
            stages = db.get_stages(rid)
            for s in stages:
                if s.get("result"):
                    continue
                res = get_stage_result(fc_id, YEAR, s["n"])
                if res:
                    db.update_stage(rid, s["n"], {"result": res})
                    print(f"    étape {s['n']} : top {len(res)} enregistré")
                time.sleep(2)
            if not race.get("gc_result"):
                gc = get_gc_result(fc_id, YEAR)
                if gc:
                    db.update_race(rid, {"gc_result": gc})
                    print(f"    général : top {len(gc)} enregistré")

        print()

    print("Terminé.")


if __name__ == "__main__":
    main()
