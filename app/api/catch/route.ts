import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId } = await req.json();

  if (!fishId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    // 抢占：仅当还在池塘里时才能被钓走
    const { rows: updRows } = await sql/*sql*/`
      UPDATE fish
      SET in_pond = FALSE
      WHERE id = ${fishId} AND in_pond = TRUE
      RETURNING id, owner_id, name
    `;
    if (updRows.length === 0) {
      return NextResponse.json({ ok: false, error: 'already_caught' }, { status: 409 });
    }
    const f = updRows[0];

    // 记录 catches
    const { rows: catRows } = await sql/*sql*/`
      INSERT INTO catches (fish_id, angler_id)
      VALUES (${fishId}, ${session.id})
      RETURNING id, created_at
    `;
    const c = catRows[0];

    // 今日收获 +1
    await sql/*sql*/`
      UPDATE users SET today_catch = COALESCE(today_catch, 0) + 1
      WHERE id = ${session.id}
    `;

    // 公告快照（CATCH）
    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id, fish_name, owner_username, actor_username)
      SELECT
        'CATCH',
        ${session.id},
        ${f.id},
        ${f.owner_id},
        ${f.name},
        u_owner.username,
        u_actor.username
      FROM users u_owner, users u_actor
      WHERE u_owner.id = ${f.owner_id} AND u_actor.id = ${session.id}
    `;

    return NextResponse.json({ ok: true, catch_id: c.id, caught_at: c.created_at });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

// GET：返回今天的收获（从 users.today_catch 取）
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { rows } = await sql/*sql*/`
    SELECT COALESCE(today_catch, 0) AS today_catch
    FROM users
    WHERE id = ${session.id}
  `;
  const today = rows[0]?.today_catch ?? 0;
  return NextResponse.json({ ok: true, today_catch: today });
}
