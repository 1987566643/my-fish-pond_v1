import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 我钓到的鱼（用于“我的”右侧列表） */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT
        c.id AS catch_id,
        f.id AS fish_id,
        f.name,
        ou.username AS owner_username,
        f.data_url, f.w, f.h,
        c.created_at AS caught_at
      FROM catches c
      JOIN fish f ON f.id = c.fish_id
      JOIN users ou ON ou.id = f.owner_id
      WHERE c.angler_id = ${session.id}
      ORDER BY c.created_at DESC
    `;
    return NextResponse.json({ ok: true, fish: rows });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
