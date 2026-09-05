"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/Button";
import PaperCard from "@/components/PaperCard";
import PlayerList from "@/components/PlayerList";
import Timer from "@/components/Timer";
import { ApiClientError, api, clearToken, errorMessage, getToken, setToken } from "@/lib/client";
import { LIMITS, MAX_NAME_LEN, PROMPTS, SLOTS, composeSentence } from "@/lib/prompts";
import type { JoinResponse, PlayerView, RoomSettings } from "@/lib/types";

const POLL_MS = 2000;

export default function Room({ code }: { code: string }) {
  const [token, setTok] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // localStorage letto (solo client)
  const [view, setView] = useState<PlayerView | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

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
    const controllers = new Set<AbortController>();

    const poll = async () => {
      const ac = new AbortController();
      controllers.add(ac);
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

    const start = () => {
      if (timer) return;
      void poll();
      timer = setInterval(poll, POLL_MS);
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

function SettingsSummary({ settings }: { settings: RoomSettings }) {
  return (
    <ul className="settings-summary">
      <li>
        Giocatori: da {settings.minPlayers} a {settings.maxPlayers}
      </li>
      <li>Tempo per round: {Math.round(settings.roundMs / 1000)}s</li>
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
  const savedKey = `${saved.minPlayers}|${saved.maxPlayers}|${saved.roundMs}|${saved.maxAnswerLen}`;
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
              Passato il tempo si va alla domanda successiva anche senza tutte le risposte.
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

function Round(props: PhaseProps) {
  const { view } = props;
  const { busy, error, run } = useAction(props);
  const [text, setText] = useState("");
  const maxLen = view.settings.maxAnswerLen;

  // nuovo round (o nuova partita) = foglio pulito
  useEffect(() => setText(""), [view.round, view.game]);

  const send = () => {
    if (!text.trim()) return;
    void run("/answer", { text: text.trim() }, ["ALREADY_ANSWERED"]);
  };

  const header = (
    <div className="round-head">
      <p className="eyebrow">
        Round {view.round + 1} di {SLOTS}
      </p>
      <Timer roundEndsAt={view.roundEndsAt} serverNow={view.serverNow} />
    </div>
  );

  if (view.me.answered) {
    return (
      <>
        {header}
        <h1 className="title">Risposta inviata</h1>
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
      <div className="actions">
        <Button block loading={busy} disabled={!text.trim()} onClick={send}>
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

function Reveal(props: PhaseProps) {
  const { view } = props;
  const { busy, error, run } = useAction(props);
  const reveal = view.reveal;
  if (!reveal) return null;

  const current = reveal.sheets[reveal.index];
  const previous = reveal.sheets.slice(0, reveal.index);
  const last = reveal.index >= reveal.total - 1;

  return (
    <>
      <p className="eyebrow">
        Foglietto {reveal.index + 1} di {reveal.total}
      </p>
      {current && <Sheet parts={current} unfoldKey={reveal.index} />}

      <div className="actions">
        {view.me.isHost ? (
          <Button block loading={busy} onClick={() => run("/advance")}>
            {last ? "Fine" : "Prossima"}
          </Button>
        ) : (
          <p className="muted" aria-live="polite">
            L&apos;host sta leggendo…
          </p>
        )}
      </div>
      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>

      {previous.length > 0 && (
        <>
          <hr className="rule" />
          <h2>Già letti</h2>
          <ul className="sheet-list">
            {previous.map((parts, i) => (
              <li key={i}>
                <p className="sentence">{composeSentence(parts)}</p>
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
  const data = {
    stanza: view.code,
    partita: view.game,
    esportatoIl: new Date().toISOString(),
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
      <h1 className="title">Le storie</h1>
      <p className="eyebrow" aria-live="polite">
        Foglietto {index + 1} di {sheets.length}
      </p>
      {current && <Sheet parts={current} unfoldKey={index} />}

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
