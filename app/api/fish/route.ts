import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';
import { getSession } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 北京时间每天 4:00 作为边界，返回 [startISO, endISO] */
function beijing4AMWindowNow(): { startISO: string; endISO: string } {
  // 以本地时间为准（部署机器时区可能是 UTC），这里用北京时间偏移 +8
  const now = new Date();
  // 把 now 先换算成北京时间
  const bj = new Date(now.getTime() + 8 * 3600_000);
  const boundary = new Date(bj.getFullYear(), bj.getMonth(), bj.getDate(), 4, 0, 0, 0);
  const startBJ = bj.getTime() < boundary.getTime()
    ? new Date(boundary.getTime() - 24 * 3600_000)
    : boundary;
  const endBJ = new Date(startBJ.getTime() + 24 * 3600_000);

  // 再把北京时间换回 UTC ISO 存到数据库对比（数据库时间通常是 UTC）
  const startISO = new Date(startBJ.getTime() - 8 * 3600_000).toISOString();
  const endISO   = new Date(endBJ.getTime() - 8 * 3600_000).toISOString();
  return { startISO, endISO };
}

/** 列池塘里的鱼（包含聚合的 likes/dislikes；若已登录，还会带上我当天的 my_vote） */
export async function GET() {
  const session = await getSession(); // 允许未登录访问，这时 my_vote 不会返回
  try {
    // 1) 列出池塘所有鱼 + 聚合赞/踩
    const fishRes = await sql/*sql*/`
      SELECT
        f.id, f.name, f.data_url, f.w, f.h, f.created_at, f.in_pond,
        u.username AS owner_name,
        COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 ELSE 0 END),0)::int AS likes,
        COALESCE(SUM(CASE WHEN r.value =-1 THEN 1 ELSE 0 END),0)::int AS dislikes
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      LEFT JOIN reactions r ON r.fish_id = f.id
      WHERE f.in_pond = TRUE
      GROUP BY f.id, u.username
      ORDER BY f.created_at DESC
    `;

    const fish = fishRes.rows as Array<{
      id: string;
      name: string;
      data_url: string;
      w: number;
      h: number;
      created_at: string;
      in_pond: boolean;
      owner_name: string;
      likes: number;
      dislikes: number;
    }>;

    // 2) 未登录：直接返回
    if (!session) {
      return NextResponse.json({ ok: true, fish });
    }

    // 3) 已登录：查“当天（按北京 4 点窗口）我对每条鱼的最新一条投票”
    const { startISO, endISO } = beijing4AMWindowNow();

    // 这里不再用 ANY(${fishIds})，直接把该用户当天的投票全取出（通常量很小），
    // 用 DISTINCT ON 每条鱼只保留最新一条，再在应用层合并
    const voteRes = await sql/*sql*/`
      SELECT DISTINCT ON (r.fish_id) r.fish_id, r.value
      FROM reactions r
      WHERE r.user_id = ${session.id}
        AND r.created_at >= ${startISO}
        AND r.created_at <  ${endISO}
      ORDER BY r.fish_id, r.created_at DESC
    `;

    const myMap: Record<string, 1 | -1> = Object.create(null);
    for (const row of voteRes.rows as Array<{ fish_id: string; value: number }>) {
      if (row.value === 1 || row.value === -1) {
        myMap[row.fish_id] = row.value as 1 | -1;
      }
    }

    // 4) 合并 my_vote
    const out = fish.map(f => ({
      ...f,
      my_vote: myMap[f.id] ?? null,
    }));

    return NextResponse.json({ ok: true, fish: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/** 画布保存鱼 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();

  try {
    // 1) 存鱼（入池）
    const { rows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id
    `;
    const fishId = rows[0].id as string;

    // 2) 公告：ADD 事件
    await sql/*sql*/`
      INSERT INTO pond_events (
        type, actor_id, target_fish_id, target_owner_id,
        fish_name, actor_username, owner_username
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
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
