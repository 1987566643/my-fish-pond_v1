import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 北京时间 4 点窗口
function beijing4Window() {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600_000);
  const boundary = new Date(bj.getFullYear(), bj.getMonth(), bj.getDate(), 4, 0, 0, 0);
  const startBJ = bj.getTime() < boundary.getTime()
    ? new Date(boundary.getTime() - 24 * 3600_000)
    : boundary;
  const endBJ = new Date(startBJ.getTime() + 24 * 3600_000);
  return {
    startISO: new Date(startBJ.getTime() - 8 * 3600_000).toISOString(),
    endISO:   new Date(endBJ.getTime() - 8 * 3600_000).toISOString(),
  };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fishId = String(body.fishId || '');
  const value  = Number(body.value);

  if (!fishId || !(value === 1 || value === -1)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const { startISO, endISO } = beijing4Window();

  try {
    // 1) 查今天我对这条鱼的“最新一条”记录
    const cur = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const latest = cur.rows?.[0] as { id?: string; value?: number } | undefined;

    if (latest && latest.value === value) {
      // 1.a 再点一次同样的：= 取消（删除那条最新记录）
      await sql/*sql*/`
        DELETE FROM reactions
        WHERE id = ${latest.id}
      `;
    } else {
      // 1.b 没点过 / 点了相反的：插入一条新记录
      await sql/*sql*/`
        INSERT INTO reactions (fish_id, user_id, value)
        VALUES (${fishId}, ${session.id}, ${value})
      `;
    }

    // 2) 重新计算该鱼总赞/踩
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END),0)::int AS likes,
        COALESCE(SUM(CASE WHEN value =-1 THEN 1 ELSE 0 END),0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = Number(agg.rows?.[0]?.likes ?? 0);
    const dislikes = Number(agg.rows?.[0]?.dislikes ?? 0);

    // 3) 再查一次我当天对这条鱼的“最新状态”作为 my_vote
    const me = await sql/*sql*/`
      SELECT value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const my_vote: 1 | -1 | null =
      me.rows?.[0]?.value === 1 ? 1 :
      me.rows?.[0]?.value === -1 ? -1 : null;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
