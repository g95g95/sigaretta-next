"use client";

import { useEffect, useState } from "react";
import Button from "./Button";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const sync = () => setInstalled(media.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    sync();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
      setError(false);
    };
    const complete = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
      media.removeEventListener("change", sync);
    };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setError(false);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setError(true);
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  if (installed) return null;
  return (
    <aside className="install-app" aria-label="Installa l’app">
      <img src="/icons/icon-192.png" alt="" width={48} height={48} />
      <div>
        <strong>La Sigaretta, sempre a portata di mano</strong>
        <p className="muted">Aggiungila alla schermata Home. Per giocare serve una connessione.</p>
        {prompt ? <Button variant="ghost" loading={busy} onClick={install}>Installa l’app</Button> : (
          <details>
            <summary>Come installarla</summary>
            <p className="muted">{ios
              ? "Apri questa pagina in Safari, usa Condividi e scegli Aggiungi alla schermata Home. Se compare Apri come app web, lascialo attivo."
              : "Nel menu del browser cerca Installa app o Aggiungi alla schermata Home. La disponibilità e il nome della voce dipendono dal browser."}</p>
          </details>
        )}
        {error && <p role="status">Installazione non riuscita. Puoi riprovare dal menu del browser.</p>}
      </div>
    </aside>
  );
}
