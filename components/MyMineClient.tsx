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
  angler_username?: string | null;   // ← 新增：最近一次钓走者
  caught_at?: string | null;         // ← 新增：最近一次被钓走时间
};

type MyCatch = {
  catch_id: string;
  fish_id: string;
  name: string;
  owner_username?: string | null;    // ← 新增：鱼原主人
  data_url: string;
  w: number;
  h: number;
  caught_at?: string | null;
};

export default function MyMineClient() {
  const [mine, setMine] = useState<MyFish[]>([]);
  const [catches, setCatches] = useState<MyCatch[]>([]);
  const [loading, setLoading] = useState(true);

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
    const res = await fetch(`/api/fish/${fishId}`, { method: 'DELETE' });
    if (res.ok) {
      setMine(list => list.filter(f => f.id !== fishId));
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
    } else {
      const j = await res.json().catch(() => ({} as any));
      alert(j?.error || '删除失败');
    }
  }

  async function releaseFish(fishId: string) {
    if (!confirm('确定把这条鱼放回池塘？')) return;
    const res = await fetch('/api/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fishId }),
    });
    if (res.ok) {
      setCatches(list => list.filter(c => c.fish_id !== fishId));
      try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
    } else {
      const j = await res.json().catch(() => ({} as any));
      alert(j?.error || '放回失败');
    }
  }

  const Card = (props: { title: string; children: React.ReactNode }) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: 16, margin: 0 }}>{props.title}</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {props.children}
      </div>
    </section>
  );

  const Tile = (props: {
    img?: string; name: string; meta?: string; actions?: React.ReactNode;
  }) => (
    <div
      style={{
        border: '1px solid rgba(255,255,255,.12)',
        background: 'rgba(255,255,255,.04)',
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ position: 'relative', paddingTop: '60%', background: '#0b1a23' }}>
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
      <div style={{ padding: 10, display: 'grid', gap: 6 }}>
        <div style={{ fontWeight: 600 }}>{props.name || '无名鱼'}</div>
        {props.meta && <div className="muted" style={{ fontSize: 12 }}>{props.meta}</div>}
        {props.actions && <div style={{ display: 'flex', gap: 8 }}>{props.actions}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {/* 左：我画的鱼 */}
      <Card title={`我画的鱼（${mine.length}）`}>
        {loading && <div className="muted">加载中…</div>}
        {!loading && mine.length === 0 && <div className="muted">暂无</div>}
        {!loading && mine.map(f => (
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
      </Card>

      {/* 右：我的收获 */}
      <Card title={`我的收获（${catches.length}）`}>
        {loading && <div className="muted">加载中…</div>}
        {!loading && catches.length === 0 && <div className="muted">暂无</div>}
        {!loading && catches.map(c => (
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
      </Card>
    </div>
  );
}
