'use client';

import { useEffect, useRef, useState } from 'react';

type EventItem = {
  id?: number | string;
  type: 'ADD' | 'CATCH' | 'RELEASE' | 'DELETE' | string;
  created_at: string;
  // 兼容两套字段名
  actor_name?: string | null;
  target_owner_name?: string | null;
  fish_name?: string | null;

  actor_username?: string | null;
  owner_username?: string | null;
};

const LIMIT = 60;

export default function Announcements() {
  const [items, setItems] = useState<EventItem[]>([]);
  const fetchingRef = useRef(false);

  async function loadOnce() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch(`/api/events?limit=${LIMIT}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const list: EventItem[] = json?.events ?? [];
      // 保序：后端已按时间降序，这里再截断一次
      setItems(list.slice(0, LIMIT));
    } catch {
      // 静默失败
    } finally {
      fetchingRef.current = false;
    }
  }

  useEffect(() => {
    let disposed = false;
    let debounceTimer: any = null;

    // 首次加载
    loadOnce();

    // SSE：收到任何池塘事件都“轻量刷新”一次
    const es = new EventSource('/api/stream');
    const onPond = () => {
      if (disposed) return;
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        loadOnce();
      }, 120);
    };
    es.addEventListener('pond', onPond);
    es.onerror = () => {
      // 交给浏览器自动重连；这里不处理
    };

    // 兜底轮询：防止代理断流或本地休眠错过事件
    const poll = setInterval(() => loadOnce(), 15000);

    return () => {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(poll);
      es.close();
    };
  }, []);

  // 字段兼容 + 中文文案
  const renderLine = (ev: EventItem) => {
    const actor =
      ev.actor_name ??
      ev.actor_username ??
      '某人';
    const owner =
      ev.target_owner_name ??
      ev.owner_username ??
      '某人';
    const fish = ev.fish_name ?? '无名鱼';

    switch (ev.type) {
      case 'ADD':
        return (
          <>
            📢 <strong>{actor}</strong> 放入了「{fish}」
          </>
        );
      case 'CATCH':
        return (
          <>
            🎣 <strong>{actor}</strong> 钓走了 <strong>{owner}</strong> 的「{fish}」
          </>
        );
      case 'RELEASE':
        return (
          <>
            🪣 <strong>{actor}</strong> 放回了「{fish}」
          </>
        );
      case 'DELETE':
        return (
          <>
            🗑️ <strong>{actor}</strong> 删除了「{fish}」
          </>
        );
      default:
        return (
          <>
            📌 <strong>{actor}</strong> 有一条动态：「{fish}」
          </>
        );
    }
  };

  return (
    <div>
      <h3 style={{ margin: '8px 0' }}>公告栏</h3>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gap: 8,
        }}
      >
        {items.map((ev, i) => (
          <li key={String(ev.id ?? i)} className="muted">
            {renderLine(ev)}
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
