import { NextResponse } from 'next/server';
import { getSession } from '../../lib/auth';
import { sql } from '../../lib/db';

// GET: 池塘中的鱼
export async function GET() {
  const { rows } = await sql/*sql*/`
    SELECT
      f.id, f.name, f.data_url, f.w, f.h, f.created_at, f.in_pond,
      u.username AS owner_name,
      COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 ELSE 0 END), 0) AS likes,
      COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes
    FROM fish f
    JOIN users u ON u.id = f.owner_id
    LEFT JOIN reactions r ON r.fish_id = f.id
    WHERE f.in_pond = TRUE
    GROUP BY f.id, u.username
    ORDER BY f.created_at DESC
  `;
  return NextResponse.json({ ok: true, fish: rows });
}

// POST: 新建鱼（入池）
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();
  if (!data_url || !w || !h) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    // 插入 fish
    const { rows: fishRows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${name ?? null}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id, name, owner_id
    `;
    const f = fishRows[0];

    // 公告快照（ADD）
    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id, fish_name, owner_username, actor_username)
      SELECT
        'ADD', ${session.id}, ${f.id}, ${session.id}, ${f.name},
        u.username, u.username
      FROM users u
      WHERE u.id = ${session.id}
    `;

    return NextResponse.json({ ok: true, id: f.id });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
