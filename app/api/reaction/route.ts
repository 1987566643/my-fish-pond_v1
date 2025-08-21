// /app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 北京时间的“天”以 4:00 为边界：UTC 对应 20:00 前一日 */
function bjDayWindow4() {
  const now = new Date(); // 任意时区都用 UTC 来算边界
  // 今天 UTC 20:00
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    20, 0, 0, 0
  ));
  if (now.getTime() < start.getTime()) {
    // 还没到今天 UTC 20:00，相当于北京时间没过 4 点——退一天
    start.setUTCDate(start.getUTCDate() - 1);
  }
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/**
 * 规则
 * - 用户“当天”(北京4点边界)对同一条鱼只能存在一条投票记录
 * - 再次点同一按钮 => 取消
 * - 点另一边 => 改值
 * - 返回该鱼的累计 likes/dislikes（全历史合计，不按天），以及当前用户当天的 my_vote
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const fishId = String(body?.fishId || body?.id || '');
  const value = Number(body?.value);
  if (!fishId || (value !== 1 && value !== -1)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { startISO, endISO } = bjDayWindow4();

  try {
    // 1) 查今天有没有我对这条鱼的投票
    const existed = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    let myVote: 1 | -1 | null = null;

    if (existed.rows.length === 0) {
      // 没有记录 => 新增
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      myVote = value as 1 | -1;
    } else {
      const row = existed.rows[0] as { id: string; value: number };
      if (row.value === value) {
        // 同按钮 => 取消（删除今天这条）
        await sql/*sql*/`DELETE FROM reactions WHERE id = ${row.id}`;
        myVote = null;
      } else {
        // 另一边 => 改值，并刷新时间戳
        await sql/*sql*/`
          UPDATE reactions
          SET value = ${value}, created_at = NOW()
          WHERE id = ${row.id}
        `;
        myVote = value as 1 | -1;
      }
    }

    // 2) 统计全历史 likes/dislikes（方便排行榜）
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value =-1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = (agg.rows[0] as any).likes as number;
    const dislikes = (agg.rows[0] as any).dislikes as number;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote: myVote });
  } catch (e) {
    // 打日志方便排查
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
