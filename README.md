# La Sigaretta — gioco dei bigliettini online

La Sigaretta è la versione online del classico gioco dei bigliettini a rotazione: 8 prompt fissi (Chi · Chi · Dove · Cosa fanno · Cosa dice 1 · Cosa dice 2 · Chi arriva · Cosa dice) da compilare in cieco, uno per round.
Da 2 a 10 giocatori scrivono a turno sui foglietti, che ruotano tra i partecipanti a ogni round da 60 secondi.
Alla fine l'host guida il reveal delle frasi complete, foglietto per foglietto.

## Deploy in 5 passi

1. Fork del repo
2. Import su Vercel
3. Crea un database Redis su Upstash (console.upstash.com, piano free)
4. Aggiungi le env `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` nel progetto Vercel
5. Deploy

## Sviluppo locale

```
npm install
cp .env.example .env.local
npm run dev
```

Senza le env Upstash configurate, l'app usa uno store in memoria valido solo in locale (non funziona su Vercel serverless).

## Script

- `npm run dev` — avvia il server di sviluppo
- `npm run build` — build di produzione
- `npm start` — avvia il server buildato
- `npm test` — esegue i test vitest
- `npm run typecheck` — controllo TypeScript senza emissione

## Come funziona

- Lo stato di ogni stanza è una singola chiave Redis con TTL di 24 ore.
- Il client aggiorna la vista con il polling ogni 2 secondi, senza WebSocket.
- Le regole del gioco vivono in un reducer puro in `lib/game.ts`, coperto da test vitest.
- La cecità sui bigliettini è garantita lato server: il client non riceve mai risposte non ancora rivelate.
- Se l'host resta silente per 30 secondi, il ruolo passa automaticamente a un altro giocatore connesso.
- Il token del giocatore è salvato in localStorage per permettere di rientrare nella stanza.
