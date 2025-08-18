import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/** 每天 4:00 为边界；若当前时间早于 4 点，则边界取昨天 4 点 */
function boundary4AM(d = new Date()) {
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0, 0);
  if (d.getTime() < b.getTime()) b.setDate(b.getDate() - 1);
  return b;
}

/** 若用户的 reset_at 早于当前边界，则清零并把 reset_at 置为边界 */
async function ensureReset(userId: string) {
  const boundaryIso = boundary4AM().toISOString();
  await sql/*sql*/`
    UPDATE users
    SET today_catch = 0,
        today_catch_reset_at = ${boundaryIso}
    WHERE id = ${userId}
      AND today_catch_reset_at < ${boundaryIso}
  `;
}

/** GET：只返回今日收获数（来自 users.today_catch） */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await ensureReset(session.id);

  const { rows } = await sql/*sql*/`
    SELECT today_catch
    FROM users
    WHERE id = ${session.id}
  `;
  const today_catch = rows.length ? Number(rows[0].today_catch) || 0 : 0;

  return NextResponse.json({ today_catch });
}

/** POST：钓鱼成功则 +1 今日收获，并写公告事件 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { fishId } = await req.json();

  try {
    // 1) 从池塘移除 → 写入 catches
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

    // 2) 公告事件
    await sql/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id)
      SELECT 'CATCH', ${session.id}, ${fishId}, owner_id
      FROM (SELECT owner_id FROM fish WHERE id = ${fishId}) t
    `;

    // 3) 确保 4 点边界重置后，再 +1 今日收获
    await ensureReset(session.id);
    await sql/*sql*/`
      UPDATE users
      SET today_catch = today_catch + 1
      WHERE id = ${session.id}
    `;

    // 可选：把最新 today_catch 一并返回，便于前端即时更新
    const { rows: urows } = await sql/*sql*/`
      SELECT today_catch FROM users WHERE id = ${session.id}
    `;
    const today_catch = urows.length ? Number(urows[0].today_catch) || 0 : 0;

    return NextResponse.json({ ok: true, today_catch });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
