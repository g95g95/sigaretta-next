"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, sendChat } from "@/lib/client";
import { MAX_CHAT_LEN } from "@/lib/prompts";
import type { PlayerView } from "@/lib/types";

// Leggibili su bianco; ogni giocatore ha sempre lo stesso colore (derivato dal suo id).
const COLORS = ["#c5221f", "#1967d2", "#137333", "#8430ce", "#b06000", "#007b83", "#c2185b", "#3949ab"];

function colorOf(playerId: string): string {
  let h = 0;
  for (const c of playerId) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

interface Props {
  view: PlayerView;
  token: string;
  onView: (v: PlayerView) => void;
}

export default function Chat({ view, token, onView }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastId = view.chat.at(-1)?.id ?? 0;
  // Non letti = solo i messaggi arrivati dopo l'apertura della pagina.
  const [readId, setReadId] = useState(lastId);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!open) return;
    setReadId(lastId);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, lastId]);

  const unread = open ? 0 : view.chat.filter((m) => m.id > readId && m.playerId !== view.me.id).length;

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setError(null);
    setBusy(true);
    try {
      onView(await sendChat(view.code, token, t));
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={open ? "chat chat-open" : "chat"} aria-label="Chat della stanza">
      <button type="button" className="chat-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Chat</span>
        {unread > 0 && (
          <span className="chat-badge">
            {unread}
            <span className="sr-only"> nuovi messaggi</span>
          </span>
        )}
        <span className="chat-caret" aria-hidden="true">
          {open ? "▾" : "▴"}
        </span>
      </button>

      {open && (
        <>
          <ol className="chat-list" ref={listRef} aria-live="polite">
            {view.chat.length === 0 && <li className="chat-empty">Ancora nessun messaggio.</li>}
            {view.chat.map((m, i) => {
              const mine = m.playerId === view.me.id;
              const first = view.chat[i - 1]?.playerId !== m.playerId;
              return (
                <li key={m.id} className={mine ? "chat-msg chat-mine" : "chat-msg"}>
                  {first && (
                    <span className="chat-name" style={{ color: colorOf(m.playerId) }}>
                      {mine ? "Tu" : m.name}
                    </span>
                  )}
                  <span className="chat-text">{m.text}</span>
                </li>
              );
            })}
          </ol>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="chat-input">
              Messaggio
            </label>
            <input
              id="chat-input"
              type="text"
              value={text}
              maxLength={MAX_CHAT_LEN}
              autoComplete="off"
              placeholder="Scrivi un messaggio…"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="chat-send" disabled={busy || !text.trim()}>
              Invia
            </button>
          </form>
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
