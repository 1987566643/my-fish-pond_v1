import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId } = await req.json();

  try {
    // 确认是我钓到的
    const { rows: chk } = await sql/*sql*/`
      SELECT id FROM catches WHERE fish_id = ${fishId} AND angler_id = ${session.id}
    `;
    if (!chk.length) {
      return NextResponse.json({ error: 'not_your_catch' }, { status: 403 });
    }

    // 删除收获记录 & 放回池塘
    await sql/*sql*/`DELETE FROM catches WHERE fish_id = ${fishId} AND angler_id = ${session.id}`;
    await sql/*sql*/`UPDATE fish SET in_pond = TRUE WHERE id = ${fishId}`;

    // 公告事件
    await sql/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id)
      VALUES ('RELEASE', ${session.id}, ${fishId})
    `;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/release failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
