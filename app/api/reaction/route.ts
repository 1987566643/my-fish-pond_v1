import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 计算「北京时间 4:00」为边界的当日窗口（返回 UTC ISO）
function bj4Window() {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600_000);
  const day4 = new Date(bj.getFullYear(), bj.getMonth(), bj.getDate(), 4, 0, 0, 0);
  const startBJ = bj.getTime() < day4.getTime() ? new Date(day4.getTime() - 24 * 3600_000) : day4;
  const endBJ = new Date(startBJ.getTime() + 24 * 3600_000);
  // 转回 UTC
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
  const value: 1 | -1 = body.value === 1 ? 1 : body.value === -1 ? -1 : 0;
  if (!fishId || !value) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const { startISO, endISO } = bj4Window();

  try {
    // 1) 取“今天我对这条鱼”的最新记录
    const latest = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const row = latest.rows?.[0] as { id?: string; value?: number } | undefined;

    if (row && row.value === value) {
      // 再点一次同值 = 取消（删除最新这一条）
      await sql/*sql*/`DELETE FROM reactions WHERE id = ${row.id}`;
    } else {
      // 没点过 或 改主意 → 插入一条新记录
      await sql/*sql*/`
        INSERT INTO reactions (fish_id, user_id, value)
        VALUES (${fishId}, ${session.id}, ${value})
      `;
    }

    // 2) 聚合总赞/踩（全历史）
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END),0)::int AS likes,
        COALESCE(SUM(CASE WHEN value =-1 THEN 1 ELSE 0 END),0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = Number(agg.rows?.[0]?.likes ?? 0);
    const dislikes = Number(agg.rows?.[0]?.dislikes ?? 0);

    // 3) 取“今天我对这条鱼”的最新值作为 my_vote（可能为 null）
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
