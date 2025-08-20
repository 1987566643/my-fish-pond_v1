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
  angler_username?: string | null;   // 最近一次钓走者
  caught_at?: string | null;         // 最近一次被钓走时间
};

type MyCatch = {
  catch_id: string;
  fish_id: string;
  name: string;
  owner_username?: string | null;    // 鱼原主人
  data_url: string;
  w: number;
  h: number;
  caught_at?: string | null;
};

export default function MyMineClient() {
  const [mine, setMine] = useState<MyFish[]>([]);
  const [catches, setCatches] = useState<MyCatch[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  // 仅用于按钮/动作防抖（不展示任何提示）
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());  // fishId
  const [pendingRelease, setPendingRelease] = useState<Set<string>>(new Set()); // fishId

  // 只首屏拉取一次；之后不做整页 reload
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

  /** 删除我的鱼：rAF 解耦 + 纯乐观；失败仅回滚该卡片 */
  function deleteMyFish(fishId: string) {
    if (pendingDelete.has(fishId)) return;

    const target = mine.find(f => f.id === fishId);
    if (!target || !target.in_pond) return;

    // —— 乐观：立即移除并让池塘隐藏该鱼（不触发全局刷新） —— //
    const prevMine = mine;
    setMine(prevMine.filter(f => f.id !== fishId));
    try { window.dispatchEvent(new CustomEvent('pond:remove_fish', { detail: { fishId } })); } catch {}

    // —— 解耦异步：等浏览器先 paint，再发请求 —— //
    setPendingDelete(s => new Set(s).add(fishId));
    requestAnimationFrame(() => {
      (async () => {
        try {
          const res = await fetch(`/api/fish/${fishId}`, { method: 'DELETE' });

          if (res.ok) return;

          // 非 200：判定是否幂等等价（保持乐观结果）
          let reason = '';
          try { const j = await res.json(); reason = j?.error || ''; } catch {}
          const idempotent =
            res.status === 403 || res.status === 404 || res.status === 409 ||
            ['forbidden_or_not_in_pond', 'not_found', 'already_deleted'].includes(reason);
          if (idempotent) return;

          // 其他错误：仅回滚该卡片到原位置序（不触发整页刷新）
          setMine(cur => {
            if (cur.some(f => f.id === fishId)) return cur; // 已被其他途径补回
            const restored: MyFish[] = [];
            const curSet = new Set(cur.map(f => f.id));
            for (const f of prevMine) {
              if (f.id === fishId) restored.push(f);
              else if (curSet.has(f.id)) restored.push(f);
            }
            return restored;
          });
        } catch {
          // 网络异常：回滚该卡片
          setMine(cur => {
            if (cur.some(f => f.id === fishId)) return cur;
            const restored: MyFish[] = [];
            const curSet = new Set(cur.map(f => f.id));
            for (const f of prevMine) {
              if (f.id === fishId) restored.push(f);
              else if (curSet.has(f.id)) restored.push(f);
            }
            return restored;
          });
        } finally {
          setPendingDelete(s => {
            const n = new Set(s);
            n.delete(fishId);
            return n;
          });
        }
      })();
    });
  }

  /** 放回池塘：rAF 解耦 + 纯乐观；失败仅回滚该卡片；成功/失败都广播一次（保证池塘/公告刷新） */
  function releaseFish(fishId: string) {
    if (pendingRelease.has(fishId)) return;

    // —— 乐观：立即把卡片从“我的收获”移除 —— //
    const prevCatches = catches;
    setCatches(prevCatches.filter(c => c.fish_id !== fishId));

    // 先广播一次，让池塘/公告尽快刷新视觉
    try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}

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
            // 再广播一次，确保远端状态落地后也能同步
            try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
            return;
          }

          // 非 200：幂等等价 → 保持乐观结果；否则回滚
          let reason = '';
          try { const j = await res.json(); reason = j?.error || ''; } catch {}
          const idempotent =
            res.status === 403 || res.status === 404 || res.status === 409 ||
            ['not_your_catch', 'already_released', 'forbidden_or_not_in_pond', 'not_found'].includes(reason);
          if (idempotent) return;

          // 其他错误：回滚该卡片
          setCatches(cur => {
            if (cur.some(c => c.fish_id === fishId)) return cur;
            const curSet = new Set(cur.map(c => c.catch_id));
            const restored: MyCatch[] = [];
            for (const c of prevCatches) {
              if (c.fish_id === fishId) restored.push(c);
              else if (curSet.has(c.catch_id)) restored.push(c);
            }
            return restored;
          });
        } catch {
          // 网络异常：回滚该卡片
          setCatches(cur => {
            if (cur.some(c => c.fish_id === fishId)) return cur;
            const curSet = new Set(cur.map(c => c.catch_id));
            const restored: MyCatch[] = [];
            for (const c of prevCatches) {
              if (c.fish_id === fishId) restored.push(c);
              else if (curSet.has(c.catch_id)) restored.push(c);
            }
            return restored;
          });
        } finally {
          setPendingRelease(s => {
            const n = new Set(s);
            n.delete(fishId);
            return n;
          });
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
