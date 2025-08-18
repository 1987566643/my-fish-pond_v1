import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/**
 * GET /api/fish
 * 返回池塘中的鱼，包含作者、创建时间、赞/踩数量
 */
export async function GET() {
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
}

/**
 * POST /api/fish
 * 保存新鱼到池塘，并写入公告
 * body: { name: string, data_url: string, w: number, h: number }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  const { name, data_url, w, h } = body || {};
  if (!name || !data_url || !w || !h) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // 保底：确保公告表存在
  await sql/*sql*/`
    CREATE TABLE IF NOT EXISTS pond_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('ADD','CATCH')),
      actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_fish_id UUID REFERENCES fish(id) ON DELETE SET NULL,
      target_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      extra JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `;

  const { rows } = await sql/*sql*/`
    INSERT INTO fish (owner_id, name, data_url, w, h)
    VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h})
    RETURNING id
  `;
  const fishId: string = rows[0].id;

  await sql/*sql*/`
    INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id)
    VALUES ('ADD', ${session.id}, ${fishId}, ${session.id})
  `;

  return NextResponse.json({ ok: true, id: fishId });
}