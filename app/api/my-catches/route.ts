import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT
        c.id AS catch_id,
        f.id AS fish_id,
        f.name,
        f.data_url,
        f.w, f.h,
        u.username AS owner_username,
        c.caught_at
      FROM catches c
      JOIN fish f ON f.id = c.fish_id
      JOIN users u ON u.id = f.owner_id
      WHERE c.angler_id = ${session.id}
        AND c.released = FALSE               -- 关键：只看未放回
        AND f.in_pond = FALSE                -- 兜底：防止旧数据
      ORDER BY c.caught_at DESC
      LIMIT 500
    `;
    return NextResponse.json({ ok: true, fish: rows });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

