import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

/* =====================================================================
   MyPick — version multijoueur (Supabase)

   Chaque joueur a son compte. Les pronos des autres restent invisibles
   tant que la journée n'est pas clôturée — la règle est appliquée par
   la base de données, pas seulement par l'interface.

   CONFIGURATION : remplace les deux valeurs ci-dessous par celles de
   ton projet Supabase (Settings > API). Voir GUIDE_INSTALLATION.md
===================================================================== */

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "https://TON-PROJET.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "TA-CLE-ANON";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------- paliers de rareté ---------------- */
const TIERS = [
  { pts: 20,  label: "Exact",      color: "#8B8B9C" },
  { pts: 30,  label: "Rare",       color: "#7C5CFF" },
  { pts: 50,  label: "Très rare",  color: "#A78BFF" },
  { pts: 70,  label: "Méga rare",  color: "#3DE0B0" },
  { pts: 100, label: "Ultra rare", color: "#FFC94D" },
];

function tierFor(rate) {
  if (rate > 0.30) return TIERS[0];
  if (rate >= 0.20) return TIERS[1];
  if (rate >= 0.05) return TIERS[2];
  if (rate >= 0.005) return TIERS[3];
  return TIERS[4];
}

/* Cote décimale -> points.
   Loi de puissance calée sur le barème MPP : 66 × (cote − 1)^0.327
   Le favori est écrasé, l'outsider récompensé mais plafonné.
     1.10 -> 31 · 2.00 -> 66 · 5.00 -> 104 · 11.0 -> 140 · 21.0 -> 175 */
const ODDS_K = 65.79;
const ODDS_P = 0.3271;
const oddsToPoints = (o) => {
  const c = parseFloat(o);
  if (!isFinite(c) || c <= 1) return 0;
  return Math.round(ODDS_K * Math.pow(c - 1, ODDS_P));
};

/* ---------------- reconnaissance des clubs ---------------- */
const key = (s) => String(s || "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]/g, "");

const ALIASES = {
  "Arsenal":        ["arsenal","arsenalfc","afc"],
  "Aston Villa":    ["astonvilla","villa","avfc"],
  "Bournemouth":    ["bournemouth","afcbournemouth","afcbmouth","bmouth"],
  "Brentford":      ["brentford","brentfordfc","bees"],
  "Brighton":       ["brighton","brightonandhovealbion","brightonhovealbion","brightonalbion","bha"],
  "Chelsea":        ["chelsea","chelseafc","cfc"],
  "Coventry":       ["coventry","coventrycity","covcity","ccfc"],
  "Crystal Palace": ["crystalpalace","palace","cpfc"],
  "Everton":        ["everton","evertonfc","efc"],
  "Fulham":         ["fulham","fulhamfc","ffc"],
  "Hull":           ["hull","hullcity","hullcityafc","hcafc"],
  "Ipswich":        ["ipswich","ipswichtown","itfc"],
  "Leeds":          ["leeds","leedsunited","leedsutd","lufc"],
  "Liverpool":      ["liverpool","liverpoolfc","lfc"],
  "Man City":       ["mancity","manchestercity","manchestercityfc","mcfc","mancityfc","city"],
  "Man United":     ["manunited","manutd","manchesterunited","manchesterutd","manchesterunitedfc","mufc","manu","unitedmanchester"],
  "Newcastle":      ["newcastle","newcastleunited","newcastleutd","nufc","toon"],
  "Nott'm Forest":  ["nottmforest","nottinghamforest","nottsforest","nottingham","forest","nffc","nottmfor"],
  "Sunderland":     ["sunderland","sunderlandafc","safc"],
  "Tottenham":      ["tottenham","tottenhamhotspur","spurs","thfc","tottenhamhotspurfc"],
};


/* les noms canoniques sont les clés de ALIASES — ils doivent correspondre
   exactement aux valeurs stockées dans la base (colonnes home / away) */
const CLUBS = Object.keys(ALIASES);

/* Écussons servis par football-data.org (accès libre, sans clé).
   Si une image ne charge pas, le composant Club masque l'écusson
   et n'affiche que le nom — aucun carré cassé. */
const CRESTS = {
  "Arsenal": 57, "Aston Villa": 58, "Bournemouth": 1044, "Brentford": 402,
  "Brighton": 397, "Chelsea": 61, "Coventry": 1076, "Crystal Palace": 354,
  "Everton": 62, "Fulham": 63, "Hull": 322, "Ipswich": 349,
  "Leeds": 341, "Liverpool": 64, "Man City": 65, "Man United": 66,
  "Newcastle": 67, "Nott'm Forest": 351, "Sunderland": 71, "Tottenham": 73,
};
const crestUrl = (club) =>
  CRESTS[club] ? `https://crests.football-data.org/${CRESTS[club]}.png` : null;

const CLUB_LOOKUP = {};
CLUBS.forEach((c) => { CLUB_LOOKUP[key(c)] = c; });
Object.entries(ALIASES).forEach(([club, list]) => list.forEach((a) => { CLUB_LOOKUP[key(a)] = club; }));
const matchClub = (raw) => CLUB_LOOKUP[key(raw)] || null;

/* nombre depuis une cellule : gère "3,40" et "3.40" */
const parseNum = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = parseFloat(String(v).replace(",", ".").replace(/\s/g, ""));
  return isNaN(n) ? NaN : n;
};

/* ---------------- horaires ----------------
   Maurice est à UTC+4 toute l'année (pas d'heure d'été), donc un décalage
   fixe suffit. Les horaires sont stockés en UTC et affichés en heure locale. */
const MU_OFFSET_H = 4;
const SEASON_START_YEAR = 2026;

/* "21/08" + "21:00" saisis en heure de Maurice -> instant UTC */
function parseKickoff(dateStr, timeStr) {
  if (!dateStr) return null;
  const ds = String(dateStr).trim();
  const ts = String(timeStr || "").trim();
  let d, m, y;

  let mt = ds.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (mt) {
    d = +mt[1]; m = +mt[2];
    y = mt[3] ? (+mt[3] < 100 ? 2000 + +mt[3] : +mt[3]) : null;
  } else {
    mt = ds.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!mt) return null;
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  }
  if (!m || !d || m > 12 || d > 31) return null;
  /* août-décembre = première moitié de saison, janvier-mai = année suivante */
  if (!y) y = m >= 7 ? SEASON_START_YEAR : SEASON_START_YEAR + 1;

  let hh = 0, mm = 0;
  if (ts) {
    const tm = ts.match(/^(\d{1,2})[h:.](\d{2})?/i);
    if (tm) { hh = +tm[1]; mm = tm[2] ? +tm[2] : 0; }
  }
  const dt = new Date(Date.UTC(y, m - 1, d, hh - MU_OFFSET_H, mm));
  return isNaN(dt.getTime()) ? null : dt;
}

const J_COURT = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const M_COURT = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];

/* instant UTC -> "ven 21 août · 21h00" en heure de Maurice */
function fmtKickoff(iso) {
  if (!iso) return null;
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  const mu = new Date(dt.getTime() + MU_OFFSET_H * 3600 * 1000);
  const hh = String(mu.getUTCHours()).padStart(2, "0");
  const mi = String(mu.getUTCMinutes()).padStart(2, "0");
  return `${J_COURT[mu.getUTCDay()]} ${String(mu.getUTCDate()).padStart(2, "0")} ${M_COURT[mu.getUTCMonth()]} · ${hh}h${mi}`;
}

const outcome = (h, a) => (h > a ? "1" : h < a ? "2" : "N");
const filled = (p) => p && p.home !== "" && p.away !== "";

const jokerOn = (jokers, playerId, matchId, halfOf) => {
  const j = jokers[playerId];
  if (!j) return false;
  return j[halfOf[matchId]] === matchId;
};

/* ---------------- calcul du classement ---------------- */
function computeScores(players, predictions, results, jokers, odds, MATCHDAYS, MATCH_HALF) {
  const totals = {};
  players.forEach((p) => (totals[p.id] = {
    points: 0, exact: 0, correct: 0, played: 0, best: null,
  }));

  MATCHDAYS.forEach((md) =>
    md.matches.forEach((match) => {
      const res = results[match.id];
      if (!filled(res)) return;
      const real = outcome(+res.home, +res.away);
      const o = odds[match.id];
      const basePts = o && o[real] ? +o[real] : 0;

      /* combien ont le bon résultat, et parmi eux combien ont le score exact */
      let rightOutcome = 0, exactCount = 0;
      players.forEach((p) => {
        const pr = predictions[p.id]?.[match.id];
        if (!filled(pr)) return;
        if (outcome(+pr.home, +pr.away) !== real) return;
        rightOutcome++;
        if (+pr.home === +res.home && +pr.away === +res.away) exactCount++;
      });

      const rate = rightOutcome > 0 ? exactCount / rightOutcome : 0;
      const tier = tierFor(rate);

      players.forEach((p) => {
        const pr = predictions[p.id]?.[match.id];
        if (!filled(pr)) return;
        totals[p.id].played++;
        if (outcome(+pr.home, +pr.away) !== real) return;

        totals[p.id].correct++;
        let pts = basePts;
        const isExact = +pr.home === +res.home && +pr.away === +res.away;
        if (isExact) { totals[p.id].exact++; pts += tier.pts; }
        const dbl = jokerOn(jokers, p.id, match.id, MATCH_HALF) ? 2 : 1;
        pts *= dbl;
        totals[p.id].points += pts;
        if (!totals[p.id].best || pts > totals[p.id].best.pts) {
          totals[p.id].best = { pts, match: match.home + " – " + match.away, tier: isExact ? tier.label : null, dbl: dbl > 1 };
        }
      });
    })
  );
  Object.values(totals).forEach((t) => (t.points = Math.round(t.points)));
  return totals;
}


/* Nom de club avec son écusson. `align` place l'écusson du bon côté
   pour que les deux équipes se fassent face autour du score. */
/* Pastilles de forme : V vert · N gris · D rouge, du plus ancien au plus récent.
   align aligne les pastilles côté équipe (droite pour l'équipe à domicile). */
function Forme({ results, align = "left" }) {
  if (!results || results.length === 0) return null;
  const color = { V: "#3DE0B0", N: "#7A7A8C", D: "#E5484D" };
  return (
    <span
      aria-label={`Forme : ${results.join(" ")}`}
      style={{
        display: "flex", gap: 4, alignItems: "center",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      {results.map((r, i) => (
        <span key={i} title={r} style={{
          width: 7, height: 7, borderRadius: "50%",
          background: color[r] || "#7A7A8C", flexShrink: 0,
        }} />
      ))}
    </span>
  );
}

function Club({ name, align = "left", size = 22 }) {
  const [broken, setBroken] = React.useState(false);
  const url = crestUrl(name);
  const showImg = url && !broken;

  return (
    <span
      className="club"
      style={{
        flex: 1, display: "flex", alignItems: "center", gap: 8,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        fontWeight: 500, fontSize: 14.5, minWidth: 0,
      }}
    >
      {align === "right" && <span style={{ textAlign: "right", minWidth: 0 }}>{name}</span>}
      {showImg && (
        <img
          src={url} alt="" aria-hidden="true" loading="lazy" width={size} height={size}
          onError={() => setBroken(true)}
          style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
        />
      )}
      {align === "left" && <span style={{ minWidth: 0 }}>{name}</span>}
    </span>
  );
}

/* Logo MyPick — lettres dessinées dans l'esprit des flocages de maillot :
   fûts épais et constants, terminaisons carrées, pas de courbe molle.
   `scale` pilote tout : 1 = 58px de hauteur de capitale. */
function Logo({ scale = 1, withMark = true, className = "" }) {
  const w = withMark ? 466 : 350;
  return (
    <svg
      viewBox={`0 0 ${w} 74`}
      height={74 * scale}
      width={w * scale}
      role="img"
      aria-label="MyPick"
      className={className}
      style={{ display: "block", overflow: "visible", maxWidth: "100%" }}
    >
      <title>MyPick</title>
      {withMark && (
        <g>
          <rect x="0" y="0" width="74" height="74" rx="18" fill="#7C5CFF" />
          <g fill="#0B0B12">
            <rect x="13" y="22" width="7" height="30" />
            <rect x="34" y="22" width="7" height="30" />
            <path d="M20 22 L23.5 22 L27 34 L30.5 22 L34 22 L34 30 L29 44 L25 44 L20 30 Z" />
            <rect x="47" y="22" width="7" height="30" />
            <path d="M54 22 L61 22 L61 36 L54 36 L54 33 L58 33 L58 25 L54 25 Z" />
          </g>
        </g>
      )}

      <g transform={`translate(${withMark ? 100 : 0},8)`}>
        <g fill="#F4F4F7">
          <rect x="0" y="0" width="11" height="58" />
          <rect x="34" y="0" width="11" height="58" />
          <path d="M11 0 L17 0 L22.5 26 L28 0 L34 0 L34 15 L26 46 L19 46 L11 15 Z" />
          <path d="M57 0 L68 0 L78 24 L88 0 L99 0 L99 9 L83.5 38 L83.5 58 L72.5 58 L72.5 38 L57 9 Z" />
        </g>

        <circle cx="114" cy="16" r="5" fill="#3DE0B0" />
        <circle cx="114" cy="42" r="5" fill="#3DE0B0" />

        <g transform="translate(128,0)" fill="#A78BFF">
          <path d="M0 0 L38 0 L38 31 L11 31 L11 58 L0 58 Z M11 11 L11 20 L27 20 L27 11 Z" />
          <rect x="48" y="0" width="11" height="58" />
          <path d="M73 0 L108 0 L108 11 L84 11 L84 47 L108 47 L108 58 L73 58 Z" />
          <rect x="120" y="0" width="11" height="58" />
          <path d="M131 26 L143 0 L156 0 L142 29 L156 58 L143 58 L131 32 Z" />
        </g>

        <g transform="translate(181,0)">
          <circle cx="0" cy="-14" r="9.5" fill="#F4F4F7" />
          <path d="M0 -21 L5.7 -16.8 L3.5 -10.2 L-3.5 -10.2 L-5.7 -16.8 Z" fill="#07070C" />
          <path d="M0 -21 L0 -25.5 M5.7 -16.8 L10 -19 M3.5 -10.2 L6 -6.2 M-3.5 -10.2 L-6 -6.2 M-5.7 -16.8 L-10 -19"
            stroke="#07070C" strokeWidth="1.3" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

/* ===================== PALETTE ===================== */
const C = {
  ink:       "#07070C",   // fond, plus profond qu'avant
  surface:   "#13131C",   // cartes : opaque, franchement détachées du fond
  surfaceHi: "#1B1B27",   // survol et zones secondaires
  sunken:    "#0B0B12",   // champs et bandes en creux
  line:      "rgba(255,255,255,0.10)",
  lineSoft:  "rgba(255,255,255,0.05)",
  text:      "#F4F4F7",
  dim:       "#B4B4C4",   // texte secondaire lisible
  muted:     "#7A7A8C",   // texte tertiaire
  volt:      "#7C5CFF",
  voltSoft:  "#A78BFF",
  mint:      "#3DE0B0",
  gold:      "#FFC94D",   // accent joker
  olympic:   "#E8B84B",   // or profond, titres de journée
  danger:    "#FF8080",
};

const S = {
  wrap: {
    minHeight: "100vh", background: C.ink,
    backgroundImage:
      `radial-gradient(900px 420px at 10% -10%, rgba(124,92,255,0.16), transparent 62%),
       radial-gradient(700px 340px at 95% 2%, rgba(61,224,176,0.07), transparent 58%)`,
    color: C.text, fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    /* env(safe-area-inset-*) vaut 0 sur navigateur classique et prend la
       hauteur de la barre d'état une fois l'app installée sur l'écran d'accueil */
    paddingTop: "calc(28px + env(safe-area-inset-top))",
    paddingLeft: "calc(16px + env(safe-area-inset-left))",
    paddingRight: "calc(16px + env(safe-area-inset-right))",
    paddingBottom: "calc(80px + env(safe-area-inset-bottom))",
    position: "relative",
  },
  inner: { maxWidth: 860, margin: "0 auto" },
  card: {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
    padding: "16px 18px", marginBottom: 10,
    boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.32)",
    transition: "background 160ms ease, border-color 160ms ease",
  },
  score: {
    width: 52, height: 52, background: C.sunken, border: `1px solid ${C.line}`,
    color: C.text, fontSize: 32, fontWeight: 600, textAlign: "center", borderRadius: 12,
    fontFamily: "'Teko', 'Inter', system-ui, sans-serif",
    outline: "none", transition: "border-color 140ms ease, background 140ms ease",
  },
  oddIn: {
    width: 62, height: 38, background: C.sunken, border: `1px solid ${C.line}`,
    color: C.text, fontSize: 20, fontWeight: 600, textAlign: "center", borderRadius: 9,
    outline: "none", fontFamily: "'Teko', 'Inter', system-ui, sans-serif",
  },
  pill: (on) => ({
    padding: "8px 15px", background: on ? C.text : C.surface,
    color: on ? C.ink : C.dim,
    border: `1px solid ${on ? C.text : C.line}`, borderRadius: 9, cursor: "pointer",
    fontWeight: on ? 700 : 500, fontSize: 12.5, transition: "all 150ms ease", fontFamily: "inherit",
  }),
  btn: {
    padding: "12px 20px", background: `linear-gradient(135deg, ${C.volt}, ${C.voltSoft})`,
    color: "#fff", border: "none", borderRadius: 12, fontWeight: 600, fontSize: 13.5,
    cursor: "pointer", boxShadow: "0 6px 20px rgba(124,92,255,0.30)", fontFamily: "inherit",
  },
  ghost: {
    padding: "9px 15px", background: "transparent", border: `1px solid ${C.line}`,
    color: C.muted, borderRadius: 10, fontWeight: 600, fontSize: 12.5, cursor: "pointer",
    fontFamily: "inherit",
  },
  field: {
    padding: "12px 14px", background: C.sunken, border: `1px solid ${C.line}`,
    color: C.text, borderRadius: 11, outline: "none", fontSize: 14, fontFamily: "inherit",
  },
  nav: {
    width: 42, height: 42, display: "grid", placeItems: "center", background: C.surface,
    border: `1px solid ${C.line}`, color: C.text, borderRadius: 11, cursor: "pointer", fontSize: 18,
    transition: "background 140ms ease, border-color 140ms ease",
  },
};

const GLOBAL_CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Teko:wght@500;600;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: #07070C; -webkit-font-smoothing: antialiased; }
  input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
  input[type=number] { -moz-appearance:textfield; }
  input:focus, select:focus { border-color:#7C5CFF !important; background:rgba(124,92,255,0.10) !important; }
  button:focus-visible { outline:2px solid #7C5CFF; outline-offset:2px; }
  .row:hover { background:#1B1B27; }
  select option { background:#13131C; color:#F4F4F7; }
  input:disabled { opacity:0.5; cursor:not-allowed; }
  .match:hover { border-color: rgba(255,255,255,0.16) !important; }
  .num { font-family: 'Teko', 'Inter', system-ui, sans-serif; font-feature-settings: 'tnum'; line-height: 1; }
  input.num { padding-top: 3px; }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; animation:none !important; } }
  .club > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bonus-inline { display: none; }
  @keyframes splashPulse {
    0%, 100% { opacity: 0.45; transform: scale(0.985); }
    50%      { opacity: 1;    transform: scale(1); }
  }
  .splash-logo { animation: splashPulse 1.6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .splash-logo { animation: none; opacity: 0.85; } }
  .lbl-short { display: none; }
  .colhead { font-size: 10.5px !important; letter-spacing: 0.05em; white-space: nowrap; overflow: hidden; }
  @media (max-width:600px){
    .applogo { width: 178px !important; height: 28px !important; }
    .club { font-size:12.5px !important; gap:6px !important; }
    .club img { width:19px !important; height:19px !important; }
    .score-in { width:46px !important; height:46px !important; font-size:28px !important; }
    .col-num { width: 38px !important; font-size: 17px !important; }
    .col-pts { width: 56px !important; }
    .colhead { font-size: 9.5px !important; letter-spacing: 0.02em; }
    .lbl-long { display: none !important; }
    .lbl-short { display: inline !important; }
  }
  @media (max-width:440px){
    .col-bonus { display: none !important; }
    .col-num { width: 34px !important; }
    .bonus-inline { display: block !important; }
  }
  @media (max-width:400px){
    .applogo { width: 152px !important; height: 24px !important; }
    .club { font-size:11.5px !important; }
    .col-pts { width: 52px !important; font-size: 21px !important; }
  }`;


/* Écran d'attente : le logo pulse doucement le temps du chargement.
   `message` n'apparaît qu'en cas d'erreur, pour ne pas parasiter l'attente. */
function Splash({ message }) {
  return (
    <div style={{ ...S.wrap, display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ textAlign: "center", padding: "0 20px" }}>
        <div className="splash-logo" style={{ display: "flex", justifyContent: "center" }}>
          <Logo scale={0.62} />
        </div>
        {message && (
          <p style={{ color: C.danger, fontSize: 12.5, marginTop: 22, maxWidth: 320, lineHeight: 1.6 }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

/* ===================== ÉCRAN DE CONNEXION ===================== */
function NewPasswordScreen({ onDone }) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setMsg(null);
    if (pwd.length < 6) return setMsg("Mot de passe : 6 caractères minimum.");
    if (pwd !== pwd2) return setMsg("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      onDone();
    } catch (e) {
      setMsg(e.message);
      setBusy(false);
    }
  };

  return (
    <div style={{ ...S.wrap, display: "grid", placeItems: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", justifyContent: "center", margin: "0 0 14px" }}>
          <Logo scale={0.58} />
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Nouveau mot de passe</div>
          <p style={{ fontSize: 12, color: C.muted, margin: "0 0 16px", lineHeight: 1.5 }}>
            Choisis un nouveau mot de passe pour ton compte.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <input value={pwd} onChange={(e) => setPwd(e.target.value)}
              placeholder="Nouveau mot de passe" type="password" style={S.field} autoComplete="new-password" />
            <input value={pwd2} onChange={(e) => setPwd2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && save()}
              placeholder="Confirme le mot de passe" type="password" style={S.field} autoComplete="new-password" />
            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>
              {busy ? "…" : "Enregistrer"}
            </button>
          </div>
          {msg && <p style={{ fontSize: 12.5, marginTop: 14, marginBottom: 0, color: C.danger, lineHeight: 1.5 }}>{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const sendReset = async () => {
    setMsg(null);
    if (!email.trim()) return setMsg({ t: "err", m: "Entre ton email pour recevoir le lien." });
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setMsg({ t: "ok", m: "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé. Pense à vérifier tes spams." });
    } catch (e) {
      setMsg({ t: "err", m: e.message });
    }
    setBusy(false);
  };

  const submit = async () => {
    setMsg(null);
    if (mode === "reset") return sendReset();
    if (!email.trim() || !pwd) return setMsg({ t: "err", m: "Email et mot de passe requis." });
    if (mode === "signup" && !pseudo.trim()) return setMsg({ t: "err", m: "Choisis un pseudo." });
    if (mode === "signup" && pwd.length < 6) return setMsg({ t: "err", m: "Mot de passe : 6 caractères minimum." });

    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pwd,
          options: { data: { pseudo: pseudo.trim() } },
        });
        if (error) throw error;
        setMsg({ t: "ok", m: "Compte créé. Vérifie ta boîte mail pour confirmer, puis connecte-toi." });
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(), password: pwd,
        });
        if (error) throw error;
      }
    } catch (e) {
      const map = {
        "Invalid login credentials": "Email ou mot de passe incorrect.",
        "Email not confirmed": "Confirme d'abord ton email — vérifie ta boîte de réception.",
        "User already registered": "Un compte existe déjà avec cet email.",
      };
      setMsg({ t: "err", m: map[e.message] || e.message });
    }
    setBusy(false);
  };

  return (
    <div style={{ ...S.wrap, display: "grid", placeItems: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", justifyContent: "center", margin: "0 0 14px" }}>
          <Logo scale={0.58} />
        </div>
        <p style={{ color: C.muted, fontSize: 13, textAlign: "center", margin: "0 0 26px" }}>
          Premier League 2026/27
        </p>

        <div style={S.card}>
          {mode === "reset" ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Réinitialiser le mot de passe</div>
              <p style={{ fontSize: 12, color: C.muted, margin: "5px 0 0", lineHeight: 1.5 }}>
                Entre ton email : tu recevras un lien pour choisir un nouveau mot de passe.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button style={{ ...S.pill(mode === "login"), flex: 1 }} onClick={() => { setMode("login"); setMsg(null); }}>
                Connexion
              </button>
              <button style={{ ...S.pill(mode === "signup"), flex: 1 }} onClick={() => { setMode("signup"); setMsg(null); }}>
                Créer un compte
              </button>
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {mode === "signup" && (
              <input value={pseudo} onChange={(e) => setPseudo(e.target.value)}
                placeholder="Pseudo affiché au classement" style={S.field} autoComplete="nickname" />
            )}
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && mode === "reset" && submit()}
              placeholder="Email" type="email" style={S.field} autoComplete="email" />
            {mode !== "reset" && (
              <input value={pwd} onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
                placeholder="Mot de passe" type="password" style={S.field}
                autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            )}
            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
              {busy ? "…" : mode === "signup" ? "Créer mon compte" : mode === "reset" ? "Envoyer le lien" : "Se connecter"}
            </button>
          </div>

          {mode === "login" && (
            <button onClick={() => { setMode("reset"); setMsg(null); }}
              style={{
                background: "none", border: "none", color: C.muted, fontSize: 12,
                cursor: "pointer", marginTop: 12, padding: 0, fontFamily: "inherit",
                textDecoration: "underline", textUnderlineOffset: 2,
              }}>
              Mot de passe oublié ?
            </button>
          )}
          {mode === "reset" && (
            <button onClick={() => { setMode("login"); setMsg(null); }}
              style={{
                background: "none", border: "none", color: C.muted, fontSize: 12,
                cursor: "pointer", marginTop: 12, padding: 0, fontFamily: "inherit",
                textDecoration: "underline", textUnderlineOffset: 2,
              }}>
              ← Retour à la connexion
            </button>
          )}

          {msg && (
            <p style={{ fontSize: 12.5, marginTop: 14, marginBottom: 0, lineHeight: 1.5,
              color: msg.t === "err" ? C.danger : C.mint }}>
              {msg.m}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


/* ===================== APPLICATION ===================== */
export default function MyPick() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [recovering, setRecovering] = useState(false);   // arrivé par lien "mot de passe oublié"

  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [matchdays, setMatchdays] = useState([]);
  const [matches, setMatches] = useState([]);
  const [myPreds, setMyPreds] = useState({});
  const [allPreds, setAllPreds] = useState([]);

  const [mdIndex, setMdIndex] = useState(0);
  const defaultMdDone = useRef(false);   // n'ouvre sur la journée courante qu'une fois
  const [tab, setTab] = useState("pronos");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmLock, setConfirmLock] = useState(false);
  const [rankScope, setRankScope] = useState("all");   // "all" | id de journée
  const [openMatch, setOpenMatch] = useState(null);    // id du match déplié dans Mes points
  const [openBonusPlayer, setOpenBonusPlayer] = useState(null);   // id du joueur dont on voit les bonus dans le classement
  const [bonusOptions, setBonusOptions] = useState([]);
  const [bonusPreds, setBonusPreds] = useState([]);
  const [bonusSettled, setBonusSettled] = useState({});   // { buteur:false, passeur:false, vainqueur:false }
  const [bonusPreview, setBonusPreview] = useState(null);
  const [freeText, setFreeText] = useState({});
  const bonusFileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  /* --- session --- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session); setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const flash = useCallback((m, ms = 2600) => {
    setStatus(m); setTimeout(() => setStatus(""), ms);
  }, []);

  /* --- chargement des données --- */
  const loadAll = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const [pRes, mdRes, mRes, prRes, allRes, boRes, bpRes, bsRes] = await Promise.all([
        supabase.from("profiles").select("id, pseudo, is_admin"),
        supabase.from("matchdays").select("*").order("id"),
        supabase.from("matches").select("*").order("id"),
        supabase.from("predictions").select("*").eq("user_id", session.user.id),
        supabase.from("predictions").select("user_id, match_id, home, away, joker"),
        supabase.from("bonus_options").select("*").order("category").order("points"),
        supabase.from("bonus_predictions").select("*"),
        supabase.from("bonus_settlement").select("*"),
      ]);
      if (pRes.error) throw pRes.error;

      setProfiles(pRes.data || []);
      setProfile((pRes.data || []).find((p) => p.id === session.user.id) || null);
      const mds = mdRes.data || [];
      const mts = mRes.data || [];
      setMatchdays(mds);
      setMatches(mts);

      /* à la première ouverture, se placer sur la prochaine journée non terminée
         (celle qui a encore au moins un match sans résultat). */
      if (!defaultMdDone.current && mds.length) {
        defaultMdDone.current = true;
        const idx = mds.findIndex((d) =>
          mts.some((m) => m.matchday_id === d.id && (m.result_home === null || m.result_away === null))
        );
        setMdIndex(idx >= 0 ? idx : mds.length - 1);
      }

      const mine = {};
      (prRes.data || []).forEach((r) => { mine[r.match_id] = r; });
      setMyPreds(mine);
      setAllPreds(allRes.data || []);
      setBonusOptions(boRes.data || []);
      setBonusPreds(bpRes.data || []);
      const settled = {};
      (bsRes?.data || []).forEach((r) => { settled[r.category] = r.settled; });
      setBonusSettled(settled);
    } catch (e) {
      flash("Erreur de chargement : " + e.message, 5000);
    }
    setLoading(false);
  }, [session, flash]);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* --- dépliage d'un match : Échap le referme (sans bloquer le défilement) --- */
  useEffect(() => {
    if (!openMatch) return;
    const onKey = (e) => { if (e.key === "Escape") setOpenMatch(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openMatch]);

  /* --- temps réel : le classement bouge quand quelqu'un joue --- */
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel("mypick")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "matchdays" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "bonus_options" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "bonus_predictions" }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, loadAll]);

  /* --- horloge calée sur le SERVEUR, pas sur le téléphone ---
     On demande l'heure réelle à Supabase et on mémorise l'écart avec
     l'horloge locale (skew). Ensuite `now` = heure locale + écart, ce
     qui reste juste même si le joueur trafique l'heure de son téléphone.
     Le verrouillage financier, lui, est de toute façon garanti côté base. */
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    supabase.rpc("server_now").then(({ data, error }) => {
      if (!alive || error || !data) return;
      const serverMs = Date.parse(data);
      if (!isNaN(serverMs)) setSkew(serverMs - Date.now());
    });
    const t = setInterval(() => { if (alive) setNow(Date.now()); }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const serverNow = now + skew;   // heure de référence pour tous les verrouillages

  /* un match est verrouillé si son coup d'envoi est passé (ou la journée close à la main) */
  const matchLocked = useCallback((m) => {
    if (!m) return false;
    if (m.kickoff && Date.parse(m.kickoff) <= serverNow) return true;
    const d = matchdays.find((x) => x.id === m.matchday_id);
    return !!d?.is_locked;
  }, [serverNow, matchdays]);

  /* un match est "commencé" : ses pronos deviennent visibles de tous */
  const matchStarted = useCallback((m) => {
    if (!m) return false;
    if (m.kickoff && Date.parse(m.kickoff) <= serverNow) return true;
    const d = matchdays.find((x) => x.id === m.matchday_id);
    return !!d?.is_locked;
  }, [serverNow, matchdays]);

  /* --- dérivés --- */
  const md = matchdays[mdIndex] || null;
  const mdMatches = useMemo(
    () => {
      if (!md) return [];
      return matches
        .filter((m) => m.matchday_id === md.id)
        .sort((a, b) => {
          /* tri chronologique par coup d'envoi ; les matchs sans horaire
             passent en dernier, dans l'ordre de leur id */
          const ka = a.kickoff ? Date.parse(a.kickoff) : Infinity;
          const kb = b.kickoff ? Date.parse(b.kickoff) : Infinity;
          if (ka !== kb) return ka - kb;
          return a.id - b.id;
        });
    },
    [matches, md]
  );
  const mdLocked = md ? md.is_locked : false;
  const isAdmin = !!profile?.is_admin;

  const MATCH_HALF = useMemo(() => {
    const h = {};
    const byMd = {};
    matchdays.forEach((d) => { byMd[d.id] = d.half; });
    matches.forEach((m) => { h[m.id] = byMd[m.matchday_id]; });
    return h;
  }, [matches, matchdays]);

  const MD_OF = useMemo(() => {
    const o = {};
    matches.forEach((m) => { o[m.id] = m.matchday_id; });
    return o;
  }, [matches]);

  /* ================= BONUS DE SAISON ================= */

  const BONUS_CATS = [
    { key: "buteur",    label: "Meilleur buteur" },
    { key: "passeur",   label: "Meilleur passeur" },
    { key: "vainqueur", label: "Vainqueur de la Premier League" },
  ];

  /* les pronos bonus se ferment dès que la saison commence :
     au coup d'envoi du tout premier match de la J1 (heure serveur).
     Clôture manuelle de la J1 conservée comme filet de secours. */
  const bonusOpen = useMemo(() => {
    const j1 = matchdays.find((d) => d.id === 1);
    if (j1?.is_locked) return false;
    const j1Matches = matches.filter((m) => m.matchday_id === 1 && m.kickoff);
    if (j1Matches.length === 0) return true;   // pas encore d'horaires -> ouvert
    const firstKick = Math.min(...j1Matches.map((m) => Date.parse(m.kickoff)));
    return serverNow < firstKick;
  }, [matchdays, matches, serverNow]);

  const myBonus = useMemo(() => {
    const o = {};
    bonusPreds.filter((b) => b.user_id === session?.user?.id)
              .forEach((b) => { o[b.category] = b; });
    return o;
  }, [bonusPreds, session]);

  const optionsByCat = useMemo(() => {
    const o = { buteur: [], passeur: [], vainqueur: [] };
    bonusOptions.forEach((x) => { if (o[x.category]) o[x.category].push(x); });
    Object.values(o).forEach((list) =>
      list.sort((a, b) => (a.is_other ? 1 : b.is_other ? -1 : a.points - b.points))
    );
    return o;
  }, [bonusOptions]);

  /* points bonus par joueur, une fois les gagnants cochés */
  const bonusPointsByUser = useMemo(() => {
    const out = {};
    const winners = {};
    bonusOptions.forEach((o) => { if (o.is_winner) winners[o.category] = o; });

    bonusPreds.forEach((b) => {
      const opt = bonusOptions.find((o) => o.id === b.option_id);
      if (!opt) return;
      const win = winners[b.category];
      /* les points ne comptent QUE si la catégorie est réglée (fin de saison).
         Tant qu'elle ne l'est pas, le pari est affiché mais rapporte zéro. */
      const settled = !!bonusSettled[b.category];
      let pts = 0;
      if (settled) {
        if (opt.is_other) {
          if (b.is_correct) pts = opt.points;   /* "Autre" validé à la main */
        } else if (win && win.id === opt.id) {
          pts = opt.points;
        }
      }
      if (!out[b.user_id]) out[b.user_id] = { total: 0, detail: {} };
      out[b.user_id].total += pts;
      out[b.user_id].detail[b.category] = { pts, opt, free: b.free_text, ok: pts > 0, settled };
    });
    return out;
  }, [bonusPreds, bonusOptions, bonusSettled]);

  const saveBonus = async (category, optionId, text) => {
    if (!bonusOpen) return flash("Les pronos bonus sont fermés");
    const opt = bonusOptions.find((o) => o.id === optionId);
    const row = {
      user_id: session.user.id,
      category,
      option_id: optionId,
      free_text: opt?.is_other ? (text || "").trim() || null : null,
      updated_at: new Date().toISOString(),
    };
    setBonusPreds((prev) => [
      ...prev.filter((b) => !(b.user_id === session.user.id && b.category === category)),
      row,
    ]);
    const { error } = await supabase.from("bonus_predictions")
      .upsert(row, { onConflict: "user_id,category" });
    if (error) { flash(error.message, 4000); loadAll(); }
    else { setStatus("Enregistré"); setTimeout(() => setStatus(""), 1200); }
  };

  const setBonusWinner = async (optionId, category) => {
    const cur = bonusOptions.find((o) => o.id === optionId);
    const next = !cur?.is_winner;
    setBonusOptions((prev) => prev.map((o) =>
      o.category === category ? { ...o, is_winner: o.id === optionId ? next : false } : o
    ));
    const { error } = await supabase.from("bonus_options")
      .update({ is_winner: next }).eq("id", optionId);
    if (error) { flash(error.message, 4000); loadAll(); }
    else loadAll();
  };

  const validateOther = async (userId, category, ok) => {
    setBonusPreds((prev) => prev.map((b) =>
      b.user_id === userId && b.category === category ? { ...b, is_correct: ok } : b
    ));
    const { error } = await supabase.from("bonus_predictions")
      .update({ is_correct: ok }).eq("user_id", userId).eq("category", category);
    if (error) { flash(error.message, 4000); loadAll(); }
  };

  const handleBonusFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const map = { buteur: "buteur", butteur: "buteur", passeur: "passeur",
                    vainqueur: "vainqueur", champion: "vainqueur" };
      const found = [];
      wb.SheetNames.forEach((sn) => {
        const cat = map[key(sn)];
        if (!cat) return;
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
        let order = 0;
        rows.forEach((row) => {
          if (!row || row.length < 2) return;
          const label = String(row[0] || "").trim();
          const pts = parseNum(row[1]);
          if (!label || isNaN(pts)) return;
          if (key(label) === "nom") return;               // en-tête
          found.push({
            category: cat, label, points: Math.round(pts),
            is_other: key(label) === "autre", sort_order: order++,
          });
        });
      });
      if (found.length === 0) return flash("Aucun candidat reconnu — vérifie les onglets", 4000);
      setBonusPreview({ found, fileName: file.name });
    } catch (err) {
      flash("Fichier illisible — vérifie le format", 4000);
    }
  };

  const applyBonusPreview = async () => {
    if (!bonusPreview) return;
    setStatus("Import en cours…");
    const cats = [...new Set(bonusPreview.found.map((f) => f.category))];
    for (const c of cats) {
      await supabase.from("bonus_options").delete().eq("category", c);
    }
    const { error } = await supabase.from("bonus_options").insert(bonusPreview.found);
    setBonusPreview(null);
    if (error) flash(error.message, 5000);
    else { await loadAll(); flash(bonusPreview.found.length + " candidats importés"); }
  };

  /* --- classement, calculé sur les pronos visibles (journées clôturées).
         rankScope === "all" : saison entière · sinon une seule journée --- */
  const ranking = useMemo(() => {
    const scopeId = rankScope === "all" ? null : Number(rankScope);
    const totals = {};
    profiles.forEach((p) => (totals[p.id] = { points: 0, exact: 0, correct: 0, played: 0 }));

    matches.forEach((match) => {
      /* un match compte dès qu'il a un résultat saisi — plus besoin
         d'attendre la clôture de la journée entière */
      if (match.result_home === null || match.result_away === null) return;
      if (scopeId !== null && match.matchday_id !== scopeId) return;
      const real = outcome(match.result_home, match.result_away);
      const basePts = { "1": match.pts_1, N: match.pts_n, "2": match.pts_2 }[real] || 0;

      const rows = allPreds.filter((r) => r.match_id === match.id);
      let right = 0, exact = 0;
      rows.forEach((r) => {
        if (outcome(r.home, r.away) !== real) return;
        right++;
        if (r.home === match.result_home && r.away === match.result_away) exact++;
      });
      const tier = tierFor(right > 0 ? exact / right : 0);

      rows.forEach((r) => {
        if (!totals[r.user_id]) return;
        totals[r.user_id].played++;
        if (outcome(r.home, r.away) !== real) return;
        totals[r.user_id].correct++;
        let pts = basePts;
        if (r.home === match.result_home && r.away === match.result_away) {
          totals[r.user_id].exact++;
          pts += tier.pts;
        }
        if (r.joker) pts *= 2;
        totals[r.user_id].points += pts;
      });
    });

    return profiles
      .map((p) => {
        const base = Math.round(totals[p.id]?.points || 0);
        /* les bonus de saison ne comptent que dans le classement général */
        const bonus = scopeId === null ? (bonusPointsByUser[p.id]?.total || 0) : 0;
        return { ...p, ...totals[p.id], bonus, points: base + bonus };
      })
      .sort((a, b) => b.points - a.points || b.exact - a.exact);
  }, [profiles, matches, allPreds, matchdays, rankScope, bonusPointsByUser]);

  const leader = ranking[0]?.points || 0;

  /* journées disponibles au filtre : clôturées et ayant au moins un résultat */
  const rankableMds = useMemo(() => {
    const withResult = new Set(
      matches.filter((m) => m.result_home !== null && m.result_away !== null).map((m) => m.matchday_id)
    );
    return matchdays.filter((d) => withResult.has(d.id));
  }, [matchdays, matches]);

  const jokerHalfUsed = useMemo(() => {
    const used = { 1: null, 2: null };
    Object.values(myPreds).forEach((p) => {
      if (p.joker) used[MATCH_HALF[p.match_id]] = p.match_id;
    });
    return used;
  }, [myPreds, MATCH_HALF]);

  const curHalf = md?.half || 1;
  const curJokerMatch = jokerHalfUsed[curHalf];
  const curJokerSpent = useMemo(() => {
    if (!curJokerMatch) return false;
    const d = matchdays.find((x) => x.id === MD_OF[curJokerMatch]);
    return !!d?.is_locked;
  }, [curJokerMatch, matchdays, MD_OF]);

  const doneCount = mdMatches.filter((m) => myPreds[m.id]).length;

  /* pronos de tous les joueurs sur un match, triés par points décroissants.
     N'a de sens qu'une fois la journée clôturée : avant, la base ne renvoie
     que les pronos du joueur lui-même. */
  /* forme récente de chaque équipe : ses 5 derniers résultats saisis,
     calculés à partir des scores déjà entrés dans l'app.
     "V" victoire · "N" nul · "D" défaite, du plus ancien au plus récent. */
  const teamForm = useMemo(() => {
    /* matchs terminés, dans l'ordre chronologique (par journée puis coup d'envoi) */
    const done = matches
      .filter((m) => m.result_home !== null && m.result_away !== null)
      .sort((a, b) => {
        if (a.matchday_id !== b.matchday_id) return a.matchday_id - b.matchday_id;
        const ka = a.kickoff ? Date.parse(a.kickoff) : 0;
        const kb = b.kickoff ? Date.parse(b.kickoff) : 0;
        return ka - kb;
      });

    const form = {};   // { "Arsenal": ["V","N",...], ... }
    const push = (team, res) => {
      if (!form[team]) form[team] = [];
      form[team].push(res);
    };
    done.forEach((m) => {
      const h = m.result_home, a = m.result_away;
      push(m.home, h > a ? "V" : h < a ? "D" : "N");
      push(m.away, a > h ? "V" : a < h ? "D" : "N");
    });
    /* ne garder que les 5 derniers de chaque équipe */
    Object.keys(form).forEach((t) => { form[t] = form[t].slice(-5); });
    return form;
  }, [matches]);

  const matchBoard = useCallback((match) => {
    if (match.result_home === null || match.result_away === null) {
      /* match pas encore joué : on liste les pronos sans points */
      return allPreds
        .filter((r) => r.match_id === match.id)
        .map((r) => ({
          user_id: r.user_id,
          pseudo: profiles.find((x) => x.id === r.user_id)?.pseudo || "?",
          home: r.home, away: r.away, joker: r.joker,
          pts: null, good: false, exact: false,
        }))
        .sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));
    }

    const real = outcome(match.result_home, match.result_away);
    const odd = { "1": match.pts_1, N: match.pts_n, "2": match.pts_2 }[real] || 0;
    const rows = allPreds.filter((r) => r.match_id === match.id);

    let right = 0, exactCount = 0;
    rows.forEach((r) => {
      if (outcome(r.home, r.away) !== real) return;
      right++;
      if (r.home === match.result_home && r.away === match.result_away) exactCount++;
    });
    const tier = tierFor(right > 0 ? exactCount / right : 0);

    return rows
      .map((r) => {
        const good = outcome(r.home, r.away) === real;
        const exact = r.home === match.result_home && r.away === match.result_away;
        let pts = good ? odd : 0;
        if (exact) pts += tier.pts;
        if (r.joker) pts *= 2;
        return {
          user_id: r.user_id,
          pseudo: profiles.find((x) => x.id === r.user_id)?.pseudo || "?",
          home: r.home, away: r.away, joker: r.joker,
          pts, good, exact,
        };
      })
      .sort((a, b) => b.pts - a.pts || a.pseudo.localeCompare(b.pseudo, "fr"));
  }, [allPreds, profiles]);

  /* détail des points du joueur pour la journée affichée */
  const myBreakdown = useMemo(() => {
    if (!md) return null;
    /* on affiche les points dès qu'au moins un match de la journée est terminé */
    const anyPlayed = mdMatches.some((m) => m.result_home !== null && m.result_away !== null);
    if (!anyPlayed) return null;
    const lines = mdMatches.map((match) => {
      const mine = myPreds[match.id];
      const played = match.result_home !== null && match.result_away !== null;
      if (!played) return { match, mine, played: false, pts: null };

      const real = outcome(match.result_home, match.result_away);
      const odd = { "1": match.pts_1, N: match.pts_n, "2": match.pts_2 }[real] || 0;

      if (!mine) return { match, mine: null, played: true, pts: 0, odd, real };

      const good = outcome(mine.home, mine.away) === real;
      const exact = mine.home === match.result_home && mine.away === match.result_away;

      /* palier de rareté : part de scores exacts parmi les bons résultats */
      const rows = allPreds.filter((r) => r.match_id === match.id);
      let right = 0, exactCount = 0;
      rows.forEach((r) => {
        if (outcome(r.home, r.away) !== real) return;
        right++;
        if (r.home === match.result_home && r.away === match.result_away) exactCount++;
      });
      const tier = tierFor(right > 0 ? exactCount / right : 0);

      let pts = good ? odd : 0;
      if (exact) pts += tier.pts;
      if (mine.joker) pts *= 2;

      return { match, mine, played: true, pts, odd, real, good, exact, tier, joker: !!mine.joker };
    });
    const total = lines.reduce((a, l) => a + (l.pts || 0), 0);
    const counted = lines.filter((l) => l.played).length;
    return { lines, total, counted };
  }, [md, mdMatches, myPreds, allPreds]);


  /* --- écriture d'un prono --- */
  const savePred = async (matchId, patch) => {
    const m = matches.find((x) => x.id === matchId);
    if (matchLocked(m)) return flash("Match commencé — pronos figés");
    const cur = myPreds[matchId] || { home: null, away: null, joker: false };
    const next = { ...cur, ...patch };
    if (next.home === null || next.away === null || next.home === "" || next.away === "") {
      setMyPreds((s) => ({ ...s, [matchId]: { ...next, match_id: matchId } }));
      return;
    }
    const row = {
      user_id: session.user.id, match_id: matchId,
      home: Math.max(0, Math.min(30, +next.home)),
      away: Math.max(0, Math.min(30, +next.away)),
      joker: !!next.joker, updated_at: new Date().toISOString(),
    };
    setMyPreds((s) => ({ ...s, [matchId]: row }));
    const { error } = await supabase.from("predictions").upsert(row, { onConflict: "user_id,match_id" });
    if (error) {
      flash(error.message.includes("Joker") ? "Joker déjà utilisé sur cette moitié de saison" : error.message, 4000);
      loadAll();
    } else {
      setStatus("Enregistré"); setTimeout(() => setStatus(""), 1200);
    }
  };

  const toggleJoker = async (matchId) => {
    const mtch = matches.find((x) => x.id === matchId);
    if (matchLocked(mtch)) return flash("Match commencé — pronos figés");
    const cur = myPreds[matchId];
    if (!cur || cur.home === null || cur.away === null) return flash("Saisis d'abord un score");
    if (cur.joker) return savePred(matchId, { joker: false });
    if (curJokerMatch && curJokerMatch !== matchId) {
      if (curJokerSpent) return flash("Joker déjà consommé sur cette moitié");
      await supabase.from("predictions")
        .update({ joker: false })
        .eq("user_id", session.user.id).eq("match_id", curJokerMatch);
      setMyPreds((s) => ({ ...s, [curJokerMatch]: { ...s[curJokerMatch], joker: false } }));
    }
    savePred(matchId, { joker: true });
  };

  /* --- admin --- */
  const setResult = async (matchId, side, value) => {
    const v = value === "" ? null : Math.max(0, Math.min(30, Math.floor(+value) || 0));
    const patch = side === "home" ? { result_home: v } : { result_away: v };
    setMatches((s) => s.map((m) => (m.id === matchId ? { ...m, ...patch } : m)));
    const { error } = await supabase.from("matches").update(patch).eq("id", matchId);
    if (error) flash(error.message, 4000);
  };

  const setOdd = async (matchId, field, value) => {
    const v = value === "" ? null : Math.max(0, Math.round(+value) || 0);
    const patch = { [field]: v };
    setMatches((s) => s.map((m) => (m.id === matchId ? { ...m, ...patch } : m)));
    const { error } = await supabase.from("matches").update(patch).eq("id", matchId);
    if (error) flash(error.message, 4000);
  };

  const toggleLock = async () => {
    if (!md) return;
    const next = !md.is_locked;
    setMatchdays((s) => s.map((d) => (d.id === md.id ? { ...d, is_locked: next } : d)));
    setConfirmLock(false);
    const { error } = await supabase.from("matchdays").update({ is_locked: next }).eq("id", md.id);
    if (error) { flash(error.message, 4000); loadAll(); }
    else loadAll();
  };

  /* --- import Excel (admin) --- */
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !md) return;
    e.target.value = "";
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const found = [], unknown = [];
      const seen = new Set();

      wb.SheetNames.forEach((sn) => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
        rows.forEach((row, ri) => {
          if (!row || row.length < 5) return;
          const home = matchClub(row[0]), away = matchClub(row[1]);
          if (!home || !away) {
            if (String(row[0] || "").trim() && ri > 0 && unknown.length < 6)
              unknown.push(String(row[0]) + " – " + String(row[1] || ""));
            return;
          }
          /* deux dispositions acceptées :
             A — Domicile, Extérieur, Cote1, CoteN, Cote2                (5 colonnes)
             B — Domicile, Extérieur, Date, Heure, Cote1, CoteN, Cote2   (7 colonnes)
             On essaie B d'abord : trois cotes valides à partir de la colonne 4.
             Attention, parseNum("21/08") renvoie 21 — on ne peut pas se fier
             au seul type des cellules pour distinguer les deux formats. */
          const okTriplet = (i) => {
            const a = parseNum(row[i]), b = parseNum(row[i + 1]), c = parseNum(row[i + 2]);
            return !isNaN(a) && !isNaN(b) && !isNaN(c) && a >= 1 && b >= 1 && c >= 1;
          };
          const withDates = row.length >= 7 && okTriplet(4);
          const base = withDates ? 4 : 2;
          const o1 = parseNum(row[base]), oN = parseNum(row[base + 1]), o2 = parseNum(row[base + 2]);
          if (isNaN(o1) || isNaN(oN) || isNaN(o2)) return;
          const match = mdMatches.find((m) => m.home === home && m.away === away);
          if (!match || seen.has(match.id)) return;
          seen.add(match.id);
          const ko = withDates ? parseKickoff(row[2], row[3]) : null;
          found.push({
            id: match.id, home, away,
            pts_1: oddsToPoints(o1), pts_n: oddsToPoints(oN), pts_2: oddsToPoints(o2),
            kickoff: ko ? ko.toISOString() : null,
          });
        });
      });

      const missing = mdMatches.filter((m) => !seen.has(m.id));
      setPreview({ found, unknown, missing, fileName: file.name });
      if (found.length === 0) flash("Aucune ligne ne correspond à " + md.label, 4000);
    } catch (err) {
      flash("Fichier illisible — vérifie le format", 4000);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    setStatus("Import en cours…");
    for (const f of preview.found) {
      const patch = { pts_1: f.pts_1, pts_n: f.pts_n, pts_2: f.pts_2 };
      if (f.kickoff) patch.kickoff = f.kickoff;
      await supabase.from("matches").update(patch).eq("id", f.id);
    }
    setPreview(null);
    await loadAll();
    flash(preview.found.length + " matchs mis à jour");
  };

  /* ---------------- rendu ---------------- */
  if (booting) return <Splash />;

  if (recovering) return <NewPasswordScreen onDone={() => setRecovering(false)} />;

  if (!session) return <AuthScreen />;

  if (loading || !md) return <Splash message={status && status.startsWith("Erreur") ? status : null} />;

  const oddsSet = mdMatches.filter((m) => m.pts_1 && m.pts_n && m.pts_2).length;

  const tabs = [["pronos", "Pronos"], ["mespoints", "Mes points"], ["bonus", "Bonus"], ["classement", "Classement"], ["reglement", "Règlement"]];
  if (isAdmin) tabs.push(["cotes", "Cotes"], ["resultats", "Résultats"]);

  return (
    <div style={S.wrap}>
      <style>{GLOBAL_CSS}</style>
      <div style={S.inner}>

        {/* en-tête */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, gap: 12 }}>
          <div>
            <Logo scale={0.44} className="applogo" />
            <p style={{ color: C.muted, fontSize: 12.5, margin: "9px 0 0" }}>
              {profile?.pseudo}{isAdmin ? " · organisateur" : ""} · {profiles.length} joueur{profiles.length > 1 ? "s" : ""}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <button style={{ ...S.ghost, padding: "7px 12px", fontSize: 11.5 }}
              onClick={() => supabase.auth.signOut()}>Déconnexion</button>
            {status && <p style={{ fontSize: 11, color: C.muted, margin: "7px 0 0", maxWidth: 170 }}>{status}</p>}
          </div>
        </div>

        {/* onglets */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {tabs.map(([k, l]) => (
            <button key={k} style={S.pill(tab === k)} onClick={() => { setTab(k); setPreview(null); setOpenMatch(null); }}>{l}</button>
          ))}
        </div>

        {/* sélecteur de journée */}
        {tab !== "classement" && tab !== "bonus" && tab !== "reglement" && (
          <>
            {/* en-tête de journée : la journée est le titre, pas un menu perdu */}
            <div style={{
              ...S.card, padding: 0, overflow: "hidden", marginBottom: 12,
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "16px 16px 14px",
              }}>
                <button style={{
                  ...S.nav, width: 34, height: 34, fontSize: 16,
                  background: "transparent", border: "none",
                  color: mdIndex === 0 ? C.lineSoft : C.dim,
                  cursor: mdIndex === 0 ? "default" : "pointer",
                }}
                  onClick={() => { setMdIndex(Math.max(0, mdIndex - 1)); setPreview(null); }}
                  disabled={mdIndex === 0} aria-label="Journée précédente">‹</button>

                <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                  <div style={{
                    fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1,
                    color: C.olympic,
                  }}>
                    Journée <span className="num" style={{ fontSize: 34, fontWeight: 700 }}>{mdIndex + 1}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
                    {md.date_label}
                    {md.is_locked && (
                      <span style={{
                        marginLeft: 9, padding: "2px 8px", borderRadius: 6,
                        background: "rgba(255,255,255,0.06)", border: `1px solid ${C.lineSoft}`,
                        fontSize: 11, color: C.dim,
                      }}>clôturée</span>
                    )}
                  </div>
                </div>

                <button style={{
                  ...S.nav, width: 34, height: 34, fontSize: 16,
                  background: "transparent", border: "none",
                  color: mdIndex === matchdays.length - 1 ? C.lineSoft : C.dim,
                  cursor: mdIndex === matchdays.length - 1 ? "default" : "pointer",
                }}
                  onClick={() => { setMdIndex(Math.min(matchdays.length - 1, mdIndex + 1)); setPreview(null); }}
                  disabled={mdIndex === matchdays.length - 1} aria-label="Journée suivante">›</button>
              </div>

              {/* saut direct + clôture */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "11px 16px", background: C.sunken,
                borderTop: `1px solid ${C.lineSoft}`,
              }}>
                <select value={mdIndex} onChange={(e) => { setMdIndex(+e.target.value); setPreview(null); }}
                  style={{
                    padding: "7px 10px", background: "transparent", border: `1px solid ${C.line}`,
                    color: C.dim, borderRadius: 8, outline: "none", fontSize: 12,
                    fontFamily: "inherit", cursor: "pointer", maxWidth: 150,
                  }}
                  aria-label="Aller à une journée">
                  {matchdays.map((m, i) => (
                    <option key={m.id} value={i}>{m.label}{m.is_locked ? " ·" : ""}</option>
                  ))}
                </select>

                {tab !== "mespoints" && (
                  <>
                    <span style={{ fontSize: 11.5, color: C.muted, flex: 1, minWidth: 90 }}>
                      {(() => {
                        const sansHoraire = mdMatches.filter((m) => !m.kickoff).length;
                        if (isAdmin && sansHoraire > 0)
                          return `${sansHoraire} match${sansHoraire > 1 ? "s" : ""} sans horaire`;
                        return "Verrouillage auto au coup d'envoi";
                      })()}
                    </span>
                    {/* clôture manuelle de secours : utile seulement si des matchs
                        n'ont pas d'horaire (l'heure gère tout le reste) */}
                    {isAdmin && mdMatches.some((m) => !m.kickoff) && (md.is_locked ? (
                      <button style={S.ghost} onClick={toggleLock}>Rouvrir</button>
                    ) : confirmLock ? (
                      <span style={{ display: "flex", gap: 7 }}>
                        <button style={{ ...S.btn, padding: "8px 14px", fontSize: 12 }} onClick={toggleLock}>
                          Confirmer
                        </button>
                        <button style={S.ghost} onClick={() => setConfirmLock(false)}>Annuler</button>
                      </span>
                    ) : (
                      <button style={S.ghost} onClick={() => setConfirmLock(true)}>Clôturer</button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* PRONOS */}
        {tab === "pronos" && (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 14, margin: "0 0 14px",
              padding: "12px 16px", flexWrap: "wrap",
              background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
              boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
            }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  marginBottom: 7, gap: 8,
                }}>
                  <span style={{
                    fontSize: 11, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase",
                  }}>Mes pronos</span>
                  <span className="num" style={{
                    fontSize: 17, fontWeight: 600,
                    color: doneCount === mdMatches.length ? C.mint : C.dim,
                  }}>
                    {doneCount === mdMatches.length
                      ? "complet"
                      : `${doneCount}/${mdMatches.length}`}
                  </span>
                </div>
                <div style={{ height: 4, background: C.sunken, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${(doneCount / Math.max(1, mdMatches.length)) * 100}%`,
                    background: doneCount === mdMatches.length ? C.mint : `linear-gradient(90deg, ${C.volt}, ${C.voltSoft})`,
                    borderRadius: 99, transition: "width 300ms ease",
                  }} />
                </div>
              </div>

              <div style={{
                display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
                paddingLeft: 14, borderLeft: `1px solid ${C.lineSoft}`,
              }}>
                <span style={{
                  fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: curJokerMatch ? C.gold : C.muted,
                }}>
                  {curJokerSpent ? "Joker utilisé" : curJokerMatch ? "Joker posé" : "Joker ×2"}
                </span>
                <span style={{ fontSize: 11.5, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                  {curHalf === 1 ? "J1–J19" : "J20–J38"}
                </span>
              </div>
            </div>

            {mdMatches.map((match) => {
              const mine = myPreds[match.id];
              const hasScore = mine && mine.home !== null && mine.away !== null && mine.home !== "" && mine.away !== "";
              const hasJoker = !!mine?.joker;
              const myOut = hasScore ? outcome(+mine.home, +mine.away) : null;
              const jokerBlocked = curJokerSpent && !hasJoker;
              const pts = { "1": match.pts_1, N: match.pts_n, "2": match.pts_2 };
              const res = match.result_home !== null && match.result_away !== null;
              const locked = matchLocked(match);       // coup d'envoi passé ou journée close
              const board = locked ? matchBoard(match) : null;   // pronos de tous, révélés

              return (
                <div key={match.id} className="match" style={{
                  ...S.card,
                  background: hasJoker ? "#241F13" : hasScore ? "#181528" : C.surface,
                  borderColor: hasJoker ? "rgba(255,201,77,0.34)" : hasScore ? "rgba(124,92,255,0.30)" : C.line,
                  opacity: locked && !hasScore ? 0.75 : 1,
                }}>
                  {(match.kickoff || locked) && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      marginBottom: 11, flexWrap: "wrap",
                    }}>
                      {match.kickoff && (
                        <span style={{
                          fontSize: 10.5, color: C.muted,
                          letterSpacing: "0.04em", textTransform: "uppercase",
                        }}>{fmtKickoff(match.kickoff)}</span>
                      )}
                      {locked && (
                        <span style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 6,
                          background: "rgba(255,201,77,0.12)", border: "1px solid rgba(255,201,77,0.3)",
                          color: C.gold, letterSpacing: "0.04em", textTransform: "uppercase",
                        }}>🔒 figé</span>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Club name={match.home} align="right" />
                    <input className="score-in" type="number" min="0" max="30" disabled={locked}
                      value={mine?.home ?? ""} onChange={(e) => savePred(match.id, { home: e.target.value })}
                      style={{ ...S.score, opacity: locked ? 0.55 : 1, cursor: locked ? "not-allowed" : "text" }}
                      aria-label={`Buts ${match.home}`} />
                    <span style={{ color: C.muted, fontSize: 12 }}>:</span>
                    <input className="score-in" type="number" min="0" max="30" disabled={locked}
                      value={mine?.away ?? ""} onChange={(e) => savePred(match.id, { away: e.target.value })}
                      style={{ ...S.score, opacity: locked ? 0.55 : 1, cursor: locked ? "not-allowed" : "text" }}
                      aria-label={`Buts ${match.away}`} />
                    <Club name={match.away} align="left" />
                  </div>

                  {/* forme récente : 5 derniers résultats, sous chaque équipe */}
                  {(teamForm[match.home]?.length || teamForm[match.away]?.length) ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
                      <span style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                        <Forme results={teamForm[match.home]} align="right" />
                      </span>
                      <span style={{ width: 46 + 12 + 46, flexShrink: 0 }} />
                      <span style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
                        <Forme results={teamForm[match.away]} align="left" />
                      </span>
                    </div>
                  ) : null}

                  {res && (
                    <div style={{ textAlign: "center", marginTop: 9, fontSize: 11.5, color: C.mint }}>
                      Résultat : {match.result_home} – {match.result_away}
                    </div>
                  )}

                  {/* bande basse : ce que rapporte chaque issue, et le joker */}
                  <div style={{
                    display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap",
                    marginTop: 14, marginLeft: -18, marginRight: -18, marginBottom: -16,
                    padding: "12px 18px", background: C.sunken,
                    borderTop: `1px solid ${C.lineSoft}`,
                    borderBottomLeftRadius: 13, borderBottomRightRadius: 13,
                  }}>
                    <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 190 }}>
                      {["1", "N", "2"].map((k) => {
                        const on = myOut === k;
                        const val = pts[k] ? (hasJoker ? pts[k] * 2 : pts[k]) : null;
                        return (
                          <span key={k} style={{
                            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                            gap: 1, padding: "6px 4px", borderRadius: 9, minWidth: 52,
                            background: on ? "rgba(124,92,255,0.16)" : "transparent",
                            border: `1px solid ${on ? "rgba(124,92,255,0.42)" : C.lineSoft}`,
                            transition: "all 140ms ease",
                          }}>
                            <span style={{
                              fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase",
                              color: on ? C.voltSoft : C.muted, fontWeight: 600,
                            }}>{k}</span>
                            <span className="num" style={{
                              fontSize: 21, fontWeight: 600,
                              color: val ? (on ? C.text : C.dim) : C.muted,
                            }}>
                              {val ?? "—"}
                            </span>
                          </span>
                        );
                      })}
                    </div>

                    <button onClick={() => toggleJoker(match.id)} disabled={locked || jokerBlocked || !hasScore}
                      title={hasJoker ? "Retirer le joker" : "Doubler les points de ce match"}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        gap: 1, padding: "6px 14px", borderRadius: 9, minWidth: 60,
                        fontFamily: "inherit", cursor: mdLocked || jokerBlocked || !hasScore ? "not-allowed" : "pointer",
                        border: `1px solid ${hasJoker ? "rgba(255,201,77,0.55)" : C.lineSoft}`,
                        background: hasJoker ? "rgba(255,201,77,0.15)" : "transparent",
                        opacity: mdLocked || jokerBlocked || !hasScore ? 0.35 : 1,
                        transition: "all 150ms ease",
                      }}>
                      <span style={{
                        fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase",
                        color: hasJoker ? C.gold : C.muted, fontWeight: 600,
                      }}>joker</span>
                      <span className="num" style={{
                        fontSize: 21, fontWeight: 700,
                        color: hasJoker ? C.gold : C.dim,
                      }}>×2</span>
                    </button>
                  </div>

                  {/* pronos des autres, révélés dès le coup d'envoi de CE match */}
                  {locked && (
                    <details style={{ marginTop: 11 }}>
                      <summary style={{ fontSize: 11.5, color: C.muted, cursor: "pointer", listStyle: "none" }}>
                        Voir les pronos ({allPreds.filter((p) => p.match_id === match.id).length})
                      </summary>
                      <div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {allPreds.filter((p) => p.match_id === match.id).map((p) => {
                          const who = profiles.find((x) => x.id === p.user_id);
                          const ok = res && outcome(p.home, p.away) === outcome(match.result_home, match.result_away);
                          const ex = res && p.home === match.result_home && p.away === match.result_away;
                          return (
                            <span key={p.user_id} style={{
                              fontSize: 10.5, padding: "3px 9px", borderRadius: 999,
                              background: ex ? "rgba(61,224,176,0.16)" : ok ? "rgba(124,92,255,0.13)" : "rgba(0,0,0,0.28)",
                              border: `1px solid ${ex ? "rgba(61,224,176,0.4)" : ok ? "rgba(124,92,255,0.3)" : C.line}`,
                              color: ex ? C.mint : ok ? C.voltSoft : C.muted,
                            }}>
                              {who?.pseudo || "?"} {p.home}–{p.away}{p.joker ? " 🎯" : ""}
                            </span>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* MES POINTS */}
        {tab === "mespoints" && (
          <>
            {!myBreakdown ? (
              <div style={{ ...S.card, marginTop: 14 }}>
                <p style={{ color: C.muted, margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  Aucun match de {md.label} n'est encore terminé. Le détail de tes points
                  s'affichera au fur et à mesure que les résultats seront saisis.
                </p>
              </div>
            ) : (
              <>
                {/* total de la journée */}
                <div style={{
                  ...S.card, marginTop: 14, display: "flex", alignItems: "center",
                  gap: 14, flexWrap: "wrap",
                  background: "linear-gradient(135deg, rgba(124,92,255,0.10), rgba(61,224,176,0.05))",
                  borderColor: "rgba(124,92,255,0.28)",
                }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 11.5, color: C.muted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                      Total {md.label}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                      {myBreakdown.counted}/{mdMatches.length} match{mdMatches.length > 1 ? "s" : ""} joué{myBreakdown.counted > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="num" style={{
                    fontSize: 44, fontWeight: 700,
                    color: myBreakdown.total > 0 ? C.text : C.muted,
                  }}>
                    {myBreakdown.total}
                    <span style={{ fontSize: 15, fontWeight: 500, color: C.muted, marginLeft: 5 }}>pts</span>
                  </div>
                </div>

                {myBreakdown.lines.map(({ match, mine, played, pts, odd, good, exact, tier, joker }) => (
                  <div key={match.id} style={{
                    ...S.card, padding: 0, overflow: "hidden",
                    borderColor: openMatch === match.id ? "rgba(124,92,255,0.35)" : C.line,
                  }}>

                    {/* ligne du haut : équipes et score final */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "14px 16px",
                    }}>
                      <Club name={match.home} align="right" size={26} />
                      <span className="num" style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 14px 5px", borderRadius: 10,
                        border: `1px solid ${C.line}`, background: C.sunken,
                        fontSize: 27, fontWeight: 600,
                        color: played ? C.text : C.muted, flexShrink: 0,
                      }}>
                        {played ? match.result_home : "–"}
                        <span style={{ color: C.muted, fontSize: 13 }}>:</span>
                        {played ? match.result_away : "–"}
                      </span>
                      <Club name={match.away} align="left" size={26} />
                    </div>

                    {/* ligne du bas : ma cote, mon prono, mes points */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 16px", flexWrap: "wrap",
                      background: "rgba(0,0,0,0.22)",
                      borderTop: `1px solid ${C.line}`,
                    }}>
                      <div style={{ minWidth: 62 }}>
                        <div style={{ fontSize: 10.5, color: C.muted }}>Ma cote</div>
                        <div className="num" style={{ fontSize: 21, fontWeight: 600, marginTop: 3 }}>
                          {played && odd ? odd : "—"}
                        </div>
                      </div>

                      <div style={{ flex: 1, textAlign: "center", minWidth: 96 }}>
                        <div style={{ fontSize: 10.5, color: C.muted }}>Mon prono</div>
                        <div className="num" style={{ fontSize: 21, fontWeight: 600, marginTop: 3 }}>
                          {mine ? `${mine.home} - ${mine.away}` : <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: C.muted }}>non joué</span>}
                          {joker && <span style={{ marginLeft: 6, fontSize: 12 }}>🎯</span>}
                        </div>
                      </div>

                      <div style={{
                        display: "flex", alignItems: "baseline", gap: 4,
                        padding: "8px 14px", borderRadius: 10, minWidth: 76, justifyContent: "center",
                        border: `1px solid ${!played ? C.line
                          : exact ? "rgba(61,224,176,0.45)"
                          : good ? "rgba(124,92,255,0.42)"
                          : "rgba(255,255,255,0.10)"}`,
                        background: !played ? "transparent"
                          : exact ? "rgba(61,224,176,0.12)"
                          : good ? "rgba(124,92,255,0.12)"
                          : "rgba(255,255,255,0.03)",
                      }}>
                        <span className="num" style={{
                          fontSize: 27, fontWeight: 700,
                          color: !played ? C.muted : exact ? C.mint : good ? C.voltSoft : C.muted,
                        }}>
                          {played ? pts : "–"}
                        </span>
                        <span style={{ fontSize: 11, color: C.muted }}>
                          {played && pts === 1 ? "pt" : "pts"}
                        </span>
                      </div>
                    </div>

                    {/* mention du bonus obtenu */}
                    {played && exact && (
                      <div style={{
                        padding: "8px 16px", fontSize: 11,
                        background: "rgba(61,224,176,0.07)",
                        borderTop: "1px solid rgba(61,224,176,0.18)",
                        color: C.muted, display: "flex", gap: 8, flexWrap: "wrap",
                      }}>
                        <span style={{ color: tier.color, fontWeight: 700 }}>{tier.label}</span>
                        <span>score exact · bonus +{tier.pts}</span>
                        {joker && <span style={{ color: C.gold }}>· joker ×2</span>}
                      </div>
                    )}
                    {played && good && !exact && joker && (
                      <div style={{
                        padding: "8px 16px", fontSize: 11,
                        background: "rgba(255,201,77,0.07)",
                        borderTop: "1px solid rgba(255,201,77,0.18)",
                        color: C.gold,
                      }}>
                        Joker ×2 appliqué
                      </div>
                    )}

                    {/* barre de dépliage : pronos de tout le monde sur ce match */}
                    <button
                      onClick={() => setOpenMatch(openMatch === match.id ? null : match.id)}
                      style={{
                        width: "100%", padding: "11px 16px", background: "transparent",
                        border: "none", borderTop: `1px solid ${C.lineSoft}`,
                        color: openMatch === match.id ? C.voltSoft : C.muted,
                        fontSize: 11.5, fontWeight: 500, fontFamily: "inherit",
                        cursor: "pointer", textAlign: "left",
                        display: "flex", alignItems: "center", gap: 7,
                      }}>
                      <span style={{
                        display: "inline-block", transition: "transform 180ms ease",
                        transform: openMatch === match.id ? "rotate(90deg)" : "none",
                      }}>›</span>
                      {openMatch === match.id
                        ? "Masquer les pronos"
                        : `Voir les pronos des ${allPreds.filter((r) => r.match_id === match.id).length} joueurs`}
                    </button>

                    {/* pronos de tout le monde sur ce match */}
                    {openMatch === match.id && (() => {
                      const board = matchBoard(match);
                      const meRow = board.find((r) => r.user_id === session.user.id);
                      const others = board.filter((r) => r.user_id !== session.user.id);
                      const Row = ({ r, highlight }) => (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 16px",
                          background: highlight ? "rgba(124,92,255,0.10)" : "transparent",
                          borderBottom: `1px solid ${C.lineSoft}`,
                        }}>
                          <span style={{
                            flex: 1, minWidth: 60, fontSize: 13.5,
                            fontWeight: highlight ? 700 : 500,
                            color: highlight ? C.voltSoft : C.text,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {r.pseudo}{highlight ? " (toi)" : ""}
                          </span>
                          <span className="num" style={{
                            fontSize: 19, fontWeight: 600, color: C.dim,
                            minWidth: 46, textAlign: "center",
                          }}>
                            {r.home} - {r.away}
                          </span>
                          {r.joker && <span style={{ fontSize: 12 }}>🎯</span>}
                          {r.pts !== null && (
                            <span className="num" style={{
                              minWidth: 58, textAlign: "right", fontSize: 20, fontWeight: 700,
                              color: r.exact ? C.mint : r.good ? C.voltSoft : C.muted,
                            }}>
                              {r.pts}
                            </span>
                          )}
                        </div>
                      );
                      return (
                        <div style={{ background: "rgba(0,0,0,0.28)" }}>
                          {board.length === 0 ? (
                            <p style={{ padding: "13px 16px", margin: 0, fontSize: 12.5, color: C.muted }}>
                              Personne n'a pronostiqué ce match.
                            </p>
                          ) : (
                            <>
                              {meRow && <Row r={meRow} highlight />}
                              {others.map((r) => <Row key={r.user_id} r={r} />)}
                              {!meRow && (
                                <p style={{ padding: "11px 16px", margin: 0, fontSize: 12, color: C.muted }}>
                                  Tu n'as pas joué ce match.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* BONUS DE SAISON */}
        {tab === "bonus" && (
          <>
            {/* état d'ouverture */}
            <div style={{
              ...S.card, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              borderColor: bonusOpen ? "rgba(124,92,255,0.28)" : "rgba(255,201,77,0.28)",
              background: bonusOpen ? "rgba(124,92,255,0.06)" : "rgba(255,201,77,0.06)",
            }}>
              <span style={{ fontSize: 12.5, color: bonusOpen ? C.voltSoft : C.gold, flex: 1, minWidth: 200, lineHeight: 1.5 }}>
                {bonusOpen
                  ? "Pronos de saison ouverts — ils se ferment à la clôture de la J1."
                  : "Pronos de saison verrouillés depuis la clôture de la J1."}
              </span>
            </div>

            {/* import admin */}
            {isAdmin && (
              <>
                <div style={S.card}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button style={S.btn} onClick={() => bonusFileRef.current?.click()}>
                      Importer les candidats
                    </button>
                    <input ref={bonusFileRef} type="file" accept=".xlsx,.xls" onChange={handleBonusFile} style={{ display: "none" }} />
                    <span style={{ fontSize: 11.5, color: C.muted, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
                      Fichier à 3 onglets : Buteur · Passeur · Vainqueur, colonnes Nom et Points
                    </span>
                  </div>
                </div>

                {bonusPreview && (
                  <div style={{ ...S.card, borderColor: "rgba(124,92,255,0.35)", background: "rgba(124,92,255,0.06)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                      {bonusPreview.fileName} — {bonusPreview.found.length} candidats
                    </div>
                    {BONUS_CATS.map((c) => {
                      const n = bonusPreview.found.filter((f) => f.category === c.key).length;
                      return n > 0 ? (
                        <div key={c.key} style={{ fontSize: 12, color: C.muted, padding: "3px 0" }}>
                          {c.label} : {n} candidats
                        </div>
                      ) : null;
                    })}
                    <p style={{ fontSize: 11.5, color: C.gold, margin: "10px 0 0" }}>
                      L'import remplace les candidats existants de ces catégories.
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button style={{ ...S.btn, padding: "10px 18px", fontSize: 13 }} onClick={applyBonusPreview}>
                        Appliquer
                      </button>
                      <button style={S.ghost} onClick={() => setBonusPreview(null)}>Annuler</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {bonusOptions.length === 0 ? (
              <div style={S.card}>
                <p style={{ color: C.muted, margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  {isAdmin
                    ? "Aucun candidat pour l'instant — importe ton fichier Excel ci-dessus."
                    : "Les pronos de saison ne sont pas encore ouverts."}
                </p>
              </div>
            ) : BONUS_CATS.map((cat) => {
              const opts = optionsByCat[cat.key] || [];
              if (opts.length === 0) return null;
              const mine = myBonus[cat.key];
              const chosen = mine ? opts.find((o) => o.id === mine.option_id) : null;
              const winner = opts.find((o) => o.is_winner);

              return (
                <div key={cat.key} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                  <div style={{
                    padding: "14px 16px", borderBottom: `1px solid ${C.line}`,
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 160 }}>{cat.label}</span>
                    {chosen && (
                      <span style={{
                        fontSize: 11.5, padding: "5px 11px", borderRadius: 999,
                        background: "rgba(124,92,255,0.14)", border: "1px solid rgba(124,92,255,0.35)",
                        color: C.voltSoft, fontWeight: 600,
                      }}>
                        {chosen.is_other ? (mine.free_text || "Autre") : chosen.label} · {chosen.points} pts
                      </span>
                    )}
                  </div>

                  {/* choix du joueur */}
                  {bonusOpen ? (
                    <div style={{ padding: "13px 16px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                        {opts.map((o) => {
                          const on = chosen?.id === o.id;
                          return (
                            <button key={o.id}
                              onClick={() => saveBonus(cat.key, o.id, freeText[cat.key])}
                              style={{
                                padding: "7px 13px", borderRadius: 999, cursor: "pointer",
                                fontSize: 12, fontWeight: on ? 700 : 500, fontFamily: "inherit",
                                border: `1px solid ${on ? "rgba(124,92,255,0.5)" : o.is_other ? "rgba(255,201,77,0.3)" : C.line}`,
                                background: on ? "rgba(124,92,255,0.18)" : "rgba(0,0,0,0.28)",
                                color: on ? C.text : o.is_other ? C.gold : C.muted,
                                transition: "all 140ms ease",
                              }}>
                              {o.label} <span style={{ color: on ? C.voltSoft : C.muted, fontWeight: 600 }}>{o.points}</span>
                            </button>
                          );
                        })}
                      </div>

                      {chosen?.is_other && (
                        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                          <input
                            value={freeText[cat.key] ?? mine?.free_text ?? ""}
                            onChange={(e) => setFreeText((f) => ({ ...f, [cat.key]: e.target.value }))}
                            placeholder="Nom de ton choix"
                            style={{ ...S.field, flex: 1, minWidth: 180, fontSize: 13 }}
                          />
                          <button style={{ ...S.btn, padding: "10px 16px", fontSize: 12.5 }}
                            onClick={() => saveBonus(cat.key, chosen.id, freeText[cat.key])}>
                            Valider
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: "13px 16px" }}>
                      {!chosen ? (
                        <p style={{ color: C.muted, fontSize: 12.5, margin: 0 }}>Tu n'as pas fait de choix.</p>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12.5, color: C.muted }}>Ton choix :</span>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>
                            {chosen.is_other ? (mine.free_text || "—") : chosen.label}
                          </span>
                          {winner && (
                            <span style={{
                              marginLeft: "auto", fontSize: 12, padding: "5px 11px", borderRadius: 999,
                              background: bonusPointsByUser[session.user.id]?.detail?.[cat.key]?.ok
                                ? "rgba(61,224,176,0.14)" : "rgba(255,255,255,0.04)",
                              border: `1px solid ${bonusPointsByUser[session.user.id]?.detail?.[cat.key]?.ok
                                ? "rgba(61,224,176,0.4)" : C.line}`,
                              color: bonusPointsByUser[session.user.id]?.detail?.[cat.key]?.ok ? C.mint : C.muted,
                              fontWeight: 700,
                            }}>
                              {bonusPointsByUser[session.user.id]?.detail?.[cat.key]?.pts || 0} pts
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* résolution par l'organisateur */}
                  {isAdmin && !bonusOpen && (
                    <div style={{
                      padding: "13px 16px", borderTop: `1px solid ${C.line}`,
                      background: "rgba(0,0,0,0.22)",
                    }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Désigner le gagnant
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {opts.filter((o) => !o.is_other).map((o) => (
                          <button key={o.id} onClick={() => setBonusWinner(o.id, cat.key)}
                            style={{
                              padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                              fontSize: 11.5, fontWeight: o.is_winner ? 700 : 500, fontFamily: "inherit",
                              border: `1px solid ${o.is_winner ? "rgba(61,224,176,0.5)" : C.line}`,
                              background: o.is_winner ? "rgba(61,224,176,0.16)" : "rgba(0,0,0,0.3)",
                              color: o.is_winner ? C.mint : C.muted,
                            }}>
                            {o.is_winner ? "✓ " : ""}{o.label}
                          </button>
                        ))}
                      </div>

                      {/* validation des paris "Autre" */}
                      {(() => {
                        const others = bonusPreds.filter((b) => {
                          if (b.category !== cat.key) return false;
                          const o = bonusOptions.find((x) => x.id === b.option_id);
                          return o?.is_other;
                        });
                        if (others.length === 0) return null;
                        return (
                          <div style={{ marginTop: 14 }}>
                            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              Paris « Autre » à valider
                            </div>
                            {others.map((b) => {
                              const who = profiles.find((x) => x.id === b.user_id);
                              return (
                                <div key={b.user_id} style={{
                                  display: "flex", alignItems: "center", gap: 10,
                                  padding: "8px 0", flexWrap: "wrap",
                                  borderTop: `1px solid ${C.line}`,
                                }}>
                                  <span style={{ fontSize: 12.5, minWidth: 90 }}>{who?.pseudo || "?"}</span>
                                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 100 }}>
                                    {b.free_text || "(vide)"}
                                  </span>
                                  <span style={{ display: "flex", gap: 6 }}>
                                    <button onClick={() => validateOther(b.user_id, cat.key, true)}
                                      style={{
                                        padding: "5px 11px", borderRadius: 8, cursor: "pointer",
                                        fontSize: 11.5, fontWeight: 600, fontFamily: "inherit",
                                        border: `1px solid ${b.is_correct === true ? "rgba(61,224,176,0.5)" : C.line}`,
                                        background: b.is_correct === true ? "rgba(61,224,176,0.16)" : "transparent",
                                        color: b.is_correct === true ? C.mint : C.muted,
                                      }}>gagné</button>
                                    <button onClick={() => validateOther(b.user_id, cat.key, false)}
                                      style={{
                                        padding: "5px 11px", borderRadius: 8, cursor: "pointer",
                                        fontSize: 11.5, fontWeight: 600, fontFamily: "inherit",
                                        border: `1px solid ${b.is_correct === false ? "rgba(255,128,128,0.5)" : C.line}`,
                                        background: b.is_correct === false ? "rgba(255,128,128,0.14)" : "transparent",
                                        color: b.is_correct === false ? C.danger : C.muted,
                                      }}>perdu</button>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}

            {/* total bonus du joueur */}
            {!bonusOpen && bonusOptions.length > 0 && (
              <div style={{
                ...S.card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                background: "linear-gradient(135deg, rgba(124,92,255,0.10), rgba(61,224,176,0.05))",
                borderColor: "rgba(124,92,255,0.28)",
              }}>
                <span style={{ fontSize: 11.5, color: C.muted, flex: 1, minWidth: 140, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Mes points bonus
                </span>
                <span className="num" style={{ fontSize: 38, fontWeight: 700 }}>
                  {bonusPointsByUser[session.user.id]?.total || 0}
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.muted, marginLeft: 5 }}>pts</span>
                </span>
              </div>
            )}

            <p style={{ color: C.muted, fontSize: 11, margin: "12px 2px 0", lineHeight: 1.6 }}>
              Un choix par catégorie. Les points affichés sont ceux que rapporte chaque candidat —
              plus il est improbable, plus il rapporte. Les bonus s'ajoutent au classement général.
            </p>
          </>
        )}

        {/* CLASSEMENT */}
        {tab === "classement" && (
          <>
            {/* filtre saison / journée */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={rankScope}
                onChange={(e) => setRankScope(e.target.value)}
                style={{ ...S.field, fontWeight: 600, cursor: "pointer", minWidth: 210 }}
              >
                <option value="all">Classement général</option>
                {rankableMds.map((d) => (
                  <option key={d.id} value={d.id}>{d.label} · {d.date_label}</option>
                ))}
              </select>
              {rankScope !== "all" && (
                <button style={S.ghost} onClick={() => setRankScope("all")}>Tout voir</button>
              )}
            </div>

            <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
              {ranking.length === 0 ? (
                <p style={{ color: C.muted, margin: 0, fontSize: 13, padding: "16px 18px" }}>
                  Pas encore de joueurs.
                </p>
              ) : (
                <>
                  {/* en-têtes */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "11px 14px", background: "rgba(0,0,0,0.25)",
                    borderBottom: `1px solid ${C.line}`,
                    fontSize: 10.5, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase",
                  }}>
                    <span style={{ width: 26, flexShrink: 0 }}></span>
                    <span style={{ flex: 1, minWidth: 50 }}>Joueurs</span>
                    <span className="col-num colhead" style={{ width: 44, textAlign: "right", flexShrink: 0 }}>
                      <span className="lbl-long">Bons</span><span className="lbl-short">B</span>
                    </span>
                    <span className="col-num colhead" style={{ width: 48, textAlign: "right", flexShrink: 0 }}>
                      <span className="lbl-long">Exacts</span><span className="lbl-short">EX</span>
                    </span>
                    {rankScope === "all" && (
                      <span className="col-num col-bonus colhead" style={{ width: 50, textAlign: "right", flexShrink: 0 }}>
                        <span className="lbl-long">Bonus</span><span className="lbl-short">BN</span>
                      </span>
                    )}
                    <span className="col-pts colhead" style={{ width: 62, textAlign: "right", flexShrink: 0 }}>
                      <span className="lbl-long">Points</span><span className="lbl-short">PTS</span>
                    </span>
                  </div>

                  {ranking.map((p, i) => {
                    const me = p.id === session.user.id;
                    const bonusOpen2 = openBonusPlayer === p.id;
                    /* choix de saison de ce joueur, pour le dépliage */
                    const sonChoix = (cat) => {
                      const b = bonusPreds.find((x) => x.user_id === p.id && x.category === cat);
                      if (!b) return null;
                      if (b.free_text) return b.free_text;
                      const opt = bonusOptions.find((o) => o.id === b.option_id);
                      return opt ? opt.label : null;
                    };
                    return (
                      <div key={p.id} style={{
                        borderBottom: i < ranking.length - 1 ? `1px solid ${C.line}` : "none",
                        background: me ? "rgba(124,92,255,0.07)" : "transparent",
                      }}>
                      <div className="row" style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "13px 14px", position: "relative", overflow: "hidden",
                      }}>
                        {leader > 0 && p.points > 0 && (
                          <div style={{
                            position: "absolute", left: 0, top: 0, bottom: 0,
                            width: `${(p.points / leader) * 100}%`,
                            background: i === 0
                              ? "linear-gradient(90deg, rgba(124,92,255,0.20), rgba(61,224,176,0.06))"
                              : "rgba(255,255,255,0.03)",
                            pointerEvents: "none",
                          }} />
                        )}

                        <span className="num" style={{
                          width: 26, textAlign: "center", flexShrink: 0, zIndex: 1,
                          fontSize: 19, fontWeight: 700,
                          color: i === 0 ? C.gold : i < 3 ? C.voltSoft : C.muted,
                        }}>{i + 1}</span>

                        <span style={{
                          flex: 1, minWidth: 50, zIndex: 1, display: "flex",
                          flexDirection: "column", gap: 1, overflow: "hidden",
                        }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                            <span style={{
                              fontSize: 14, fontWeight: me ? 700 : 500,
                              color: me ? C.voltSoft : C.text,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {p.pseudo}{me ? " (toi)" : ""}
                            </span>
                            {!bonusOpen && (
                              <button
                                onClick={() => setOpenBonusPlayer(bonusOpen2 ? null : p.id)}
                                title="Voir ses bonus de saison"
                                aria-label={`Bonus de saison de ${p.pseudo}`}
                                style={{
                                  flexShrink: 0, width: 20, height: 20, borderRadius: 6,
                                  display: "grid", placeItems: "center", cursor: "pointer",
                                  fontSize: 11, lineHeight: 1, fontFamily: "inherit",
                                  background: bonusOpen2 ? "rgba(255,201,77,0.18)" : "transparent",
                                  border: `1px solid ${bonusOpen2 ? "rgba(255,201,77,0.5)" : C.line}`,
                                  color: bonusOpen2 ? C.gold : C.muted,
                                }}>★</button>
                            )}
                          </span>
                          {rankScope === "all" && p.bonus > 0 && (
                            <span className="bonus-inline" style={{ fontSize: 10.5, color: C.gold }}>
                              +{p.bonus.toLocaleString("fr-FR")} bonus
                            </span>
                          )}
                        </span>

                        <span className="num col-num" style={{
                          width: 44, textAlign: "right", flexShrink: 0, zIndex: 1,
                          fontSize: 19, fontWeight: 500, color: C.dim,
                        }}>{p.correct}</span>

                        <span className="num col-num" style={{
                          width: 48, textAlign: "right", flexShrink: 0, zIndex: 1,
                          fontSize: 19, fontWeight: 500, color: p.exact > 0 ? C.mint : C.muted,
                        }}>{p.exact}</span>

                        {rankScope === "all" && (
                          <span className="num col-num col-bonus" style={{
                            width: 50, textAlign: "right", flexShrink: 0, zIndex: 1,
                            fontSize: 19, fontWeight: 500, color: p.bonus > 0 ? C.gold : C.muted,
                          }}>{p.bonus > 0 ? p.bonus.toLocaleString("fr-FR") : "—"}</span>
                        )}

                        <span className="num col-pts" style={{
                          width: 62, textAlign: "right", flexShrink: 0, zIndex: 1,
                          fontSize: 24, fontWeight: 700,
                          color: p.points > 0 ? C.text : C.muted,
                        }}>{p.points.toLocaleString("fr-FR")}</span>
                      </div>

                      {/* dépliage : bonus de saison de ce joueur */}
                      {bonusOpen2 && (
                        <div style={{
                          padding: "4px 16px 13px 40px",
                          display: "flex", flexDirection: "column", gap: 5,
                        }}>
                          {BONUS_CATS.map((c) => {
                            const v = sonChoix(c.key);
                            return (
                              <div key={c.key} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                                <span style={{ color: C.muted, minWidth: 112, flexShrink: 0 }}>{c.label}</span>
                                <span style={{ color: v ? C.dim : C.muted, fontStyle: v ? "normal" : "italic" }}>
                                  {v || "— non choisi"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <p style={{ color: C.muted, fontSize: 11, margin: "12px 2px 0", lineHeight: 1.6 }}>
              {rankScope === "all"
                ? "Classement général, cumulé sur toutes les journées clôturées."
                : `Classement de la ${rankableMds.find((d) => String(d.id) === String(rankScope))?.label || ""} uniquement.`}
              {" "}Bons = bons résultats · Exacts = scores exacts.
            </p>

          </>
        )}

        {/* COTES (admin) */}
        {tab === "cotes" && isAdmin && (
          <>
            <div style={{ ...S.card, marginTop: 14 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button style={{ ...S.btn, opacity: mdLocked ? 0.45 : 1 }}
                  onClick={() => !mdLocked && fileRef.current?.click()} disabled={mdLocked}>
                  Importer un fichier Excel
                </button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
                <span style={{ fontSize: 11.5, color: C.muted, flex: 1, minWidth: 200, lineHeight: 1.5 }}>
                  Colonnes : Domicile · Extérieur · Date · Heure · Cote 1 · Cote N · Cote 2
                  <br />Les colonnes Date et Heure sont facultatives. Heure de Maurice.
                </span>
              </div>
            </div>

            {preview && (
              <div style={{ ...S.card, borderColor: "rgba(124,92,255,0.35)", background: "rgba(124,92,255,0.06)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                  {preview.fileName} — {preview.found.length} match{preview.found.length > 1 ? "s" : ""} reconnu{preview.found.length > 1 ? "s" : ""} pour {md.label}
                </div>
                {preview.found.map((f) => (
                  <div key={f.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", color: C.muted, gap: 8, flexWrap: "wrap" }}>
                    <span style={{ flex: 1, minWidth: 130 }}>{f.home} – {f.away}</span>
                    {f.kickoff && (
                      <span style={{ color: C.dim, fontSize: 11 }}>{fmtKickoff(f.kickoff)}</span>
                    )}
                    <span style={{ color: C.text }} className="num">{f.pts_1} · {f.pts_n} · {f.pts_2}</span>
                  </div>
                ))}
                {preview.missing.length > 0 && (
                  <p style={{ fontSize: 11.5, color: C.gold, margin: "10px 0 0" }}>
                    Sans cote : {preview.missing.map((m) => m.home + "–" + m.away).join(", ")}
                  </p>
                )}
                {preview.unknown.length > 0 && (
                  <p style={{ fontSize: 11.5, color: C.danger, margin: "8px 0 0" }}>
                    Non reconnu : {preview.unknown.join(" · ")}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button style={{ ...S.btn, padding: "10px 18px", fontSize: 13 }} onClick={applyPreview}>
                    Appliquer à {md.label}
                  </button>
                  <button style={S.ghost} onClick={() => setPreview(null)}>Annuler</button>
                </div>
              </div>
            )}

            {mdMatches.map((match) => {
              const complete = match.pts_1 && match.pts_n && match.pts_2;
              return (
                <div key={match.id} style={{
                  ...S.card, padding: "13px 16px",
                  borderColor: complete ? "rgba(61,224,176,0.24)" : C.line,
                  background: complete ? "rgba(61,224,176,0.04)" : C.surface,
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {match.home} <span style={{ color: C.muted }}>–</span> {match.away}
                    </span>
                    {match.kickoff && (
                      <span style={{ fontSize: 10.5, color: C.muted }}>{fmtKickoff(match.kickoff)}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {[["pts_1", "1"], ["pts_n", "N"], ["pts_2", "2"]].map(([f, lab]) => (
                      <span key={f} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10.5, color: C.muted, minWidth: 12 }}>{lab}</span>
                        <input type="number" min="0" value={match[f] ?? ""} disabled={mdLocked}
                          onChange={(e) => setOdd(match.id, f, e.target.value)}
                          style={S.oddIn} aria-label={`Points ${lab}`} />
                      </span>
                    ))}
                    <span style={{ fontSize: 10.5, color: C.muted, marginLeft: "auto" }}>points</span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* RÉSULTATS (admin) */}
        {tab === "resultats" && isAdmin && (
          <>
            <p style={{ color: C.muted, fontSize: 12, margin: "14px 0 12px" }}>
              Saisis les scores finaux. Le classement se met à jour dès que la journée est clôturée.
            </p>
            {mdMatches.map((match) => (
              <div key={match.id} style={{
                ...S.card,
                borderColor: match.result_home !== null && match.result_away !== null ? "rgba(61,224,176,0.28)" : C.line,
                background: match.result_home !== null && match.result_away !== null ? "rgba(61,224,176,0.05)" : C.surface,
              }}>
                {match.kickoff && (
                  <div style={{
                    textAlign: "center", fontSize: 10.5, color: C.muted,
                    marginBottom: 11, letterSpacing: "0.04em", textTransform: "uppercase",
                  }}>
                    {fmtKickoff(match.kickoff)}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Club name={match.home} align="right" />
                  <input className="score-in" type="number" min="0" max="30" value={match.result_home ?? ""}
                    onChange={(e) => setResult(match.id, "home", e.target.value)} style={S.score} />
                  <span style={{ color: C.muted, fontSize: 12 }}>:</span>
                  <input className="score-in" type="number" min="0" max="30" value={match.result_away ?? ""}
                    onChange={(e) => setResult(match.id, "away", e.target.value)} style={S.score} />
                  <Club name={match.away} align="left" />
                </div>
              </div>
            ))}
          </>
        )}

        {/* RÈGLEMENT */}
        {tab === "reglement" && (() => {
          const Section = ({ n, titre, children }) => (
            <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "14px 16px", borderBottom: `1px solid ${C.line}`,
              }}>
                <span className="num" style={{
                  width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                  display: "grid", placeItems: "center",
                  background: "rgba(124,92,255,0.14)", border: "1px solid rgba(124,92,255,0.3)",
                  color: C.voltSoft, fontSize: 18, fontWeight: 700,
                }}>{n}</span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{titre}</span>
              </div>
              <div style={{ padding: "14px 16px", fontSize: 13, color: C.dim, lineHeight: 1.65 }}>
                {children}
              </div>
            </div>
          );

          const b = (txt) => <strong style={{ color: C.text, fontWeight: 600 }}>{txt}</strong>;

          return (
            <>
              <div style={{
                ...S.card,
                background: "linear-gradient(135deg, rgba(124,92,255,0.10), rgba(61,224,176,0.05))",
                borderColor: "rgba(124,92,255,0.28)",
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>Comment ça marche</div>
                <p style={{ fontSize: 12.5, color: C.muted, margin: 0, lineHeight: 1.6 }}>
                  Chaque journée, tu pronostiques le score exact de chaque match. Plus ton
                  pari est audacieux et juste, plus il rapporte.
                </p>
              </div>

              <Section n="1" titre="Le déroulé d'une journée">
                Avant le premier coup d'envoi, tu saisis un score pour chaque match dans
                l'onglet {b("Pronos")}. Tu peux modifier tes pronos autant que tu veux
                tant que la journée n'est pas close.<br /><br />
                À la clôture, les pronos se figent et deviennent visibles de tous. Au fil
                des résultats, tes points s'ajoutent automatiquement. Tu suis ton détail
                dans {b("Mes points")} et ta position dans {b("Classement")}.
              </Section>

              <Section n="2" titre="Les points d'un match">
                Chaque issue — victoire {b("1")}, nul {b("N")}, victoire {b("2")} — vaut un
                nombre de points calculé à partir de sa cote. {b("Un favori rapporte peu, un outsider beaucoup.")}<br /><br />
                {b("Bon résultat")} : tu trouves le vainqueur (ou le nul), tu gagnes les points de l'issue.<br />
                {b("Score exact")} : tu trouves le score précis, tu gagnes les points de l'issue
                {" "}<em>plus</em> un bonus de rareté.
              </Section>

              <Section n="3" titre="Le bonus de rareté">
                Le bonus d'un score exact dépend de sa rareté — la part de joueurs ayant le
                bon résultat qui ont aussi trouvé le score exact. Plus vous êtes nombreux à
                l'avoir trouvé, moins il rapporte.
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                  {[[">30 %", TIERS[0]], ["20–30 %", TIERS[1]], ["5–20 %", TIERS[2]], ["0,5–5 %", TIERS[3]], ["<0,5 %", TIERS[4]]].map(([rng, tr]) => (
                    <div key={tr.label} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderRadius: 10,
                      background: "rgba(0,0,0,0.28)", border: `1px solid ${C.lineSoft}`,
                    }}>
                      <span style={{ fontWeight: 700, color: tr.color, fontSize: 12.5, flex: 1 }}>{tr.label}</span>
                      <span className="num" style={{ fontSize: 17, fontWeight: 600, color: tr.color }}>+{tr.pts}</span>
                      <span style={{ fontSize: 11, color: C.muted, minWidth: 58, textAlign: "right" }}>{rng}</span>
                    </div>
                  ))}
                </div>
              </Section>

              <Section n="4" titre="Le joker ×2">
                Une fois par demi-saison — une fois sur les journées 1 à 19, une fois sur les
                20 à 38 — tu peux poser un {b("joker")} sur un match. Il {b("double le total")} de
                ce match, bonus de rareté compris.<br /><br />
                À utiliser sur un pari où tu te sens sûr, ou sur un gros outsider pour tenter
                un coup. Une fois posé et la journée close, il est consommé.
              </Section>

              <Section n="5" titre="Les bonus de saison">
                En début de saison, dans l'onglet {b("Bonus")}, tu paries sur le
                {b(" meilleur buteur")}, le {b("meilleur passeur")} et le
                {b(" vainqueur du championnat")}. Chaque candidat vaut un nombre de points
                variable — un favori rapporte peu, une surprise beaucoup.<br /><br />
                Ces pronostics se verrouillent à la clôture de la première journée et se
                règlent en fin de saison. Ils s'ajoutent uniquement au classement général.
              </Section>

              <Section n="6" titre="Le classement">
                Le {b("classement général")} cumule tous tes points de la saison — journées et
                bonus. Tu peux aussi filtrer par journée pour voir qui a brillé sur une
                journée précise.<br /><br />
                En cas d'égalité de points, le nombre de {b("scores exacts")} départage.
              </Section>

              <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "6px 2px 0", lineHeight: 1.6 }}>
                Bonne saison à tous. Que le meilleur pronostiqueur gagne.
              </p>
            </>
          );
        })()}

        {/* légende */}
        <div style={{ ...S.card, marginTop: 18, background: "rgba(255,255,255,0.02)" }}>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7 }}>
            <strong style={{ color: C.text, fontWeight: 600 }}>Barème</strong> — bon résultat : les points de la cote.
            Score exact : cote + bonus selon la part de scores exacts parmi les bons résultats.
            <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
              {[[">30 %", TIERS[0]], ["20–30 %", TIERS[1]], ["5–20 %", TIERS[2]], ["0,5–5 %", TIERS[3]], ["<0,5 %", TIERS[4]]].map(([rng, tr]) => (
                <span key={tr.label} style={{
                  fontSize: 10.5, padding: "4px 9px", borderRadius: 999,
                  background: "rgba(0,0,0,0.3)", border: `1px solid ${C.line}`, color: tr.color, fontWeight: 600,
                }}>
                  {tr.label} +{tr.pts} <span style={{ color: C.muted, fontWeight: 400 }}>({rng})</span>
                </span>
              ))}
            </div>
            <div style={{ marginTop: 9 }}>Joker ×2 : double le total du match, bonus compris. Un par demi-saison.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
