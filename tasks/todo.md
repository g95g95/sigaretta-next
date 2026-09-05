# Nome della stanza (distinto dal nome del giocatore)

## Problema
Una stanza ha solo il codice a 4 lettere; la home ha un unico campo "Il tuo nome",
quindi la stanza non ha identità propria e viene percepita come intitolata all'host.

## Soluzione
Aggiungere `roomName` alle impostazioni di stanza: scelto alla creazione, opzionale,
modificabile dall'host in lobby come le altre impostazioni.

## Task
1. `lib/types.ts` — `RoomSettings.roomName: string` (stringa vuota = senza nome).
2. `lib/prompts.ts` — `MAX_ROOM_NAME_LEN = 30`, default `roomName: ""`.
3. `lib/game.ts` — `applySettings`: trim + validazione lunghezza (`INVALID_SETTINGS`).
4. `app/api/room/route.ts` — accetta `roomName` nel body di creazione.
5. `app/api/room/[code]/settings/route.ts` — `roomName` tra le KEYS.
6. `app/page.tsx` — campo "Nome della stanza (facoltativo)" separato da "Il tuo nome".
7. `components/Room.tsx` — titolo/eyebrow con il nome, riepilogo e form impostazioni host.
8. `lib/game.test.ts` — test su default, trim, troppo lungo, patch dell'host.
9. `CLAUDE.md` + `README.md` — aggiornare la descrizione delle impostazioni.
10. `npm test` + `npm run build` verdi.

## Note
- Nessun campo nuovo in `RoomState` fuori da `settings`: `settingsOf` copre le stanze vecchie.
- Il nome non e' unico ne' usato per il routing: si entra sempre col codice.

---

# PWA installabile su cellulare (2026-09-06)

Stato: piano da approvare prima delle modifiche al codice.

## Obiettivo
Installare La Sigaretta sulla schermata Home del telefono, con icona dedicata
 e apertura standalone. Le partite multiplayer richiedono rete.

## Piano
1. Aggiungere app/manifest.ts con identita stabile, nome, avvio dalla home,
   scope, colori e display standalone; icone PNG 192/512, maskable e Apple touch.
2. Aggiornare i metadata in app/layout.tsx per l'esperienza mobile installata.
3. Aggiungere nella home un controllo di installazione quando supportato e
   istruzioni per iOS; nasconderlo quando l'app e' aperta in standalone.
4. Registrare un service worker minimale con pagina offline e pulsante per
   riprovare. Non mettere in cache API, token, risposte o pagine delle stanze;
   non accodare risposte offline. Configurare gli header del worker.
5. Aggiornare README.md e creare AGENTS.md con le istruzioni dell'utente e
   le convenzioni PWA; mantenere coerente CLAUDE.md.
6. Eseguire regressioni npm test, controllo tipi e build di produzione.
   Verificare manifest, icone, service worker, fallback offline e layout mobile
   sulla build avviata; distinguere questi controlli dall'installazione su un
   telefono fisico, da verificare sul sito HTTPS.

## Ambito
- Funzionalita native di Next.js e browser, senza nuovi servizi.
- Nessuna modifica alle regole del gioco o alla funzionalita foto.
- La pubblicazione su GitHub/Vercel non e' inclusa in questo piano.
- Riferimento: https://nextjs.org/docs/app/guides/progressive-web-apps

## Esito PWA (2026-09-06)
- Piano approvato dall'utente; implementazione locale completata.
- Manifest, metadata Apple, icone generate, installazione home e fallback offline aggiunti.
- 56/56 test verdi (49 gioco, 7 isolamento/cache PWA); test eseguiti fuori sandbox
  per un errore di accesso di esbuild alle directory superiori.
- Build di produzione e controllo TypeScript verdi; git diff --check pulito.
- HTTP sulla build: manifest, worker, pagina offline e quattro icone tutti 200;
  tipi MIME e header no-store del worker verificati.
- Chrome: pulsante installazione disponibile, nessun errore console osservato.
  Invocazione del prompt eseguita; installazione nativa non completata nel test.
- Home verificata visivamente a 390 CSS px; controlli overflow a 390 e 320 px
  senza eccedenze; selezione modalita Disegno funzionante.
- Server locale fermato: reload mostra il fallback offline; server riavviato:
  Riprova riapre la home. Questo verifica il worker realmente nel browser.
- Da verificare dopo pubblicazione: installazione su telefoni Android/iPhone reali.
- Nessun push o deploy eseguito.
