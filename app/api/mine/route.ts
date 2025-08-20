import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { rows } = await sql/*sql*/`
    SELECT
      f.id,
      f.name,
      f.data_url,
      f.w, f.h,
      f.in_pond,
      f.created_at,
      ua.username AS angler_username,
      lc.caught_at
    FROM fish f
    LEFT JOIN LATERAL (
      SELECT c.angler_id, c.caught_at
      FROM catches c
      WHERE c.fish_id = f.id
      ORDER BY c.caught_at DESC NULLS LAST
      LIMIT 1
    ) lc ON TRUE
    LEFT JOIN users ua ON ua.id = lc.angler_id
    WHERE f.owner_id = ${session.id}
    ORDER BY f.created_at DESC NULLS LAST
  `;

  return NextResponse.json({ fish: rows || [] });
}
