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

  // 进行中集合，仅用于按钮禁用（不触发整页刷新）
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set()); // fishId
  const [pendingRelease, setPendingRelease] = useState<Set<string>>(new Set()); // fishId

  // 仅首屏拉取一次；之后不做任何全量 reload
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

  /** 删除我的鱼：纯乐观，不触发整页 reload；失败仅回滚该卡片 */
  async function deleteMyFish(fishId: string) {
    if (pendingDelete.has(fishId)) return;

    // 只有还在池塘里的鱼才显示删除按钮；这里再防御一次
    const target = mine.find(f => f.id === fishId);
    if (!target || !target.in_pond) return;

    // —— 乐观：先把卡片从列表中移除 —— //
    const prev = mine;
    setMine(prev.filter(f => f.id !== fishId));

    // 通知池塘定向移除，不触发全局刷新
    try { window.dispatchEvent(new CustomEvent('pond:remove_fish', { detail: { fishId } })); } catch {}

    setPendingDelete(s => new Set(s).add(fishId));
    try {
      const res = await fetch(`/api/fish/${fishId}`, { method: 'DELETE' });

      if (res.ok) {
        // 成功：什么都不做（已乐观移除）
        return;
      }

      // 非 200：判定是否“幂等已处理”（比如已经不在池塘/权限等）
      let reason = '';
      try { const j = await res.json(); reason = j?.error || ''; } catch {}

      const idempotent =
        res.status === 403 || res.status === 404 || res.status === 409 ||
        ['forbidden_or_not_in_pond', 'not_found', 'already_deleted'].includes(reason);

      if (idempotent) {
        // 认为最终状态与UI一致，不回滚
        return;
      }

      // 其他错误（含 5xx/未知）：仅回滚这一卡片
      setMine(cur => {
        // 如果现在列表中已没有，就插回去
        const exists = cur.some(f => f.id === fishId);
        if (exists) return cur;
        // 插回原位置：按原数组顺序重建
        const idx = prev.findIndex(f => f.id === fishId);
        const before = prev.slice(0, idx).filter(f => cur.some(x => x.id === f.id));
        const after = prev.slice(idx).filter(f => cur.some(x => x.id === f.id));
        // 简化：直接在当前列表头插回去也行；这里用更稳妥的方式：
        const restored: MyFish[] = [];
        const setCur = new Set(cur.map(f => f.id));
        for (const f of prev) {
          if (f.id === fishId) restored.push(f);
          else if (setCur.has(f.id)) restored.push(f);
        }
        return restored;
      });
    } catch {
      // 网络异常：只回滚这一卡片
      setMine(cur => {
        const exists = cur.some(f => f.id === fishId);
        if (exists) return cur;
        const restored: MyFish[] = [];
        const setCur = new Set(cur.map(f => f.id));
        for (const f of prev) {
          if (f.id === fishId) restored.push(f);
          else if (setCur.has(f.id)) restored.push(f);
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
  }

  /** 放回池塘：纯乐观；失败仅回滚该卡片；成功后广播 pond:refresh */
  async function releaseFish(fishId: string) {
    if (pendingRelease.has(fishId)) return;

    // —— 乐观：先把卡片从“我的收获”里移除 —— //
    const prev = catches;
    setCatches(prev.filter(c => c.fish_id !== fishId));

    setPendingRelease(s => new Set(s).add(fishId));
    try {
      const res = await fetch('/api/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishId }),
      });

      // 广播池塘/公告刷新（不管结果，先广播；失败时我们会把卡片回滚回来）
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}

      if (res.ok) {
        return; // 成功：保持乐观结果
      }

      let reason = '';
      try { const j = await res.json(); reason = j?.error || ''; } catch {}

      const idempotent =
        res.status === 403 || res.status === 404 || res.status === 409 ||
        ['not_your_catch', 'already_released', 'forbidden_or_not_in_pond', 'not_found'].includes(reason);

      if (idempotent) {
        // 认为最终状态与UI一致，不回滚
        return;
      }

      // 其他错误：仅回滚这个卡片
      setCatches(cur => {
        const exists = cur.some(c => c.fish_id === fishId);
        if (exists) return cur;
        const setCur = new Set(cur.map(c => c.catch_id));
        const restored: MyCatch[] = [];
        for (const c of prev) {
          if (c.fish_id === fishId) restored.push(c);
          else if (setCur.has(c.catch_id)) restored.push(c);
        }
        return restored;
      });
    } catch {
      // 网络异常：回滚此卡片
      setCatches(cur => {
        const exists = cur.some(c => c.fish_id === fishId);
        if (exists) return cur;
        const setCur = new Set(cur.map(c => c.catch_id));
        const restored: MyCatch[] = [];
        for (const c of prev) {
          if (c.fish_id === fishId) restored.push(c);
          else if (setCur.has(c.catch_id)) restored.push(c);
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
