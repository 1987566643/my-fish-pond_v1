import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min( Number(searchParams.get('limit') ?? '60'), 200 ));

  try {
    const { rows } = await sql/*sql*/`
      SELECT
        e.type,
        e.created_at,
        -- 用户名优先用事件快照，兜底再关联
        COALESCE(e.actor_username, au.username, '')      AS actor_name,
        COALESCE(e.owner_username, ou.username, '')      AS target_owner_name,
        -- 鱼名优先用事件快照；兜底再取当前 fish.name；最后给空串
        COALESCE(e.fish_name, f.name, '')                AS fish_name
      FROM pond_events e
      LEFT JOIN users au ON au.id = e.actor_id
      LEFT JOIN users ou ON ou.id = e.target_owner_id
      LEFT JOIN fish  f  ON f.id  = e.target_fish_id
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `;
    return NextResponse.json({ ok: true, events: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
