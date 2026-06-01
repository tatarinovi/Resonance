import { useEffect, useRef } from "react";

const CELL = 48;
const REACH = 144;
const FPS = 30;
const FRAME_MS = 1000 / FPS;
const LERP = 0.28;

const isMobile = () =>
  window.matchMedia("(pointer: coarse)").matches ||
  !window.matchMedia("(pointer: fine)").matches;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function GridHighlight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  const rendered = useRef({ x: -9999, y: -9999 });
  const rafId = useRef<number>(0);
  const scrollY = useRef(0);
  const lastFrame = useRef(0);

  useEffect(() => {
    if (isMobile() || prefersReducedMotion()) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    const onScroll = () => {
      scrollY.current = window.scrollY;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", onScroll, { passive: true });

    const draw = (now: number) => {
      rafId.current = requestAnimationFrame(draw);

      if (now - lastFrame.current < FRAME_MS) return;
      lastFrame.current = now;

      rendered.current.x += (mouse.current.x - rendered.current.x) * LERP;
      rendered.current.y += (mouse.current.y - rendered.current.y) * LERP;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.filter = "blur(1.2px)";

      const mx = rendered.current.x;
      const my = rendered.current.y;
      const segLen = REACH * 1.2;

      const drawLine = (
        x1: number, y1: number,
        x2: number, y2: number,
        perpDist: number
      ) => {
        const alpha = Math.max(0, 1 - perpDist / REACH);
        if (alpha < 0.01) return;

        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const isVertical = x1 === x2;

        const grad = isVertical
          ? ctx.createLinearGradient(cx, cy - segLen / 2, cx, cy + segLen / 2)
          : ctx.createLinearGradient(cx - segLen / 2, cy, cx + segLen / 2, cy);

        const peak = `hsla(187, 58%, 68%, ${alpha * 0.20})`;
        grad.addColorStop(0, "hsla(187, 58%, 68%, 0)");
        grad.addColorStop(0.5, peak);
        grad.addColorStop(1, "hsla(187, 58%, 68%, 0)");

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.stroke();
      };

      const offsetY = scrollY.current % CELL;

      const firstCol = Math.floor((mx - REACH) / CELL) * CELL;
      const lastCol = Math.ceil((mx + REACH) / CELL) * CELL;
      for (let x = firstCol; x <= lastCol; x += CELL) {
        drawLine(x, my - segLen / 2, x, my + segLen / 2, Math.abs(x - mx));
      }

      const firstRow = Math.floor((my + offsetY - REACH) / CELL) * CELL - offsetY;
      const lastRow = Math.ceil((my + offsetY + REACH) / CELL) * CELL - offsetY;
      for (let y = firstRow; y <= lastRow; y += CELL) {
        drawLine(mx - segLen / 2, y, mx + segLen / 2, y, Math.abs(y - my));
      }

      ctx.filter = "none";
    };

    rafId.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
    />
  );
}
