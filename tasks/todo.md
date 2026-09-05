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
