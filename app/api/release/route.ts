import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId } = await req.json().catch(() => ({ fishId: '' }));
  if (!fishId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  try {
    // 1) 我是否持有（最近一次、未放回）
    const own = await sql/*sql*/`
      SELECT c.id AS catch_id, f.owner_id, f.name
      FROM catches c
      JOIN fish f ON f.id = c.fish_id
      WHERE c.fish_id = ${fishId}
        AND c.angler_id = ${session.id}
        AND c.released = FALSE
      ORDER BY c.created_at DESC
      LIMIT 1
    `;
    if (own.rows.length === 0) {
      // 幂等/越权：当作成功
      return NextResponse.json({ ok: true });
    }

    const catchId = own.rows[0].catch_id as string;
    const ownerId = own.rows[0].owner_id as string;
    const fishName = own.rows[0].name as string;

    // 2) 标记放回 & 鱼回池塘
    await sql/*sql*/`UPDATE catches SET released = TRUE WHERE id = ${catchId}`;
    await sql/*sql*/`UPDATE fish SET in_pond = TRUE WHERE id = ${fishId}`;

    // 3) 公告（允许的类型：RELEASE）
    await sql/*sql*/`
      INSERT INTO pond_events (
        type, actor_id, target_fish_id, target_owner_id,
        fish_name, owner_username, actor_username
      )
      VALUES (
        'RELEASE',
        ${session.id},
        ${fishId},
        ${ownerId},
        ${fishName},
        (SELECT username FROM users WHERE id = ${ownerId}),
        (SELECT username FROM users WHERE id = ${session.id})
      )
    `;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
