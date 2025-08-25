import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 北京时间 4 点为一天边界，生成 day_key（如 20250825）
function bj4DayKey(): string {
  const now = new Date();
  // 北京 UTC+8
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  // 当天 04:00
  const dayStart = new Date(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), 4, 0, 0);
  // 如果当前（北京时间）在 0:00-3:59 之间，属于“前一天”
  if (bj.getUTCHours() < 4) {
    dayStart.setDate(dayStart.getDate() - 1);
  }
  // 格式化 YYYYMMDD
  const y = dayStart.getFullYear();
  const m = String(dayStart.getMonth() + 1).padStart(2, '0');
  const d = String(dayStart.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fishId = String(body.fishId || '');
  const incoming: 1 | -1 | 0 =
    body.value === 1 ? 1 : body.value === -1 ? -1 : 0; // 我们允许 0（取消），但前端通常传 1/-1

  if (!fishId || (incoming !== 1 && incoming !== -1)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  try {
    const dayKey = bj4DayKey();

    // 查当前是否已有记录（注意：你的 reactions 主键是 (fish_id, user_id)）
    const { rows: existRows } = await sql/*sql*/`
      SELECT fish_id, user_id, value, day_key
      FROM reactions
      WHERE fish_id = ${fishId} AND user_id = ${session.id}
      LIMIT 1
    `;

    if (existRows.length === 0) {
      // 没有就插入（第一次对这条鱼投票）
      await sql/*sql*/`
        INSERT INTO reactions (fish_id, user_id, value, day_key, created_at)
        VALUES (${fishId}, ${session.id}, ${incoming}, ${dayKey}, NOW())
      `;
    } else {
      const cur = existRows[0] as { value: number | null; day_key: string | null };
      const curValue = typeof cur.value === 'number' ? cur.value : 0;
      const curDayKey = cur.day_key || '';

      // 同一天：再次点相同按钮 = 取消（置 0），否则切换成新值
      // 跨天：直接覆盖为新值，并把 day_key 写成今天
      let nextValue = incoming as 0 | 1 | -1;
      if (curDayKey === dayKey) {
        if (curValue === incoming) {
          nextValue = 0; // 取消
        }
      }
      await sql/*sql*/`
        UPDATE reactions
        SET value = ${nextValue}, day_key = ${dayKey}, created_at = NOW()
        WHERE fish_id = ${fishId} AND user_id = ${session.id}
      `;
    }

    // 重新统计该鱼的 likes/dislikes（基于当前 reactions 快照）
    const { rows: agg } = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1  THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;

    const likes = Number(agg?.[0]?.likes ?? 0);
    const dislikes = Number(agg?.[0]?.dislikes ?? 0);

    // 返回我当前这次操作后的 my_vote
    const { rows: mine } = await sql/*sql*/`
      SELECT value FROM reactions WHERE fish_id = ${fishId} AND user_id = ${session.id} LIMIT 1
    `;
    const v = mine?.[0]?.value;
    const my_vote: 1 | -1 | null = v === 1 || v === -1 ? v : null;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
