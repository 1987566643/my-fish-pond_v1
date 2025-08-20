import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 列池塘里的鱼 */
export async function GET() {
  try {
    const { rows } = await sql/*sql*/`
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
    return NextResponse.json({ ok: true, fish: rows });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/** 画布保存鱼 */
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

    // 2) 公告：ADD 事件，写“快照”
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
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
