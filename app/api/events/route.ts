import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';

/**
 * /api/events
 * - 兼容两种存储：
 *   A) 新方案：pond_events 自带快照列 fish_name / owner_username / actor_username
 *   B) 旧方案：无快照列，则回退用 JOIN fish/users 取名称，并用别名返回
 */
export async function GET() {
  try {
    // 检查是否存在快照列（fish_name）
    const { rows: cols } = await sql/*sql*/`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'pond_events' AND column_name = 'fish_name'
      LIMIT 1
    `;
    const hasSnapshot = cols.length > 0;

    if (hasSnapshot) {
      // 新：只读快照列（历史稳定，不会因为鱼被删而变空）
      const { rows } = await sql/*sql*/`
        SELECT
          id, type, created_at,
          actor_id, target_fish_id, target_owner_id,
          fish_name, owner_username, actor_username
        FROM pond_events
        ORDER BY created_at DESC
        LIMIT 50
      `;
      return NextResponse.json({ ok: true, events: rows });
    }

    // 旧：没有快照列时，用 JOIN 补齐，并把名称字段别名成快照名，避免前端改动
    const { rows } = await sql/*sql*/`
      SELECT
        e.id, e.type, e.created_at,
        e.actor_id, e.target_fish_id, e.target_owner_id,
        COALESCE(f.name, '')        AS fish_name,
        COALESCE(u_owner.username,'') AS owner_username,
        COALESCE(u_actor.username,'') AS actor_username
      FROM pond_events e
      LEFT JOIN fish   f       ON f.id       = e.target_fish_id
      LEFT JOIN users  u_owner ON u_owner.id = e.target_owner_id
      LEFT JOIN users  u_actor ON u_actor.id = e.actor_id
      ORDER BY e.created_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ ok: true, events: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

