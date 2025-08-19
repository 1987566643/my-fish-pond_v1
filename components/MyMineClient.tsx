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

/** 轻量 Toast */
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 1600);
    return () => clearTimeout(t);
  }, [msg]);
  const Toast = msg ? (
    <div
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        zIndex: 5000,
        background: 'rgba(0,0,0,.82)',
        color: '#fff',
        padding: '10px 14px',
        borderRadius: 10,
        boxShadow: '0 8px 22px rgba(0,0,0,.35)',
        fontSize: 14,
      }}
    >
      {msg}
    </div>
  ) : null;
  return { Toast, show: (m: string) => setMsg(m) };
}

export default function MyMineClient() {
  const [mine, setMine] = useState<MyFish[]>([]);
  const [catches, setCatches] = useState<MyCatch[]>([]);
  const [loading, setLoading] = useState(true);
  const { Toast, show } = useToast();

  async function load() {
    setLoading(true);
    const [a, b] = await Promise.all([
      fetch('/api/mine', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ fish: [] })),
      fetch('/api/my-catches', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ fish: [] })),
    ]);
    setMine((a?.fish ?? []) as MyFish[]);
    setCatches((b?.fish ?? []) as MyCatch[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener('pond:refresh', onRefresh);
    return () => window.removeEventListener('pond:refresh', onRefresh);
  }, []);

  async function deleteMyFish(fishId: string) {
    if (!confirm('确定删除这条还在池塘里的鱼吗？删除后不可恢复。')) return;
    // 乐观更新
    setMine(list => list.filter(f => f.id !== fishId));
    try {
      const res = await fetch(`/api/fish/${fishId}`, { method: 'DELETE' });
      if (!res.ok) {
        // 回滚
        await load();
        const j = await res.json().catch(() => ({} as any));
        show(j?.error === 'forbidden_or_not_in_pond' ? '无法删除：这条鱼不在池塘或不属于你' : '删除失败，请稍后重试');
        return;
      }
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
      show('已删除这条鱼');
    } catch {
      await load();
      show('网络异常，删除失败');
    }
  }

  async function releaseFish(fishId: string) {
    // 乐观更新：先从“我的收获”移除
    setCatches(list => list.filter(c => c.fish_id !== fishId));
    try {
      const res = await fetch('/api/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishId }),
      });
      if (!res.ok) {
        // 回滚
        await load();
        const j = await res.json().catch(() => ({} as any));
        show(j?.error === 'not_your_catch' ? '这条鱼不是你的收获，不能放回' : '放回失败，请稍后重试');
        return;
      }
      show('已放回池塘');
      // 通知池塘 & 公告栏刷新
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
      // 轻量校准一次
      setTimeout(() => { load(); }, 300);
    } catch {
      await load();
      show('网络异常，放回失败');
    }
  }

  /** 公共卡片容器（等高） */
  const TILE_HEIGHT = 280;      // 统一卡片高度
  const PREVIEW_HEIGHT = 130;   // 统一预览区高度

  const Tile = (props: {
    img?: string;
    name: string;
    meta?: string;
    actions?: React.ReactNode;
  }) => (
    <div
      style={{
        border: '1px solid rgba(255,255,255,.12)',
        background: 'rgba(255,255,255,.04)',
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: TILE_HEIGHT,            // 等高
      }}
    >
      <div style={{ position: 'relative', height: PREVIEW_HEIGHT, background: '#0b1a23' }}>
        {props.img ? (
          <img
            src={props.img}
            alt={props.name}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'contain', imageRendering: 'auto'
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
              color: '#88a', fontSize: 12
            }}
          >
            无缩略图
          </div>
        )}
      </div>

      {/* 文本 + 操作按钮区：用 flex 推到底部，保证按钮齐平 */}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ fontWeight: 600, lineHeight: 1.2, wordBreak: 'break-word' }}>
          {props.name || '无名鱼'}
        </div>
        {props.meta && <div className="muted" style={{ fontSize: 12, lineHeight: 1.3 }}>{props.meta}</div>}
        <div style={{ marginTop: 'auto' }}>
          {props.actions && (
            <div style={{ display: 'flex', gap: 8 }}>
              {props.actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /** 两列独立滚动：每列设置 maxHeight + overflowY:auto */
  const columnStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxHeight: 'calc(100vh - 180px)',
    overflowY: 'auto',
    paddingRight: 4, // 给滚动留点右侧空间
  };

  const Grid = (props: { children: React.ReactNode }) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 12,
      }}
    >
      {props.children}
    </div>
  );

  return (
    <>
      {Toast}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
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
                  actions={
                    f.in_pond ? (
                      <button className="ghost" onClick={() => deleteMyFish(f.id)}>🗑 删除</button>
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
                  actions={
                    <button className="ghost" onClick={() => releaseFish(c.fish_id)}>🪣 放回池塘</button>
                  }
                />
              ))}
            </Grid>
          )}
        </section>
      </div>
    </>
  );
}
