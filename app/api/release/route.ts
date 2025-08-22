import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId } = await req.json();

  try {
    // 找到我“未放回”的那条收获
    const { rows: mine } = await sql/*sql*/`
      SELECT c.id AS catch_id, f.id AS fish_id, f.owner_id, f.name AS fish_name, u.username AS owner_username
      FROM catches c
      JOIN fish f ON f.id = c.fish_id
      JOIN users u ON u.id = f.owner_id
      WHERE c.fish_id = ${fishId}
        AND c.angler_id = ${session.id}
        AND c.released = FALSE
      ORDER BY c.caught_at DESC
      LIMIT 1
    `;

    // 幂等：不是我的/已放回 → 认为成功
    if (mine.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const catchId = mine[0].catch_id as string;
    const ownerId = mine[0].owner_id as string;
    const fishName = mine[0].fish_name as string;
    const ownerUsername = mine[0].owner_username as string;

    // 1) 把该收获标记为已放回（只更新一次）
    const { rows: updCatch } = await sql/*sql*/`
      UPDATE catches
      SET released = TRUE, released_at = now()
      WHERE id = ${catchId} AND released = FALSE
      RETURNING id
    `;

    // 2) 鱼回到池塘
    await sql/*sql*/`
      UPDATE fish SET in_pond = TRUE WHERE id = ${fishId}
    `;

    // 只有真正从 false→true 才 −1
    if (updCatch.length > 0) {
      await sql/*sql*/`
        UPDATE users
        SET today_catch = GREATEST(today_catch - 1, 0),
            total_catch = GREATEST(total_catch - 1, 0)
        WHERE id = ${session.id}
      `;
    }

    // 公告快照（RELEASE）
    await sql/*sql*/`
      INSERT INTO pond_events (
        type, actor_id, target_fish_id, target_owner_id,
        fish_name, owner_username, actor_username
      )
      VALUES (
        'RELEASE', ${session.id}, ${fishId}, ${ownerId},
        ${fishName},
        ${ownerUsername},
        (SELECT username FROM users WHERE id = ${session.id})
      )
    `;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
