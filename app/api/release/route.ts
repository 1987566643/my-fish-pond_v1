import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId } = await req.json();
  if (!fishId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    // 验证这条鱼确实是该用户的收获
    const { rows: ownRows } = await sql/*sql*/`
      SELECT c.id, f.owner_id, f.name
      FROM catches c
      JOIN fish f ON f.id = c.fish_id
      WHERE c.fish_id = ${fishId} AND c.angler_id = ${session.id}
      ORDER BY c.created_at DESC
      LIMIT 1
    `;
    if (ownRows.length === 0) {
      return NextResponse.json({ error: 'not_your_catch' }, { status: 403 });
    }
    const rec = ownRows[0];

    // 删除 catches 记录 & 把鱼放回池塘
    await sql/*sql*/`DELETE FROM catches WHERE id = ${rec.id}`;
    await sql/*sql*/`UPDATE fish SET in_pond = TRUE WHERE id = ${fishId}`;

    // 公告快照（RELEASE）
    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id, fish_name, owner_username, actor_username)
      SELECT
        'RELEASE',
        ${session.id},
        ${fishId},
        ${rec.owner_id},
        ${rec.name},
        u_owner.username,
        u_actor.username
      FROM users u_owner, users u_actor
      WHERE u_owner.id = ${rec.owner_id} AND u_actor.id = ${session.id}
    `;

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
