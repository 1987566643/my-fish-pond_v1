'use client';

import useSWR from 'swr';
import { useEffect } from 'react';

type MyDrawn = {
  id: string;            // UUID
  name: string;
  data_url: string;
  in_pond: boolean;
  caught: boolean;       // 是否已被钓走（由 LEFT JOIN 判断）
};

type MyCatch = {
  catch_id: string;      // UUID
  fish_id: string;       // UUID
  name: string;
  data_url: string;
  owner_id: string;      // UUID
};

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function MinePage() {
  const { data, mutate, isLoading } = useSWR<{ myDrawn: MyDrawn[]; myCatch: MyCatch[] }>(
    '/api/mine/fishes',
    fetcher,
    { revalidateOnFocus: true }
  );

  // 监听全局事件以与池塘/公告栏联动
  useEffect(() => {
    const onRefresh = () => mutate();
    window.addEventListener('pond:refresh', onRefresh as any);
    window.addEventListener('board:refresh', onRefresh as any);
    return () => {
      window.removeEventListener('pond:refresh', onRefresh as any);
      window.removeEventListener('board:refresh', onRefresh as any);
    };
  }, [mutate]);

  if (isLoading || !data) {
    return <div className="p-4 text-sm opacity-70">加载中…</div>;
  }

  // 删除“我画的鱼”（仅允许在池塘且未被钓走）
  async function handleDeleteFish(fishId: string) {
    const prev = data;
    const next = { ...data, myDrawn: data.myDrawn.filter(f => f.id !== fishId) };
    mutate(next, { revalidate: false });

    const res = await fetch(`/api/mine/my-fish/${fishId}`, { method: 'DELETE' });
    if (!res.ok) {
      mutate(prev, { revalidate: false });
      const err = await res.json().catch(() => ({}));
      alert(`删除失败：${err.error || res.status}`);
      return;
    }
    try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
    try { window.dispatchEvent(new CustomEvent('board:refresh')); } catch {}
    mutate();
  }

  // 放回“我的收获”
  async function handleReturnCatch(catchId: string) {
    const prev = data;
    const next = { ...data, myCatch: data.myCatch.filter(c => c.catch_id !== catchId) };
    mutate(next, { revalidate: false });

    const res = await fetch('/api/mine/catch/return', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catchId }),
    });
    if (!res.ok) {
      mutate(prev, { revalidate: false });
      const err = await res.json().catch(() => ({}));
      alert(`放回失败：${err.error || res.status}`);
      return;
    }
    try { window.dispatchEvent(new CustomEvent('pond:refresh')); } catch {}
    try { window.dispatchEvent(new CustomEvent('board:refresh')); } catch {}
    mutate();
  }

  return (
    <div className="p-4 space-y-8">
      {/* 我画的鱼 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">我画的鱼</h2>
        {data.myDrawn.length === 0 ? (
          <div className="text-sm opacity-60">还没有画的鱼。</div>
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.myDrawn.map(f => {
              const canDelete = f.in_pond && !f.caught;
              return (
                <li key={f.id} className="rounded-2xl shadow p-2 bg-white/80 dark:bg-neutral-800/60">
                  <div className="aspect-square overflow-hidden rounded-xl bg-black/5">
                    <img src={f.data_url} alt={f.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="opacity-70">
                      {f.caught ? '已被钓走' : (f.in_pond ? '池塘中' : '不在池塘')}
                    </span>
                    <button
                      onClick={() => canDelete && handleDeleteFish(f.id)}
                      disabled={!canDelete}
                      className={`px-2 py-1 rounded-lg border text-[11px] ${
                        canDelete ? 'hover:bg-red-50 hover:border-red-300' : 'opacity-40 cursor-not-allowed'
                      }`}
                      title={canDelete ? '删除这条鱼' : '已被钓走或不在池塘，不能删除'}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 我的收获 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">我的收获</h2>
        {data.myCatch.length === 0 ? (
          <div className="text-sm opacity-60">暂无收获。</div>
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.myCatch.map(c => (
              <li key={c.catch_id} className="rounded-2xl shadow p-2 bg-white/80 dark:bg-neutral-800/60">
                <div className="aspect-square overflow-hidden rounded-xl bg-black/5">
                  <img src={c.data_url} alt={c.name} className="w-full h-full object-cover" />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="opacity-70">{c.name}</span>
                  <button
                    onClick={() => handleReturnCatch(c.catch_id)}
                    className="px-2 py-1 rounded-lg border text-[11px] hover:bg-emerald-50 hover:border-emerald-300"
                    title="放回池塘"
                  >
                    放回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
