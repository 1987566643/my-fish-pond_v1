'use client';

import { useEffect, useState } from 'react';

type MyFish = {
  id: string;
  name: string;
  data_url: string;
  w: number;
  h: number;
  in_pond?: boolean;
  created_at?: string;
};

type MyCatch = {
  catch_id: string;
  fish_id: string;
  name: string;
  data_url: string;
  w: number;
  h: number;
  caught_at?: string;
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
    setMine((a && a.fish) ? a.fish : []);
    setCatches((b && b.fish) ? b.fish : []);
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
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>{props.title}</h2>
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
    img: string; name: string; meta?: string; actions?: React.ReactNode;
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
        <img
          src={props.img}
          alt={props.name}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'contain', imageRendering: 'auto'
          }}
        />
      </div>
      <div style={{ padding: 10, display: 'grid', gap: 6 }}>
        <div style={{ fontWeight: 600 }}>{props.name}</div>
        {props.meta && <div className="muted" style={{ fontSize: 12 }}>{props.meta}</div>}
        {props.actions && <div style={{ display: 'flex', gap: 8 }}>{props.actions}</div>}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ margin: '6px 0 14px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span className="muted">我画的鱼：{mine.length} 条</span>
        <span className="muted">我的收获：{catches.length} 条</span>
      </div>

      {loading && <div className="muted">加载中…</div>}

      {!loading && (
        <>
          <Card title="我画的鱼">
            {mine.length === 0 && <div className="muted">暂无</div>}
            {mine.map(f => (
              <Tile
                key={f.id}
                img={f.data_url}
                name={f.name || '无名鱼'}
                meta={typeof f.in_pond === 'boolean' ? (f.in_pond ? '状态：池塘中' : '状态：已被钓走') : undefined}
                actions={
                  f.in_pond ? (
                    <button className="ghost" onClick={() => deleteMyFish(f.id)}>🗑 删除</button>
                  ) : null
                }
              />
            ))}
          </Card>

          <Card title="我的收获">
            {catches.length === 0 && <div className="muted">暂无</div>}
            {catches.map(c => (
              <Tile
                key={c.catch_id}
                img={c.data_url}
                name={c.name || '无名鱼'}
                meta={c.caught_at ? `钓到时间：${new Date(c.caught_at).toLocaleString()}` : undefined}
                actions={
                  <button className="ghost" onClick={() => releaseFish(c.fish_id)}>🪣 放回池塘</button>
                }
              />
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
