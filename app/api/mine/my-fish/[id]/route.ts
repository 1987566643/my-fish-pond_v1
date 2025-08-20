import { NextResponse } from 'next/server';
import { sql } from '../../../../../lib/db';
import { getSessionUserId, getSessionUsername } from '../../../../../lib/auth';

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const fishId = params.id;

  const rows = await sql<any[]>/*sql*/`
    SELECT
      f.id, f.owner_id, f.name, f.in_pond,
      (c.id IS NOT NULL) AS caught
    FROM fish f
    LEFT JOIN catches c ON c.fish_id = f.id
    WHERE f.id = ${fishId}
    LIMIT 1
  `;
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const fish = rows[0];
  if (fish.owner_id !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!fish.in_pond || fish.caught) {
    return NextResponse.json({ error: 'cannot_delete' }, { status: 409 });
  }

  const actorUsername = (await getSessionUsername()) || 'unknown';

  await sql.begin(async (trx) => {
    await trx/*sql*/`
      DELETE FROM fish
      WHERE id = ${fishId} AND owner_id = ${userId}
    `;

    // 你的 pond_events 是 BIGSERIAL + BIGINT 列；我们仅写快照字段，BIGINT 列设 NULL。
    await trx/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id, fish_name, owner_username, actor_username)
      VALUES ('DELETE', NULL, NULL, NULL, ${fish.name}, ${actorUsername}, ${actorUsername})
    `;
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
