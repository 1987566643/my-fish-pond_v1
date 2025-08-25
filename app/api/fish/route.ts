import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** GET：列池塘里的鱼（稳定版：无 ANY($array)，无条件内嵌 Promise） */
export async function GET() {
  // 可未登录；未登录时 my_vote = null
  const session = await getSession().catch(() => null);
  const uid = session?.id ?? null;

  try {
    const { rows } = await sql/*sql*/`
      SELECT
        f.id,
        f.name,
        f.data_url,
        f.w,
        f.h,
        f.created_at,
        u.username AS owner_name,
        COALESCE(rx.likes, 0)::int    AS likes,
        COALESCE(rx.dislikes, 0)::int AS dislikes,
        rme.value                     AS my_vote
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      -- 聚合点赞/点踩
      LEFT JOIN (
        SELECT
          r.fish_id,
          SUM(CASE WHEN r.value = 1  THEN 1 ELSE 0 END)::int AS likes,
          SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END)::int AS dislikes
        FROM reactions r
        GROUP BY r.fish_id
      ) rx ON rx.fish_id = f.id
      -- 当前用户对每条鱼的投票；uid=null 时 WHERE user_id = null 无行返回 => rme.value 为 NULL
      LEFT JOIN (
        SELECT fish_id, value
        FROM reactions
        WHERE user_id = ${uid}
      ) rme ON rme.fish_id = f.id
      WHERE f.in_pond = TRUE
      ORDER BY f.created_at DESC
    `;

    const list = rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      data_url: r.data_url,
      w: r.w,
      h: r.h,
      created_at: r.created_at,
      owner_name: r.owner_name,
      likes: Number(r.likes) || 0,
      dislikes: Number(r.dislikes) || 0,
      my_vote: r.my_vote === 1 || r.my_vote === -1 ? (r.my_vote as 1 | -1) : null,
    }));

    return NextResponse.json({ ok: true, fish: list });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/**
 * POST：保存新鱼（保持你之前的逻辑）
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();

  try {
    const { rows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id
    `;
    const fishId = rows[0].id as string;

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
