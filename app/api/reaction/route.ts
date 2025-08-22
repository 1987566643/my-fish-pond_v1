// /app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 生成北京时间 4:00~次日 4:00 的 ISO 窗口，用字符串避免把 Date 直接传 SQL */
function bj4WindowISO() {
  const now = new Date();
  const bjNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const start = new Date(bjNow);
  start.setHours(4, 0, 0, 0);
  if (bjNow.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const fishId = String(body.fishId || '');
  const rawVal = Number(body.value);
  if (!fishId || (rawVal !== 1 && rawVal !== -1)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  const value = rawVal as 1 | -1;

  const { startISO, endISO } = bj4WindowISO();

  try {
    // 防呆：鱼存在
    const chk = await sql/*sql*/`SELECT 1 FROM fish WHERE id = ${fishId} LIMIT 1`;
    if (chk.rowCount === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

    // 查今天我对这条鱼的最新一条
    const prev = await sql/*sql*/`
      SELECT value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const prevValue: 1 | -1 | undefined = prev.rows[0]?.value;

    // 幂等：先删掉今天的，再决定是否插入
    await sql/*sql*/`
      DELETE FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
    `;

    let my_vote: 1 | -1 | null = null;
    if (prevValue !== value) {
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      my_vote = value;
    } else {
      my_vote = null; // 取消
    }

    // 全历史聚合（排行榜/总数用）
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = Number(agg.rows[0]?.likes ?? 0);
    const dislikes = Number(agg.rows[0]?.dislikes ?? 0);

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
