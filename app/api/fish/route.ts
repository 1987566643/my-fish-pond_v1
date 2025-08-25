import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 计算“北京时间4点为界”的 day_key：YYYYMMDD */
function bj4DayKey(date = new Date()): string {
  // 把当前时刻加 4 小时再取 UTC 日期，等价于（UTC+8 时区的当天 4 点为界）
  const t = new Date(date.getTime() + 4 * 3600_000);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${y}${pad(m)}${pad(d)}`;
}

/** 列池塘里的鱼（带总赞/总踩 + 我今天的投票 my_vote） */
export async function GET() {
  // 未登录也允许看池塘；my_vote 将返回 NULL
  const session = await getSession().catch(() => null);
  const userId = session?.id ?? null; // 关键：不要用三元插模板，统一传参数
  const dayKey = bj4DayKey();

  try {
    const { rows } = await sql/*sql*/`
      SELECT
        f.id,
        f.name,
        f.data_url,
        f.w,
        f.h,
        f.created_at,
        f.in_pond,
        u.username AS owner_name,

        -- 累计点赞
        (
          SELECT COUNT(*)::int
          FROM reactions r1
          WHERE r1.fish_id = f.id AND r1.value = 1
        ) AS likes,

        -- 累计点踩
        (
          SELECT COUNT(*)::int
          FROM reactions r2
          WHERE r2.fish_id = f.id AND r2.value = -1
        ) AS dislikes,

        -- 我今天的投票（1 / -1 / NULL）
        (
          SELECT rx.value
          FROM reactions rx
          WHERE rx.fish_id = f.id
            AND rx.user_id = ${userId}
            AND rx.day_key = ${dayKey}
          LIMIT 1
        ) AS my_vote

      FROM fish f
      JOIN users u ON u.id = f.owner_id
      WHERE f.in_pond = TRUE
      ORDER BY f.created_at DESC
    `;

    return NextResponse.json({ ok: true, fish: rows });
  } catch (e) {
    console.error('GET /api/fish failed', e);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}



/** 画布保存鱼（入池，公告写 ADD） */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();
  if (!name || !data_url || !w || !h) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  try {
    const inserted = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id
    `;
    const fishId = inserted.rows[0].id as string;

    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id,
         fish_name, actor_username, owner_username)
      VALUES
        ('ADD', ${session.id}, ${fishId}, ${session.id},
         ${name},
         (SELECT username FROM users WHERE id = ${session.id}),
         (SELECT username FROM users WHERE id = ${session.id}))
    `;

    return NextResponse.json({ ok: true, id: fishId });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
