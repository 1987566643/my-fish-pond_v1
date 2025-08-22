// /components/PondClient.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { drawHookIcon, HOOK_SIZE } from './HookIcon';

/** ================== 可调参数 ================== */
const INIT_SCALE = 0.3;
const GROWTH_PER_DAY = 0.03;
const MAX_SCALE = 1.8;
const EXPORT_W = 420;
const EXPORT_H = 240;
/** ============================================== */

type ServerFish = {
  id: string;
  name: string;
  data_url: string;
  w: number;
  h: number;
  created_at: string;
  owner_name: string;
  likes: number;
  dislikes: number;
  my_vote?: 1 | -1 | null;
};

type PondSprite = {
  id: string;
  name: string;
  owner_name: string;
  data_url: string;
  w: number;
  h: number;
  created_at: string;
  likes: number;
  dislikes: number;
  my_vote?: 1 | -1 | null;

  img: HTMLImageElement;
  x: number;
  y: number;
  angle: number;
  speed: number;
  turn: number;
  caught: boolean;
};

type Bubble = { x: number; y: number; r: number; vy: number; phase: number };

function rnd(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function sizeFactor(iso: string, s0 = 1.0, kPerDay = GROWTH_PER_DAY, sMax = MAX_SCALE) {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  const v = s0 + kPerDay * days;
  return v > sMax ? sMax : v;
}

const palette = [
  '#ffffff', '#000000', '#ff6b6b', '#ffd166', '#06d6a0',
  '#4dabf7', '#a78bfa', '#ff9f1c', '#2ec4b6', '#8892b0',
];

export default function PondClient() {
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  function showToast(text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 1800);
  }

  /** —— 刷新调度：避免并发/连环刷新 —— */
  const refreshBusyRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const freezeUntilRef = useRef<number>(0); // 钓鱼保护时间戳（ms）

  async function refreshAllInternal() {
    // 钓鱼保护：冻结期内跳过
    if (Date.now() < freezeUntilRef.current) return;

    if (refreshBusyRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshBusyRef.current = true;

    try {
      // —— 拉池塘 —— //
      const res = await fetch('/api/fish', { cache: 'no-store' });
      const json = await res.json();
      const list: ServerFish[] = (json.fish || []).map((f: any) => ({
        ...f,
        my_vote: (f.my_vote === 1 || f.my_vote === -1) ? f.my_vote : null,
      }));
      setPondFish(list);

      // —— 拉今日收获 —— //
      try {
        const j = await fetch('/api/catch', { cache: 'no-store' }).then(r => r.json());
        if (j && j.ok) setTodayCatchCount(j.today_catch ?? 0);
        else setTodayCatchCount(0);
      } catch { setTodayCatchCount(0); }
    } finally {
      refreshBusyRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        // 小延时再跑，防止抖动
        setTimeout(refreshAllInternal, 120);
      }
    }
  }
  // 供外部调用的 refresh（做节流/防抖）
  const refreshAll = () => {
    // 可视时刷新；不可视时延后
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      refreshQueuedRef.current = true;
      return;
    }
    // 统一入队
    refreshQueuedRef.current = true;
    setTimeout(refreshAllInternal, 60);
  };

  /** 悬浮卡控制 */
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverLock, setHoverLock] = useState(false);
  const hoverGraceRef = useRef<number | null>(null);

  /** 池塘数据 */
  const pondRef = useRef<HTMLCanvasElement>(null);
  const [pondFish, setPondFish] = useState<ServerFish[]>([]);
  const [todayCatchCount, setTodayCatchCount] = useState(0);

  /** 画鱼对话框与画布 */
  const drawDlgRef = useRef<HTMLDialogElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [fishName, setFishName] = useState('');
  const [brush, setBrush] = useState(8);
  const [currentColor, setCurrentColor] = useState(palette[5]);

  const colorRef = useRef(currentColor);
  const brushRef = useRef(brush);
  useEffect(() => { colorRef.current = currentColor; }, [currentColor]);
  useEffect(() => { brushRef.current = brush; }, [brush]);

  /** 钓鱼状态（包含“咬钩判定”与“冻结刷新”） */
  const [armed, setArmed] = useState(false);
  const fishingRef = useRef({
    hasHook: false,
    x: 0,
    y: 0,
    biteRadius: 16,
    caughtId: null as null | string,

    holdMsRequired: 380,
    lastAttemptAt: 0,
    cooldownMs: 1500,
    candidateId: null as null | string,
    candidateStart: 0,
  });

  useEffect(() => {
    refreshAll(); // 首次加载
    initDrawCanvas();
  }, []);

  /** 画鱼面板初始化（略，与你当前版本一致） */
  function initDrawCanvas() {
    const cvs = drawCanvasRef.current!;
    if (!cvs) return;
    setupHiDPI(cvs, EXPORT_W, EXPORT_H);
    const ctx = cvs.getContext('2d')!;
    (cvs as any)._strokes = (cvs as any)._strokes || [];

    function drawGuides() {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      ctx.save();
      ctx.globalAlpha = 0.08;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * cvs.width, Math.random() * cvs.height, rnd(8, 30), 0, Math.PI * 2);
        ctx.fillStyle = '#9dd0ff';
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(16, 20);
      ctx.lineTo(cvs.width - 16, 20);
      ctx.stroke();
      ctx.restore();

      const strokes: any[] = (cvs as any)._strokes || [];
      for (let si = 0; si < strokes.length; si++) {
        const s = strokes[si];
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < s.points.length; i++) {
          const p = s.points[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    let drawing = false;
    let last: { x: number; y: number } | null = null;
    let stroke: { color: string; size: number; points: { x: number; y: number }[] } | null = null;

    function down(ev: PointerEvent) {
      drawing = true;
      const rect = cvs.getBoundingClientRect();
      const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      stroke = { color: colorRef.current, size: brushRef.current, points: [p] };
      (cvs as any)._strokes.push(stroke);
      last = p;
      drawGuides();
    }
    function move(ev: PointerEvent) {
      if (!drawing || !last || !stroke) return;
      const rect = cvs.getBoundingClientRect();
      const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      stroke.points.push(p);
      const ctx2 = cvs.getContext('2d')!;
      ctx2.strokeStyle = stroke.color;
      ctx2.lineWidth = stroke.size;
      ctx2.lineCap = 'round';
      ctx2.lineJoin = 'round';
      ctx2.beginPath();
      ctx2.moveTo(last.x, last.y);
      ctx2.lineTo(p.x, p.y);
      ctx2.stroke();
      last = p;
    }
    function up() { drawing = false; last = null; stroke = null; }

    cvs.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    (cvs as any).redraw = drawGuides;
    drawGuides();

    return () => {
      cvs.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }

  function clearDrawing() {
    const cvs = drawCanvasRef.current!;
    (cvs as any)._strokes = [];
    (cvs as any).redraw && (cvs as any).redraw();
  }
  function undoDrawing() {
    const cvs = drawCanvasRef.current!;
    const strokes = ((cvs as any)._strokes as any[]) || [];
    if (strokes.length) { strokes.pop(); (cvs as any).redraw && (cvs as any).redraw(); }
  }

  async function saveFish() {
    const cvs = drawCanvasRef.current!;
    const strokes = ((cvs as any)._strokes as any[]) || [];
    if (!strokes.length) { showToast('先画一条鱼 🙂'); return; }

    const off = document.createElement('canvas');
    off.width = EXPORT_W; off.height = EXPORT_H;
    const g = off.getContext('2d')!;
    for (let si = 0; si < strokes.length; si++) {
      const s = strokes[si];
      g.strokeStyle = s.color;
      g.lineWidth = s.size;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < s.points.length; i++) {
        const p = s.points[i];
        if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
    const dst = document.createElement('canvas');
    const dstW = Math.max(1, Math.round(EXPORT_W * INIT_SCALE));
    const dstH = Math.max(1, Math.round(EXPORT_H * INIT_SCALE));
    dst.width = dstW; dst.height = dstH;
    const dg = dst.getContext('2d')!;
    dg.imageSmoothingEnabled = true;
    dg.imageSmoothingQuality = 'high';
    dg.drawImage(off, 0, 0, dstW, dstH);

    const data_url = dst.toDataURL('image/png');
    const name = (fishName || '').trim() || `无名鱼-${String(Date.now()).slice(-5)}`;

    const res = await fetch('/api/fish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data_url, w: dstW, h: dstH }),
    });

    if (res.ok) {
      drawDlgRef.current?.close();
      setFishName(''); clearDrawing();
      refreshAll();
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
      showToast('已保存到池塘');
    } else {
      showToast('保存失败');
    }
  }

  const spritesRef = useRef<PondSprite[]>([]);
  const bubblesRef = useRef<Bubble[]>([]);
  const lastTs = useRef(performance.now());

  function drawWater(ctx: CanvasRenderingContext2D, W: number, H: number, ts: number) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0c1e2e'); g.addColorStop(1, '#0a1825');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.lineWidth = 18; ctx.strokeStyle = '#cfeaff';
    const t = ts * 0.001;
    for (let i = 0; i < 5; i++) {
      const baseY = (H * (i + 1)) / 6;
      const amp = 12 + i * 3; const freq = 0.8 + i * 0.15;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const y = baseY + Math.sin((x * 0.015) + t * freq + i * 1.7) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < bubblesRef.current.length; i++) {
      const b = bubblesRef.current[i];
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(205,234,255,0.9)'; ctx.fill();
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
      b.x += Math.sin(t * 0.9 + b.phase) * 0.06;
    }
    ctx.restore();
  }

  function rebuildSprites(list: ServerFish[]) {
    const cvs = pondRef.current!;
    const W = (cvs && cvs.clientWidth) ? cvs.clientWidth : 800;
    const H = (cvs && cvs.clientHeight) ? cvs.clientHeight : 480;

    const prev = spritesRef.current || [];
    const map = new Map<string, PondSprite>();
    for (let i = 0; i < prev.length; i++) map.set(prev[i].id, prev[i]);

    const next: PondSprite[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const existed = map.get(f.id);
      if (existed) {
        existed.name = f.name;
        existed.owner_name = f.owner_name;
        existed.likes = f.likes || 0;
        existed.dislikes = f.dislikes || 0;
        existed.created_at = f.created_at;
        existed.my_vote = (f.my_vote === 1 || f.my_vote === -1) ? f.my_vote : null;
        if (existed.data_url !== f.data_url) {
          existed.data_url = f.data_url; existed.img = new Image(); existed.img.src = f.data_url;
        }
        existed.w = f.w; existed.h = f.h;
        next.push(existed);
      } else {
        const img = new Image(); img.src = f.data_url;
        next.push({
          id: f.id, name: f.name, owner_name: f.owner_name, data_url: f.data_url,
          w: f.w, h: f.h, created_at: f.created_at, likes: f.likes || 0, dislikes: f.dislikes || 0,
          my_vote: (f.my_vote === 1 || f.my_vote === -1) ? f.my_vote : null,
          img,
          x: Math.max(80, Math.min(W - 80, Math.random() * (W - 160) + 80)),
          y: Math.max(80, Math.min(H - 80, Math.random() * (H - 160) + 80)),
          angle: rnd(-Math.PI, Math.PI), speed: rnd(22, 60), turn: rnd(0.8, 2.2), caught: false,
        });
      }
    }
    spritesRef.current = next;
  }
  useEffect(() => { if (pondRef.current) rebuildSprites(pondFish); }, [pondFish]);

  useEffect(() => {
    const cvs = pondRef.current!;
    if (!cvs) return;

    setupHiDPI(cvs);
    const ctx = cvs.getContext('2d')!;

    if (bubblesRef.current.length === 0) {
      const N = Math.max(10, Math.floor((cvs.clientWidth * cvs.clientHeight) / 45000));
      for (let i = 0; i < N; i++) {
        bubblesRef.current.push({
          x: Math.random() * cvs.clientWidth, y: Math.random() * cvs.clientHeight,
          r: 3 + Math.random() * 6, vy: 12 + Math.random() * 16, phase: Math.random() * Math.PI * 2,
        });
      }
    }

    let rafId = 0 as number;

    function drawHookAndCheck(ctx2: CanvasRenderingContext2D) {
      const f = fishingRef.current;
      if (!f.hasHook) return;
      const size = HOOK_SIZE;
      const eyeY = f.y - size;

      ctx2.save();
      ctx2.strokeStyle = '#c7e8ff';
      ctx2.lineWidth = 2;
      ctx2.globalAlpha = 0.9;
      ctx2.beginPath();
      ctx2.moveTo(f.x, 0);
      ctx2.lineTo(f.x, Math.max(0, eyeY));
      ctx2.stroke();
      ctx2.restore();

      drawHookIcon(ctx2, f.x, f.y, size);

      const fref = fishingRef.current;
      if (!fref.caughtId) {
        const now = performance.now();
        const HOOK_UP_VEC = { x: 0, y: -1 };
        const cosBetween = (ax:number, ay:number, bx:number, by:number) => {
          const la = Math.hypot(ax, ay) || 1; const lb = Math.hypot(bx, by) || 1;
          return (ax * bx + ay * by) / (la * lb);
        };

        let bestId: string | null = null;
        let bestScore = -1;

        for (let i = 0; i < spritesRef.current.length; i++) {
          const s = spritesRef.current[i];
          const mouthX = s.x + Math.cos(s.angle) * (s.w * 0.52);
          const mouthY = s.y + Math.sin(s.angle) * (s.h * 0.18);
          const dist = Math.hypot(mouthX - fref.x, mouthY - fref.y);
          const sizeK = Math.max(s.w, s.h) * 0.05;
          const radius = Math.max(10, fref.biteRadius + sizeK - 6);
          if (dist > radius) continue;

          const fishDir = { x: Math.cos(s.angle), y: Math.sin(s.angle) };
          const cos = cosBetween(fishDir.x, fishDir.y, HOOK_UP_VEC.x, HOOK_UP_VEC.y);
          if (cos < 0.75) continue;
          if (s.speed > 48) continue;

          const score = (1 - dist / radius) * 0.6 + ((cos - 0.75) / 0.25) * 0.3 + (1 - Math.min(1, s.speed / 48)) * 0.1;
          if (score > bestScore) { bestScore = score; bestId = s.id; }
        }

        if (!bestId) { fref.candidateId = null; fref.candidateStart = 0; return; }

        if (now - fref.lastAttemptAt < fref.cooldownMs && fref.candidateId !== bestId) return;

        if (fref.candidateId !== bestId) {
          fref.candidateId = bestId; fref.candidateStart = now; return;
        } else {
          if (now - fref.candidateStart < fref.holdMsRequired) return;
        }

        if (Math.random() < 0.45) {
          const s = spritesRef.current.find(x => x.id === bestId);
          if (s) {
            s.caught = true; s.x = fref.x; s.y = fref.y;
            fref.caughtId = s.id; fref.lastAttemptAt = now;
          }
        } else {
          fref.lastAttemptAt = now; fref.candidateStart = now;
        }
      } else {
        const s = spritesRef.current.find((x) => x.id === fref.caughtId);
        if (s) {
          s.x = fref.x + Math.sin(performance.now() / 120) * 1.2;
          s.y = fref.y + Math.cos(performance.now() / 150) * 1.2;
        }
      }
    }

    function frame(ts: number) {
      const dt = Math.min(0.033, (ts - lastTs.current) / 1000);
      lastTs.current = ts;

      const W = cvs.clientWidth; const H = cvs.clientHeight;
      ctx.clearRect(0, 0, W, H);
      drawWater(ctx, W, H, ts);

      for (let i = 0; i < bubblesRef.current.length; i++) {
        const b = bubblesRef.current[i];
        b.y -= b.vy * dt;
        if (b.y + b.r < -10) {
          b.y = H + 20 + Math.random() * 40;
          b.x = Math.random() * W;
          b.r = 3 + Math.random() * 6;
          b.vy = 12 + Math.random() * 16;
          b.phase = Math.random() * Math.PI * 2;
        }
      }

      for (let i = 0; i < spritesRef.current.length; i++) {
        const s = spritesRef.current[i];
        const isHovered = hovered && s.id === hovered.id;

        if (!s.caught) {
          if (!isHovered) {
            s.turn -= dt;
            if (s.turn <= 0) { s.angle += rnd(-0.5, 0.5); s.turn = rnd(0.6, 1.8); }
            s.x += Math.cos(s.angle) * s.speed * dt;
            s.y += Math.sin(s.angle) * s.speed * dt;

            const margin = 30;
            if (s.x < margin || s.x > W - margin || s.y < 40 + margin || s.y > H - 40 - margin) {
              const cx = W / 2, cy = H / 2;
              s.angle = Math.atan2(cy - s.y, cx - s.x) + rnd(-0.25, 0.25);
            }
          }
        }
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        const k = sizeFactor(s.created_at);
        ctx.drawImage(s.img, (-s.w * k) / 2, (-s.h * k) / 2, s.w * k, s.h * k);
        ctx.restore();
      }

      drawHookAndCheck(ctx);
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    function onMove(ev: PointerEvent) {
      if (hoverLock) return;
      const rect = cvs.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let found: null | { id: string; x: number; y: number } = null;
      for (let i = 0; i < spritesRef.current.length; i++) {
        const s = spritesRef.current[i];
        const k = sizeFactor(s.created_at);
        const bw = s.w * k; const bh = s.h * k;
        if (x > s.x - bw * 0.575 && x < s.x + bw * 0.575 && y > s.y - bh * 0.575 && y < s.y + bh * 0.575) {
          found = { id: s.id, x, y }; break;
        }
      }
      if (found) {
        if (hoverGraceRef.current) { clearTimeout(hoverGraceRef.current); hoverGraceRef.current = null; }
        setHovered(found);
      } else {
        if (!hoverGraceRef.current) {
          hoverGraceRef.current = window.setTimeout(() => {
            hoverGraceRef.current = null;
            if (!hoverLock) setHovered(null);
          }, 250);
        }
      }
    }

    const onResize = () => setupHiDPI(cvs);
    window.addEventListener('resize', onResize);
    cvs.addEventListener('pointermove', onMove);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      cvs.removeEventListener('pointermove', onMove);
      if (hoverGraceRef.current) { clearTimeout(hoverGraceRef.current); hoverGraceRef.current = null; }
    };
  }, [hovered, hoverLock]);

  /** 放下鱼钩：进入“钓鱼保护期”，暂停外部刷新 */
  function armToggle() {
    const next = !armed;
    setArmed(next);
    if (next) {
      fishingRef.current.hasHook = false;
      // 将保护窗口稍微提前，避免刚放钩立刻触发某些刷新
      freezeUntilRef.current = Date.now() + 600;
    }
  }
  function onPondClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!armed) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    fishingRef.current = {
      ...fishingRef.current,
      hasHook: true,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      caughtId: null,
    };
    // 放钩后进入保护期
    freezeUntilRef.current = Date.now() + 2000;
    setArmed(false);
  }

  /** 收钩：成功后再解冻，期间抑制 refreshAll */
  async function reelUp() {
    const f = fishingRef.current;
    if (!f.hasHook) return;

    // 收钩瞬间再延长冻结，避免请求返回前外部刷新打断
    freezeUntilRef.current = Date.now() + 1200;

    if (f.caughtId) {
      const res = await fetch('/api/catch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishId: f.caughtId }),
      });

      if (res.ok) {
        spritesRef.current = spritesRef.current.filter((s) => s.id !== f.caughtId);
        setPondFish((prev) => prev.filter((x) => x.id !== f.caughtId));
        setTodayCatchCount((n) => n + 1);

        fishingRef.current.caughtId = null;
        fishingRef.current.hasHook = false;

        // 稍等一会儿再刷新（让后端聚合写入完全可见）
        setTimeout(() => { refreshAll(); try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {} }, 400);
        showToast('收到一条鱼，已加入你的收获！');
      } else {
        showToast('这条鱼已被别人抢先钓走了 :(');
        setTimeout(() => refreshAll(), 200);
      }
    }

    fishingRef.current.hasHook = false;
    fishingRef.current.caughtId = null;

    // 收尾 800ms 后解冻
    setTimeout(() => { freezeUntilRef.current = 0; }, 800);
  }

  /** 点赞/点踩：本地更新 + 软刷新（不立刻强刷，避免和钓鱼撞） */
  async function reactToFish(id: string, value: 1 | -1) {
    try {
      const res = await fetch('/api/reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishId: id, value }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) return;

      const { likes, dislikes, my_vote } = j as { likes: number; dislikes: number; my_vote: 1 | -1 | null };

      const s = spritesRef.current.find(x => x.id === id);
      if (s) { s.likes = likes; s.dislikes = dislikes; s.my_vote = my_vote; }

      setPondFish(list => list.map(f => f.id === id ? { ...f, likes, dislikes, my_vote } : f));

      if (hovered && hovered.id === id) setHovered({ ...hovered });

      // 交给刷新调度器：非钓鱼期再刷新
      setTimeout(() => refreshAll(), 800);
    } catch {
      // 静默
    }
  }

  useEffect(() => {
    const tick = () => {
      // 周期刷新也走调度器；冻结期会被跳过
      refreshAll();
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
    };
    const iv = setInterval(tick, 5000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(iv);
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', tick);
    };
  }, []);

  const pondCount = pondFish.length;

  let hoverCard: ReactNode = null;
  if (hovered) {
    const s = spritesRef.current.find((x) => x.id === hovered.id);
    if (s) {
      const ageMs = Date.now() - new Date(s.created_at).getTime();
      const d = Math.floor(ageMs / 86400000);
      const h = Math.floor(ageMs / 3600000) % 24;
      const m = Math.floor(ageMs / 60000) % 60;

      const liked = s.my_vote === 1;
      const disliked = s.my_vote === -1;

      hoverCard = (
        <div
          onMouseEnter={() => setHoverLock(true)}
          onMouseLeave={() => setHoverLock(false)}
          style={{
            position: 'fixed', left: Math.round(hovered.x + 12), top: Math.round(hovered.y + 12),
            background: 'rgba(0,0,0,.9)', color: '#fff', padding: '10px 12px', borderRadius: 10,
            fontSize: 12, pointerEvents: 'auto', zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
            border: '1px solid rgba(255,255,255,.12)', minWidth: 190,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
          <div className="muted" style={{ opacity: .8, marginBottom: 6 }}>作者：{s.owner_name}</div>
          <div className="muted" style={{ opacity: .8, marginBottom: 8 }}>已存活：{d}天{h}小时{m}分</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              key={`like-${liked ? 1 : 0}`}
              className="ghost"
              onClick={() => reactToFish(s.id, 1)}
              style={{ borderColor: liked ? '#ffd166' : 'rgba(255,255,255,.25)', background: liked ? 'rgba(255,209,102,.15)' : 'transparent' }}
              title={liked ? '取消点赞' : '点赞'}
            >
              👍 {s.likes}
            </button>
            <button
              key={`dislike-${disliked ? 1 : 0}`}
              className="ghost"
              onClick={() => reactToFish(s.id, -1)}
              style={{ borderColor: disliked ? '#ff6b6b' : 'rgba(255,255,255,.25)', background: disliked ? 'rgba(255,107,107,.15)' : 'transparent' }}
              title={disliked ? '取消点踩' : '点踩'}
            >
              👎 {s.dislikes}
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <div>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <button
          className="ghost"
          onClick={() => {
            const c = drawCanvasRef.current as any;
            if (c) { c._strokes = []; c.redraw && c.redraw(); }
            if (drawCanvasRef.current) setupHiDPI(drawCanvasRef.current, EXPORT_W, EXPORT_H);
            drawDlgRef.current?.showModal();
          }}
        >
          🎨 画鱼
        </button>
        <button className="ghost" onClick={armToggle}>
          {armed ? '✅ 点击池塘放下鱼钩' : '🎯 放下鱼钩'}
        </button>
        <button className="ghost" onClick={reelUp}>
          ⏫ 收回鱼钩
        </button>
        <span style={{ marginLeft: 'auto' }} className="muted">
          池塘 {pondCount} | 今日收获 {todayCatchCount}
        </span>
      </header>

      <div style={{ position: 'relative', height: '70dvh' }}>
        <canvas ref={pondRef} onClick={onPondClick} style={{ width: '100%', height: '100%', display: 'block' }} />
        {armed && (
          <div
            style={{
              position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
              padding: '6px 10px', fontSize: 13, borderRadius: 999, background: 'rgba(0,0,0,.35)',
            }}
          >
            点击池塘任意位置放下鱼钩
          </div>
        )}
      </div>

      {/* 画鱼对话框同上，省略（与你原版一致） */}
      <dialog
        ref={drawDlgRef}
        style={{
          border: '1px solid rgba(255,255,255,.12)', borderRadius: 12,
          background: 'linear-gradient(180deg,#0f2236,#0d1e2f)', color: '#cfeaff',
          width: 'min(940px,95vw)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <strong>🎨 画一条鱼（鱼头朝右）</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={clearDrawing}>清空</button>
            <button className="ghost" onClick={undoDrawing}>撤销</button>
            <button className="ghost" onClick={saveFish}>保存到池塘</button>
            <button className="ghost" onClick={() => drawDlgRef.current?.close()}>关闭</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 12, padding: 12 }}>
          <canvas
            ref={drawCanvasRef}
            style={{
              width: EXPORT_W, height: EXPORT_H, background: '#0b1a23',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, display: 'block',
            }}
          />
          <div style={{ display: 'grid', gap: 10 }}>
            <input value={fishName} onChange={(e) => setFishName(e.target.value)} placeholder="给这条鱼起个名字" />
            <label>粗细 <input type="range" min={2} max={30} step={1} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /></label>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>颜色</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,28px)', gap: 6 }}>
                {palette.map((c) => (
                  <button key={c} onClick={() => setCurrentColor(c)} title={c}
                    style={{
                      width: 28, height: 28, borderRadius: 8,
                      border: `2px solid ${currentColor === c ? '#fff' : 'rgba(255,255,255,.25)'}`,
                      background: c,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </dialog>

      {hoverCard}

      <div className="toast-container" style={{ position: 'fixed', right: 16, top: 16, display: 'grid', gap: 8, zIndex: 1000 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ background: 'rgba(0,0,0,.75)', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 13, boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function setupHiDPI(canvas: HTMLCanvasElement, w?: number, h?: number) {
  function resize() {
    const dpr = Math.max(1, (window as any).devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const rectW = Math.floor(rect.width) || 0;
    const rectH = Math.floor(rect.height) || 0;
    const cssW = (w !== undefined ? w : (rectW || EXPORT_W));
    const cssH = (h !== undefined ? h : (rectH || EXPORT_H));
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * dpr); canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
}
