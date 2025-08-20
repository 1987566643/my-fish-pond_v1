'use client';

import { useEffect, useState } from 'react';

type MyFish = {
  id: string;
  name: string;
  data_url: string;
  w: number;
  h: number;
  in_pond: boolean;
  created_at?: string | null;
  angler_username?: string | null;
  caught_at?: string | null;
};

type MyCatch = {
  catch_id: string;
  fish_id: string;
  name: string;
  owner_username?: string | null;
  data_url: string;
  w: number;
  h: number;
  caught_at?: string | null;
};

export default function MyMineClient() {
  const [mine, setMine] = useState<MyFish[]>([]);
  const [catches, setCatches] = useState<MyCatch[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  // 仅用于按钮禁用（不做提示、不触发整页刷新）
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());   // fishId
  const [pendingRelease, setPendingRelease] = useState<Set<string>>(new Set()); // fishId

  // 首屏加载一次
  useEffect(() => {
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch('/api/mine', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ fish: [] })),
          fetch('/api/my-catches', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ fish: [] })),
        ]);
        setMine((a?.fish ?? []) as MyFish[]);
        setCatches((b?.fish ?? []) as MyCatch[]);
      } finally {
        setInitialLoading(false);
      }
    })();
  }, []);

  /** 定时“软同步”：仅合并状态，不替换数组，避免跳动 */
  useEffect(() => {
    let iv: number | undefined;

    async function softMerge() {
      // 页面不可见时跳过
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      try {
        const [a, b] = await Promise.all([
          fetch('/api/mine', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
          fetch('/api/my-catches', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        ]);

        if (a?.fish) {
          const incoming: Record<string, MyFish> = Object.create(null);
          (a.fish as MyFish[]).forEach(f => { incoming[f.id] = f; });
          setMine(cur => cur.map(old => incoming[old.id] ? { ...old,
            in_pond: incoming[old.id].in_pond,
            angler_username: incoming[old.id].angler_username,
            caught_at: incoming[old.id].caught_at,
            // 名称/图也可能被作者改过
            name: incoming[old.id].name ?? old.name,
            data_url: incoming[old.id].data_url ?? old.data_url,
          } : old));
        }
        if (b?.fish) {
          const incoming: Record<string, MyCatch> = Object.create(null);
          (b.fish as MyCatch[]).forEach(c => { incoming[c.catch_id] = c; });
          setCatches(cur => {
            // 用 fish_id 主键对齐，保序
            const mapByFish = new Map<string, MyCatch>();
            (b.fish as MyCatch[]).forEach(c => mapByFish.set(c.fish_id, c));
            return cur.map(old => mapByFish.get(old.fish_id) ? { ...old, ...mapByFish.get(old.fish_id)! } : old);
          });
        }
      } catch { /* 静默 */ }
    }

    iv = window.setInterval(softMerge, 8000) as unknown as number;
    const onVis = () => { if (document.visibilityState === 'visible') softMerge(); };
    window.addEventListener('visibilitychange', onVis);
    return () => {
      if (iv) clearInterval(iv);
      window.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  /** 删除我的鱼：rAF 解耦 + 纯乐观；不回滚、不全量刷新 */
  function deleteMyFish(fishId: string) {
    if (pendingDelete.has(fishId)) return;

    const t = mine.find(f => f.id === fishId);
    if (!t || !t.in_pond) return;

    // 乐观：立即移除；池塘定向隐藏
    setMine(prev => prev.filter(f => f.id !== fishId));
    try { window.dispatchEvent(new CustomEvent('pond:remove_fish', { detail: { fishId } })); } catch {}

    // 解耦异步：先完成一次 paint
    setPendingDelete(s => new Set(s).add(fishId));
    requestAnimationFrame(() => {
      (async () => {
        try {
          // 后端建议：DELETE 接口做“幂等成功”，即
          // - 本人 + in_pond=TRUE → 真正删除
          // - 其他情况（不存在/已被钓走）→ 返回 200 {ok:true}
          await fetch(`/api/fish/${fishId}`, { method: 'DELETE' });
        } catch {
          // 静默：保持乐观结果；后续 softMerge 会矫正
        } finally {
          setPendingDelete(s => { const n = new Set(s); n.delete(fishId); return n; });
        }
      })();
    });
  }

  /** 放回池塘：rAF 解耦 + 纯乐观；只在成功后广播 pond:refresh；不回滚 */
  function releaseFish(fishId: string) {
    if (pendingRelease.has(fishId)) return;

    // 乐观：立即把卡片从“我的收获”里移除
    setCatches(prev => prev.filter(c => c.fish_id !== fishId));

    setPendingRelease(s => new Set(s).add(fishId));
    requestAnimationFrame(() => {
      (async () => {
        try {
          const res = await fetch('/api/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fishId }),
          });
          if (res.ok) {
            // 只有在真正放回成功后再广播 → 避免“消失又回滚”闪烁
            try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
          }
        } catch {
          // 静默：保持乐观结果；后续 softMerge 会矫正
        } finally {
          setPendingRelease(s => { const n = new Set(s); n.delete(fishId); return n; });
        }
      })();
    });
  }

  /** 统一卡片样式（固定高度、按钮底部对齐） */
  const TILE_HEIGHT = 280;
  const PREVIEW_HEIGHT = 130;

  const Tile = (props: {
    img?: string;
    name: string;
    meta?: string;
    actions?: React.ReactNode;
    busy?: boolean;
  }) => (
    <div
      style={{
        border: '1px solid rgba(255,255,255,.12)',
        background: 'rgba(255,255,255,.04)',
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: TILE_HEIGHT,
        opacity: props.busy ? .7 : 1,
        pointerEvents: props.busy ? 'none' : 'auto',
      }}
    >
      <div style={{ position: 'relative', height: PREVIEW_HEIGHT, background: '#0b1a23' }}>
        {props.img ? (
          <img
            src={props.img}
            alt={props.name}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#88a', fontSize: 12 }}>
            无缩略图
          </div>
        )}
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ fontWeight: 600, lineHeight: 1.2, wordBreak: 'break-word' }}>
          {props.name || '无名鱼'}
        </div>
        {props.meta && <div className="muted" style={{ fontSize: 12, lineHeight: 1.3 }}>{props.meta}</div>}
        <div style={{ marginTop: 'auto' }}>
          {props.actions && <div style={{ display: 'flex', gap: 8 }}>{props.actions}</div>}
        </div>
      </div>
    </div>
  );

  const columnStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxHeight: 'calc(100vh - 180px)',
    overflowY: 'auto',
    paddingRight: 4,
  };

  const Grid = (props: { children: React.ReactNode }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      {props.children}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      {/* 左列：我画的鱼（独立滚动） */}
      <section style={columnStyle}>
        <h2 style={{ fontSize: 16, margin: 0 }}>我画的鱼（{mine.length}）</h2>
        {initialLoading && <div className="muted">加载中…</div>}
        {!initialLoading && mine.length === 0 && <div className="muted">暂无</div>}
        {!initialLoading && (
          <Grid>
            {mine.map(f => (
              <Tile
                key={f.id}
                img={f.data_url}
                name={f.name || '无名鱼'}
                meta={
                  f.in_pond
                    ? '状态：池塘中'
                    : f.angler_username
                      ? `已被 ${f.angler_username} 在 ${f.caught_at ? new Date(f.caught_at).toLocaleString() : '未知时间'} 钓走`
                      : '状态：已被钓走'
                }
                busy={pendingDelete.has(f.id)}
                actions={
                  f.in_pond ? (
                    <button className="ghost" onClick={() => deleteMyFish(f.id)} disabled={pendingDelete.has(f.id)}>
                      {pendingDelete.has(f.id) ? '删除中…' : '🗑 删除'}
                    </button>
                  ) : null
                }
              />
            ))}
          </Grid>
        )}
      </section>

      {/* 右列：我的收获（独立滚动） */}
      <section style={columnStyle}>
        <h2 style={{ fontSize: 16, margin: 0 }}>我的收获（{catches.length}）</h2>
        {initialLoading && <div className="muted">加载中…</div>}
        {!initialLoading && catches.length === 0 && <div className="muted">暂无</div>}
        {!initialLoading && (
          <Grid>
            {catches.map(c => (
              <Tile
                key={c.catch_id}
                img={c.data_url}
                name={c.name || '无名鱼'}
                meta={`来自 ${c.owner_username || '未知'}${c.caught_at ? ` · ${new Date(c.caught_at).toLocaleString()}` : ''}`}
                busy={pendingRelease.has(c.fish_id)}
                actions={
                  <button className="ghost" onClick={() => releaseFish(c.fish_id)} disabled={pendingRelease.has(c.fish_id)}>
                    {pendingRelease.has(c.fish_id) ? '放回中…' : '🪣 放回池塘'}
                  </button>
                }
              />
            ))}
          </Grid>
        )}
      </section>
    </div>
  );
}
