import type { PlayerPublic } from "@/lib/types";

interface Props {
  players: PlayerPublic[];
  /** in "round" mostra la spunta di chi ha già risposto */
  showAnswered?: boolean;
  meId?: string;
}

export default function PlayerList({ players, showAnswered = false, meId }: Props) {
  return (
    <ul className="players">
      {players.map((p) => (
        <li key={p.id}>
          <span
            className={`dot ${p.connected ? "dot-on" : "dot-off"}`}
            title={p.connected ? "Connesso" : "Disconnesso"}
          />
          <span className="player-name">
            {p.name}
            {p.id === meId && <span className="muted"> (tu)</span>}
          </span>
          <span className="sr-only">{p.connected ? "connesso" : "disconnesso"}</span>
          {p.isHost && <span className="badge badge-host">host</span>}
          {showAnswered && p.answered && (
            <span className="check" title="Ha risposto">
              ✓<span className="sr-only"> ha risposto</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
