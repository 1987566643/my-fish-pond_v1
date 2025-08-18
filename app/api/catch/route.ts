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
        RETURNING id, owner_id
      )
      INSERT INTO catches (fish_id, angler_id)
      SELECT id, ${session.id} FROM upd
      RETURNING fish_id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }
    // 公告：记录 CATCH 事件
    await sql/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id)
      SELECT 'CATCH', ${session.id}, ${fishId}, owner_id FROM (
        SELECT owner_id FROM fish WHERE id = ${fishId}
      ) t
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
