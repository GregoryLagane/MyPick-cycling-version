#!/usr/bin/env python3
"""
MyPick Vélo — ingestion des données depuis ProCyclingStats vers Supabase.

Ce script :
  1. lit la table `races` de Supabase pour savoir quelles courses suivre ;
  2. pour chaque course dont l'URL PCS est renseignée, récupère la startlist
     et, si disponibles, les résultats (course d'un jour, étapes, général) ;
  3. écrit tout ça dans Supabase.

Il est CONÇU POUR ÊTRE RELANCÉ SANS DANGER : il ne fait qu'écraser des
champs de résultat, jamais les pronostics des joueurs. Relancer dix fois
produit le même état final.

La correspondance des courses se fait via la colonne `pcs_url` de la table
`races` (ajoutée par le fichier SQL 04). Une course sans `pcs_url` est
ignorée — pratique pour ne suivre que ce qui t'intéresse.

Variables d'environnement attendues (fournies par GitHub Actions) :
  SUPABASE_URL          — l'URL du projet (même valeur que dans l'app)
  SUPABASE_SERVICE_KEY  — la clé SECRETE (sb_secret_...), jamais publique
"""

import os
import sys
import time
import unicodedata

# ---------------------------------------------------------------------------
# Conversion des noms PCS -> format lisible
# PCS renvoie "POGAČAR Tadej" ; on veut "Tadej Pogačar".
# ---------------------------------------------------------------------------

PARTICULES = {"van", "der", "den", "de", "del", "di", "da", "le", "la",
              "von", "ten", "ter", "af", "av", "dos", "das", "el", "y"}

def _recap(word):
    """Capitalise en gérant apostrophes et tirets : O'CONNOR -> O'Connor."""
    for sep in ("'", "-"):
        if sep in word:
            return sep.join(_recap(p) for p in word.split(sep))
    return word.capitalize()

def pcs_to_name(pcs_name):
    """POGAČAR Tadej -> Tadej Pogačar. Particules en minuscules."""
    if not pcs_name or not pcs_name.strip():
        return None
    parts = pcs_name.strip().split()
    surname, given = [], []
    for p in parts:
        letters = [c for c in p if c.isalpha()]
        if letters and all(c.isupper() for c in letters):
            surname.append(p)
        else:
            given.append(p)
    if not surname or not given:
        return pcs_name.strip()  # cas ambigu, laissé tel quel
    words = []
    for w in surname:
        low = w.lower()
        words.append(low if low in PARTICULES else _recap(w))
    return f"{' '.join(given)} {' '.join(words)}"


# ---------------------------------------------------------------------------
# Accès PCS via la librairie procyclingstats
# ---------------------------------------------------------------------------

def get_startlist(pcs_url):
    """Renvoie la liste des coureurs au départ, format base."""
    from procyclingstats import RaceStartlist
    sl = RaceStartlist(f"{pcs_url}/startlist")
    riders = []
    for row in sl.startlist():
        name = pcs_to_name(row.get("rider_name"))
        if name:
            riders.append(name)
    # dédoublonne en gardant l'ordre
    seen, out = set(), []
    for r in riders:
        if r not in seen:
            seen.add(r); out.append(r)
    return out


def get_stage_result(pcs_url, stage_n, top_n=10):
    """Renvoie le top N d'une étape, format base. Liste vide si pas encore couru."""
    from procyclingstats import Stage
    try:
        st = Stage(f"{pcs_url}/stage-{stage_n}")
        rows = st.results()
    except Exception as e:
        print(f"      étape {stage_n} : pas de résultat ({type(e).__name__})")
        return []
    return _extract_top(rows, top_n)


def get_oneday_result(pcs_url, top_n=10):
    """Renvoie le top N d'une course d'un jour."""
    from procyclingstats import Stage
    try:
        st = Stage(f"{pcs_url}/result")
        rows = st.results()
    except Exception:
        try:
            st = Stage(pcs_url)
            rows = st.results()
        except Exception as e:
            print(f"      pas de résultat ({type(e).__name__})")
            return []
    return _extract_top(rows, top_n)


def get_gc_result(pcs_url, last_stage, top_n=10):
    """Renvoie le top N du classement général final."""
    from procyclingstats import Stage
    for suffix in (f"/gc", f"/stage-{last_stage}/gc"):
        try:
            st = Stage(f"{pcs_url}{suffix}")
            rows = st.results()
            top = _extract_top(rows, top_n)
            if top:
                return top
        except Exception:
            continue
    return []


def _extract_top(rows, top_n):
    """Extrait les N premiers noms d'une table de résultats PCS."""
    out = []
    for row in rows[:top_n]:
        name = pcs_to_name(row.get("rider_name"))
        if name:
            out.append(name)
    return out


# ---------------------------------------------------------------------------
# Accès Supabase via l'API REST (pas de dépendance lourde)
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
            params={"select": "*", "pcs_url": "not.is.null"},
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

def main():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERREUR : SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis.")
        sys.exit(1)

    db = Supabase(url, key)
    races = db.get_races()
    print(f"{len(races)} course(s) avec une URL PCS à suivre.\n")

    for race in races:
        rid = race["id"]
        pcs = race["pcs_url"].strip().rstrip("/")
        print(f"=== {race['name']} ({rid}) ===")
        print(f"    PCS: {pcs}")

        # 1) Startlist — seulement si absente ou vide, pour ne pas réécrire
        #    en boucle une liste que l'admin aurait ajustée à la main.
        current_sl = race.get("startlist") or []
        if len(current_sl) == 0:
            try:
                sl = get_startlist(pcs)
                if sl:
                    db.update_race(rid, {"startlist": sl})
                    print(f"    startlist : {len(sl)} coureurs ajoutés")
                else:
                    print("    startlist : vide côté PCS (pas encore publiée ?)")
            except Exception as e:
                print(f"    startlist : échec ({type(e).__name__}: {e})")
        else:
            print(f"    startlist : déjà {len(current_sl)} coureurs, on ne touche pas")

        time.sleep(2)  # courtoisie envers PCS

        # 2) Résultats
        if race["format"] == "oneday":
            if not race.get("result"):
                res = get_oneday_result(pcs)
                if res:
                    db.update_race(rid, {"result": res})
                    print(f"    résultat : top {len(res)} enregistré")
                else:
                    print("    résultat : pas encore disponible")
            else:
                print("    résultat : déjà présent")
        else:
            stages = db.get_stages(rid)
            last_n = max((s["n"] for s in stages), default=0)
            for s in stages:
                if s.get("result"):
                    continue  # déjà rempli
                res = get_stage_result(pcs, s["n"])
                if res:
                    db.update_stage(rid, s["n"], {"result": res})
                    print(f"    étape {s['n']} : top {len(res)} enregistré")
                time.sleep(2)
            # Classement général, une fois la dernière étape courue
            if not race.get("gc_result"):
                gc = get_gc_result(pcs, last_n)
                if gc:
                    db.update_race(rid, {"gc_result": gc})
                    print(f"    général : top {len(gc)} enregistré")

        print()

    print("Terminé.")


if __name__ == "__main__":
    main()
