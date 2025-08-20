// app/api/stream/route.ts
import { sql } from '../../../lib/db';

// 不参与预渲染 & 不缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (s: string) => controller.enqueue(enc.encode(s));
      const heartbeat = () => send(`: ping\n\n`);

      // 以当前最大 id 作为起点，避免首次把历史全量推给客户端
      let lastId = 0;
      try {
        const { rows } = await sql/*sql*/`SELECT COALESCE(MAX(id), 0) AS mid FROM pond_events`;
        lastId = Number(rows?.[0]?.mid || 0);
      } catch {
        lastId = 0;
      }

      // 告诉浏览器：断线 3s 后重连
      send(`retry: 3000\n`);
      heartbeat();

      const POLL_MS = 2000; // 2 秒一轮
      const poll = async () => {
        try {
          const { rows } = await sql/*sql*/`
            SELECT
              id, type, created_at,
              actor_id, target_fish_id, target_owner_id,
              fish_name, owner_username, actor_username
            FROM pond_events
            WHERE id > ${lastId}
            ORDER BY id ASC
            LIMIT 100
          `;
          for (const ev of rows) {
            lastId = Math.max(lastId, Number(ev.id));
            send(`id: ${ev.id}\n`);
            send(`event: pond\n`);
            send(`data: ${JSON.stringify(ev)}\n\n`);
          }
        } catch {
          // 出错也不断流，下一轮继续
          heartbeat();
        }
      };

      const pollTimer = setInterval(poll, POLL_MS);
      const hbTimer = setInterval(heartbeat, 15000);

      // 连接关闭时清理
      const cleanup = () => {
        clearInterval(pollTimer);
        clearInterval(hbTimer);
        try { controller.close(); } catch {}
      };

      // 兼容 Next 的中止信号
      // @ts-ignore
      const signal: AbortSignal | undefined = (globalThis as any)?.__NEXT_PRIVATE_SIGNAL || undefined;
      if (signal) signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });

}
