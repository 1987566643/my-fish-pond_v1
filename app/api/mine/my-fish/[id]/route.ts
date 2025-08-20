import { NextResponse } from 'next/server';
import { sql } from '../../../../../lib/db';
import { getSessionUserId } from '../../../../../lib/auth';

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const fishId = params.id;

  // 查询鱼状态
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

  // 获取用户名快照
  const userRow = await sql<{ username: string }[]>/*sql*/`
    SELECT username FROM users WHERE id = ${userId} LIMIT 1
  `;
  const ownerUsername = userRow[0]?.username || 'unknown';

  await sql.begin(async (trx) => {
    // 真删除（不会触发 catches 级联，因为未被钓走）
    await trx/*sql*/`
      DELETE FROM fish
      WHERE id = ${fishId} AND owner_id = ${userId}
    `;

    // 写入 pond_events（你的 pond_events 为 BIGSERIAL + BIGINT列，我们仅写快照字段）
    await trx/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id, fish_name, owner_username, actor_username)
      VALUES ('DELETE', NULL, NULL, NULL, ${fish.name}, ${ownerUsername}, ${ownerUsername})
    `;
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

