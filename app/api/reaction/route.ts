import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 北京时间 4:00 当天窗口（返回 UTC ISO） */
function bj4Window() {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600_000);
  const four = new Date(bj.getFullYear(), bj.getMonth(), bj.getDate(), 4, 0, 0, 0);
  const startBJ = bj.getTime() < four.getTime() ? new Date(four.getTime() - 86400_000) : four;
  const endBJ = new Date(startBJ.getTime() + 86400_000);
  return {
    startISO: new Date(startBJ.getTime() - 8 * 3600_000).toISOString(),
    endISO: new Date(endBJ.getTime() - 8 * 3600_000).toISOString(),
  };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 兼容前端 value 为字符串
  const body = await req.json().catch(() => ({} as any));
  const fishId = String(body?.fishId || '');
  const vNum = Number(body?.value);

  let value: 1 | -1;
  if (vNum === 1) value = 1;
  else if (vNum === -1) value = -1;
  else return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  if (!fishId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const { startISO, endISO } = bj4Window();

  try {
    // —— 查我今天对这条鱼最新一票 —— //
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
    const prev = latest.rows?.[0] as { id?: string; value?: number } | undefined;

    // —— 同值 => 取消（删除最新一条）；否则追加新记录 —— //
    if (prev && prev.value === value) {
      if (prev.id) {
        await sql/*sql*/`DELETE FROM reactions WHERE id = ${prev.id}`;
      }
    } else {
      await sql/*sql*/`
        INSERT INTO reactions (fish_id, user_id, value)
        VALUES (${fishId}, ${session.id}, ${value})
      `;
    }

    // —— 聚合总赞/踩（全历史） —— //
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END),0)::int AS likes,
        COALESCE(SUM(CASE WHEN value =-1 THEN 1 ELSE 0 END),0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = Number(agg.rows?.[0]?.likes ?? 0);
    const dislikes = Number(agg.rows?.[0]?.dislikes ?? 0);

    // —— 回传今天我的最新投票（用于按钮状态与“取消××”提示） —— //
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
      me.rows?.[0]?.value === 1 ? 1 : me.rows?.[0]?.value === -1 ? -1 : null;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    // 保持返回结构，避免前端崩溃
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
