// /app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 北京时间 4:00 为“当天”边界（转成 UTC 20:00） */
function bjDayWindow4() {
  const now = new Date();
  // 今日 UTC 20:00
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    20, 0, 0, 0
  ));
  if (now.getTime() < start.getTime()) {
    // 还没到 UTC20:00（北京时间 <4:00），往前一天
    start.setUTCDate(start.getUTCDate() - 1);
  }
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/**
 * 交互规则（不依赖 reactions.id）：
 * - 当天（北京 4 点边界）同一用户对同一条鱼最多保留 1 条记录
 * - 再点同一边 => 取消（删当日最新一条）
 * - 点另一边 => 改值（把当日最新一条的 value 改掉，并更新 created_at=now()）
 * - 返回累计 likes/dislikes（全历史）+ 我当天的 my_vote
 *
 * reactions 表假定结构（没有 id 也可）：
 *   user_id UUID, fish_id UUID, value INT CHECK (value IN (-1,1)), created_at TIMESTAMPTZ DEFAULT now()
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }

  const fishId = String(body?.fishId || body?.id || '');
  const value = Number(body?.value);
  if (!fishId || (value !== 1 && value !== -1)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { startISO, endISO } = bjDayWindow4();

  try {
    // 1) 查“今天”的最新一条记录（不用 id）
    const existed = await sql/*sql*/`
      SELECT value, created_at
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
      // 没有 => 新增
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      myVote = value as 1 | -1;
    } else {
      const cur = (existed.rows[0] as any).value as number;
      if (cur === value) {
        // 同按钮 => 删除“今天”最新一条（用 ctid 精确定位）
        await sql/*sql*/`
          WITH target AS (
            SELECT ctid
            FROM reactions
            WHERE user_id = ${session.id}
              AND fish_id = ${fishId}
              AND created_at >= ${startISO}
              AND created_at <  ${endISO}
            ORDER BY created_at DESC
            LIMIT 1
          )
          DELETE FROM reactions r
          USING target
          WHERE r.ctid = target.ctid
        `;
        myVote = null;
      } else {
        // 另一边 => 更新“今天”最新一条的 value（同样用 ctid）
        await sql/*sql*/`
          WITH target AS (
            SELECT ctid
            FROM reactions
            WHERE user_id = ${session.id}
              AND fish_id = ${fishId}
              AND created_at >= ${startISO}
              AND created_at <  ${endISO}
            ORDER BY created_at DESC
            LIMIT 1
          )
          UPDATE reactions r
          SET value = ${value}, created_at = NOW()
          FROM target
          WHERE r.ctid = target.ctid
        `;
        myVote = value as 1 | -1;
      }
    }

    // 2) 聚合全历史点赞点踩
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
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
