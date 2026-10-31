import { useEffect, useRef } from "react";

/**
 * „Жива“ сфера за входната страница: частици с вълни, които тръгват от курсора и от клик,
 * мрежа от дъги между „хора“ с пътуващи светлини („задачи“), и орбити със спътници.
 * Чист canvas; спира в скрит раздел; при „намалено движение“ рисува един кадър.
 */
export default function ParticleHero({ backdrop = false }: { backdrop?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = innerWidth < 700;
    const N = backdrop ? (small ? 1300 : 3200) : small ? 2400 : 6500;
    const ANCH = small ? 26 : 46;

    // ---- сфера (спирала на Фибоначи)
    const base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      base[i * 3] = Math.cos(th) * r;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = Math.sin(th) * r;
    }

    // ---- „хора“: котви по сферата и дъги между близките
    const anchors: [number, number, number][] = [];
    for (let i = 0; i < ANCH; i++) {
      const k = Math.floor(((i + 0.5) / ANCH) * N);
      anchors.push([base[k * 3], base[k * 3 + 1], base[k * 3 + 2]]);
    }
    interface Arc { pts: Float32Array; phase: number; speed: number }
    const arcs: Arc[] = [];
    const SEG = 14;
    for (let a = 0; a < ANCH; a++) {
      const near = anchors
        .map((p, b) => ({ b, d: p[0] * anchors[a][0] + p[1] * anchors[a][1] + p[2] * anchors[a][2] }))
        .filter((o) => o.b > a)
        .sort((p, q) => q.d - p.d)
        .slice(0, 2);
      for (const { b, d } of near) {
        if (d < 0.35) continue;
        const A = anchors[a], B = anchors[b];
        const om = Math.acos(Math.min(1, d));
        const pts = new Float32Array((SEG + 1) * 3);
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG;
          const k1 = Math.sin((1 - u) * om) / Math.sin(om), k2 = Math.sin(u * om) / Math.sin(om);
          const lift = 1.02 + 0.22 * Math.sin(Math.PI * u) * (om / 1.2);
          pts[s * 3] = (A[0] * k1 + B[0] * k2) * lift;
          pts[s * 3 + 1] = (A[1] * k1 + B[1] * k2) * lift;
          pts[s * 3 + 2] = (A[2] * k1 + B[2] * k2) * lift;
        }
        arcs.push({ pts, phase: Math.random(), speed: 0.00006 + Math.random() * 0.00006 });
      }
    }

    // ---- орбити със спътници
    const rings = [
      { tilt: 1.15, roll: 0.3, r: 1.42, v: 0.00045, nodes: 3 },
      { tilt: 0.45, roll: -0.9, r: 1.58, v: -0.00032, nodes: 2 },
      { tilt: 1.5, roll: 1.2, r: 1.72, v: 0.00024, nodes: 2 },
    ];
    const ringPt = (ri: number, a: number, out: number[]) => {
      const { tilt, roll, r } = rings[ri];
      let x = Math.cos(a) * r, y = 0, z = Math.sin(a) * r;
      const y1 = y * Math.cos(tilt) - z * Math.sin(tilt), z1 = y * Math.sin(tilt) + z * Math.cos(tilt);
      y = y1; z = z1;
      const x2 = x * Math.cos(roll) - y * Math.sin(roll), y2 = x * Math.sin(roll) + y * Math.cos(roll);
      out[0] = x2; out[1] = y2; out[2] = z;
    };

    // ---- вълни
    interface Ripple { x: number; y: number; z: number; t0: number }
    let ripples: Ripple[] = [];

    let w = 0, h = 0, dpr = 1, raf = 0;
    let tx = 0, ty = 0, mx = 0, my = 0;
    let cyA = 1, syA = 0, cxA = 1, sxA = 0;
    let cx = 0, cy = 0, R = 1;
    let lastAuto = -1e9;

    const BUCKETS = 7;
    const styles = Array.from({ length: BUCKETS }, (_, b) => {
      const k = b / (BUCKETS - 1);
      const a = 0.14 + 0.86 * k;
      return `rgba(${Math.round(60 + 175 * k)},${Math.round(80 + 140 * k)},255,${a.toFixed(2)})`;
    });
    const bk = new Uint8Array(N);
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const out3 = [0, 0, 0];
    let sx = 0, sy = 0, sz = 0;
    const proj = (x: number, y: number, z: number) => {
      const x1 = x * cyA + z * syA, z1 = -x * syA + z * cyA;
      const y2 = y * cxA - z1 * sxA, z2 = y * sxA + z1 * cxA;
      const f = 3.2 / (3.2 - z2);
      sx = cx + x1 * f * R;
      sy = cy + y2 * f * R;
      sz = z2;
      return f;
    };

    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      if (reduce) draw(2500);
    };

    function addRipple(t: number) {
      // точката от сферата, която гледа към зрителя
      ripples.push({ x: -cxA * syA, y: sxA, z: cxA * cyA, t0: t });
      if (ripples.length > 4) ripples.shift();
    }

    function draw(t: number) {
      const c = ctx!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const wide = w > 900;
      cx = backdrop ? (wide ? w * 0.62 : w / 2) : wide ? w * 0.42 : w / 2;
      cy = h * (wide || backdrop ? 0.5 : 0.36);
      R = Math.min(wide ? w * 0.4 : w, h) * (wide ? 0.4 : 0.34) * (backdrop ? 1.15 : 1);
      const ay = t * 0.00012 + mx * 0.9;
      const ax = -0.3 + my * 0.5;
      cyA = Math.cos(ay); syA = Math.sin(ay); cxA = Math.cos(ax); sxA = Math.sin(ax);

      if (!reduce && t - lastAuto > 3800) {
        lastAuto = t;
        addRipple(t);
      }
      ripples = ripples.filter((r) => t - r.t0 < 5200);
      const dotSz = small ? 1.5 : 1.25;

      // ---- частици със вълни
      for (let i = 0; i < N; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        let lift = 0.025 * Math.sin(x * 4 + y * 3 + t * 0.0006) * Math.cos(z * 3 - t * 0.0004);
        let glow = 0;
        for (let k = 0; k < ripples.length; k++) {
          const r = ripples[k];
          const d = 1 - (x * r.x + y * r.y + z * r.z); // 0..2 – разстояние от източника
          const age = t - r.t0;
          const front = d * 7 - age * 0.0032; // фронт на вълната
          const env = Math.exp(-front * front * 0.6) * Math.exp(-age * 0.00055) * Math.exp(-d * 0.35);
          lift += 0.11 * env;
          glow += env;
        }
        const s = 1 + lift;
        proj(x * s, y * s, z * s);
        px[i] = sx;
        py[i] = sy;
        const depth = (sz + 1.15) / 2.3;
        bk[i] = Math.max(0, Math.min(BUCKETS - 1, Math.floor((depth + glow * 0.9) * BUCKETS)));
      }
      for (let b = 0; b < BUCKETS; b++) {
        c.fillStyle = styles[b];
        const s = dotSz * (0.7 + b * 0.14);
        for (let i = 0; i < N; i++) if (bk[i] === b) c.fillRect(px[i], py[i], s, s);
      }

      // ---- мрежа от дъги + пътуващи светлини
      c.lineWidth = 0.7;
      for (const arc of arcs) {
        const p = arc.pts;
        let prevOk = false;
        c.beginPath();
        let midZ = 0;
        for (let s = 0; s <= SEG; s++) {
          proj(p[s * 3], p[s * 3 + 1], p[s * 3 + 2]);
          if (s === SEG >> 1) midZ = sz;
          if (s === 0) c.moveTo(sx, sy);
          else c.lineTo(sx, sy);
          prevOk = true;
        }
        if (!prevOk) continue;
        const al = Math.max(0.04, 0.1 + midZ * 0.28);
        c.strokeStyle = `rgba(150,165,255,${al.toFixed(2)})`;
        c.stroke();
        // светлина по дъгата
        const u = ((t * arc.speed + arc.phase) % 1) * SEG;
        const i0 = Math.floor(u), f = u - i0;
        const a0 = Math.min(SEG, i0), a1 = Math.min(SEG, i0 + 1);
        const gx = p[a0 * 3] + (p[a1 * 3] - p[a0 * 3]) * f;
        const gy = p[a0 * 3 + 1] + (p[a1 * 3 + 1] - p[a0 * 3 + 1]) * f;
        const gz = p[a0 * 3 + 2] + (p[a1 * 3 + 2] - p[a0 * 3 + 2]) * f;
        proj(gx, gy, gz);
        if (sz > -0.3) {
          c.fillStyle = "rgba(255,255,255,0.95)";
          c.fillRect(sx - 1.5, sy - 1.5, 3, 3);
          c.fillStyle = "rgba(140,160,255,0.28)";
          c.fillRect(sx - 4, sy - 4, 8, 8);
        }
      }
      // котви („хора“)
      for (const a of anchors) {
        proj(a[0] * 1.02, a[1] * 1.02, a[2] * 1.02);
        if (sz < -0.2) continue;
        c.fillStyle = "rgba(230,236,255,0.95)";
        c.fillRect(sx - 1.6, sy - 1.6, 3.2, 3.2);
      }

      // ---- орбити и спътници
      for (let ri = 0; ri < rings.length; ri++) {
        const dots = small ? 70 : 130;
        for (let k = 0; k < dots; k++) {
          ringPt(ri, (k / dots) * Math.PI * 2, out3);
          proj(out3[0], out3[1], out3[2]);
          const al = 0.07 + 0.16 * ((sz + 1.8) / 3.6);
          c.fillStyle = `rgba(170,180,255,${al.toFixed(2)})`;
          c.fillRect(sx, sy, 1.1, 1.1);
        }
        for (let n = 0; n < rings[ri].nodes; n++) {
          const a0 = t * rings[ri].v * 2 + (n / rings[ri].nodes) * Math.PI * 2 + ri;
          const dir = Math.sign(rings[ri].v);
          for (let tr = 9; tr >= 0; tr--) {
            ringPt(ri, a0 - dir * tr * 0.045, out3);
            proj(out3[0], out3[1], out3[2]);
            const front = (sz + 1.8) / 3.6;
            const al = (1 - tr / 10) * (0.25 + 0.75 * front);
            c.fillStyle = tr === 0 ? `rgba(255,255,255,${(0.5 + 0.5 * front).toFixed(2)})` : `rgba(150,170,255,${al.toFixed(2)})`;
            const z = tr === 0 ? 3.4 : 2.2 * (1 - tr / 12);
            c.fillRect(sx - z / 2, sy - z / 2, z, z);
          }
        }
      }
    }

    const onMove = (e: PointerEvent) => {
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".card")) return;
      addRipple(performance.now());
    };
    let lastDraw = 0;
    const loop = (t: number) => {
      mx += (tx - mx) * 0.05;
      my += (ty - my) * 0.05;
      // фонът в приложението е ~30 кадъра/сек – пести батерия
      if (!document.hidden && (!backdrop || t - lastDraw > 32)) {
        lastDraw = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();
    if (!reduce) {
      window.addEventListener("pointermove", onMove);
      if (!backdrop) window.addEventListener("pointerdown", onDown);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [backdrop]);

  return <canvas ref={ref} className={backdrop ? "particles app-bg" : "particles"} aria-hidden="true" />;
}
