"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  roundEndsAt: number | null;
  /** timestamp del server: serve a compensare l'orologio locale */
  serverNow: number;
}

/**
 * Secondi rimanenti alla fine del round. L'offset server−client viene fissato al primo
 * render utile: ricalcolarlo a ogni polling farebbe saltellare il countdown avanti e
 * indietro con la latenza.
 */
export function useCountdown(roundEndsAt: number | null, serverNow: number): number {
  const offset = useRef<number | null>(null);
  if (offset.current === null) offset.current = serverNow - Date.now();

  const remaining = (end: number) => Math.max(0, Math.ceil((end - (Date.now() + offset.current!)) / 1000));

  const [left, setLeft] = useState(() => (roundEndsAt === null ? 0 : remaining(roundEndsAt)));

  useEffect(() => {
    if (roundEndsAt === null) return;
    setLeft(remaining(roundEndsAt));
    const id = setInterval(() => setLeft(remaining(roundEndsAt)), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundEndsAt]);

  return left;
}

export default function Timer({ roundEndsAt, serverNow }: Props) {
  const left = useCountdown(roundEndsAt, serverNow);

  if (roundEndsAt === null) return null;

  const urgent = left <= 10;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");

  return (
    <p className="timer" data-urgent={urgent}>
      <span aria-hidden="true">
        {mm}:{ss}
      </span>
      {/* annuncio a bassa frequenza: ogni 15s, poi ogni 5s nel finale */}
      <span className="sr-only" aria-live="polite">
        {left % (urgent ? 5 : 15) === 0 ? `${left} secondi rimasti` : ""}
      </span>
    </p>
  );
}
