// app/api/stream/route.ts
import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';

// 不参与预渲染 & 不缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 写入一行（SSE 协议格式）
      const send = (payload: string) => {
        controller.enqueue(encoder.encode(payload));
      };

      // 发送注释/心跳（部分代理需要每隔 N 秒有输出）
      const heartbeat = () => send(`: ping\n\n`);

      // 取最近一条 id 作为起点（首次连接不会把历史全推一遍）
      let lastId = 0;
      try {
        const { rows } = await sql/*sql*/`
          SELECT COALESCE(MAX(id), 0) AS mid FROM pond_events
        `;
        lastId = Number(rows?.[0]?.mid || 0);
      } catch {
        // ignore; 从 0 开始
      }

      // 立刻告诉浏览器：这是个 SSE 流
      send(`retry: 3000\n`); // 断线重连等待毫秒
      heartbeat();

      // 轮询增量事件
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
            // SSE event：可以分 topic。这里统一 event 名为 'pond'
            send(`id: ${ev.id}\n`);
            send(`event: pond\n`);
            send(`data: ${JSON.stringify(ev)}\n\n`);
          }
        } catch (e) {
          // 出错也不要断流，交给下一轮重试
          heartbeat();
        }
      };

      const pollTimer = setInterval(poll, POLL_MS);
      const hbTimer = setInterval(heartbeat, 15000);

      // 连接关闭时清理
      const cancel = () => {
        clearInterval(pollTimer);
        clearInterval(hbTimer);
        try { controller.close(); } catch {}
      };

      // @ts-ignore Vercel/Node 会注入 signal
      const signal: AbortSignal | undefined = (globalThis as any)?.__NEXT_PRIVATE_SIGNAL || undefined;
      if (signal) {
        signal.addEventListener('abort', cancel);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // 重要：允许浏览器跨域缓存中间代理关闭压缩
      'X-Accel-Buffering': 'no',
    },
  });
}

