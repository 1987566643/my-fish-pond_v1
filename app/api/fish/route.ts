import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 计算“北京时间 4 点”为一天边界的 [start,end) ISO 字符串（UTC 时间） */
function bj4amRangeISO() {
  const nowUTC = Date.now();
  const bjNow = new Date(nowUTC + 8 * 3600_000); // 把“现在”平移到东八区再读 UTC 字段 == 读到的是北京时间
  const y = bjNow.getUTCFullYear();
  const m = bjNow.getUTCMonth();
  const d = bjNow.getUTCDate();
  const hourBJ = bjNow.getUTCHours(); // 这里读到的是北京时间的小时

  // 今天 4:00（北京）的 UTC 时间 = Date.UTC(y,m,d, 4-8)
  let startUtcMs = Date.UTC(y, m, d, -4, 0, 0, 0); // 4-8 = -4
  if (hourBJ < 4) {
    // 若当前北京时间 <4 点，则边界是“昨天 4:00”
    startUtcMs -= 24 * 3600_000;
  }
  const endUtcMs = startUtcMs + 24 * 3600_000;
  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
  };
}

/** 列池塘里的鱼（聚合 likes/dislikes；若已登录再返回当天 my_vote） */
export async function GET() {
  const session = await getSession().catch(() => null);
  try {
    if (session) {
      const { startIso, endIso } = bj4amRangeISO();
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
          COALESCE(SUM(CASE WHEN r.value = 1  THEN 1 ELSE 0 END),0)::int AS likes,
          COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END),0)::int AS dislikes,
          mv.value AS my_vote
        FROM fish f
        JOIN users u ON u.id = f.owner_id
        LEFT JOIN reactions r ON r.fish_id = f.id
        /* 取当日这位用户对该鱼的最新一次投票作为 my_vote */
        LEFT JOIN LATERAL (
          SELECT value
          FROM reactions r2
          WHERE r2.fish_id = f.id
            AND r2.user_id = ${session.id}
            AND r2.created_at >= ${startIso}
            AND r2.created_at <  ${endIso}
          ORDER BY r2.created_at DESC
          LIMIT 1
        ) AS mv ON TRUE
        WHERE f.in_pond = TRUE
        GROUP BY f.id, u.username, mv.value
        ORDER BY f.created_at DESC
      `;
      return NextResponse.json({ ok: true, fish: rows });
    } else {
      // 未登录也允许浏览（无 my_vote）
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
          COALESCE(SUM(CASE WHEN r.value = 1  THEN 1 ELSE 0 END),0)::int AS likes,
          COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END),0)::int AS dislikes
        FROM fish f
        JOIN users u ON u.id = f.owner_id
        LEFT JOIN reactions r ON r.fish_id = f.id
        WHERE f.in_pond = TRUE
        GROUP BY f.id, u.username
        ORDER BY f.created_at DESC
      `;
      return NextResponse.json({ ok: true, fish: rows });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/** 画布保存鱼 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();
  const safeName: string = (name ?? '').toString().trim() || `无名鱼-${String(Date.now()).slice(-5)}`;

  try {
    // 1) 存鱼（在池塘）
    const { rows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${safeName}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id
    `;
    const fishId = rows[0].id as string;

    // 2) 公告：ADD 事件（落快照字段）
    await sql/*sql*/`
      INSERT INTO pond_events (
        type, actor_id, target_fish_id, target_owner_id,
        fish_name, actor_username, owner_username
      )
      VALUES (
        'ADD',
        ${session.id},
        ${fishId},
        ${session.id},
        ${safeName},
        (SELECT username FROM users WHERE id = ${session.id}),
        (SELECT username FROM users WHERE id = ${session.id})
      )
    `;

    return NextResponse.json({ ok: true, id: fishId });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
