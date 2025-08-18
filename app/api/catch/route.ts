import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId } = await req.json();

  try {
    const { rows } = await sql/*sql*/`
      WITH upd AS (
        UPDATE fish SET in_pond = FALSE
        WHERE id = ${fishId} AND in_pond = TRUE
        RETURNING id
      ),
      ins AS (
        INSERT INTO catches (fish_id, angler_id)
        SELECT id, ${session.id} FROM upd
        RETURNING id
      )
      SELECT * FROM ins;
    `;
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
