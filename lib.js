/* ============================================================================
   MyPick Vélo — moteur de points et utilitaires
   Fonctions pures, sans dépendance React : testables et réutilisables.
   ========================================================================= */

export const COEFF = { grand_tour: 3, monument: 2, worldtour: 1 };

// Barème général (podium final / course d'un jour)
export const S_GC = { winner: 20, exactPlace: 10, wrongPlace: 5, outsiderTop5: 15 };
// Barème étape — volontairement plus léger
export const S_STAGE = { winner: 10, exactPlace: 5, wrongPlace: 2 };
// Bonus maillots
export const S_JERSEY = { points: 10, kom: 10 };

/* Plafond des points d'étape par course.
   Sans plafond, 21 étapes rapportent jusqu'à 420 pts et écrasent le
   classement général (225 pts au maximum). Seules les N meilleures étapes
   comptent : le jeu récompense la justesse, pas le simple fait de tout saisir.
   Un joueur qui rate quelques étapes n'est pas éliminé pour autant. */
export const STAGE_CAP = { grand_tour: 12, worldtour: 6, monument: 0 };

export const TYPE_LABEL = {
  grand_tour: "Grand Tour",
  monument: "Monument",
  worldtour: "World Tour",
};

export const PROFILE_LABEL = {
  plaine: "Plaine",
  vallonnee: "Vallonnée",
  montagne: "Montagne",
  clm: "Contre-la-montre",
};

export const FLAG = {
  IT: "🇮🇹", BE: "🇧🇪", FR: "🇫🇷", ES: "🇪🇸", NL: "🇳🇱", DE: "🇩🇪",
  CH: "🇨🇭", PL: "🇵🇱", CA: "🇨🇦", CN: "🇨🇳", AE: "🇦🇪", GB: "🇬🇧",
};

/* Ordinal français : 1 -> 1er, 2 -> 2e ... */
export function ord(n) {
  return n === 1 ? "1er" : `${n}e`;
}

/* --------------------------------------------------------------------------
   Calcul du score d'un podium contre un résultat.
   -------------------------------------------------------------------------- */
export function scorePodium(podium, result, scale, favorites, outsider) {
  const lines = [];
  let raw = 0;
  if (!podium || !result) return { raw, lines };

  podium.forEach((rider, i) => {
    if (!rider) return;
    const actual = result.indexOf(rider);
    if (actual === -1) return;

    if (actual === i) {
      const pts = i === 0 ? scale.winner : scale.exactPlace;
      raw += pts;
      lines.push({
        rider,
        label: i === 0 ? "Vainqueur exact" : `${ord(i + 1)} place exacte`,
        pts,
      });
    } else if (actual < 3) {
      raw += scale.wrongPlace;
      lines.push({
        rider,
        label: `Annoncé ${ord(i + 1)}, arrivé ${ord(actual + 1)}`,
        pts: scale.wrongPlace,
      });
    }
  });

  if (outsider && scale.outsiderTop5) {
    const actual = result.indexOf(outsider);
    if (actual !== -1 && actual < 5 && !(favorites || []).includes(outsider)) {
      raw += scale.outsiderTop5;
      lines.push({
        rider: outsider,
        label: `Outsider, arrivé ${ord(actual + 1)}`,
        pts: scale.outsiderTop5,
      });
    }
  }

  return { raw, lines };
}

/* --------------------------------------------------------------------------
   Score complet d'une course pour un jeu de pronostics donné.

   Le coefficient de course (×3 Grand Tour, ×2 Monument, ×1 World Tour)
   s'applique au classement général, aux maillots et aux courses d'un jour —
   mais PAS aux étapes. Sans ça, un Grand Tour à 21 étapes vaut treize fois
   un Monument et les classiques ne comptent plus.
   -------------------------------------------------------------------------- */
export function scoreRace(racePicks, race) {
  const coeff = COEFF[race.type];
  const groups = [];
  let weighted = 0;   // points soumis au coefficient
  let flat = 0;       // points d'étape, hors coefficient

  if (race.format === "oneday") {
    if (!race.result) return null;
    const pick = racePicks?.oneday;
    if (!pick) return { raw: 0, coeff, total: 0, groups: [] };
    const r = scorePodium(pick.podium, race.result, S_GC, race.favorites, pick.outsider);
    weighted += r.raw;
    if (r.lines.length) groups.push({ title: "Course", lines: r.lines, subtotal: r.raw * coeff });
  } else {
    if (race.gcResult && racePicks?.gc) {
      const r = scorePodium(racePicks.gc.podium, race.gcResult, S_GC, race.favorites, racePicks.gc.outsider);
      weighted += r.raw;
      if (r.lines.length) groups.push({ title: "Classement général", lines: r.lines, subtotal: r.raw * coeff });
    }

    if (race.jerseys && racePicks?.jerseys) {
      const lines = [];
      let jRaw = 0;
      if (racePicks.jerseys.points && racePicks.jerseys.points === race.jerseys.points) {
        jRaw += S_JERSEY.points;
        lines.push({ rider: race.jerseys.points, label: "Maillot à points", pts: S_JERSEY.points });
      }
      if (racePicks.jerseys.kom && racePicks.jerseys.kom === race.jerseys.kom) {
        jRaw += S_JERSEY.kom;
        lines.push({ rider: race.jerseys.kom, label: "Maillot montagne", pts: S_JERSEY.kom });
      }
      weighted += jRaw;
      if (lines.length) groups.push({ title: "Maillots", lines, subtotal: jRaw * coeff });
    }

    // Points d'étape : on calcule chaque étape séparément, puis on ne garde
    // que les N meilleures (plafond). Les autres sont affichées grisées.
    const perStage = [];
    (race.stages || []).forEach((st) => {
      if (!st.result) return;
      const pick = racePicks?.stages?.[st.n];
      if (!pick) return;
      const r = scorePodium(pick.podium, st.result, S_STAGE, race.favorites, null);
      if (r.lines.length === 0) return;
      perStage.push({ n: st.n, label: st.label, raw: r.raw, lines: r.lines });
    });

    const cap = STAGE_CAP[race.type] ?? 0;
    const ranked = [...perStage].sort((a, b) => b.raw - a.raw || a.n - b.n);
    const kept = new Set(ranked.slice(0, cap).map((s) => s.n));

    let sRaw = 0;
    const stageLines = [];
    perStage
      .sort((a, b) => a.n - b.n)
      .forEach((st) => {
        const counts = kept.has(st.n);
        if (counts) sRaw += st.raw;
        st.lines.forEach((l) =>
          stageLines.push({
            ...l,
            label: `${st.label} — ${l.label}`,
            dropped: !counts,
          })
        );
      });

    flat += sRaw;
    if (stageLines.length) {
      const overflow = perStage.length > cap;
      groups.push({
        title: overflow
          ? `Étapes · ${cap} meilleures retenues sur ${perStage.length}`
          : "Étapes",
        lines: stageLines,
        subtotal: sRaw,
        noCoeff: true,
      });
    }
  }

  return {
    raw: weighted,
    flat,
    coeff,
    total: weighted * coeff + flat,
    groups,
  };
}

/* Maximum théorique d'une course — sert au calcul du "% du max" */
export function maxForRace(race) {
  const coeff = COEFF[race.type];
  let weighted = S_GC.winner + S_GC.exactPlace * 2 + S_GC.outsiderTop5;
  let flat = 0;
  if (race.format === "stage") {
    weighted += S_JERSEY.points + S_JERSEY.kom;
    const withResult = (race.stages || []).filter((st) => st.result).length;
    const cap = STAGE_CAP[race.type] ?? 0;
    flat = Math.min(withResult, cap) * (S_STAGE.winner + S_STAGE.exactPlace * 2);
  }
  return weighted * coeff + flat;
}

/* --------------------------------------------------------------------------
   Verrouillage et affichage du temps
   -------------------------------------------------------------------------- */
export function isLocked(iso, now) {
  return new Date(iso).getTime() <= now;
}

export function countdown(iso, now) {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "Verrouillé";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

/* Affichage en heure de Maurice (UTC+4), quel que soit le fuseau du navigateur */
export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Indian/Mauritius",
  });
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long",
    timeZone: "Indian/Mauritius",
  });
}

/* --------------------------------------------------------------------------
   Transformation des lignes Supabase vers la forme utilisée par le moteur
   -------------------------------------------------------------------------- */
export function buildRace(row, stageRows) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    format: row.format,
    country: row.country,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startlist: row.startlist || [],
    favorites: row.favorites || [],
    result: row.result || null,
    gcResult: row.gc_result || null,
    jerseys: (row.jersey_points || row.jersey_kom)
      ? { points: row.jersey_points, kom: row.jersey_kom }
      : null,
    stages: (stageRows || [])
      .filter((s) => s.race_id === row.id)
      .sort((a, b) => a.n - b.n)
      .map((s) => ({
        n: s.n,
        label: s.label,
        profile: s.profile,
        startsAt: s.starts_at,
        result: s.result || null,
      })),
  };
}

/* picks[userId][raceId] = { oneday?, gc?, jerseys?, stages: {} } */
export function indexPicks(rows) {
  const out = {};
  (rows || []).forEach((p) => {
    if (!out[p.user_id]) out[p.user_id] = {};
    if (!out[p.user_id][p.race_id]) out[p.user_id][p.race_id] = { stages: {} };
    const bucket = out[p.user_id][p.race_id];
    if (p.kind === "stage") {
      bucket.stages[p.stage_n] = p.payload;
    } else {
      bucket[p.kind] = p.payload;
    }
  });
  return out;
}

/* Classement des joueurs sur un ensemble de courses */
export function leaderboard(profiles, picksByUser, races) {
  return profiles
    .map((prof) => {
      let total = 0;
      const perRace = {};
      races.forEach((race) => {
        const s = scoreRace(picksByUser[prof.id]?.[race.id], race);
        const pts = s?.total ?? 0;
        perRace[race.id] = pts;
        total += pts;
      });
      return { profile: prof, total, perRace };
    })
    .sort((a, b) => b.total - a.total || a.profile.pseudo.localeCompare(b.profile.pseudo));
}
