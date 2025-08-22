import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 读取计数（后端为准） */
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

/** 钓鱼：原子摘取+记录收获+计数+公告 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId } = await req.json();

  if (!fishId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    // 1) 原子摘取（确保仍在池塘）
    const { rows: upd } = await sql/*sql*/`
      UPDATE fish SET in_pond = FALSE
      WHERE id = ${fishId} AND in_pond = TRUE
      RETURNING id, owner_id, name
    `;
    if (upd.length === 0) {
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }

    const ownerId = upd[0].owner_id as string;
    const fishName = upd[0].name as string;

    // 2) 记录收获（我的收获页依赖这张表）
    const { rows: c } = await sql/*sql*/`
      INSERT INTO catches (fish_id, angler_id, released)
      VALUES (${fishId}, ${session.id}, FALSE)
      RETURNING id
    `;
    const catchId = c[0].id;

    // 3) 计数 +1
    await sql/*sql*/`
      UPDATE users
      SET today_catch = today_catch + 1,
          total_catch = total_catch + 1
      WHERE id = ${session.id}
    `;

    // 4) 公告：CATCH
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

    return NextResponse.json({ ok: true, catch_id: catchId });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
