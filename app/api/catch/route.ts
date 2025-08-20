import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId } = await req.json();

  try {
    // 原子：从池塘拿走
    const { rows: upd } = await sql/*sql*/`
      UPDATE fish SET in_pond = FALSE
      WHERE id = ${fishId} AND in_pond = TRUE
      RETURNING id, owner_id, name
    `;
    if (upd.length === 0) {
      // 已被别人拿走
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }

    const ownerId = upd[0].owner_id as string;
    const fishName = upd[0].name as string;

    // 记录收获（默认 released=false）
    await sql/*sql*/`
      INSERT INTO catches (fish_id, angler_id, released)
      VALUES (${fishId}, ${session.id}, FALSE)
    `;

    // 公告：CATCH 快照
    await sql/*sql*/`
      INSERT INTO pond_events (
        type, actor_id, target_fish_id, target_owner_id,
        fish_name, owner_username, actor_username
      )
      VALUES (
        'CATCH', ${session.id}, ${fishId}, ${ownerId},
        ${fishName},
        (SELECT username FROM users WHERE id = ${ownerId}),
        (SELECT username FROM users WHERE id = ${session.id})
      )
    `;

    // （可选）这里如果你有 today_catch 计数，也可以一起 +1

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
