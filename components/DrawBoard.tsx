"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/Button";
import {
  DRAW_COLORS,
  DRAW_SIZE,
  DRAW_WIDTHS,
  MAX_DRAWING_LEN,
  MAX_STROKES,
  serializeDrawing,
} from "@/lib/drawing";
import type { Drawing, Stroke } from "@/lib/drawing";

const PAPER = "#fffdf6";
const ERASER = DRAW_COLORS.length - 1;
const MIN_STEP = 2; // unità logiche: punti più vicini vengono scartati

const COLOR_NAMES = ["Nero", "Rosso", "Arancione", "Giallo", "Verde", "Blu", "Viola", "Marrone", "Rosa", "Gomma"];
const WIDTH_NAMES = ["Sottile", "Medio", "Grosso"];

interface Props {
  value: Drawing;
  onChange: (next: Drawing) => void;
  disabled?: boolean;
}

function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number) {
  const color = DRAW_COLORS[s.c];
  const width = DRAW_WIDTHS[s.w] * scale;
  if (s.p.length === 2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(s.p[0] * scale, s.p[1] * scale, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s.p[0] * scale, s.p[1] * scale);
  for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i] * scale, s.p[i + 1] * scale);
  ctx.stroke();
}

/** Board "tipo Paint": tratti a mano libera con colori e spessori, gomma, annulla, pulisci. */
export default function DrawBoard({ value, onChange, disabled = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(1); // pixel canvas per unità logica
  const current = useRef<Stroke | null>(null); // tratto in corso (non ancora in `value`)
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const [full, setFull] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of value) paintStroke(ctx, s, scaleRef.current);
    if (current.current) paintStroke(ctx, current.current, scaleRef.current);
  }, [value]);

  // Il canvas segue la larghezza del contenitore, a risoluzione nativa del dispositivo.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const css = canvas.clientWidth;
      if (!css) return;
      const px = Math.round(css * (window.devicePixelRatio || 1));
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      scaleRef.current = px / DRAW_SIZE;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(redraw, [redraw]);

  const toLogical = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * DRAW_SIZE);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * DRAW_SIZE);
    return [Math.min(DRAW_SIZE, Math.max(0, x)), Math.min(DRAW_SIZE, Math.max(0, y))];
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || current.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toLogical(e);
    current.current = { c: color, w: width, p: [x, y] };
    redraw();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = current.current;
    if (!s) return;
    const [x, y] = toLogical(e);
    const n = s.p.length;
    if (Math.abs(x - s.p[n - 2]) < MIN_STEP && Math.abs(y - s.p[n - 1]) < MIN_STEP) return;
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) {
      // disegno incrementale: solo l'ultimo segmento
      const k = scaleRef.current;
      ctx.strokeStyle = DRAW_COLORS[s.c];
      ctx.lineWidth = DRAW_WIDTHS[s.w] * k;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(s.p[n - 2] * k, s.p[n - 1] * k);
      ctx.lineTo(x * k, y * k);
      ctx.stroke();
    }
    s.p.push(x, y);
  };

  const up = () => {
    const s = current.current;
    if (!s) return;
    current.current = null;
    const next = [...value, s];
    // Il disegno viaggia in una singola chiave Redis: oltre il budget il tratto viene scartato.
    if (next.length > MAX_STROKES || serializeDrawing(next).length > MAX_DRAWING_LEN) {
      setFull(true);
      redraw();
      return;
    }
    setFull(false);
    onChange(next);
  };

  return (
    <div className="board-wrap">
      <canvas
        ref={canvasRef}
        className="board"
        aria-label="Area di disegno"
        data-disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
      />

      <div className="palette" role="radiogroup" aria-label="Colore">
        {DRAW_COLORS.map((hex, i) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={color === i}
            aria-label={COLOR_NAMES[i]}
            className={`swatch${i === ERASER ? " swatch-eraser" : ""}`}
            style={{ background: hex }}
            disabled={disabled}
            onClick={() => setColor(i)}
          />
        ))}
      </div>

      <div className="tools">
        <div className="widths" role="radiogroup" aria-label="Spessore">
          {DRAW_WIDTHS.map((w, i) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={width === i}
              aria-label={WIDTH_NAMES[i]}
              className="width-btn"
              disabled={disabled}
              onClick={() => setWidth(i)}
            >
              <span style={{ width: w + 4, height: w + 4 }} />
            </button>
          ))}
        </div>
        <Button variant="ghost" disabled={disabled || value.length === 0} onClick={() => onChange(value.slice(0, -1))}>
          Annulla
        </Button>
        <Button variant="ghost" disabled={disabled || value.length === 0} onClick={() => onChange([])}>
          Pulisci
        </Button>
      </div>
      <p className="error" role="alert" aria-live="polite">
        {full ? "Disegno troppo complesso: annulla qualche tratto." : ""}
      </p>
    </div>
  );
}
