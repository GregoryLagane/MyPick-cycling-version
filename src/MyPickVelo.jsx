/* ============================================================================
   MyPick Vélo — application multijoueur
   ========================================================================= */
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase, configured } from "./supabase.js";
import {
  COEFF, TYPE_LABEL, PROFILE_LABEL, FLAG,
  S_GC, S_STAGE, S_JERSEY, STAGE_CAP,
  scoreRace, scorePodium, maxForRace,
  isLocked, countdown, fmtDateTime, fmtDate,
  buildRace, indexPicks, leaderboard,
} from "./lib.js";
import {
  SectionTitle, Empty, StatBox, RaceBadge, ResultTable,
  PickCard, PickModal,
} from "./ui.jsx";

const TABS = [
  { id: "courses", label: "Courses" },
  { id: "points", label: "Mes points" },
  { id: "classement", label: "Classement" },
];

// Écusson MyPick Vélo (SVG inline, taille réglable)
function LogoMark({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-label="MyPick Cyclisme">
      <defs>
        <path id="mpTopArc" d="M 40,100 A 60,60 0 0 1 160,100" />
        <path id="mpBotArc" d="M 44,100 A 56,56 0 0 0 156,100" />
      </defs>
      <circle cx="100" cy="100" r="70" fill="none" stroke="#a3e635" strokeWidth="5" />
      <circle cx="100" cy="100" r="60" fill="none" stroke="#44403c" strokeWidth="1.5" />
      <text fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="14" letterSpacing="4" fill="#fafaf9">
        <textPath href="#mpTopArc" startOffset="50%" textAnchor="middle">MYPICK</textPath>
      </text>
      <text fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="11" letterSpacing="6" fill="#a3e635">
        <textPath href="#mpBotArc" startOffset="50%" textAnchor="middle">CYCLISME</textPath>
      </text>
      <circle cx="42" cy="100" r="2.5" fill="#a3e635" />
      <circle cx="158" cy="100" r="2.5" fill="#a3e635" />
      <g transform="translate(100,96)" stroke="#fafaf9" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="-26" cy="9" r="14" />
        <circle cx="26" cy="9" r="14" />
        <path d="M-26,9 L-9,-13 L17,-13 M-9,-13 L9,9 L26,9 M-26,9 L9,9" />
        <path d="M17,-13 L24,-13 M-9,-13 L-13,-17" />
        <circle cx="-9" cy="9" r="2.6" fill="#a3e635" stroke="none" />
      </g>
    </svg>
  );
}

export default function MyPickVelo() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!configured) { setBooting(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from("profiles").select("*").eq("id", session.user.id).single()
      .then(({ data }) => setProfile(data));
  }, [session]);

  if (!configured) return <ConfigMissing />;
  if (booting) return <Splash />;
  if (!session) return <AuthScreen />;
  if (!profile) return <Splash />;

  return <Game session={session} profile={profile} />;
}

/* ==========================================================================
   ÉCRANS D'ATTENTE ET D'ERREUR
   ======================================================================== */

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-stone-900 text-stone-50 flex items-center justify-center p-5">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Logo({ size = "text-5xl" }) {
  return (
    <div className="text-center mb-8">
      <div className="mono text-[11px] uppercase tracking-[0.25em] text-lime-400 mb-1">
        UCI World Tour
      </div>
      <div className={`display ${size}`}>MyPick</div>
    </div>
  );
}

function Splash() {
  return (
    <Shell>
      <Logo />
      <div className="mono text-[11px] uppercase tracking-wider text-stone-500 text-center animate-pulse">
        Chargement
      </div>
    </Shell>
  );
}

function ConfigMissing() {
  return (
    <Shell>
      <Logo />
      <div className="bg-stone-800 border border-stone-700 p-5 text-sm leading-relaxed">
        <div className="mono text-[11px] uppercase tracking-wider text-lime-400 mb-2">
          Configuration manquante
        </div>
        <p className="text-stone-300">
          Crée un fichier <code className="mono text-lime-400">.env.local</code> à la racine
          du projet avec tes deux clés Supabase :
        </p>
        <pre className="mono text-[11px] bg-stone-900 p-3 mt-3 overflow-x-auto text-stone-400">
{`VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...`}
        </pre>
        <p className="text-stone-400 mt-3 text-xs">
          Puis relance le serveur de développement. Le guide d'installation détaille
          où trouver ces valeurs.
        </p>
      </div>
    </Shell>
  );
}

/* ==========================================================================
   AUTHENTIFICATION
   ======================================================================== */

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (pseudo.trim().length < 2) throw new Error("Choisis un pseudo d'au moins 2 caractères.");
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { pseudo: pseudo.trim() } },
        });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Compte créé. Tu peux te connecter." });
        setMode("login");
      }
    } catch (e) {
      setMsg({ kind: "err", text: traduireErreur(e.message) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Logo />
      <div className="bg-stone-800 border border-stone-700 p-5 space-y-4">
        <div className="flex gap-2">
          {[["login", "Connexion"], ["signup", "Créer un compte"]].map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setMode(k); setMsg(null); }}
              className={`flex-1 py-2 mono text-[11px] uppercase tracking-wider transition-colors ${
                mode === k ? "bg-lime-400 text-stone-900 font-bold" : "border border-stone-600 text-stone-400 hover:text-stone-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "signup" && (
          <Field label="Pseudo" value={pseudo} onChange={setPseudo} placeholder="Comment on te voit au classement" />
        )}
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Mot de passe" type="password" value={password} onChange={setPassword}
          onEnter={submit} />

        {msg && (
          <div className={`px-3 py-2 text-sm ${
            msg.kind === "ok" ? "bg-lime-400/10 border border-lime-400/40 text-lime-300"
                              : "bg-red-500/10 border border-red-500/40 text-red-300"
          }`}>
            {msg.text}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || !email || !password}
          className="w-full bg-lime-400 text-stone-900 py-3 mono text-xs uppercase tracking-wider font-bold disabled:bg-stone-700 disabled:text-stone-500 hover:bg-lime-300 transition-colors"
        >
          {busy ? "…" : mode === "login" ? "Se connecter" : "Créer le compte"}
        </button>
      </div>
    </Shell>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, onEnter }) {
  return (
    <div>
      <label className="mono text-[10px] uppercase tracking-wider text-stone-400 block mb-1.5">{label}</label>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        className="w-full bg-stone-900 border border-stone-600 px-3 py-2.5 text-sm text-stone-50 focus:outline-none focus:border-lime-400"
      />
    </div>
  );
}

function traduireErreur(m) {
  if (!m) return "Une erreur est survenue.";
  if (/Invalid login credentials/i.test(m)) return "Email ou mot de passe incorrect.";
  if (/User already registered/i.test(m)) return "Un compte existe déjà avec cet email.";
  if (/Password should be at least/i.test(m)) return "Le mot de passe doit faire au moins 6 caractères.";
  if (/new row violates row-level security/i.test(m))
    return "Pronostic refusé : le départ est déjà passé.";
  return m;
}

/* ==========================================================================
   JEU
   ======================================================================== */

function Game({ session, profile }) {
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState("courses");
  const [view, setView] = useState(null);
  const [modal, setModal] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);

  const [races, setRaces] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [pickRows, setPickRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const [r, s, p, pk] = await Promise.all([
      supabase.from("races").select("*").order("starts_at"),
      supabase.from("stages").select("*"),
      supabase.from("profiles").select("*"),
      supabase.from("picks").select("*"),
    ]);
    if (r.data) setRaces(r.data.map((row) => buildRace(row, s.data || [])));
    if (p.data) setProfiles(p.data);
    if (pk.data) setPickRows(pk.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Temps réel : le classement bouge quand les autres jouent
  useEffect(() => {
    const ch = supabase.channel("mypick-velo")
      .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "races" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "stages" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const picksByUser = useMemo(() => indexPicks(pickRows), [pickRows]);
  const myPicks = picksByUser[session.user.id] || {};

  const scores = useMemo(() => {
    const out = {};
    races.forEach((r) => { out[r.id] = scoreRace(myPicks[r.id], r); });
    return out;
  }, [races, myPicks]);

  const totals = useMemo(() => {
    let season = 0, done = 0, maxPossible = 0;
    const byType = { grand_tour: 0, monument: 0, worldtour: 0 };
    races.forEach((r) => {
      const s = scores[r.id];
      if (s && (r.result || r.gcResult)) {
        season += s.total; byType[r.type] += s.total; done++;
        maxPossible += maxForRace(r);
      }
    });
    return { season, done, byType, maxPossible };
  }, [races, scores]);

  const board = useMemo(
    () => leaderboard(profiles, picksByUser, races.filter((r) => r.result || r.gcResult)),
    [profiles, picksByUser, races]
  );
  const myRank = board.findIndex((r) => r.profile.id === session.user.id) + 1;

  /* --- formulaires --- */
  function openPick(kind, race, stage) {
    const cur = myPicks[race.id];
    let d;
    if (kind === "jerseys") {
      d = cur?.jerseys ? { ...cur.jerseys } : { points: "", kom: "" };
    } else if (kind === "stage") {
      d = cur?.stages?.[stage.n] ? { podium: [...cur.stages[stage.n].podium] } : { podium: ["", "", ""] };
    } else {
      d = cur?.[kind] ? { podium: [...cur[kind].podium], outsider: cur[kind].outsider || "" }
                      : { podium: ["", "", ""], outsider: "" };
    }
    setDraft(d);
    setModalError(null);
    setModal({ kind, race, stage });
  }

  async function savePick() {
    if (!modal) return;
    setSaving(true); setModalError(null);
    const { kind, race, stage } = modal;
    const payload = kind === "jerseys"
      ? { points: draft.points || null, kom: draft.kom || null }
      : kind === "stage"
        ? { podium: draft.podium }
        : { podium: draft.podium, outsider: draft.outsider || null };

    const { error } = await supabase.from("picks").upsert({
      user_id: session.user.id,
      race_id: race.id,
      kind,
      stage_n: kind === "stage" ? stage.n : null,
      payload,
    }, { onConflict: "user_id,race_id,kind,stage_n" });

    setSaving(false);
    if (error) {
      setModalError(traduireErreur(error.message));
    } else {
      setModal(null);
      load();
    }
  }

  const openRace = view ? races.find((r) => r.id === view) : null;

  const modalProps = {
    modal, draft, setDraft, onSave: savePick,
    onClose: () => setModal(null), saving, error: modalError, fmtDateTime,
  };

  if (loading) return <Splash />;

  /* --- détail d'une course à étapes --- */
  if (openRace && openRace.format === "stage") {
    return (
      <RaceDetail
        race={openRace} myPicks={myPicks[openRace.id] || { stages: {} }}
        score={scores[openRace.id]} now={now}
        profiles={profiles} picksByUser={picksByUser} meId={session.user.id}
        onBack={() => setView(null)}
        onPick={(kind, stage) => openPick(kind, openRace, stage)}
        modalProps={modalProps}
      />
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="bg-stone-900 text-stone-50">
        <div className="max-w-4xl mx-auto px-5 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <LogoMark size={64} />
              <div>
                <div className="mono text-[11px] uppercase tracking-[0.2em] text-lime-400 mb-1">
                  Saison 2026 · UCI World Tour
                </div>
                <h1 className="display text-4xl sm:text-5xl">MyPick</h1>
              <div className="mono text-[11px] text-stone-400 mt-1">
                {profile.pseudo}
                {profile.is_admin && <span className="text-lime-400 ml-2">· admin</span>}
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="ml-3 underline hover:text-stone-200"
                >
                  déconnexion
                </button>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="mono text-[11px] uppercase tracking-[0.15em] text-stone-400">Total saison</div>
              <div className="display text-5xl text-lime-400 leading-none">{totals.season}</div>
              <div className="mono text-[11px] text-stone-400 mt-1">
                {myRank > 0 ? `${myRank}${myRank === 1 ? "er" : "e"} sur ${board.length}` : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-stone-700">
          <div className="max-w-4xl mx-auto px-5 flex overflow-x-auto">
            {[...TABS, ...(profile.is_admin ? [{ id: "admin", label: "Admin" }] : [])].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`mono text-[11px] uppercase tracking-[0.15em] px-4 py-3 border-b-2 whitespace-nowrap transition-colors ${
                  tab === t.id ? "border-lime-400 text-lime-400"
                               : "border-transparent text-stone-400 hover:text-stone-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-8 body-f">
        {tab === "courses" && (
          <TabCourses
            races={races} myPicks={myPicks} scores={scores} now={now}
            onOpenRace={setView} onPick={openPick}
          />
        )}
        {tab === "points" && (
          <TabPoints races={races} scores={scores} totals={totals} onOpenRace={setView} />
        )}
        {tab === "classement" && (
          <TabClassement
            board={board} races={races} meId={session.user.id}
            picksByUser={picksByUser} profiles={profiles} now={now}
          />
        )}
        {tab === "admin" && profile.is_admin && (
          <TabAdmin races={races} onSaved={load} />
        )}
      </main>

      <PickModal {...modalProps} />
    </div>
  );
}

/* ==========================================================================
   ONGLET 1 — COURSES
   ======================================================================== */

function TabCourses({ races, myPicks, scores, now, onOpenRace, onPick }) {
  const upcoming = races.filter((r) => !(r.result || r.gcResult));
  const finished = races.filter((r) => r.result || r.gcResult);

  return (
    <div className="space-y-10">
      <section>
        <SectionTitle>Pronostics ouverts</SectionTitle>
        <div className="grid gap-3">
          {upcoming.length === 0
            ? <Empty>Aucune course à venir dans le calendrier.</Empty>
            : upcoming.map((race) => (
                <RaceRow key={race.id} race={race} myPicks={myPicks} scores={scores}
                  now={now} onOpenRace={onOpenRace} onPick={onPick} />
              ))}
        </div>
      </section>

      <section>
        <SectionTitle>Courses jouées</SectionTitle>
        <div className="grid gap-3">
          {finished.length === 0
            ? <Empty>Les résultats apparaîtront après la première course.</Empty>
            : finished.map((race) => (
                <RaceRow key={race.id} race={race} myPicks={myPicks} scores={scores}
                  now={now} onOpenRace={onOpenRace} onPick={onPick} />
              ))}
        </div>
      </section>

      <section className="text-xs text-stone-500 leading-relaxed border-t border-stone-300 pt-5 space-y-2">
        <p>
          <strong className="text-stone-700">Barème.</strong> Course d'un jour et classement général :
          vainqueur {S_GC.winner}, bonne place sur le podium {S_GC.exactPlace}, podium mais mauvaise place {S_GC.wrongPlace},
          outsider dans le top 5 {S_GC.outsiderTop5}. Maillot à points et maillot montagne : {S_JERSEY.points} chacun.
          Ces points sont multipliés par le coefficient de la course
          (×{COEFF.grand_tour} Grand Tour, ×{COEFF.monument} Monument, ×{COEFF.worldtour} World Tour).
        </p>
        <p>
          <strong className="text-stone-700">Étapes.</strong> {S_STAGE.winner} / {S_STAGE.exactPlace} / {S_STAGE.wrongPlace} pts,
          sans coefficient. Seules tes {STAGE_CAP.grand_tour} meilleures étapes comptent sur un Grand Tour
          et tes {STAGE_CAP.worldtour} meilleures sur les autres courses à étapes — rater quelques étapes
          ne te sort donc pas du jeu.
        </p>
        <p>
          Un pronostic non saisi avant l'heure de départ vaut 0. Les horaires sont affichés
          en heure de Maurice. Les pronostics des autres joueurs deviennent visibles au départ
          de chaque étape ; ceux du classement général restent cachés jusqu'à la fin de la course.
        </p>
      </section>
    </div>
  );
}

function RaceRow({ race, myPicks, scores, now, onOpenRace, onPick }) {
  const s = scores[race.id];
  const rp = myPicks[race.id];
  const locked = isLocked(race.startsAt, now);
  const played = race.result || race.gcResult;

  let subInfo = null;
  if (race.format === "stage") {
    const total = (race.stages || []).length;
    const filled = Object.keys(rp?.stages || {}).length;
    subInfo = total > 0 ? `${filled}/${total} étapes pronostiquées` : "Étapes pas encore publiées";
  }

  return (
    <div className="bg-white border border-stone-300 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 mb-1">
            <span>{FLAG[race.country] || "🏁"}</span>
            <RaceBadge race={race} muted={Boolean(played)} />
            {race.format === "stage" && (
              <span className="mono text-[10px] uppercase tracking-wider text-stone-400">
                Course à étapes
              </span>
            )}
          </div>
          <div className="display text-xl">{race.name}</div>
          <div className="mono text-[11px] text-stone-500 mt-0.5">
            Départ {fmtDateTime(race.startsAt)}
            {!locked && <span className="text-stone-900"> · ferme dans {countdown(race.startsAt, now)}</span>}
          </div>
          {subInfo && <div className="mono text-[11px] text-stone-500 mt-1">{subInfo}</div>}
          {race.format === "oneday" && rp?.oneday && (
            <div className="mono text-xs text-stone-600 mt-2">
              {rp.oneday.podium.map((r, i) => `${i + 1}. ${r}`).join("  ·  ")}
              {rp.oneday.outsider && `  ·  ★ ${rp.oneday.outsider}`}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {played && s && (
            <div className="text-right">
              <div className="display text-3xl leading-none">{s.total}</div>
              <div className="mono text-[9px] uppercase text-stone-400">pts</div>
            </div>
          )}
          {race.format === "stage" ? (
            <button
              onClick={() => onOpenRace(race.id)}
              className="px-5 py-2.5 mono text-xs uppercase tracking-wider border border-stone-900 hover:bg-stone-900 hover:text-white transition-colors"
            >
              Ouvrir
            </button>
          ) : locked ? (
            <span className="mono text-[10px] uppercase tracking-wider text-stone-400 px-2">
              Verrouillé
            </span>
          ) : (
            <button
              onClick={() => onPick("oneday", race)}
              className={`px-5 py-2.5 mono text-xs uppercase tracking-wider transition-colors ${
                rp?.oneday ? "border border-stone-900 hover:bg-stone-900 hover:text-white"
                           : "bg-lime-400 text-stone-900 font-bold hover:bg-lime-300"
              }`}
            >
              {rp?.oneday ? "Modifier" : "Pronostiquer"}
            </button>
          )}
        </div>
      </div>

      {race.format === "oneday" && race.result && (
        <ResultTable
          result={race.result}
          picked={rp?.oneday ? [...rp.oneday.podium, rp.oneday.outsider].filter(Boolean) : []}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   ONGLET 2 — MES POINTS
   ======================================================================== */

function TabPoints({ races, scores, totals, onOpenRace }) {
  const played = races.filter((r) => r.result || r.gcResult);
  const pct = totals.maxPossible > 0 ? Math.round((totals.season / totals.maxPossible) * 100) : 0;

  if (played.length === 0) {
    return <Empty>Tes points apparaîtront ici après la première course.</Empty>;
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Saison</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox value={totals.season} label="Points" accent />
          <StatBox value={totals.done} label="Courses jouées" />
          <StatBox value={`${pct}%`} label="Du maximum" />
          <StatBox value={totals.done ? Math.round(totals.season / totals.done) : 0} label="Moyenne / course" />
        </div>
        <div className="mt-3 bg-white border border-stone-300 p-4">
          <div className="mono text-[10px] uppercase tracking-wider text-stone-400 mb-2">
            Répartition par type
          </div>
          {Object.entries(TYPE_LABEL).map(([k, label]) => {
            const v = totals.byType[k];
            const w = totals.season > 0 ? (v / totals.season) * 100 : 0;
            return (
              <div key={k} className="flex items-center gap-3 py-1">
                <span className="mono text-[11px] uppercase tracking-wider text-stone-500 w-28">{label}</span>
                <div className="flex-1 h-2 bg-stone-100">
                  <div className="h-full bg-lime-400" style={{ width: `${w}%` }} />
                </div>
                <span className="mono text-xs font-bold w-10 text-right">{v}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle>Détail par course</SectionTitle>
        <div className="space-y-3">
          {played.map((race) => {
            const s = scores[race.id];
            const max = maxForRace(race);
            return (
              <div key={race.id} className="bg-white border border-stone-300">
                <div className="px-5 py-4 flex items-baseline justify-between gap-3 flex-wrap border-b border-stone-200">
                  <div>
                    <div className="flex items-center gap-2">
                      <span>{FLAG[race.country] || "🏁"}</span>
                      <span className="display text-lg">{race.name}</span>
                    </div>
                    <div className="mono text-[10px] uppercase tracking-wider text-stone-400 mt-0.5">
                      {TYPE_LABEL[race.type]} ×{COEFF[race.type]} · maximum théorique {max}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="display text-3xl leading-none">{s?.total ?? 0}</div>
                      <div className="mono text-[9px] uppercase text-stone-400">pts</div>
                    </div>
                    {race.format === "stage" && (
                      <button
                        onClick={() => onOpenRace(race.id)}
                        className="mono text-[10px] uppercase tracking-wider border border-stone-400 px-3 py-1.5 hover:bg-stone-900 hover:text-white transition-colors"
                      >
                        Détail
                      </button>
                    )}
                  </div>
                </div>

                {s && s.groups.length > 0 ? (
                  <div className="divide-y divide-stone-100">
                    {s.groups.map((g, gi) => (
                      <div key={gi} className="px-5 py-3">
                        <div className="flex justify-between items-baseline mb-1.5">
                          <span className="mono text-[10px] uppercase tracking-wider text-stone-500">{g.title}</span>
                          <span className="mono text-xs font-bold">{g.subtotal}</span>
                        </div>
                        <div className="space-y-1">
                          {g.lines.map((l, i) => (
                            <div key={i} className={`flex items-baseline gap-2 text-sm ${l.dropped ? "opacity-40" : ""}`}>
                              <span className={`mono text-[11px] px-1.5 py-0.5 font-bold ${
                                l.dropped ? "bg-stone-200 text-stone-500 line-through" : "bg-lime-400"
                              }`}>+{l.pts}</span>
                              <span className="font-medium">{l.rider}</span>
                              <span className="text-stone-500 text-xs">{l.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="px-5 py-2.5 bg-stone-50 mono text-[11px] text-stone-500">
                      {s.raw} × coefficient {s.coeff}
                      {s.flat ? ` + ${s.flat} d'étapes` : ""} = {s.total} pts
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-4 text-sm text-stone-500">
                    Aucun point marqué sur cette course.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ==========================================================================
   ONGLET 3 — CLASSEMENT
   ======================================================================== */

function TabClassement({ board, races, meId, picksByUser, profiles, now }) {
  const [scope, setScope] = useState("all");
  const played = races.filter((r) => r.result || r.gcResult);

  const rows = useMemo(() => {
    if (scope === "all") return board;
    if (scope.startsWith("type:")) {
      const t = scope.slice(5);
      return leaderboard(profiles, picksByUser, played.filter((r) => r.type === t));
    }
    return leaderboard(profiles, picksByUser, played.filter((r) => r.id === scope));
  }, [scope, board, profiles, picksByUser, played]);

  const best = rows.length ? rows[0].total : 0;

  if (played.length === 0) {
    return <Empty>Le classement démarrera après la première course.</Empty>;
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1.5">
          Filtrer
        </label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="w-full sm:w-80 border border-stone-400 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-stone-900"
        >
          <option value="all">Classement général de la saison</option>
          <optgroup label="Par type de course">
            {Object.entries(TYPE_LABEL).map(([k, label]) => (
              <option key={k} value={`type:${k}`}>{label}</option>
            ))}
          </optgroup>
          <optgroup label="Par course">
            {played.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="bg-white border border-stone-300 divide-y divide-stone-200">
        {rows.map((row, i) => {
          const me = row.profile.id === meId;
          return (
            <div key={row.profile.id} className={`px-5 py-4 flex items-center gap-4 ${me ? "bg-lime-50" : ""}`}>
              <div className={`display text-2xl w-8 text-center ${
                i === 0 ? "text-lime-600" : i < 3 ? "text-stone-700" : "text-stone-300"
              }`}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="display text-base truncate">
                  {row.profile.pseudo}
                  {me && <span className="mono text-[10px] uppercase tracking-wider text-lime-700 ml-2">toi</span>}
                </div>
                <div className="h-1.5 bg-stone-100 max-w-[240px] mt-1.5">
                  <div className="h-full bg-lime-400" style={{ width: `${best > 0 ? (row.total / best) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="text-right">
                <div className="display text-2xl leading-none">{row.total}</div>
                <div className="mono text-[9px] uppercase text-stone-400">pts</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pronostics des autres, une fois la course partie */}
      <section>
        <SectionTitle>Qui a pronostiqué quoi</SectionTitle>
        <div className="space-y-3">
          {played.filter((r) => r.format === "oneday").map((race) => (
            <ComparePicks key={race.id} race={race} profiles={profiles} picksByUser={picksByUser} meId={meId} />
          ))}
          {played.filter((r) => r.format === "oneday").length === 0 && (
            <Empty>La comparaison s'affiche pour les courses d'un jour terminées.</Empty>
          )}
        </div>
      </section>
    </div>
  );
}

function ComparePicks({ race, profiles, picksByUser, meId }) {
  const rows = profiles
    .map((p) => ({ p, pick: picksByUser[p.id]?.[race.id]?.oneday }))
    .filter((r) => r.pick)
    .map((r) => ({
      ...r,
      pts: scoreRace(picksByUser[r.p.id]?.[race.id], race)?.total ?? 0,
    }))
    .sort((a, b) => b.pts - a.pts);

  if (rows.length === 0) return null;

  return (
    <div className="bg-white border border-stone-300">
      <div className="px-5 py-3 border-b border-stone-200 flex items-center gap-2">
        <span>{FLAG[race.country] || "🏁"}</span>
        <span className="display text-base">{race.name}</span>
      </div>
      <div className="divide-y divide-stone-100">
        {rows.map(({ p, pick, pts }) => (
          <div key={p.id} className={`px-5 py-3 flex items-baseline gap-3 flex-wrap ${
            p.id === meId ? "bg-lime-50" : ""
          }`}>
            <span className="display text-sm w-24 truncate">{p.pseudo}</span>
            <span className="mono text-xs text-stone-600 flex-1 min-w-[200px]">
              {pick.podium.map((r, i) => `${i + 1}. ${r}`).join("  ·  ")}
              {pick.outsider && `  ·  ★ ${pick.outsider}`}
            </span>
            <span className="mono text-sm font-bold">{pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==========================================================================
   DÉTAIL D'UNE COURSE À ÉTAPES
   ======================================================================== */

function RaceDetail({ race, myPicks, score, now, profiles, picksByUser, meId, onBack, onPick, modalProps }) {
  const rp = myPicks;
  const s = score;
  const gcLocked = isLocked(race.startsAt, now);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="bg-stone-900 text-stone-50">
        <div className="max-w-3xl mx-auto px-5 py-6">
          <button onClick={onBack} className="mono text-[11px] uppercase tracking-wider text-lime-400 hover:text-lime-300 mb-3">
            ← Toutes les courses
          </button>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="mono text-[10px] uppercase tracking-wider text-stone-400">
                {TYPE_LABEL[race.type]} · coefficient ×{COEFF[race.type]}
              </div>
              <h1 className="display text-3xl sm:text-4xl">{race.name}</h1>
            </div>
            <div className="text-right">
              <div className="display text-4xl text-lime-400 leading-none">{s ? s.total : 0}</div>
              <div className="mono text-[10px] uppercase tracking-wider text-stone-400">points</div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 body-f space-y-8">
        <section>
          <SectionTitle>Classement final</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-3">
            <PickCard
              title="Podium général"
              hint={`${S_GC.winner} / ${S_GC.exactPlace} / ${S_GC.exactPlace} + outsider ${S_GC.outsiderTop5}`}
              locked={gcLocked}
              lockLabel={countdown(race.startsAt, now)}
              value={rp.gc ? rp.gc.podium.map((r, i) => `${i + 1}. ${r}`).join(" · ") + (rp.gc.outsider ? ` · ★ ${rp.gc.outsider}` : "") : null}
              onEdit={() => onPick("gc")}
            />
            <PickCard
              title="Maillots"
              hint={`${S_JERSEY.points} pts par maillot`}
              locked={gcLocked}
              lockLabel={countdown(race.startsAt, now)}
              value={rp.jerseys ? `Points : ${rp.jerseys.points || "—"} · Montagne : ${rp.jerseys.kom || "—"}` : null}
              onEdit={() => onPick("jerseys")}
            />
          </div>
        </section>

        {race.gcResult && (
          <section>
            <SectionTitle>Classement général définitif</SectionTitle>
            <div className="bg-white border border-stone-300 p-5">
              <ResultTable
                result={race.gcResult}
                picked={rp.gc ? [...rp.gc.podium, rp.gc.outsider].filter(Boolean) : []}
                title="Général"
              />
              {race.jerseys && (
                <div className="mt-4 pt-3 border-t border-stone-200 grid sm:grid-cols-2 gap-3">
                  <JerseyResult label="Maillot à points" rider={race.jerseys.points}
                    hit={rp.jerseys?.points === race.jerseys.points} />
                  <JerseyResult label="Maillot montagne" rider={race.jerseys.kom}
                    hit={rp.jerseys?.kom === race.jerseys.kom} />
                </div>
              )}
            </div>
          </section>
        )}

        <section>
          <SectionTitle>Étapes · {S_STAGE.winner} / {S_STAGE.exactPlace} / {S_STAGE.exactPlace} pts</SectionTitle>
          <div className="grid gap-2">
            {(race.stages || []).length === 0 ? (
              <Empty>Les étapes ne sont pas encore publiées pour cette course.</Empty>
            ) : race.stages.map((st) => (
              <StageRow key={st.n} race={race} stage={st} pick={rp.stages?.[st.n]}
                now={now} profiles={profiles} picksByUser={picksByUser} meId={meId}
                onPick={() => onPick("stage", st)} />
            ))}
          </div>
        </section>

        {s && s.groups.length > 0 && (
          <section>
            <SectionTitle>Détail des points</SectionTitle>
            <div className="bg-white border border-stone-300 divide-y divide-stone-200">
              {s.groups.map((g, gi) => (
                <div key={gi} className="p-4">
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="mono text-[10px] uppercase tracking-wider text-stone-500">{g.title}</span>
                    <span className="mono text-xs font-bold">{g.subtotal}</span>
                  </div>
                  <div className="space-y-1">
                    {g.lines.map((l, i) => (
                      <div key={i} className={`flex items-baseline gap-2 text-sm ${l.dropped ? "opacity-40" : ""}`}>
                        <span className={`mono text-[11px] px-1.5 py-0.5 font-bold ${
                          l.dropped ? "bg-stone-200 text-stone-500 line-through" : "bg-lime-400"
                        }`}>+{l.pts}</span>
                        <span className="font-medium">{l.rider}</span>
                        <span className="text-stone-500 text-xs">{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="p-4 bg-stone-900 text-stone-50 flex justify-between items-baseline">
                <span className="mono text-[11px] uppercase tracking-wider">
                  {s.raw} × coefficient {s.coeff}
                  {s.flat ? ` + ${s.flat} d'étapes` : ""}
                </span>
                <span className="display text-2xl text-lime-400">{s.total}</span>
              </div>
            </div>
          </section>
        )}
      </main>

      <PickModal {...modalProps} />
    </div>
  );
}

function StageRow({ race, stage, pick, now, profiles, picksByUser, meId, onPick }) {
  const [showOthers, setShowOthers] = useState(false);
  const locked = isLocked(stage.startsAt, now);
  const pts = stage.result && pick
    ? scorePodium(pick.podium, stage.result, S_STAGE, race.favorites, null).raw
    : null;

  const others = locked
    ? profiles
        .map((p) => ({ p, pick: picksByUser[p.id]?.[race.id]?.stages?.[stage.n] }))
        .filter((r) => r.pick)
    : [];

  return (
    <div className="bg-white border border-stone-300 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <span className="display text-base">{stage.label}</span>
            {stage.profile && (
              <span className="mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-stone-200 text-stone-600">
                {PROFILE_LABEL[stage.profile]}
              </span>
            )}
          </div>
          <div className="mono text-[11px] text-stone-500 mt-0.5">
            Départ {fmtDateTime(stage.startsAt)}
            {!locked && <span className="text-stone-900"> · ferme dans {countdown(stage.startsAt, now)}</span>}
          </div>
          {pick && (
            <div className="mono text-xs text-stone-600 mt-2">
              {pick.podium.map((r, i) => `${i + 1}. ${r}`).join("  ·  ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {pts !== null && (
            <div className="text-right">
              <div className="display text-2xl leading-none">{pts}</div>
              <div className="mono text-[9px] uppercase text-stone-400">pts</div>
            </div>
          )}
          {!locked ? (
            <button
              onClick={onPick}
              className={`px-4 py-2 mono text-[11px] uppercase tracking-wider transition-colors ${
                pick ? "border border-stone-900 hover:bg-stone-900 hover:text-white"
                     : "bg-lime-400 text-stone-900 font-bold hover:bg-lime-300"
              }`}
            >
              {pick ? "Modifier" : "Pronostiquer"}
            </button>
          ) : !pick ? (
            <span className="mono text-[10px] uppercase tracking-wider text-stone-400 px-2">Non joué</span>
          ) : null}
        </div>
      </div>

      {stage.result && (
        <ResultTable result={stage.result} picked={pick ? pick.podium.filter(Boolean) : []}
          title="Résultat de l'étape" />
      )}

      {others.length > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-200">
          <button
            onClick={() => setShowOthers(!showOthers)}
            className="mono text-[10px] uppercase tracking-wider text-stone-500 hover:text-stone-900"
          >
            {showOthers ? "▾" : "▸"} Pronostics des autres ({others.length})
          </button>
          {showOthers && (
            <div className="mt-2 space-y-1">
              {others.map(({ p, pick: op }) => (
                <div key={p.id} className={`flex items-baseline gap-3 text-xs py-1 ${
                  p.id === meId ? "font-bold" : "text-stone-600"
                }`}>
                  <span className="w-20 truncate">{p.pseudo}</span>
                  <span className="mono flex-1">{op.podium.join("  ·  ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JerseyResult({ label, rider, hit }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="mono text-[10px] uppercase tracking-wider text-stone-400">{label}</span>
      <span className={`text-sm ${hit ? "font-bold" : "text-stone-600"}`}>{rider || "—"}</span>
      {hit && <span className="mono text-[10px] text-lime-600">✓</span>}
    </div>
  );
}

/* ==========================================================================
   ONGLET ADMIN
   ======================================================================== */

function TabAdmin({ races, onSaved }) {
  const [raceId, setRaceId] = useState(races[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const race = races.find((r) => r.id === raceId);

  const [startlist, setStartlist] = useState("");
  const [favorites, setFavorites] = useState("");
  const [result, setResult] = useState("");
  const [gcResult, setGcResult] = useState("");
  const [jPoints, setJPoints] = useState("");
  const [jKom, setJKom] = useState("");
  const [stageN, setStageN] = useState("");
  const [stageResult, setStageResult] = useState("");

  useEffect(() => {
    if (!race) return;
    setStartlist((race.startlist || []).join("\n"));
    setFavorites((race.favorites || []).join("\n"));
    setResult((race.result || []).join("\n"));
    setGcResult((race.gcResult || []).join("\n"));
    setJPoints(race.jerseys?.points || "");
    setJKom(race.jerseys?.kom || "");
    setStageN("");
    setStageResult("");
  }, [raceId]);

  const toList = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function saveRace() {
    setBusy(true); setMsg(null);
    const patch = {
      startlist: toList(startlist),
      favorites: toList(favorites),
      result: race.format === "oneday" && result.trim() ? toList(result) : null,
      gc_result: race.format === "stage" && gcResult.trim() ? toList(gcResult) : null,
      jersey_points: jPoints || null,
      jersey_kom: jKom || null,
    };
    const { error } = await supabase.from("races").update(patch).eq("id", raceId);
    setBusy(false);
    setMsg(error ? { kind: "err", text: error.message } : { kind: "ok", text: "Course mise à jour." });
    if (!error) onSaved();
  }

  async function saveStage() {
    if (!stageN) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("stages")
      .update({ result: stageResult.trim() ? toList(stageResult) : null })
      .eq("race_id", raceId).eq("n", Number(stageN));
    setBusy(false);
    setMsg(error ? { kind: "err", text: error.message } : { kind: "ok", text: `Étape ${stageN} mise à jour.` });
    if (!error) onSaved();
  }

  if (!race) return <Empty>Aucune course dans le calendrier.</Empty>;

  return (
    <div className="space-y-6">
      <div className="bg-stone-900 text-stone-50 px-5 py-4">
        <div className="mono text-[10px] uppercase tracking-wider text-lime-400 mb-1">Organisateur</div>
        <div className="text-sm text-stone-300 leading-relaxed">
          Un coureur par ligne, dans l'ordre d'arrivée. Les noms doivent correspondre
          exactement à ceux de la liste de départ, sinon les points ne seront pas comptés.
        </div>
      </div>

      <div>
        <label className="mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1.5">Course</label>
        <select
          value={raceId} onChange={(e) => setRaceId(e.target.value)}
          className="w-full border border-stone-400 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-stone-900"
        >
          {races.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {fmtDate(r.startsAt)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <TextArea label="Liste de départ" hint="un coureur par ligne"
          value={startlist} onChange={setStartlist} rows={10} />
        <TextArea label="Favoris" hint="exclus du bonus outsider"
          value={favorites} onChange={setFavorites} rows={10} />
      </div>

      {race.format === "oneday" ? (
        <TextArea label="Résultat" hint="top 10 dans l'ordre" value={result} onChange={setResult} rows={10} />
      ) : (
        <>
          <TextArea label="Classement général final" hint="top 10 dans l'ordre"
            value={gcResult} onChange={setGcResult} rows={10} />
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1.5">
                Maillot à points
              </label>
              <input value={jPoints} onChange={(e) => setJPoints(e.target.value)}
                className="w-full border border-stone-400 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-stone-900" />
            </div>
            <div>
              <label className="mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1.5">
                Maillot montagne
              </label>
              <input value={jKom} onChange={(e) => setJKom(e.target.value)}
                className="w-full border border-stone-400 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-stone-900" />
            </div>
          </div>
        </>
      )}

      <button onClick={saveRace} disabled={busy}
        className="w-full bg-lime-400 text-stone-900 py-3 mono text-xs uppercase tracking-wider font-bold disabled:bg-stone-300 hover:bg-lime-300 transition-colors">
        {busy ? "…" : "Enregistrer la course"}
      </button>

      {race.format === "stage" && (race.stages || []).length > 0 && (
        <div className="border-t border-stone-300 pt-6 space-y-4">
          <SectionTitle>Résultat d'une étape</SectionTitle>
          <div>
            <label className="mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1.5">Étape</label>
            <select
              value={stageN}
              onChange={(e) => {
                setStageN(e.target.value);
                const st = race.stages.find((s) => String(s.n) === e.target.value);
                setStageResult((st?.result || []).join("\n"));
              }}
              className="w-full border border-stone-400 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-stone-900"
            >
              <option value="">Choisir une étape</option>
              {race.stages.map((s) => (
                <option key={s.n} value={s.n}>
                  {s.label} — {fmtDate(s.startsAt)}{s.result ? " ✓" : ""}
                </option>
              ))}
            </select>
          </div>
          {stageN && (
            <>
              <TextArea label="Résultat de l'étape" hint="top 10 dans l'ordre"
                value={stageResult} onChange={setStageResult} rows={10} />
              <button onClick={saveStage} disabled={busy}
                className="w-full border border-stone-900 py-3 mono text-xs uppercase tracking-wider hover:bg-stone-900 hover:text-white transition-colors">
                {busy ? "…" : `Enregistrer l'étape ${stageN}`}
              </button>
            </>
          )}
        </div>
      )}

      {msg && (
        <div className={`px-3 py-2 text-sm ${
          msg.kind === "ok" ? "bg-lime-50 border border-lime-400 text-lime-900"
                            : "bg-red-50 border border-red-300 text-red-800"
        }`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function TextArea({ label, hint, value, onChange, rows = 6 }) {
  const n = value.split("\n").filter((x) => x.trim()).length;
  return (
    <div>
      <label className="mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1.5">
        {label}
        {hint && <span className="text-stone-400 ml-2">{hint}</span>}
        <span className="text-stone-400 ml-2">· {n} ligne{n > 1 ? "s" : ""}</span>
      </label>
      <textarea
        value={value} rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-stone-400 bg-white px-3 py-2.5 text-sm mono focus:outline-none focus:border-stone-900"
      />
    </div>
  );
}
