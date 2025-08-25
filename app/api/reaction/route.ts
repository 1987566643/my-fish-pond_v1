// /app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 北京时间 4:00 为日界，返回今天 day_key（字符串） */
function bj4DayKey(date = new Date()): string {
  // 取北京本地时间（UTC+8），往回挪 4 小时，再取“本地日”
  const utc = date.getTime();
  // 把 UTC 转北京：+8h，然后再 -4h = +4h
  const bjLike = new Date(utc + 4 * 3600_000);
  const y = bjLike.getUTCFullYear();
  const m = bjLike.getUTCMonth() + 1;
  const d = bjLike.getUTCDate();
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${y}${pad(m)}${pad(d)}`;
}

/**
 * 点赞/点踩（当天唯一；可取消/改主意）
 * - value: 1 / -1 / 0（0=取消）
 * - reactions 主键/唯一：(fish_id, user_id, day_key)
 * - likes/dislikes = 全表聚合（历史累计）
 * - my_vote = 我今天的值
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fishId = String(body.fishId || '');
  const raw = Number(body.value);
  // 允许 0 代表取消
  const value = raw === 1 ? 1 : raw === -1 ? -1 : 0;

  if (!fishId || !Number.isFinite(value)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const dayKey = bj4DayKey();

  try {
    // 当天 upsert：有则改 value / 没有则插入
    await sql/*sql*/`
      INSERT INTO reactions (fish_id, user_id, day_key, value, created_at)
      VALUES (${fishId}, ${session.id}, ${dayKey}, ${value}, NOW())
      ON CONFLICT (fish_id, user_id, day_key)
      DO UPDATE SET
        value = EXCLUDED.value,
        created_at = NOW()
    `;

    // 总计数（历史累计）
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1  THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;

    // 我今天的状态
    const mine = await sql/*sql*/`
      SELECT value
      FROM reactions
      WHERE fish_id = ${fishId} AND user_id = ${session.id} AND day_key = ${dayKey}
      LIMIT 1
    `;

    const likes = Number(agg.rows?.[0]?.likes ?? 0);
    const dislikes = Number(agg.rows?.[0]?.dislikes ?? 0);
    const my_vote_raw = Number(mine.rows?.[0]?.value ?? 0);
    const my_vote: 1 | -1 | null =
      my_vote_raw === 1 ? 1 : my_vote_raw === -1 ? -1 : null;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
