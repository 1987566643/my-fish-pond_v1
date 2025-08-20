import { NextResponse } from 'next/server';
import { sql } from '../../../../../lib/db';
import { getSessionUserId } from '../../../../../lib/auth';

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { catchId } = await req.json().catch(() => ({}));
  if (!catchId) return NextResponse.json({ error: 'missing_catch_id' }, { status: 400 });

  const rows = await sql<any[]>/*sql*/`
    SELECT
      c.id      AS catch_id,
      c.angler_id,
      f.id      AS fish_id,
      f.owner_id,
      f.name
    FROM catches c
    JOIN fish f ON f.id = c.fish_id
    WHERE c.id = ${catchId}
    LIMIT 1
  `;
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const row = rows[0];
  if (row.angler_id !== userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const users = await sql<{ id: string; username: string }[]>/*sql*/`
    SELECT id, username FROM users WHERE id IN (${row.owner_id}, ${userId})
  `;
  const ownerUsername = users.find(u => u.id === row.owner_id)?.username || 'unknown';
  const actorUsername = users.find(u => u.id === userId)?.username || 'unknown';

  await sql.begin(async (trx) => {
    await trx/*sql*/`
      UPDATE fish SET in_pond = TRUE
      WHERE id = ${row.fish_id}
    `;

    await trx/*sql*/`
      DELETE FROM catches
      WHERE id = ${row.catch_id} AND angler_id = ${userId}
    `;

    await trx/*sql*/`
      UPDATE users
      SET today_catch = GREATEST(today_catch - 1, 0)
      WHERE id = ${userId}
    `;

    await trx/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id, fish_name, owner_username, actor_username)
      VALUES ('RELEASE', NULL, NULL, NULL, ${row.name}, ${ownerUsername}, ${actorUsername})
    `;
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
