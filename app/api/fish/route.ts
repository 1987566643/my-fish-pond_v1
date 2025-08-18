import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  const { rows } = await sql/*sql*/`
    SELECT f.id, f.name, f.data_url, f.w, f.h
    FROM fish f
    WHERE f.in_pond = TRUE
    ORDER BY f.created_at DESC
    LIMIT 200
  `;
  return NextResponse.json({ fish: rows });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  const { name, data_url, w, h } = body || {};
  if (!name || !data_url || !w || !h) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { rows } = await sql/*sql*/`
    INSERT INTO fish (owner_id, name, data_url, w, h)
    VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h})
    RETURNING id
  `;
  return NextResponse.json({ ok: true, id: rows[0].id });
}
