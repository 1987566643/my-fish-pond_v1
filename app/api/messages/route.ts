import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function GET() {
  const { rows } = await sql/*sql*/`
    SELECT m.id, m.content, m.created_at, u.username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    ORDER BY m.created_at DESC
    LIMIT 100
  `;
  return NextResponse.json({ messages: rows });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { content } = await req.json();
  if (!content || String(content).length > 500) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  await sql/*sql*/`INSERT INTO messages (user_id, content) VALUES (${s.id}, ${content})`;
  return NextResponse.json({ ok: true });
}
