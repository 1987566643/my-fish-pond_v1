import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/**
 * GET: 返回当前用户的今日收获
 * POST: 钓鱼（catch），成功则 today_catch+1
 */

// —— GET: 获取我的今日收获 —— //
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT today_catch, today_catch_reset_at
      FROM users
      WHERE id = ${session.id}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
    }
    const user = rows[0];
    return NextResponse.json({
      ok: true,
      today_catch: user.today_catch ?? 0,
      today_catch_reset_at: user.today_catch_reset_at,
    });
  } catch (e) {
    console.error('GET /api/catch failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

// —— POST: 钓鱼 —— //
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId } = await req.json();

  try {
    const { rows } = await sql/*sql*/`
      WITH upd AS (
        UPDATE fish SET in_pond = FALSE
        WHERE id = ${fishId} AND in_pond = TRUE
        RETURNING id, owner_id
      )
      INSERT INTO catches (fish_id, angler_id)
      SELECT id, ${session.id} FROM upd
      RETURNING fish_id
    `;

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }

    // —— 更新用户今日收获数 —— //
    await sql/*sql*/`
      UPDATE users
      SET today_catch = today_catch + 1
      WHERE id = ${session.id}
    `;

    // —— 公告：记录事件 —— //
    await sql/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id)
      SELECT 'CATCH', ${session.id}, ${fishId}, owner_id FROM (
        SELECT owner_id FROM fish WHERE id = ${fishId}
      ) t
    `;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/catch failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
