import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 使用 pond_events 作为时间来源，避免对 catches.created_at 的硬依赖
  const { rows } = await sql/*sql*/`
    SELECT
      c.id AS catch_id,
      f.id AS fish_id,
      f.name,
      f.data_url,
      f.w,
      f.h,
      (
        SELECT e.created_at
        FROM pond_events e
        WHERE e.type = 'CATCH'
          AND e.actor_id = c.angler_id
          AND e.target_fish_id = c.fish_id
        ORDER BY e.created_at DESC
        LIMIT 1
      ) AS caught_at
    FROM catches c
    JOIN fish f ON f.id = c.fish_id
    WHERE c.angler_id = ${session.id}
    ORDER BY caught_at DESC NULLS LAST
  `;

  return NextResponse.json({ fish: rows || [] });
}
