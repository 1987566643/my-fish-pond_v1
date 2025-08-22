// /app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 计算“北京时间 4:00”为日界，返回 ISO（UTC）字符串，避免把 Date 直接传 SQL */
function bj4WindowISO() {
  const now = new Date();
  // 用北京时区时间来确定当天 4:00
  const bjNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const start = new Date(bjNow);
  start.setHours(4, 0, 0, 0);
  if (bjNow.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const fishId = String(body.fishId || '');
  const rawVal = Number(body.value);
  if (!fishId || (rawVal !== 1 && rawVal !== -1)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  const value = rawVal as 1 | -1;

  const { startISO, endISO } = bj4WindowISO();

  try {
    // 可选校验：鱼是否存在（不改钓鱼逻辑，只是防呆）
    const chk = await sql/*sql*/`
      SELECT 1 FROM fish WHERE id = ${fishId} LIMIT 1
    `;
    if (chk.rowCount === 0) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    // 找到“今天我对这条鱼”的上一条记录（注意：不选 id，避免你表没有该列）
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

    // 先删掉今天该用户对这条鱼的记录 → 保证“每天最多一条”（幂等）
    await sql/*sql*/`
      DELETE FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
    `;

    // 如果和上次相同 → 本次是“取消”，不插入；否则插入新选择
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

    // 汇总整条鱼的总点赞/点踩（全历史，用于排行榜）
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
    // 控制台能看到具体 SQL 报错，前端拿到 500
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
