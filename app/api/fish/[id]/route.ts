import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

type Params = { params: { id: string } };

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const fishId = Number(params.id);
  if (!fishId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    // 先把要删的鱼拿出来（仅限本人、且必须还在池塘）
    const { rows } = await sql/*sql*/`
      WITH del AS (
        DELETE FROM fish
        WHERE id = ${fishId} AND owner_id = ${session.id} AND in_pond = TRUE
        RETURNING id, owner_id, name
      )
      SELECT * FROM del
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'forbidden_or_not_in_pond' }, { status: 403 });
    }
    const del = rows[0];

    // 写公告快照（DELETE）
    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id, fish_name, owner_username, actor_username)
      SELECT
        'DELETE',
        ${session.id},
        ${del.id},
        ${del.owner_id},
        ${del.name},
        u_owner.username,
        u_actor.username
      FROM users u_owner, users u_actor
      WHERE u_owner.id = ${del.owner_id} AND u_actor.id = ${session.id}
    `;

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
