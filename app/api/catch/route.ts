// /app/api/catch/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT today_catch, total_catch
      FROM users
      WHERE id = ${session.id}
    `;
    const today = rows?.[0]?.today_catch ?? 0;
    const total = rows?.[0]?.total_catch ?? 0;
    return NextResponse.json({ ok: true, today_catch: Number(today), total_catch: Number(total) });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId } = await req.json().catch(() => ({ fishId: '' }));
  if (!fishId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  try {
    // 1) 尝试从池塘里“拿走”这条鱼（原子）
    const upd = await sql/*sql*/`
      UPDATE fish SET in_pond = FALSE
      WHERE id = ${fishId} AND in_pond = TRUE
      RETURNING id, owner_id, name
    `;

    if (upd.rowCount === 0) {
      // 可能是重复点/并发；幂等兜底：最近 3 秒内是否就是我钓到过？
      const sinceISO = new Date(Date.now() - 3000).toISOString();
      const chk = await sql/*sql*/`
        SELECT 1
        FROM catches
        WHERE fish_id = ${fishId}
          AND angler_id = ${session.id}
          AND created_at >= ${sinceISO}
        LIMIT 1
      `;
      if (chk.rowCount > 0) {
        return NextResponse.json({ ok: true }); // 幂等：认作成功
      }
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }

    const ownerId = upd.rows[0].owner_id as string;
    const fishName = upd.rows[0].name as string;

    // 2) 记录收获
    await sql/*sql*/`
      INSERT INTO catches (fish_id, angler_id, released)
      VALUES (${fishId}, ${session.id}, FALSE)
    `;

    // 3) 计数 +1
    await sql/*sql*/`
      UPDATE users
      SET today_catch = today_catch + 1,
          total_catch = total_catch + 1
      WHERE id = ${session.id}
    `;

    // 4) 公告（CATCH）
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

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/catch failed', e);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
