import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { rows } = await sql/*sql*/`
    SELECT f.id, f.name, u.username AS owner, c.caught_at
    FROM catches c
    JOIN fish f ON f.id = c.fish_id
    JOIN users u ON u.id = f.owner_id
    WHERE c.angler_id = ${s.id}
    ORDER BY c.caught_at DESC
  `;
  return NextResponse.json({ fish: rows });
}
