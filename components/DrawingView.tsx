import { useMemo } from "react";
import { DRAW_COLORS, DRAW_SIZE, DRAW_WIDTHS, parseDrawing } from "@/lib/drawing";

/** Rende un disegno serializzato come SVG inline (scala con il contenitore). */
export default function DrawingView({ data, label = "Disegno" }: { data: string; label?: string }) {
  const strokes = useMemo(() => parseDrawing(data), [data]);

  if (!strokes) {
    return (
      <div className="drawing drawing-missing" role="img" aria-label="Disegno mancante">
        <span className="hand">…</span>
      </div>
    );
  }

  return (
    <svg className="drawing" viewBox={`0 0 ${DRAW_SIZE} ${DRAW_SIZE}`} role="img" aria-label={label}>
      <rect width={DRAW_SIZE} height={DRAW_SIZE} fill="#fffdf6" />
      {strokes.map((s, i) => {
        const color = DRAW_COLORS[s.c];
        const width = DRAW_WIDTHS[s.w];
        if (s.p.length === 2) {
          return <circle key={i} cx={s.p[0]} cy={s.p[1]} r={width / 2} fill={color} />;
        }
        return (
          <polyline
            key={i}
            points={s.p.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
