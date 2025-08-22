// /app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 计算“北京时间 4:00”为界的一天窗口，返回 ISO 字符串（UTC） */
function bj4WindowISO() {
  const now = new Date();
  // 用北京时区来计算当天 4:00
  const bjNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const start = new Date(bjNow);
  start.setHours(4, 0, 0, 0);
  if (bjNow.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // 转成 ISO 字符串传给数据库
  const startISO = start.toISOString();
  const endISO = end.toISOString();
  return { startISO, endISO };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const fishId = String(body.fishId || '');
  const v = Number(body.value);
  if (!fishId || (v !== 1 && v !== -1)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  const value = v as 1 | -1;

  const { startISO, endISO } = bj4WindowISO();

  try {
    // 可选：校验鱼是否存在
    const chk = await sql/*sql*/`
      SELECT id FROM fish WHERE id = ${fishId} LIMIT 1
    `;
    if (chk.rowCount === 0) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    // 查出今天是否已有一条该用户对该鱼的投票
    const prev = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const prevRow = prev.rows[0] as { id: string; value: 1 | -1 } | undefined;

    // 先删，确保“每天最多一条”幂等
    await sql/*sql*/`
      DELETE FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
    `;

    // 如果和上一次相同 → 本次点击视为“取消”（不插入）
    // 如果不同或之前没有 → 插入新的这条
    let my_vote: 1 | -1 | null = null;
    if (!prevRow || prevRow.value !== value) {
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      my_vote = value;
    } else {
      my_vote = null; // 取消
    }

    // 聚合全时段的 likes/dislikes（便于做排行榜）
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
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
