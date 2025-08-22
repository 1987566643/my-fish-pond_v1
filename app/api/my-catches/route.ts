import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 我的收获（未放回） */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT
        c.id AS catch_id,
        f.id AS fish_id,
        f.name,
        f.data_url, f.w, f.h,
        c.created_at AS caught_at,
        u.username AS owner_username
      FROM catches c
      JOIN fish f ON f.id = c.fish_id
      JOIN users u ON u.id = f.owner_id
      WHERE c.angler_id = ${session.id}
        AND c.released = FALSE
      ORDER BY c.created_at DESC
    `;
    return NextResponse.json({ ok: true, fish: rows });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
