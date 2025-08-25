import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 列池塘里的鱼（含聚合票数 + 当前用户的 my_vote） */
export async function GET() {
  // 允许未登录
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
      LEFT JOIN (
        SELECT r.fish_id,
               SUM(CASE WHEN r.value = 1  THEN 1 ELSE 0 END)::int  AS likes,
               SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END)::int  AS dislikes
        FROM reactions r
        GROUP BY r.fish_id
      ) rx ON rx.fish_id = f.id
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

/** 画布保存鱼（保留你原先的逻辑） */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();

  try {
    // 1) 存鱼
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
