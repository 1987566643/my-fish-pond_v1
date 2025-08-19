import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { sql } from '../../../../lib/db';

export async function DELETE(_: Request, ctx: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const fishId = ctx.params.id;

  try {
    // 仅允许删除自己的、且仍在池塘中的鱼
    const { rows } = await sql/*sql*/`
      SELECT id FROM fish
      WHERE id = ${fishId} AND owner_id = ${session.id} AND in_pond = TRUE
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'forbidden_or_not_in_pond' }, { status: 403 });
    }

    await sql/*sql*/`DELETE FROM fish WHERE id = ${fishId}`;

    // 公告事件（可选）
    await sql/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id)
      VALUES ('REMOVE', ${session.id}, ${fishId})
    `;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/fish/:id failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
