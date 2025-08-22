import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 读取计数（“今日/总收获”） */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT today_catch, total_catch
      FROM users
      WHERE id = ${session.id}
    `;
    return NextResponse.json({
      ok: true,
      today_catch: Number(rows?.[0]?.today_catch ?? 0),
      total_catch: Number(rows?.[0]?.total_catch ?? 0),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/** 收线：把鱼从池塘里拿走，记入 catches + 公告，用户计数 +1 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId } = await req.json();
  if (!fishId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  try {
    // 原子拉鱼：只取仍在池塘的
    const upd = await sql/*sql*/`
      UPDATE fish SET in_pond = FALSE
      WHERE id = ${fishId} AND in_pond = TRUE
      RETURNING id, owner_id, name
    `;
    if (upd.rows.length === 0) {
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }

    const ownerId = upd.rows[0].owner_id as string;
    const fishName = upd.rows[0].name as string;

    // 记收获
    await sql/*sql*/`
      INSERT INTO catches (fish_id, angler_id, released)
      VALUES (${fishId}, ${session.id}, FALSE)
    `;

    // 计数
    await sql/*sql*/`
      UPDATE users
      SET today_catch = today_catch + 1,
          total_catch = total_catch + 1
      WHERE id = ${session.id}
    `;

    // 公告
    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id,
         fish_name, actor_username, owner_username)
      VALUES
        ('CATCH', ${session.id}, ${fishId}, ${ownerId},
         ${fishName},
         (SELECT username FROM users WHERE id = ${session.id}),
         (SELECT username FROM users WHERE id = ${ownerId}))
    `;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
