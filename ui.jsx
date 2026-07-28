/* ============================================================================
   MyPick Vélo — composants d'interface réutilisables
   ========================================================================= */
import { COEFF, TYPE_LABEL, FLAG, S_GC, S_STAGE, S_JERSEY, ord } from "./lib.js";

export function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="mono text-[11px] uppercase tracking-[0.2em] text-stone-500">{children}</h2>
      <div className="flex-1 h-px bg-stone-300" />
      {right}
    </div>
  );
}

export function Empty({ children }) {
  return (
    <div className="bg-white border border-dashed border-stone-300 px-5 py-8 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}

export function StatBox({ value, label, accent }) {
  return (
    <div className={`border p-4 ${accent ? "bg-stone-900 border-stone-900" : "bg-white border-stone-300"}`}>
      <div className={`display text-3xl leading-none ${accent ? "text-lime-400" : ""}`}>{value}</div>
      <div className={`mono text-[10px] uppercase tracking-wider mt-1 ${accent ? "text-stone-400" : "text-stone-500"}`}>
        {label}
      </div>
    </div>
  );
}

export function RaceBadge({ race, muted }) {
  return (
    <span className={`mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${
      muted ? "bg-stone-200 text-stone-700" : "bg-stone-900 text-lime-400"
    }`}>
      {TYPE_LABEL[race.type]} ×{COEFF[race.type]}
    </span>
  );
}

/* Top 10 d'un résultat, avec mise en évidence des coureurs pronostiqués */
export function ResultTable({ result, picked = [], title = "Résultat" }) {
  if (!result || result.length === 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-stone-200">
      <div className="mono text-[10px] uppercase tracking-wider text-stone-400 mb-2">{title}</div>
      <div className="grid sm:grid-cols-2 gap-x-6">
        {result.slice(0, 10).map((r, i) => {
          const hit = picked.includes(r);
          return (
            <div key={r} className={`flex items-baseline gap-2 py-1 text-sm border-b border-stone-100 ${
              hit ? "font-bold" : "text-stone-600"
            }`}>
              <span className={`mono text-[11px] w-5 text-right ${i < 3 ? "text-stone-900" : "text-stone-400"}`}>
                {i + 1}
              </span>
              <span className="flex-1">{r}</span>
              {hit && <span className="mono text-[10px] text-lime-600">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PickCard({ title, hint, value, locked, lockLabel, onEdit }) {
  return (
    <div className="bg-white border border-stone-300 p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="display text-base">{title}</span>
          <span className="mono text-[10px] text-stone-400">{hint}</span>
        </div>
        <div className="mono text-xs text-stone-600 mt-2 min-h-[2rem]">
          {value || <span className="text-stone-400">Aucun pronostic</span>}
        </div>
      </div>
      {locked ? (
        <div className="mono text-[10px] uppercase tracking-wider text-stone-400 mt-2">Verrouillé</div>
      ) : (
        <button
          onClick={onEdit}
          className="mt-3 w-full py-2 mono text-[11px] uppercase tracking-wider bg-lime-400 text-stone-900 font-bold hover:bg-lime-300 transition-colors"
        >
          {value ? "Modifier" : "Pronostiquer"} · ferme dans {lockLabel}
        </button>
      )}
    </div>
  );
}

export function SelectField({ label, hint, value, options, favorites, disabledSet, selfValue, onChange, emptyLabel }) {
  return (
    <div>
      <label className="mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1.5">
        {label}
        {hint && <span className="text-stone-400 ml-2">{hint}</span>}
      </label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-stone-400 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-stone-900"
      >
        <option value="">{emptyLabel || "Choisir un coureur"}</option>
        {options.map((r) => (
          <option
            key={r}
            value={r}
            disabled={disabledSet ? disabledSet.includes(r) && selfValue !== r : false}
          >
            {r}{favorites?.includes(r) ? " ★" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/* Modale de saisie d'un pronostic */
export function PickModal({ modal, draft, setDraft, onSave, onClose, saving, error, fmtDateTime }) {
  if (!modal) return null;
  const { kind, race, stage } = modal;

  const heading =
    kind === "stage" ? stage.label :
    kind === "gc" ? "Podium du classement général" :
    kind === "jerseys" ? "Maillots" : race.name;

  const scale = kind === "stage" ? S_STAGE : S_GC;
  const valid = kind === "jerseys"
    ? true
    : draft.podium?.every(Boolean) && new Set(draft.podium).size === 3;

  const startlist = race.startlist || [];
  const noStartlist = startlist.length === 0;

  return (
    <div className="fixed inset-0 bg-stone-900/70 flex items-end sm:items-center justify-center p-0 sm:p-5 z-50" onClick={onClose}>
      <div className="bg-stone-100 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="bg-stone-900 text-stone-50 px-5 py-4 sticky top-0 z-10">
          <div className="mono text-[10px] uppercase tracking-wider text-lime-400">
            {race.name} · {TYPE_LABEL[race.type]} ×{COEFF[race.type]}
          </div>
          <div className="display text-2xl">{heading}</div>
          <div className="mono text-[10px] text-stone-400 mt-1">
            Ferme le {fmtDateTime(kind === "stage" ? stage.startsAt : race.startsAt)}
          </div>
        </div>

        <div className="p-5 body-f space-y-5">
          {noStartlist ? (
            <div className="bg-white border border-stone-300 px-4 py-5 text-sm text-stone-600">
              La liste de départ n'est pas encore renseignée pour cette course.
              L'organisateur doit l'ajouter depuis l'onglet Admin avant que les
              pronostics puissent être saisis.
            </div>
          ) : kind === "jerseys" ? (
            <>
              <SelectField
                label="Maillot à points" hint={`${S_JERSEY.points} pts`}
                value={draft.points} options={startlist}
                onChange={(v) => setDraft({ ...draft, points: v })}
              />
              <SelectField
                label="Maillot montagne" hint={`${S_JERSEY.kom} pts`}
                value={draft.kom} options={startlist}
                onChange={(v) => setDraft({ ...draft, kom: v })}
              />
            </>
          ) : (
            <>
              {[0, 1, 2].map((i) => (
                <SelectField
                  key={i}
                  label={i === 0 ? "Vainqueur" : `${ord(i + 1)} place`}
                  hint={`${i === 0 ? scale.winner : scale.exactPlace} pts`}
                  value={draft.podium?.[i] || ""}
                  options={startlist}
                  favorites={race.favorites}
                  disabledSet={draft.podium}
                  selfValue={draft.podium?.[i]}
                  onChange={(v) => {
                    const next = [...(draft.podium || ["", "", ""])];
                    next[i] = v;
                    setDraft({ ...draft, podium: next });
                  }}
                />
              ))}

              {kind !== "stage" && (
                <div className="pt-2 border-t border-stone-300">
                  <SelectField
                    label="Outsider" hint={`${S_GC.outsiderTop5} pts si top 5`}
                    value={draft.outsider || ""}
                    options={startlist.filter((r) => !(race.favorites || []).includes(r))}
                    onChange={(v) => setDraft({ ...draft, outsider: v })}
                    emptyLabel="Aucun"
                  />
                  <div className="text-xs text-stone-500 mt-1.5">
                    Les favoris (★) ne comptent pas comme outsiders.
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-300 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onSave}
              disabled={!valid || saving || noStartlist}
              className="flex-1 bg-lime-400 text-stone-900 py-3 mono text-xs uppercase tracking-wider font-bold disabled:bg-stone-300 disabled:text-stone-500 hover:bg-lime-300 transition-colors"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              onClick={onClose}
              className="px-5 border border-stone-400 mono text-xs uppercase tracking-wider hover:bg-stone-200 transition-colors"
            >
              Annuler
            </button>
          </div>

          {!valid && !noStartlist && kind !== "jerseys" && (
            <div className="text-xs text-stone-600">
              Complète les trois places avec des coureurs différents.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { COEFF, TYPE_LABEL, FLAG };
