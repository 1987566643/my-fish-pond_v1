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
  const [loading, setLoading] = useState(true);

  // 进行中集合，仅用于防抖（不显示提示）
  const [releasing, setReleasing] = useState<Set<string>>(new Set()); // key: fishId
  const [deleting, setDeleting] = useState<Set<string>>(new Set());   // key: fishId

  async function load() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch('/api/mine', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ fish: [] })),
        fetch('/api/my-catches', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ fish: [] })),
      ]);
      setMine((a?.fish ?? []) as MyFish[]);
      setCatches((b?.fish ?? []) as MyCatch[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(); // 只初次加载；不监听 pond:refresh，避免跳动
  }, []);

  /** 删除我的鱼：乐观更新 + 定向让池塘隐藏；失败则静默回源同步 */
  async function deleteMyFish(fishId: string) {
    if (deleting.has(fishId)) return;

    // —— 乐观：本地先移除 —— //
    const prevMine = mine;
    setMine(list => list.filter(f => f.id !== fishId));
    try {
      // 定向让池塘隐藏该鱼（不触发全局刷新）
      try { window.dispatchEvent(new CustomEvent('pond:remove_fish', { detail: { fishId } })); } catch {}

      setDeleting(prev => new Set(prev).add(fishId));
      const res = await fetch(`/api/fish/${fishId}`, { method: 'DELETE' });

      if (!res.ok) {
        // 失败：静默纠偏（重新拉一遍，不弹提示）
        await load();
      }
    } catch {
      // 网络异常也静默纠偏
      await load();
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(fishId); return s; });
    }
  }

  /** 放回池塘：乐观更新 + 广播 pond:refresh；失败则静默回源同步 */
  async function releaseFish(fishId: string) {
    if (releasing.has(fishId)) return;

    // —— 乐观：本地先移除 —— //
    const prevCatches = catches;
    setCatches(list => list.filter(c => c.fish_id !== fishId));
    try {
      setReleasing(prev => new Set(prev).add(fishId));
      const res = await fetch('/api/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishId }),
      });

      // 广播：让池塘与公告栏立即更新（无论结果如何都广播一次，保证体验）
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}

      if (!res.ok) {
        // 失败：静默纠偏（reload 一次）
        await load();
      }
    } catch {
      // 网络异常：静默纠偏
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
      await load();
    } finally {
      setReleasing(prev => { const s = new Set(prev); s.delete(fishId); return s; });
    }
  }

  /** 卡片统一尺寸，按钮对齐到底部 */
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
        {loading && <div className="muted">加载中…</div>}
        {!loading && mine.length === 0 && <div className="muted">暂无</div>}
        {!loading && (
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
                busy={deleting.has(f.id)}
                actions={
                  f.in_pond ? (
                    <button className="ghost" onClick={() => deleteMyFish(f.id)} disabled={deleting.has(f.id)}>
                      {deleting.has(f.id) ? '删除中…' : '🗑 删除'}
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
        {loading && <div className="muted">加载中…</div>}
        {!loading && catches.length === 0 && <div className="muted">暂无</div>}
        {!loading && (
          <Grid>
            {catches.map(c => (
              <Tile
                key={c.catch_id}
                img={c.data_url}
                name={c.name || '无名鱼'}
                meta={`来自 ${c.owner_username || '未知'}${c.caught_at ? ` · ${new Date(c.caught_at).toLocaleString()}` : ''}`}
                busy={releasing.has(c.fish_id)}
                actions={
                  <button className="ghost" onClick={() => releaseFish(c.fish_id)} disabled={releasing.has(c.fish_id)}>
                    {releasing.has(c.fish_id) ? '放回中…' : '🪣 放回池塘'}
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
