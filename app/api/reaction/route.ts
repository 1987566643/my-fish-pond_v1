import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** —— 计算北京时间 4:00 边界（UTC ISO） —— */
function beijing4amBoundsISO() {
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 3600_000);
  const y = bjNow.getUTCFullYear();
  const m = bjNow.getUTCMonth();
  const d = bjNow.getUTCDate();
  let startBj = new Date(Date.UTC(y, m, d, 4, 0, 0, 0));
  if (bjNow.getUTCHours() < 4) startBj = new Date(startBj.getTime() - 24 * 3600_000);
  const startUtc = new Date(startBj.getTime() - 8 * 3600_000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600_000);
  return { startISO: startUtc.toISOString(), endISO: endUtc.toISOString() };
}

/** 点赞/点踩：再次点击相同值 => 取消；不同值 => 切换。返回聚合计数与 my_vote。 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId, value } = await req.json();
  if (!fishId || !(value === 1 || value === -1)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { startISO, endISO } = beijing4amBoundsISO();

  try {
    // 1) 取出今天我对这条鱼的最后一次
    const { rows: prevRows } = await sql/*sql*/`
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

    if (prevRows.length && prevRows[0].value === value) {
      // 2a) 与本次相同 => 取消（删除本条最新记录即可）
      await sql/*sql*/`DELETE FROM reactions WHERE id = ${prevRows[0].id}`;
      myVote = null;
    } else {
      // 2b) 不相同 => 插入新记录
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      myVote = value;
    }

    // 3) 返回聚合后的总计数 + 我今天的投票
    const { rows: agg } = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END),0)::int AS likes,
        COALESCE(SUM(CASE WHEN value =-1 THEN 1 ELSE 0 END),0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = Number(agg[0]?.likes ?? 0);
    const dislikes = Number(agg[0]?.dislikes ?? 0);

    return NextResponse.json({ ok: true, likes, dislikes, my_vote: myVote });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
