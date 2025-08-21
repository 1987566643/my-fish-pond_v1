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
  my_vote: 1 | -1 | null; // 新增：我今天的投票
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
  my_vote: 1 | -1 | null;

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
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  const v = s0 + kPerDay * days;
  return v > sMax ? sMax : v;
}
const palette = ['#ffffff','#000000','#ff6b6b','#ffd166','#06d6a0','#4dabf7','#a78bfa','#ff9f1c','#2ec4b6','#8892b0'];

export default function PondClient() {
  /** Toast（保留，必要时提示） */
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  function showToast(text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 1600);
  }

  /** 悬浮卡定位 + 锁定 */
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverLock, setHoverLock] = useState(false);
  const lockedSpriteIdRef = useRef<string | null>(null);

  /** 数据 */
  const pondRef = useRef<HTMLCanvasElement>(null);
  const [pondFish, setPondFish] = useState<ServerFish[]>([]);
  const [todayCatchCount, setTodayCatchCount] = useState(0);

  /** 画鱼面板 */
  const drawDlgRef = useRef<HTMLDialogElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [fishName, setFishName] = useState('');
  const [brush, setBrush] = useState(8);
  const [currentColor, setCurrentColor] = useState(palette[5]);
  const colorRef = useRef(currentColor);
  const brushRef = useRef(brush);
  useEffect(() => { colorRef.current = currentColor; }, [currentColor]);
  useEffect(() => { brushRef.current = brush; }, [brush]);

  /** 钓鱼状态 */
  const [armed, setArmed] = useState(false);
  const fishingRef = useRef({ hasHook:false, x:0, y:0, biteRadius:20, caughtId: null as null | string });

  /** 从后端刷新池塘 + 今日收获 */
  async function refreshAll() {
    const res = await fetch('/api/fish', { cache: 'no-store' });
    const json = await res.json();
    setPondFish(json.fish || []);

    try {
      const j = await fetch('/api/catch', { cache: 'no-store' }).then(r => r.json());
      if (j && j.ok) setTodayCatchCount(j.today_catch ?? 0);
      else setTodayCatchCount(0);
    } catch { setTodayCatchCount(0); }
  }

  useEffect(() => {
    refreshAll();
    initDrawCanvas();
  }, []);

  /** 画板 */
  function initDrawCanvas() {
    const cvs = drawCanvasRef.current!;
    if (!cvs) return;
    setupHiDPI(cvs, EXPORT_W, EXPORT_H);
    const ctx = cvs.getContext('2d')!;
    (cvs as any)._strokes = (cvs as any)._strokes || [];

    function drawGuides() {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      // 背景泡
      ctx.save();
      ctx.globalAlpha = 0.08;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(rnd(0, cvs.width), rnd(0, cvs.height), rnd(8, 30), 0, Math.PI * 2);
        ctx.fillStyle = '#9dd0ff';
        ctx.fill();
      }
      ctx.restore();
      // 顶部虚线
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(16, 20);
      ctx.lineTo(cvs.width - 16, 20);
      ctx.stroke();
      ctx.restore();
      // strokes
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
    const strokes: any[] = (cvs as any)._strokes || [];
    if (strokes.length) {
      strokes.pop();
      (cvs as any).redraw && (cvs as any).redraw();
    }
  }
  async function saveFish() {
    const cvs = drawCanvasRef.current!;
    const strokes: any[] = (cvs as any)._strokes || [];
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
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
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
      await refreshAll();
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
      showToast('已保存到池塘');
    } else showToast('保存失败');
  }

  /** ======== 池塘渲染 & 柔和背景 ======== */
  const spritesRef = useRef<PondSprite[]>([]);
  const bubblesRef = useRef<Bubble[]>([]);
  const lastTs = useRef(performance.now());

  function drawWater(ctx: CanvasRenderingContext2D, W: number, H: number, ts: number) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0c1e2e');
    g.addColorStop(1, '#0a1825');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#cfeaff';
    const t = ts * 0.001;
    for (let i = 0; i < 5; i++) {
      const baseY = (H * (i + 1)) / 6;
      const amp = 12 + i * 3;
      const freq = 0.8 + i * 0.15;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const y = baseY + Math.sin((x * 0.015) + t * freq + i * 1.7) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < bubblesRef.current.length; i++) {
      const b = bubblesRef.current[i];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(205,234,255,0.9)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.35, 0, Math.PI * 2);
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
        existed.my_vote = (f.my_vote ?? null) as any;
        existed.created_at = f.created_at;
        if (existed.data_url !== f.data_url) {
          existed.data_url = f.data_url;
          existed.img = new Image();
          existed.img.src = f.data_url;
        }
        existed.w = f.w; existed.h = f.h;
        next.push(existed);
      } else {
        const img = new Image();
        img.src = f.data_url;
        next.push({
          id: f.id, name: f.name, owner_name: f.owner_name,
          data_url: f.data_url, w: f.w, h: f.h, created_at: f.created_at,
          likes: f.likes || 0, dislikes: f.dislikes || 0, my_vote: (f.my_vote ?? null) as any,
          img,
          x: Math.max(80, Math.min(W - 80, Math.random() * (W - 160) + 80)),
          y: Math.max(80, Math.min(H - 80, Math.random() * (H - 160) + 80)),
          angle: rnd(-Math.PI, Math.PI),
          speed: rnd(22, 60),
          turn: rnd(0.8, 2.2),
          caught: false,
        });
      }
    }
    spritesRef.current = next;
  }
  useEffect(() => {
    if (!pondRef.current) return;
    rebuildSprites(pondFish);
  }, [pondFish]);

  useEffect(() => {
    const cvs = pondRef.current!;
    if (!cvs) return;
    setupHiDPI(cvs);
    const ctx = cvs.getContext('2d')!;
    if (bubblesRef.current.length === 0) {
      const N = Math.max(10, Math.floor((cvs.clientWidth * cvs.clientHeight) / 45000));
      for (let i = 0; i < N; i++) {
        bubblesRef.current.push({
          x: Math.random() * cvs.clientWidth,
          y: Math.random() * cvs.clientHeight,
          r: 3 + Math.random() * 6,
          vy: 12 + Math.random() * 16,
          phase: Math.random() * Math.PI * 2,
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

      if (!f.caughtId) {
        for (let i = 0; i < spritesRef.current.length; i++) {
          const s = spritesRef.current[i];
          const mouthX = s.x + Math.cos(s.angle) * (s.w * 0.52);
          const mouthY = s.y + Math.sin(s.angle) * (s.h * 0.18);
          const d = Math.hypot(mouthX - f.x, mouthY - f.y);
          if (d <= f.biteRadius) {
            s.caught = true;
            s.x = f.x; s.y = f.y;
            fishingRef.current.caughtId = s.id;
            break;
          }
        }
      } else {
        const s = spritesRef.current.find((x) => x.id === f.caughtId);
        if (s) {
          s.x = f.x + Math.sin(performance.now() / 120) * 1.2;
          s.y = f.y + Math.cos(performance.now() / 150) * 1.2;
        }
      }
    }

    function frame(ts: number) {
      const dt = Math.min(0.033, (ts - lastTs.current) / 1000);
      lastTs.current = ts;
      const W = cvs.clientWidth, H = cvs.clientHeight;

      ctx.clearRect(0, 0, W, H);
      drawWater(ctx, W, H, ts);

      // 更新气泡上浮
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
        const isLocked = lockedSpriteIdRef.current === s.id;
        if (!s.caught && !isLocked) {
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
      if (hoverLock) return; // 锁定时不更新 hovered
      const rect = cvs.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let found: null | { id: string; x: number; y: number } = null;
      for (let i = 0; i < spritesRef.current.length; i++) {
        const s = spritesRef.current[i];
        const k = sizeFactor(s.created_at);
        const bw = s.w * k, bh = s.h * k;
        if (x > s.x - bw / 2 && x < s.x + bw / 2 && y > s.y - bh / 2 && y < s.y + bh / 2) {
          found = { id: s.id, x, y }; break;
        }
      }
      setHovered(found);
    }

    const onResize = () => setupHiDPI(cvs);
    window.addEventListener('resize', onResize);
    cvs.addEventListener('pointermove', onMove);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      cvs.removeEventListener('pointermove', onMove);
    };
  }, []);

  /** 放钩/收钩 */
  function armToggle() { setArmed((a) => !a); }
  function onPondClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!armed) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    fishingRef.current = { ...fishingRef.current, hasHook: true, x: e.clientX - rect.left, y: e.clientY - rect.top, caughtId: null };
    setArmed(false);
  }
  async function reelUp() {
    const f = fishingRef.current;
    if (!f.hasHook) return;
    if (f.caughtId) {
      const res = await fetch('/api/catch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fishId: f.caughtId }) });
      if (res.ok) {
        spritesRef.current = spritesRef.current.filter((s) => s.id !== f.caughtId);
        setPondFish((prev) => prev.filter((x) => x.id !== f.caughtId));
        setTodayCatchCount((n) => n + 1);
        fishingRef.current.caughtId = null; fishingRef.current.hasHook = false;
        await refreshAll();
        try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
        showToast('收到一条鱼，已加入你的收获！');
      } else {
        showToast('这条鱼已被别人抢先钓走了 :(');
        await refreshAll();
      }
    }
    fishingRef.current.hasHook = false; fishingRef.current.caughtId = null;
  }

  /** 点赞/点踩 —— 乐观更新 */
  const votingBusy = useRef<Set<string>>(new Set());
  async function voteToggle(id: string, kind: 'like' | 'dislike') {
    if (votingBusy.current.has(id)) return;
    // 找 sprite + 计算乐观状态
    const s = spritesRef.current.find((x) => x.id === id);
    if (!s) return;

    let newVote: 1 | -1 | null = s.my_vote;
    let dLike = 0, dDislike = 0;

    if (kind === 'like') {
      if (s.my_vote === 1) { newVote = null; dLike = -1; }
      else if (s.my_vote === -1) { newVote = 1; dLike = +1; dDislike = -1; }
      else { newVote = 1; dLike = +1; }
    } else {
      if (s.my_vote === -1) { newVote = null; dDislike = -1; }
      else if (s.my_vote === 1) { newVote = -1; dLike = -1; dDislike = +1; }
      else { newVote = -1; dDislike = +1; }
    }

    // 乐观写入 spritesRef
    s.my_vote = newVote;
    s.likes = Math.max(0, s.likes + dLike);
    s.dislikes = Math.max(0, s.dislikes + dDislike);
    // 同步到 pondFish（让 React 也刷新）
    setPondFish((prev) => prev.map((f) => f.id === s.id
      ? { ...f, likes: s.likes, dislikes: s.dislikes, my_vote: s.my_vote }
      : f
    ));

    // 打接口
    try {
      votingBusy.current.add(id);
      const res = await fetch('/api/reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishId: id, action: kind === 'like' ? 'toggle_like' : 'toggle_dislike' }),
      });
      if (!res.ok) throw new Error('http');
      const j = await res.json();
      // 以后端为准纠正
      const sp = spritesRef.current.find((x) => x.id === id);
      if (sp) {
        sp.likes = j.likes ?? sp.likes;
        sp.dislikes = j.dislikes ?? sp.dislikes;
        sp.my_vote = (j.my_vote ?? null) as any;
        setPondFish((prev) => prev.map((f) => f.id === id
          ? { ...f, likes: sp.likes, dislikes: sp.dislikes, my_vote: sp.my_vote }
          : f
        ));
      }
    } catch (e) {
      // 回滚：直接刷新一次
      await refreshAll();
    } finally {
      votingBusy.current.delete(id);
    }
  }

  /** 定时无感刷新（可留） */
  useEffect(() => {
    const tick = () => {
      refreshAll().then(() => {
        try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
      });
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

  /** 悬浮卡（锁定后不跟随 & 暂停该鱼） */
  let hoverCard: ReactNode = null;
  if (hovered) {
    const s = spritesRef.current.find((x) => x.id === hovered.id);
    if (s) {
      const ageMs = Date.now() - new Date(s.created_at).getTime();
      const d = Math.floor(ageMs / 86400000);
      const h = Math.floor(ageMs / 3600000) % 24;
      const m = Math.floor(ageMs / 60000) % 60;
      const likeActive = s.my_vote === 1;
      const dislikeActive = s.my_vote === -1;

      hoverCard = (
        <div
          onMouseEnter={() => { setHoverLock(true); lockedSpriteIdRef.current = s.id; }}
          onMouseLeave={() => { setHoverLock(false); lockedSpriteIdRef.current = null; }}
          style={{
            position: 'fixed',
            left: Math.round(hovered.x + 12),
            top: Math.round(hovered.y + 12),
            background: 'rgba(0,0,0,.86)',
            color: '#fff',
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: 12,
            pointerEvents: 'auto',
            zIndex: 2000,
            boxShadow: '0 6px 18px rgba(0,0,0,.3)',
            border: '1px solid rgba(255,255,255,.15)',
            minWidth: 160,
          }}
        >
          <div>作者：{s.owner_name}</div>
          <div>名字：{s.name}</div>
          <div>已存活：{d}天{h}小时{m}分</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="ghost"
              onClick={() => voteToggle(s.id, 'like')}
              style={{ borderColor: likeActive ? '#ffd166' : 'rgba(255,255,255,.25)' }}
              title={likeActive ? '取消点赞' : '点赞'}
            >
              {likeActive ? '🖐️' : '👍'} {s.likes}
            </button>
            <button
              className="ghost"
              onClick={() => voteToggle(s.id, 'dislike')}
              style={{ borderColor: dislikeActive ? '#ff6b6b' : 'rgba(255,255,255,.25)' }}
              title={dislikeActive ? '取消点踩' : '点踩'}
            >
              {dislikeActive ? '✋' : '👎'} {s.dislikes}
            </button>
          </div>
        </div>
      );
    }
  }

  /** —— 渲染 —— */
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
        >🎨 画鱼</button>
        <button className="ghost" onClick={armToggle}>{armed ? '✅ 点击池塘放下鱼钩' : '🎯 放下鱼钩'}</button>
        <button className="ghost" onClick={reelUp}>⏫ 收回鱼钩</button>
        <span style={{ marginLeft: 'auto' }} className="muted">池塘 {pondCount} | 今日收获 {todayCatchCount}</span>
      </header>

      <div style={{ position: 'relative', height: '70dvh' }}>
        <canvas ref={pondRef} onClick={onPondClick} style={{ width: '100%', height: '100%', display: 'block' }} />
        {armed && (
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', padding: '6px 10px', fontSize: 13, borderRadius: 999, background: 'rgba(0,0,0,.35)' }}>
            点击池塘任意位置放下鱼钩
          </div>
        )}
      </div>

      {/* 画鱼对话框 */}
      <dialog
        ref={drawDlgRef}
        style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, background: 'linear-gradient(180deg,#0f2236,#0d1e2f)', color: '#cfeaff', width: 'min(940px,95vw)' }}
      >
        <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,.08)' }}>
          <strong>🎨 画一条鱼（鱼头朝右）</strong>
          <div style={{ display:'flex', gap:8 }}>
            <button className="ghost" onClick={clearDrawing}>清空</button>
            <button className="ghost" onClick={undoDrawing}>撤销</button>
            <button className="ghost" onClick={saveFish}>保存到池塘</button>
            <button className="ghost" onClick={() => drawDlgRef.current?.close()}>关闭</button>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 260px', gap:12, padding:12 }}>
          <canvas
            ref={drawCanvasRef}
            style={{ width: EXPORT_W, height: EXPORT_H, background:'#0b1a23', border:'1px solid rgba(255,255,255,.12)', borderRadius:8, display:'block' }}
          />
          <div style={{ display:'grid', gap:10 }}>
            <input value={fishName} onChange={(e) => setFishName(e.target.value)} placeholder="给这条鱼起个名字" />
            <label>粗细 <input type="range" min={2} max={30} step={1} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /></label>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>颜色</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,28px)', gap:6 }}>
                {palette.map((c) => (
                  <button key={c} onClick={() => setCurrentColor(c)} title={c}
                    style={{
                      width:28, height:28, borderRadius:8,
                      border: `2px solid ${currentColor === c ? '#fff' : 'rgba(255,255,255,.25)'}`,
                      background: c
                    }}/>
                ))}
              </div>
            </div>
          </div>
        </div>
      </dialog>

      {/* 悬浮卡 */}
      {hoverCard}

      {/* Toast */}
      <div style={{ position:'fixed', right:16, top:16, display:'grid', gap:8, zIndex:1000 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ background:'rgba(0,0,0,.75)', color:'#fff', padding:'8px 12px', borderRadius:8, fontSize:13, boxShadow:'0 4px 14px rgba(0,0,0,.2)' }}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** DPR 适配 */
function setupHiDPI(canvas: HTMLCanvasElement, w?: number, h?: number) {
  function resize() {
    const dpr = Math.max(1, (window as any).devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const rectW = Math.floor(rect.width) || 0;
    const rectH = Math.floor(rect.height) || 0;
    const cssW = (w !== undefined ? w : (rectW || EXPORT_W));
    const cssH = (h !== undefined ? h : (rectH || EXPORT_H));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
}
