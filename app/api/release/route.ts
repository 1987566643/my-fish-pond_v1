import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 放回池塘：将我最近未放回的那条收获标记为 released，并把鱼放回池塘 + 公告 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId } = await req.json();
  if (!fishId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  try {
    // 取鱼信息
    const f = await sql/*sql*/`SELECT owner_id, name FROM fish WHERE id = ${fishId}`;
    if (!f.rows.length) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

    const ownerId = f.rows[0].owner_id as string;
    const fishName = f.rows[0].name as string;

    // 标记我最近一次未放回的收获为 released
    const rel = await sql/*sql*/`
      UPDATE catches
      SET released = TRUE
      WHERE id IN (
        SELECT id FROM catches
        WHERE fish_id = ${fishId}
          AND angler_id = ${session.id}
          AND released = FALSE
        ORDER BY created_at DESC
        LIMIT 1
      )
      RETURNING id
    `;
    if (rel.rows.length === 0) {
      // 没有未放回记录也允许放回（幂等）
    }

    // 把鱼放回
    await sql/*sql*/`UPDATE fish SET in_pond = TRUE WHERE id = ${fishId}`;

    // 公告
    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id,
         fish_name, actor_username, owner_username)
      VALUES
        ('RELEASE', ${session.id}, ${fishId}, ${ownerId},
         ${fishName},
         (SELECT username FROM users WHERE id = ${session.id}),
         (SELECT username FROM users WHERE id = ${ownerId}))
    `;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
