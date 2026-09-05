"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/Button";
import DrawBoard from "@/components/DrawBoard";
import DrawingView from "@/components/DrawingView";
import PaperCard from "@/components/PaperCard";
import PlayerList from "@/components/PlayerList";
import Timer, { useCountdown } from "@/components/Timer";
import { ApiClientError, api, clearToken, errorMessage, getToken, setToken } from "@/lib/client";
import { serializeDrawing } from "@/lib/drawing";
import type { Drawing } from "@/lib/drawing";
import { DRAW_EXTRA_MS, EMPTY, LIMITS, MAX_NAME_LEN, PROMPTS, SLOTS, composeSentence, slotKind } from "@/lib/prompts";
import type { JoinResponse, PlayerPublic, PlayerView, RoomSettings } from "@/lib/types";

const POLL_MS = 2000;
const ENDED_POLL_MS = 5000; // a fine partita la vista è grande (disegni) e cambia solo al restart
const AUTOSEND_S = 3; // drawing: invio automatico a pochi secondi dalla fine, per non perdere il disegno

export default function Room({ code }: { code: string }) {
  const [token, setTok] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // localStorage letto (solo client)
  const [view, setView] = useState<PlayerView | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const phaseRef = useRef<PlayerView["phase"] | null>(null);
  phaseRef.current = view?.phase ?? null;

  useEffect(() => {
    setTok(getToken(code));
    setReady(true);
  }, [code]);

  const onJoined = (res: JoinResponse) => {
    setToken(code, res.token);
    setTok(res.token);
    setFatal(null);
  };

  const dropToken = useCallback(() => {
    clearToken(code);
    setTok(null);
    setView(null);
  }, [code]);

  // Polling dello stato: sospeso quando il tab è nascosto, ripreso al ritorno.
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastPoll = 0;
    const controllers = new Set<AbortController>();

    const poll = async () => {
      const ac = new AbortController();
      controllers.add(ac);
      lastPoll = Date.now();
      try {
        const next = await api<PlayerView>(`/api/room/${code}/state`, { token, signal: ac.signal });
        if (stopped) return;
        setView(next);
        setOffline(false);
      } catch (err) {
        if (stopped || ac.signal.aborted) return;
        if (err instanceof ApiClientError && err.code === "NOT_A_PLAYER") {
          dropToken();
        } else if (err instanceof ApiClientError && err.code === "ROOM_NOT_FOUND") {
          setFatal("Stanza scaduta o inesistente");
        } else {
          setOffline(true); // rete instabile: teniamo l'ultima vista
        }
      } finally {
        controllers.delete(ac);
      }
    };
    const tick = () => {
      if (phaseRef.current === "ended" && Date.now() - lastPoll < ENDED_POLL_MS) return;
      void poll();
    };

    const start = () => {
      if (timer) return;
      void poll();
      timer = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      controllers.forEach((c) => c.abort());
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [code, token, dropToken]);

  if (!ready) return null;

  if (fatal) {
    return (
      <main className="screen">
        <h1 className="title">{fatal}</h1>
        <Link className="btn btn-primary" href="/">
          Torna alla home
        </Link>
      </main>
    );
  }

  if (!token) return <JoinForm code={code} onJoined={onJoined} />;

  if (!view) {
    return (
      <main className="screen">
        <p className="muted" aria-live="polite">
          Carico la stanza {code}…
        </p>
      </main>
    );
  }

  return (
    <main className="screen">
      {offline && (
        <p className="banner" role="status">
          Connessione instabile…
        </p>
      )}
      <Phase view={view} token={token} onView={setView} />
    </main>
  );
}

// ---------- join ----------

function JoinForm({ code, onJoined }: { code: string; onJoined: (r: JoinResponse) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      onJoined(await api<JoinResponse>(`/api/room/${code}/join`, { method: "POST", body: { name: name.trim() } }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <h1 className="title">Stanza {code}</h1>
      <p className="lead">Scrivi il tuo nome per entrare.</p>
      <div className="field">
        <label htmlFor="join-name">Il tuo nome</label>
        <input
          id="join-name"
          type="text"
          value={name}
          maxLength={MAX_NAME_LEN}
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
        />
      </div>
      <div className="actions">
        <Button block loading={busy} disabled={!name.trim()} onClick={submit}>
          Entra
        </Button>
      </div>
      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>
    </main>
  );
}

// ---------- dispatcher di fase ----------

interface PhaseProps {
  view: PlayerView;
  token: string;
  onView: (v: PlayerView) => void;
}

function Phase(props: PhaseProps) {
  switch (props.view.phase) {
    case "lobby":
      return <Lobby {...props} />;
    case "round":
      return <Round {...props} />;
    case "reveal":
      return <Reveal {...props} />;
    case "ended":
      return <Ended {...props} />;
  }
}

/** Esegue una POST e adotta subito la PlayerView restituita. */
function useAction({ view, token, onView }: PhaseProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (path: string, body?: unknown, okCodes: string[] = []) => {
    setError(null);
    setBusy(true);
    try {
      onView(await api<PlayerView>(`/api/room/${view.code}${path}`, { method: "POST", body, token }));
      return true;
    } catch (err) {
      if (err instanceof ApiClientError && okCodes.includes(err.code)) return true;
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, run };
}

function modeLabel(s: RoomSettings): string {
  return s.mode === "drawing" ? `Disegno · ${s.rounds} turni` : "Classica · 8 domande";
}

// ---------- lobby ----------

function Lobby(props: PhaseProps) {
  const { view } = props;
  const { busy, error, run } = useAction(props);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${view.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const min = view.settings.minPlayers;
  const few = view.players.length < min;

  return (
    <>
      <p className="eyebrow">Codice stanza</p>
      <p className="room-code">{view.code}</p>

      <div className="actions">
        <Button variant="ghost" block onClick={copy}>
          {copied ? "Copiato!" : "Copia link"}
        </Button>
      </div>

      <hr className="rule" />

      <h2>
        Giocatori ({view.players.length}/{view.settings.maxPlayers})
      </h2>
      <PaperCard>
        <PlayerList players={view.players} meId={view.me.id} />
      </PaperCard>

      <div className="actions">
        {view.me.isHost ? (
          <Button block loading={busy} disabled={few} onClick={() => run("/start")}>
            Inizia
          </Button>
        ) : (
          <p className="muted" aria-live="polite">
            In attesa che l&apos;host inizi…
          </p>
        )}
      </div>
      {view.me.isHost && few && <p className="muted">Servono almeno {min} giocatori.</p>}
      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>

      {view.me.isHost ? (
        <Settings {...props} />
      ) : (
        <>
          <hr className="rule" />
          <h2>Impostazioni</h2>
          <SettingsSummary settings={view.settings} />
        </>
      )}
    </>
  );
}

// ---------- impostazioni (host) ----------

const ROUND_OPTIONS = Array.from({ length: LIMITS.rounds.max - LIMITS.rounds.min + 1 }, (_, i) => LIMITS.rounds.min + i);

function SettingsSummary({ settings }: { settings: RoomSettings }) {
  const drawing = settings.mode === "drawing";
  return (
    <ul className="settings-summary">
      <li>Modalità: {modeLabel(settings)}</li>
      <li>
        Giocatori: da {settings.minPlayers} a {settings.maxPlayers}
      </li>
      <li>
        Tempo per round: {Math.round(settings.roundMs / 1000)}s
        {drawing && ` (disegno: ${Math.round((settings.roundMs + DRAW_EXTRA_MS) / 1000)}s)`}
      </li>
      <li>Caratteri per risposta: {settings.maxAnswerLen}</li>
    </ul>
  );
}

function Settings(props: PhaseProps) {
  const { view } = props;
  const { busy, error, run } = useAction(props);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoomSettings>(view.settings);

  // Le impostazioni salvate (anche da un altro tab dell'host) riallineano il form.
  const saved = view.settings;
  const savedKey = (Object.keys(saved) as (keyof RoomSettings)[]).map((k) => saved[k]).join("|");
  useEffect(() => setDraft(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = (Object.keys(saved) as (keyof RoomSettings)[]).some((k) => draft[k] !== saved[k]);
  const set = (patch: Partial<RoomSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const num = (v: string, fallback: number) => (v === "" ? fallback : Number(v));

  const players = Array.from(
    { length: LIMITS.players.max - LIMITS.players.min + 1 },
    (_, i) => LIMITS.players.min + i,
  );

  return (
    <>
      <hr className="rule" />
      <div className="row row-head">
        <h2>Impostazioni</h2>
        <Button variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Chiudi" : "Modifica"}
        </Button>
      </div>

      {!open ? (
        <SettingsSummary settings={saved} />
      ) : (
        <>
          <fieldset className="choice">
            <legend>Modalità</legend>
            <div className="seg" role="radiogroup" aria-label="Modalità">
              <button
                type="button"
                role="radio"
                aria-checked={draft.mode === "classic"}
                onClick={() => set({ mode: "classic", rounds: SLOTS })}
              >
                <strong>Classica</strong>
                <span>8 domande, una storia</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={draft.mode === "drawing"}
                onClick={() => set({ mode: "drawing", rounds: saved.mode === "drawing" ? saved.rounds : 6 })}
              >
                <strong>Disegno</strong>
                <span>descrivi → disegna → descrivi…</span>
              </button>
            </div>
            {draft.mode === "drawing" && (
              <div className="rounds-row">
                <span id="set-rounds-label" className="field-label">
                  Turni
                </span>
                <div className="seg seg-compact" role="radiogroup" aria-labelledby="set-rounds-label">
                  {ROUND_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={draft.rounds === n}
                      onClick={() => set({ rounds: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </fieldset>

          <div className="field-row">
            <div className="field">
              <label htmlFor="set-min">Giocatori minimi</label>
              <select
                id="set-min"
                value={draft.minPlayers}
                onChange={(e) => set({ minPlayers: Number(e.target.value) })}
              >
                {players.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="set-max">Giocatori massimi</label>
              <select
                id="set-max"
                value={draft.maxPlayers}
                onChange={(e) => set({ maxPlayers: Number(e.target.value) })}
              >
                {players.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="set-time">
              Tempo per round: {Math.round(draft.roundMs / 1000)}s
            </label>
            <input
              id="set-time"
              type="range"
              min={LIMITS.roundMs.min / 1000}
              max={LIMITS.roundMs.max / 1000}
              step={LIMITS.roundMs.step / 1000}
              value={Math.round(draft.roundMs / 1000)}
              onChange={(e) => set({ roundMs: Number(e.target.value) * 1000 })}
            />
            <p className="muted">
              Passato il tempo si va al turno successivo anche senza tutte le risposte.
              {draft.mode === "drawing" && ` I turni di disegno hanno ${DRAW_EXTRA_MS / 1000}s in più.`}
            </p>
          </div>

          <div className="field">
            <label htmlFor="set-len">Caratteri per risposta</label>
            <input
              id="set-len"
              type="number"
              inputMode="numeric"
              min={LIMITS.answerLen.min}
              max={LIMITS.answerLen.max}
              step={LIMITS.answerLen.step}
              value={draft.maxAnswerLen}
              onChange={(e) => set({ maxAnswerLen: num(e.target.value, saved.maxAnswerLen) })}
            />
            <p className="muted">
              Da {LIMITS.answerLen.min} a {LIMITS.answerLen.max}.
            </p>
          </div>

          <div className="row row-nav">
            <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(saved)}>
              Annulla
            </Button>
            <Button
              loading={busy}
              disabled={!dirty}
              onClick={async () => {
                if (await run("/settings", draft)) setOpen(false);
              }}
            >
              Salva
            </Button>
          </div>
          <p className="error" role="alert" aria-live="polite">
            {error}
          </p>
        </>
      )}
    </>
  );
}

// ---------- round ----------

const OK_LATE = ["ALREADY_ANSWERED", "ROUND_OVER"]; // il prossimo polling porta la vista giusta

function Round(props: PhaseProps) {
  const { view } = props;
  const { busy, error, run } = useAction(props);
  const [text, setText] = useState("");
  const [drawing, setDrawing] = useState<Drawing>([]);
  const autoSent = useRef(false);
  const left = useCountdown(view.roundEndsAt, view.serverNow);
  const isDrawing = view.kind === "drawing";
  const maxLen = view.settings.maxAnswerLen;

  // nuovo round (o nuova partita) = foglio pulito
  useEffect(() => {
    setText("");
    setDrawing([]);
    autoSent.current = false;
  }, [view.round, view.game]);

  const send = () => {
    if (isDrawing) {
      if (drawing.length === 0) return;
      void run("/answer", { text: serializeDrawing(drawing), round: view.round }, OK_LATE);
    } else {
      if (!text.trim()) return;
      void run("/answer", { text: text.trim(), round: view.round }, OK_LATE);
    }
  };

  // Disegno: a pochi secondi dalla fine si invia quello che c'è.
  useEffect(() => {
    if (!isDrawing || view.me.answered || busy || autoSent.current) return;
    if (left > 0 && left <= AUTOSEND_S && drawing.length > 0) {
      autoSent.current = true;
      send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const header = (
    <div className="round-head">
      <p className="eyebrow">
        Round {view.round + 1} di {view.slots}
      </p>
      <Timer roundEndsAt={view.roundEndsAt} serverNow={view.serverNow} />
    </div>
  );

  if (view.me.answered) {
    return (
      <>
        {header}
        <h1 className="title">{isDrawing ? "Disegno inviato" : "Risposta inviata"}</h1>
        <p className="lead" aria-live="polite">
          {view.answeredCount}/{view.total} hanno risposto. Si aspettano gli altri.
        </p>
        <PaperCard>
          <PlayerList players={view.players} meId={view.me.id} showAnswered />
        </PaperCard>
      </>
    );
  }

  return (
    <>
      {header}
      <h1 className="prompt">{view.prompt ?? PROMPTS[view.round]}</h1>

      {view.mode === "drawing" && view.round > 0 && <Previous view={view} />}

      {isDrawing ? (
        <DrawBoard value={drawing} onChange={setDrawing} disabled={busy} />
      ) : (
        <div className="field">
          <label className="sr-only" htmlFor="answer">
            La tua risposta
          </label>
          <textarea
            id="answer"
            value={text}
            maxLength={maxLen}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && send()}
          />
          <p className="counter" data-warn={text.length > maxLen - 20} aria-live="polite">
            {text.length}/{maxLen}
          </p>
        </div>
      )}

      <div className="actions">
        <Button block loading={busy} disabled={isDrawing ? drawing.length === 0 : !text.trim()} onClick={send}>
          Invia
        </Button>
      </div>
      <p className="muted">
        {view.answeredCount}/{view.total} hanno risposto.
      </p>
      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>
    </>
  );
}

/** Drawing: il passaggio precedente del foglietto in mano (testo da disegnare o disegno da descrivere). */
function Previous({ view }: { view: PlayerView }) {
  const prevKind = slotKind(view.mode, view.round - 1);
  if (view.previous === null) {
    return (
      <PaperCard flat>
        <p className="muted">Il passaggio precedente è andato perso (tempo scaduto): improvvisa!</p>
      </PaperCard>
    );
  }
  if (prevKind === "text") {
    return (
      <PaperCard flat>
        <p className="quote">«{view.previous}»</p>
      </PaperCard>
    );
  }
  return <DrawingView data={view.previous} label="Disegno da descrivere" />;
}

// ---------- reveal ----------

function Sheet({ parts, flat, unfoldKey }: { parts: string[]; flat?: boolean; unfoldKey?: number }) {
  return (
    <PaperCard flat={flat} unfoldKey={unfoldKey}>
      <p className="sentence">{composeSentence(parts)}</p>
      {!flat && (
        <dl className="pieces">
          {PROMPTS.map((label, i) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{parts[i]?.trim() || "…"}</dd>
            </div>
          ))}
        </dl>
      )}
    </PaperCard>
  );
}

/** Autore del passaggio `step` del foglietto `sheet`: inverso di sheetFor. */
function authorOf(players: PlayerPublic[], sheet: number, step: number): string {
  return players[(sheet + step) % players.length]?.name ?? "?";
}

/** Drawing: la catena descrizione → disegno → … di un foglietto, con gli autori. */
function Chain({ parts, sheet, view }: { parts: string[]; sheet: number; view: PlayerView }) {
  const last = parts.length - 1;
  return (
    <ol className="chain">
      {parts.map((v, step) => {
        const kind = slotKind(view.mode, step);
        const who = authorOf(view.players, sheet, step);
        return (
          <li key={step} className={step === last ? "chain-step paper-unfold" : "chain-step"}>
            <p className="eyebrow">
              {step + 1}. {who} {kind === "drawing" ? "ha disegnato" : "ha scritto"}
            </p>
            {kind === "drawing" ? (
              <DrawingView data={v} label={`Disegno di ${who}`} />
            ) : (
              <p className="quote">{v === EMPTY ? EMPTY : `«${v}»`}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Reveal(props: PhaseProps) {
  const { view } = props;
  const { busy, error, run } = useAction(props);
  const reveal = view.reveal;
  if (!reveal) return null;

  const drawing = view.mode === "drawing";
  const current = reveal.sheets[reveal.index];
  const previous = reveal.sheets.slice(0, reveal.index);
  const lastSheet = reveal.index >= reveal.total - 1;
  const lastStep = !drawing || reveal.step >= view.slots - 1;
  const last = lastSheet && lastStep;

  return (
    <>
      <p className="eyebrow">
        Foglietto {reveal.index + 1} di {reveal.total}
        {drawing && ` · passaggio ${reveal.step + 1} di ${view.slots}`}
      </p>
      {current &&
        (drawing ? (
          <Chain parts={current} sheet={reveal.index} view={view} />
        ) : (
          <Sheet parts={current} unfoldKey={reveal.index} />
        ))}

      <div className="actions">
        {view.me.isHost ? (
          <Button block loading={busy} onClick={() => run("/advance")}>
            {last ? "Fine" : lastStep ? "Prossimo foglietto" : "Prossimo"}
          </Button>
        ) : (
          <p className="muted" aria-live="polite">
            L&apos;host sta {drawing ? "svelando" : "leggendo"}…
          </p>
        )}
      </div>
      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>

      {previous.length > 0 && (
        <>
          <hr className="rule" />
          <h2>Già {drawing ? "svelati" : "letti"}</h2>
          <ul className="sheet-list">
            {previous.map((parts, i) => (
              <li key={i}>
                <p className="sentence">{drawing ? `${i + 1}. «${parts[0]}»` : composeSentence(parts)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ---------- ended ----------

function exportJson(view: PlayerView, sheets: string[][]) {
  const base = { stanza: view.code, partita: view.game, esportatoIl: new Date().toISOString() };
  const data =
    view.mode === "drawing"
      ? {
          ...base,
          modalita: "disegno",
          turni: view.slots,
          catene: sheets.map((parts, sheet) => ({
            passaggi: parts.map((contenuto, step) => ({
              autore: authorOf(view.players, sheet, step),
              tipo: slotKind(view.mode, step) === "drawing" ? "disegno" : "testo",
              contenuto,
            })),
          })),
        }
      : {
          ...base,
          modalita: "classica",
          domande: PROMPTS,
          sigarette: sheets.map((parts) => ({
            frase: composeSentence(parts),
            risposte: Object.fromEntries(PROMPTS.map((label, i) => [label, parts[i]])),
          })),
        };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `sigaretta-${view.code}-partita${view.game}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function Ended(props: PhaseProps) {
  const { view } = props;
  const { busy, error, run } = useAction(props);
  const sheets = view.reveal?.sheets ?? [];
  const [index, setIndex] = useState(0); // ognuno scorre per conto suo
  const current = sheets[index];

  return (
    <>
      <h1 className="title">{view.mode === "drawing" ? "Le catene" : "Le storie"}</h1>
      <p className="eyebrow" aria-live="polite">
        Foglietto {index + 1} di {sheets.length}
      </p>
      {current &&
        (view.mode === "drawing" ? (
          <Chain key={index} parts={current} sheet={index} view={view} />
        ) : (
          <Sheet parts={current} unfoldKey={index} />
        ))}

      <div className="row row-nav">
        <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          ← Precedente
        </Button>
        <Button variant="ghost" disabled={index >= sheets.length - 1} onClick={() => setIndex(index + 1)}>
          Successiva →
        </Button>
      </div>

      <div className="actions">
        <Button variant="ghost" block onClick={() => exportJson(view, sheets)}>
          Esporta in JSON
        </Button>
        {view.me.isHost ? (
          <Button block loading={busy} onClick={() => run("/restart")}>
            Nuova partita
          </Button>
        ) : (
          <p className="muted" aria-live="polite">
            L&apos;host può avviare una nuova partita.
          </p>
        )}
      </div>
      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>
    </>
  );
}
