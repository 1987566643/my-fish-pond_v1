import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { rows } = await sql/*sql*/`
    SELECT
      c.id        AS catch_id,
      f.id        AS fish_id,
      f.name,
      f.data_url,
      f.w, f.h,
      c.caught_at,
      u.username  AS owner_username
    FROM catches c
    JOIN fish  f ON f.id = c.fish_id
    JOIN users u ON u.id = f.owner_id
    WHERE c.angler_id = ${session.id}
    ORDER BY c.caught_at DESC NULLS LAST
  `;

  return NextResponse.json({ fish: rows || [] });
}
