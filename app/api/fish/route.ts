import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 计算“北京时间 4 点”为边界的今天窗口 [start, end)（UTC 时间点） */
function todayWindowBJ4(): { start: Date; end: Date } {
  const now = new Date();

  // 北京时间 = UTC+8
  const tzOffsetMin = 8 * 60;

  // 把 now 转成“北京时间”的各个分量
  const bj = new Date(now.getTime() + tzOffsetMin * 60_000);
  const y = bj.getUTCFullYear();
  const m = bj.getUTCMonth();
  const d = bj.getUTCDate();
  const h = bj.getUTCHours();

  // 若北京时间小于 4 点，则窗口起点是“昨天 4 点”，否则“今天 4 点”
  const startBJ = new Date(Date.UTC(y, m, d, 4, 0, 0, 0));
  if (h < 4) startBJ.setUTCDate(startBJ.getUTCDate() - 1);

  const endBJ = new Date(startBJ.getTime());
  endBJ.setUTCDate(endBJ.getUTCDate() + 1);

  return { start: startBJ, end: endBJ };
}

/** GET：列出池塘里的鱼（带我的当天投票 my_vote） */
export async function GET() {
  const session = await getSession().catch(() => null);
  const { start, end } = todayWindowBJ4();
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  try {
    // 主查询：按 in_pond 取鱼 & 主人用户名；点赞/点踩直接读 fish 表字段
    const { rows } = await sql/*sql*/`
      SELECT
        f.id,
        f.name,
        f.data_url,
        f.w,
        f.h,
        f.created_at,
        f.in_pond,
        f.likes::int    AS likes,
        f.dislikes::int AS dislikes,
        u.username      AS owner_name
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      WHERE f.in_pond = TRUE
      ORDER BY f.created_at DESC
    `;

    // 如果已登录，再补充 my_vote（当天这位用户对每条鱼的投票：1 / -1 / null）
    if (session) {
      const withVote = await Promise.all(
        rows.map(async (r: any) => {
          const { rows: v } = await sql/*sql*/`
            SELECT value
            FROM reactions
            WHERE user_id = ${session.id}
              AND fish_id = ${r.id}
              AND created_at >= ${startIso}
              AND created_at <  ${endIso}
            ORDER BY created_at DESC
            LIMIT 1
          `;
          return { ...r, my_vote: v.length ? (v[0].value as 1 | -1) : null };
        })
      );
      return NextResponse.json({ ok: true, fish: withVote });
    }

    // 未登录就不带 my_vote
    return NextResponse.json({ ok: true, fish: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/** POST：画布保存新鱼（入池 & 事件快照） */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();

  try {
    // 1) 存鱼（入池，计数置 0）
    const { rows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond, likes, dislikes)
      VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h}, TRUE, 0, 0)
      RETURNING id
    `;
    const fishId = rows[0].id as string;

    // 2) 公告：ADD 事件，写“快照”（避免以后改名导致历史记录空白）
    await sql/*sql*/`
      INSERT INTO pond_events (
        type,
        actor_id,
        target_fish_id,
        target_owner_id,
        fish_name,
        actor_username,
        owner_username
      )
      VALUES (
        'ADD',
        ${session.id},
        ${fishId},
        ${session.id},
        ${name},
        (SELECT username FROM users WHERE id = ${session.id}),
        (SELECT username FROM users WHERE id = ${session.id})
      )
    `;

    return NextResponse.json({ ok: true, id: fishId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
