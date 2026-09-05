"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/Button";
import InstallApp from "@/components/InstallApp";
import { api, errorMessage, getToken, setToken } from "@/lib/client";
import { DEFAULT_ROUNDS, MAX_NAME_LEN, MAX_ROOM_NAME_LEN, MAX_ROUNDS, MIN_ROUNDS } from "@/lib/prompts";
import type { GameMode, JoinResponse } from "@/lib/types";

const ROUND_OPTIONS = Array.from({ length: MAX_ROUNDS - MIN_ROUNDS + 1 }, (_, i) => MIN_ROUNDS + i);

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<GameMode>("classic");
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enter = async (kind: "create" | "join") => {
    if (busy) return;
    setError(null);
    // Già dentro questa stanza (es. dopo un refresh): rientra nel proprio posto.
    if (kind === "join" && getToken(code)) {
      router.push(`/r/${code}`);
      return;
    }
    if (!name.trim()) {
      setError("Scrivi prima il tuo nome");
      return;
    }
    setBusy(kind);
    try {
      const path = kind === "create" ? "/api/room" : `/api/room/${code}/join`;
      const body =
        kind === "create"
          ? { name: name.trim(), roomName: roomName.trim(), mode, rounds }
          : { name: name.trim() };
      const res = await api<JoinResponse>(path, { method: "POST", body });
      setToken(res.code, res.token);
      router.push(`/r/${res.code}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const nameOk = name.trim().length > 0;

  return (
    <main className="screen">
      <h1 className="title">La Sigaretta</h1>
      <p className="lead">
        Un foglietto che passa di mano in mano. Nessuno vede cosa hanno scritto (o disegnato) gli
        altri finché, alla fine, si scopre cosa ne è uscito.
      </p>

      <div className="field">
        <label htmlFor="name">Il tuo nome</label>
        <input
          id="name"
          type="text"
          value={name}
          maxLength={MAX_NAME_LEN}
          autoComplete="nickname"
          placeholder="Come ti chiamano"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="room-name">Nome della stanza (facoltativo)</label>
        <input
          id="room-name"
          type="text"
          value={roomName}
          maxLength={MAX_ROOM_NAME_LEN}
          placeholder="Es. Cena del venerdì"
          onChange={(e) => setRoomName(e.target.value)}
        />
      </div>

      <fieldset className="choice">
        <legend>Modalità</legend>
        <div className="seg" role="radiogroup" aria-label="Modalità">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "classic"}
            onClick={() => setMode("classic")}
          >
            <strong>Classica</strong>
            <span>8 domande, una storia</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "drawing"}
            onClick={() => setMode("drawing")}
          >
            <strong>Disegno</strong>
            <span>descrivi → disegna → descrivi…</span>
          </button>
        </div>
        {mode === "drawing" && (
          <div className="rounds-row">
            <span id="rounds-label" className="field-label">
              Turni
            </span>
            <div className="seg seg-compact" role="radiogroup" aria-labelledby="rounds-label">
              {ROUND_OPTIONS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rounds === n} onClick={() => setRounds(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <div className="actions">
        <Button block loading={busy === "create"} disabled={!nameOk} onClick={() => enter("create")}>
          Crea una stanza
        </Button>
      </div>

      <hr className="rule" />

      <h2>Entra con un codice</h2>
      <div className="row">
        <div className="field">
          <label htmlFor="code">Codice stanza</label>
          <input
            id="code"
            type="text"
            className="code-input"
            value={code}
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="ABCD"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
          />
        </div>
        <Button
          variant="ghost"
          loading={busy === "join"}
          disabled={code.length !== 4}
          onClick={() => enter("join")}
        >
          Entra
        </Button>
      </div>

      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>
      <InstallApp />
    </main>
  );
}
