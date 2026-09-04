"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/Button";
import { api, errorMessage, setToken } from "@/lib/client";
import { MAX_NAME_LEN } from "@/lib/prompts";
import type { JoinResponse } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enter = async (kind: "create" | "join") => {
    if (busy) return;
    setError(null);
    setBusy(kind);
    try {
      const path = kind === "create" ? "/api/room" : `/api/room/${code}/join`;
      const res = await api<JoinResponse>(path, { method: "POST", body: { name: name.trim() } });
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
        Otto domande, un foglietto che passa di mano in mano. Nessuno vede cosa hanno scritto gli
        altri finché, alla fine, si leggono le storie che ne sono uscite.
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
          disabled={!nameOk || code.length !== 4}
          onClick={() => enter("join")}
        >
          Entra
        </Button>
      </div>

      <p className="error" role="alert" aria-live="polite">
        {error}
      </p>
    </main>
  );
}
