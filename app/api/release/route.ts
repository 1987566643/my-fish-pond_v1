import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId } = await req.json();

  try {
    // 只有“我”曾经钓到的鱼才能放回；并将 fish.in_pond 置 true
    const { rows } = await sql/*sql*/`
      WITH mine AS (
        SELECT c.fish_id
        FROM catches c
        WHERE c.fish_id = ${fishId} AND c.angler_id = ${session.id}
        ORDER BY c.caught_at DESC
        LIMIT 1
      ),
      upd AS (
        UPDATE fish f
        SET in_pond = TRUE
        WHERE f.id IN (SELECT fish_id FROM mine)
        RETURNING f.id, f.name, f.owner_id
      )
      SELECT u.username AS owner_username, f.name AS fish_name, f.id AS fid
      FROM upd f
      JOIN users u ON u.id = f.owner_id
    `;

    // 幂等：不是我的收获 / 已放回 —— 直接认为成功
    if (rows.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const fid = rows[0].fid as string;
    const fish_name = rows[0].fish_name as string;
    const owner_username = rows[0].owner_username as string;

    // 写入事件快照（RELEASE）
    await sql/*sql*/`
      INSERT INTO pond_events (
        type, actor_id, target_fish_id, target_owner_id,
        fish_name, owner_username, actor_username
      )
      SELECT
        'RELEASE', ${session.id}, ${fid}, f.owner_id,
        ${fish_name},
        ${owner_username},
        (SELECT username FROM users WHERE id = ${session.id})
      FROM fish f WHERE f.id = ${fid}
    `;

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
