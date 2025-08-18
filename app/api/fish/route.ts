import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  // 返回池塘里的鱼，带作者名、创建时间、赞/踩数量（若 reactions 表不存在则为 0）
  const { rows } = await sql/*sql*/`
    SELECT
      f.id, f.name, f.data_url, f.w, f.h, f.created_at,
      u.username AS owner_name,
      COALESCE(l.likes, 0) AS likes,
      COALESCE(d.dislikes, 0) AS dislikes
    FROM fish f
    JOIN users u ON u.id = f.owner_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS likes FROM fish_reactions r WHERE r.fish_id = f.id AND r.value = 1
    ) l ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS dislikes FROM fish_reactions r WHERE r.fish_id = f.id AND r.value = -1
    ) d ON TRUE
    WHERE f.in_pond = TRUE
    ORDER BY f.created_at DESC
    LIMIT 200
  `;
  return NextResponse.json({ fish: rows });
} = await sql/*sql*/`
    SELECT f.id, f.name, f.data_url, f.w, f.h
    FROM fish f
    WHERE f.in_pond = TRUE
    ORDER BY f.created_at DESC
    LIMIT 200
  `;
  return NextResponse.json({ fish: rows });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  const { name, data_url, w, h } = body || {};
  if (!name || !data_url || !w || !h) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { rows } = await sql/*sql*/`
    INSERT INTO fish (owner_id, name, data_url, w, h)
    VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h})
    RETURNING id
  `;
  // 写入公告（ADD）
await sql/*sql*/`
  INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id)
  VALUES ('ADD', ${session.id}, ${rows[0].id}, ${session.id})
`;
return NextResponse.json({ ok: true, id: rows[0].id });
}
