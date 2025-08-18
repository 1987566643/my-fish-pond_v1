import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/** 每天 4:00 为边界；若当前时间早于 4 点，则边界取昨天 4 点 */
function boundary4AM(d = new Date()) {
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0, 0);
  if (d.getTime() < b.getTime()) b.setDate(b.getDate() - 1);
  return b;
}

/** 确保用户的 today_catch 在 4 点边界重置（若已过边界，则清零并将 reset_at 设置为本次边界） */
async function ensureReset(userId: string) {
  const boundaryIso = boundary4AM().toISOString();
  // 当 today_catch_reset_at 早于边界时，清零并更新 reset_at
  try {
    await sql/*sql*/`
      UPDATE users
      SET today_catch = 0,
          today_catch_reset_at = ${boundaryIso}
      WHERE id = ${userId}
        AND today_catch_reset_at < ${boundaryIso}
    `;
  } catch (e) {
    // 若 users 表未添加 today_catch 字段，忽略（不影响主流程）
  }
}

/** GET：返回我的收获列表 + 今日收获计数（从 users.today_catch 读取；若没有该字段则不返回） */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 确保 4 点边界重置一次
  await ensureReset(session.id);

  // 收获列表（按你的表结构，这里用 catches(angler_id, fish_id, created_at)）
  const { rows: catches } = await sql/*sql*/`
    SELECT id, fish_id, created_at
    FROM catches
    WHERE angler_id = ${session.id}
    ORDER BY created_at DESC
  `;

  // 读取今日收获计数
  let today_catch: number | undefined = undefined;
  try {
    const { rows: urows } = await sql/*sql*/`
      SELECT today_catch FROM users WHERE id = ${session.id}
    `;
    if (urows.length) {
      today_catch = Number(urows[0].today_catch) || 0;
    }
  } catch {
    // 若字段不存在，保持 undefined，前端可用本地 4 点边界兜底
  }

  return NextResponse.json({ fish: catches, today_catch });
}

/** POST：尝试钓鱼；成功则写入 catches、写事件，并把 users.today_catch 在 4 点边界下自增 1 */
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

    // 公告：记录 CATCH 事件
    await sql/*sql*/`
      INSERT INTO pond_events (type, actor_id, target_fish_id, target_owner_id)
      SELECT 'CATCH', ${session.id}, ${fishId}, owner_id
      FROM (SELECT owner_id FROM fish WHERE id = ${fishId}) t
    `;

    // —— 今日收获统计（4 点重置后 +1）——
    try {
      await ensureReset(session.id);
      await sql/*sql*/`
        UPDATE users
        SET today_catch = today_catch + 1
        WHERE id = ${session.id}
      `;
    } catch {
      // 若 users 表未添加 today_catch 字段，不影响主流程
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
