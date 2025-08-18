
import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';

/**
 * GET /api/announcements?limit=50
 * 公告栏：谁放鱼、谁钓走谁的鱼
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Number(searchParams.get('limit') || 50));

  // 容错：若表不存在则创建
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
    SELECT e.type, e.created_at, au.username AS actor_name, tu.username AS target_owner_name, f.name AS fish_name
    FROM pond_events e
    LEFT JOIN users au ON au.id = e.actor_id
    LEFT JOIN users tu ON tu.id = e.target_owner_id
    LEFT JOIN fish f ON f.id = e.target_fish_id
    ORDER BY e.created_at DESC
    LIMIT ${limit}
  `;
  return NextResponse.json({ events: rows });
}
