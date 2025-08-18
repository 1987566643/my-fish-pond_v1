'use client';

import { useEffect, useRef, useState } from 'react';
import { drawHookIcon, HOOK_SIZE } from './HookIcon';

/** ================== 可调参数 ================== */
const INIT_SCALE = 0.3;        // 初始体型：画布导出后，作为鱼的起始尺寸（越小越迷你）
const GROWTH_PER_DAY = 0.03;   // 每天增长比例（3%/day）
const MAX_SCALE = 1.8;         // 成长上限倍数
const EXPORT_W = 420;          // 画布导出基准宽
const EXPORT_H = 240;          // 画布导出基准高
/** ============================================== */

/** 后端返回的鱼结构（/api/fish GET 已联表 users 并统计 reactions） */
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
};

/** 画布里用于渲染/碰撞的精灵 */
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

  img: HTMLImageElement;
  x: number;
  y: number;
  angle: number;
  speed: number; // 像素/秒
  turn: number;  // 何时转向的倒计时(秒)
  caught: boolean;
};

function rnd(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

/** 随时间长大：初始 1.0（因为 w/h 已经按 INIT_SCALE 存库），按天增长 */
function sizeFactor(iso: string, s0 = 1.0, kPerDay = GROWTH_PER_DAY, sMax = MAX_SCALE) {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return Math.min(s0 + kPerDay * days, sMax);
}

const palette = [
  '#ffffff',
  '#000000',
  '#ff6b6b',
  '#ffd166',
  '#06d6a0',
  '#4dabf7',
  '#a78bfa',
  '#ff9f1c',
  '#2ec4b6',
  '#8892b0',
];

export default function PondClient() {
  /** 轻提示（无感刷新） */
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  function showToast(text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2000);
  }

  /** 悬浮的提示框定位（在池塘画布内的坐标） */
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);

  /** 池塘数据 */
  const pondRef = useRef<HTMLCanvasElement>(null);
  const [pondFish, setPondFish] = useState<ServerFish[]>([]);
  const [myCatchCount, setMyCatchCount] = useState(0);

  /** 画鱼对话框与画布 */
  const drawDlgRef = useRef<HTMLDialogElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [fishName, setFishName] = useState('');
  const [brush, setBrush] = useState(8);
  const [currentColor, setCurrentColor] = useState(palette[5]);

  /** 钓鱼状态 */
  const [armed, setArmed] = useState(false);
  const fishingRef = useRef({
    hasHook: false,
    x: 0,
    y: 0,
    biteRadius: 20,
    caughtId: null as null | string,
  });

  /** 从后端刷新当前池塘鱼和“我的收获数” */
  async function refreshAll() {
    // 池塘
    const res = await fetch('/api/fish', { cache: 'no-store' });
    const json = await res.json();
    setPondFish(json.fish || []);

    // ✅ 用 /api/catch（GET）统计“我钓到的鱼”，而不是 /api/mine
    try {
      const mineCatch = await fetch('/api/catch', { cache: 'no-store' }).then((r) => r.json());
      setMyCatchCount((mineCatch.fish || []).length);
    } catch {
      setMyCatchCount(0);
    }
  }

  useEffect(() => {
    refreshAll();
    initDrawCanvas();
  }, []);

  /** ======== 画鱼面板：初始化本地画布绘制 ======== */
  function initDrawCanvas() {
    const cvs = drawCanvasRef.current!;
    if (!cvs) return;

    // ✅ 初始化时显式设置宽高，避免对话框未开启导致 rect.width=0
    setupHiDPI(cvs, EXPORT_W, EXPORT_H);
    const ctx = cvs.getContext('2d')!;
    (cvs as any)._strokes = (cvs as any)._strokes || [];

    function drawGuides() {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      // 背景
      ctx.save();
      ctx.globalAlpha = 0.08;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(rnd(0, cvs.width), rnd(0, cvs.height), rnd(8, 30), 0, Math.PI * 2);
        ctx.fillStyle = '#9dd0ff';
        ctx.fill();
      }
      ctx.restore();
      // 指南：鱼头朝右
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(16, 20);
      ctx.lineTo(cvs.width - 16, 20);
      ctx.stroke();
      ctx.restore();

      // 笔画
      const strokes: any[] = (cvs as any)._strokes || [];
      for (const s of strokes) {
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
      stroke = { color: currentColor, size: brush, points: [p] };
      (cvs as any)._strokes.push(stroke);
      last = p;
      drawGuides();
    }
    function move(ev: PointerEvent) {
      if (!drawing || !last || !stroke) return;
      const rect = cvs.getBoundingClientRect();
      const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      stroke.points.push(p);
      // 局部画线更顺滑
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
    function up() {
      drawing = false;
      last = null;
      stroke = null;
    }

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
    if (strokes.length) {
      strokes.pop();
      (cvs as any).redraw && (cvs as any).redraw();
    }
  }

  async function saveFish() {
    const cvs = drawCanvasRef.current!;
    const strokes = ((cvs as any)._strokes as any[]) || [];
    if (!strokes.length) {
      showToast('先画一条鱼 🙂');
      return;
    }
    // 1) 基准尺寸上合成 PNG
    const off = document.createElement('canvas');
    off.width = EXPORT_W;
    off.height = EXPORT_H;
    const g = off.getContext('2d')!;
    for (const s of strokes) {
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

    // 2) 生成“初始体型”版本（按 INIT_SCALE 缩小一次）
    const dst = document.createElement('canvas');
    const dstW = Math.max(1, Math.round(EXPORT_W * INIT_SCALE));
    const dstH = Math.max(1, Math.round(EXPORT_H * INIT_SCALE));
    dst.width = dstW;
    dst.height = dstH;
    const dg = dst.getContext('2d')!;
    dg.imageSmoothingEnabled = true;
    dg.imageSmoothingQuality = 'high';
    dg.drawImage(off, 0, 0, dstW, dstH);

    const data_url = dst.toDataURL('image/png');
    const name = (fishName || '').trim() || `无名鱼-${String(Date.now()).slice(-5)}`;

    const res = await fetch('/api/fish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 把缩小后的尺寸写入数据库，作为“起始体型”
      body: JSON.stringify({ name, data_url, w: dstW, h: dstH }),
    });

    if (res.ok) {
      (drawDlgRef.current as HTMLDialogElement)?.close();
      setFishName('');
      clearDrawing();
      await refreshAll();
      showToast('已保存到池塘');
    } else {
      showToast('保存失败');
    }
  }

  /** ======== 池塘渲染 ======== */
  const spritesRef = useRef<PondSprite[]>([]);
  const lastTs = useRef(performance.now());

  function rebuildSprites(list: ServerFish[]) {
    const cvs = pondRef.current!;
    const W = cvs.clientWidth || 800;
    const H = cvs.clientHeight || 480;
    spritesRef.current = list.map((f) => {
      const img = new Image();
      img.src = f.data_url;
      const scale = 1.0; // 初始体型已存库，这里不再随机
      return {
        id: f.id,
        name: f.name,
        owner_name: f.owner_name,
        data_url: f.data_url,
        w: f.w * scale,
        h: f.h * scale,
        created_at: f.created_at,
        likes: f.likes || 0,
        dislikes: f.dislikes || 0,

        img,
        x: rnd(80, Math.max(120, W - 80)),
        y: rnd(80, Math.max(120, H - 80)),
        angle: rnd(-Math.PI, Math.PI),
        speed: rnd(22, 60),
        turn: rnd(0.8, 2.2),
        caught: false,
      };
    });
  }

  useEffect(() => {
    if (!pondRef.current) return;
    rebuildSprites(pondFish);
  }, [pondFish]);

  useEffect(() => {
    const cvs = pondRef.current!;
    if (!cvs) return;

    setupHiDPI(cvs); // 池塘画布跟随容器大小
    const ctx = cvs.getContext('2d')!;
    let rafId = 0 as number;

    /** 画鱼钩+检测命中 */
    function drawHookAndCheck(ctx2: CanvasRenderingContext2D) {
      const f = fishingRef.current;
      if (!f.hasHook) return;
      const size = HOOK_SIZE;
      const eyeY = f.y - size;

      // 绘制钓线
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

      // 命中判定
      if (!f.caughtId) {
        for (const s of spritesRef.current) {
          // 鱼嘴近似位置（略偏右上）
          const mouthX = s.x + Math.cos(s.angle) * (s.w * 0.52);
          const mouthY = s.y + Math.sin(s.angle) * (s.h * 0.18);
          const d = Math.hypot(mouthX - f.x, mouthY - f.y);
          if (d <= f.biteRadius) {
            s.caught = true;
            s.x = f.x;
            s.y = f.y;
            fishingRef.current.caughtId = s.id;
            break;
          }
        }
      } else {
        // 已咬住：在钩子附近微抖
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

      const W = cvs.clientWidth;
      const H = cvs.clientHeight;
      ctx.clearRect(0, 0, W, H);

      // 背景气泡
      for (let i = 0; i < 6; i++) {
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        ctx.arc(rnd(0, W), rnd(0, H), rnd(10, 60), 0, Math.PI * 2);
        ctx.fillStyle = '#9dd0ff';
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 鱼游动+绘制
      for (const s of spritesRef.current) {
        if (!s.caught) {
          s.turn -= dt;
          if (s.turn <= 0) {
            s.angle += rnd(-0.5, 0.5);
            s.turn = rnd(0.6, 1.8);
          }
          s.x += Math.cos(s.angle) * s.speed * dt;
          s.y += Math.sin(s.angle) * s.speed * dt;

          // 撞边后朝中心拐
          const margin = 30;
          if (s.x < margin || s.x > W - margin || s.y < 40 + margin || s.y > H - 40 - margin) {
            const cx = W / 2, cy = H / 2;
            s.angle = Math.atan2(cy - s.y, cx - s.x) + rnd(-0.25, 0.25);
          }
        }
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        const k = sizeFactor(s.created_at); // 成长倍数（天）
        ctx.drawImage(s.img, (-s.w * k) / 2, (-s.h * k) / 2, s.w * k, s.h * k);
        ctx.restore();
      }

      drawHookAndCheck(ctx);
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    // 悬浮检测（计算是否在某鱼的包围盒内）
    function onMove(ev: PointerEvent) {
      const rect = cvs.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let found: null | { id: string; x: number; y: number } = null;
      for (const s of spritesRef.current) {
        const k = sizeFactor(s.created_at);
        const bw = s.w * k;
        const bh = s.h * k;
        if (x > s.x - bw / 2 && x < s.x + bw / 2 && y > s.y - bh / 2 && y < s.y + bh / 2) {
          found = { id: s.id, x, y };
          break;
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

  /** 放下鱼钩 */
  function armToggle() {
    setArmed((a) => !a);
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
    setArmed(false);
  }

  /** 收钩（若已咬住则尝试 /api/catch） */
  async function reelUp() {
    const f = fishingRef.current;
    if (!f.hasHook) return;

    if (f.caughtId) {
      const res = await fetch('/api/catch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishId: f.caughtId }),
      });

      if (res.ok) {
        // 先本地移除，立即无感反馈
        spritesRef.current = spritesRef.current.filter((s) => s.id !== f.caughtId);
        setPondFish((prev) => prev.filter((x) => x.id !== f.caughtId));
        setMyCatchCount((n) => n + 1);

        // 清理钩子状态
        fishingRef.current.caughtId = null;
        fishingRef.current.hasHook = false;

        // 静默同步远端
        await refreshAll();
        showToast('收到一条鱼，已加入你的收获！');
      } else {
        showToast('这条鱼已被别人抢先钓走了 :(');
        await refreshAll();
      }
    }

    // 无论成功与否，都收起钩子
    fishingRef.current.hasHook = false;
    fishingRef.current.caughtId = null;
  }

  /** 点赞/点踩 */
  async function reactToFish(id: string, value: 1 | -1) {
    await fetch('/api/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fishId: id, value }),
    });
    await refreshAll();
  }

  const pondCount = pondFish.length;

  return (
    <div>
      <header
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: 8,
          borderBottom: '1px solid rgba(255,255,255,.08)',
        }}
      >
        <button
          className="ghost"
          onClick={() => {
            const c = drawCanvasRef.current as any;
            if (c) {
              c._strokes = [];
              c.redraw && c.redraw();
            }
            // 打开前再确保有固定宽高，避免 0 宽
            setupHiDPI(drawCanvasRef.current!, EXPORT_W, EXPORT_H);
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
          池塘 {pondCount} | 我的收获 {myCatchCount}
        </span>
      </header>

      <div style={{ position: 'relative', height: '70dvh' }}>
        <canvas ref={pondRef} onClick={onPondClick} style={{ width: '100%', height: '100%', display: 'block' }} />
        {armed && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '6px 10px',
              fontSize: 13,
              borderRadius: 999,
              background: 'rgba(0,0,0,.35)',
            }}
          >
            点击池塘任意位置放下鱼钩
          </div>
        )}
      </div>

      {/* 画鱼对话框 */}
      <dialog
        ref={drawDlgRef}
        style={{
          border: '1px solid rgba(255,255,255,.12)',
          borderRadius: 12,
          background: 'linear-gradient(180deg,#0f2236,#0d1e2f)',
          color: '#cfeaff',
          width: 'min(940px,95vw)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            alignItems: 'center',
            padding: '10px 12px',
            borderBottom: '1px solid rgba(255,255,255,.08)',
          }}
        >
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
              width: EXPORT_W,        // ✅ 指定固定宽高，防止 0 尺寸
              height: EXPORT_H,
              background: '#0b1a23',
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 8,
              display: 'block',
            }}
          />
          <div style={{ display: 'grid', gap: 10 }}>
            <input value={fishName} onChange={(e) => setFishName(e.target.value)} placeholder="给这条鱼起个名字" />
            <label>
              粗细{' '}
              <input type="range" min={2} max={30} step={1} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
            </label>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>颜色</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,28px)', gap: 6 }}>
                {palette.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCurrentColor(c)}
                    title={c}
                    style={{
                      width: 28, height: 28, borderRadius: 8,
                      border: `2px solid ${currentColor === c ? '#fff' : 'rgba(255,255,255,.25)'}`,
                      background: c,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="muted">提示：画时顶部箭头仅作参考，导出不会包含。</div>
          </div>
        </div>

        {/* 悬浮信息卡 + 点赞/点踩（放在对话框外也行，这里沿用现有逻辑） */}
        {hovered &&
          (() => {
            const s = spritesRef.current.find((x) => x.id === hovered.id);
            if (!s) return null;
            const ageMs = Date.now() - new Date(s.created_at).getTime();
            const d = Math.floor(ageMs / 86400000),
                  h = Math.floor(ageMs / 3600000) % 24,
                  m = Math.floor(ageMs / 60000) % 60;
            return (
              <div
                style={{
                  position: 'fixed',
                  left: hovered.x + 12,
                  top: hovered.y + 12,
                  background: 'rgba(0,0,0,.75)',
                  color: '#fff',
                  padding: '8px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  pointerEvents: 'auto',
                }}
              >
                <div>作者：{s.owner_name}</div>
                <div>名字：{s.name}</div>
                <div>已存活：{d}天{h}小时{m}分</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="ghost" onClick={async () => reactToFish(s.id, 1)}>👍 {s.likes}</button>
                  <button className="ghost" onClick={async () => reactToFish(s.id, -1)}>👎 {s.dislikes}</button>
                </div>
              </div>
            );
          })()}

        {/* Toasts（无感刷新提示） */}
        <div
          className="toast-container"
          style={{ position: 'fixed', right: 16, top: 16, display: 'grid', gap: 8, zIndex: 1000 }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                background: 'rgba(0,0,0,.75)',
                color: '#fff',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                boxShadow: '0 4px 14px rgba(0,0,0,.2)',
              }}
            >
              {t.text}
            </div>
          ))}
        </div>
      </dialog>
    </div>
  );
}

/** 处理 DPR 的高分屏适配 */
function setupHiDPI(canvas: HTMLCanvasElement, w?: number, h?: number) {
  function resize() {
    const dpr = Math.max(1, (window as any).devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();

    // ✅ 不用 ??，兼容更老的解析器
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
