import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { rows } = await sql/*sql*/`
    SELECT f.id, f.name, f.created_at, f.in_pond,
           u2.username AS angler, c.caught_at
    FROM fish f
    LEFT JOIN catches c ON c.fish_id = f.id
    LEFT JOIN users u2 ON u2.id = c.angler_id
    WHERE f.owner_id = ${s.id}
    ORDER BY f.created_at DESC
  `;
  return NextResponse.json({ fish: rows });
}
