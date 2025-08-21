import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 列池塘里的鱼（读取 fish.likes/dislikes；登录时带出 my_vote） */
export async function GET() {
  const session = await getSession();

  try {
    if (session) {
      // 已登录：把“我今天的投票（以北京时间 4 点为日界）”一起返回
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
          f.likes::int    AS likes,
          f.dislikes::int AS dislikes,
          r.value         AS my_vote         -- 1 / -1 / null
        FROM fish f
        JOIN users u ON u.id = f.owner_id
        LEFT JOIN reactions r
               ON r.fish_id = f.id
              AND r.user_id = ${session.id}
              AND r.day_key = ((now() at time zone 'Asia/Shanghai') - interval '4 hours')::date
        WHERE f.in_pond = TRUE
        ORDER BY f.created_at DESC
      `;
      return NextResponse.json({ ok: true, fish: rows });
    } else {
      // 未登录：my_vote 恒为 null
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
          f.likes::int    AS likes,
          f.dislikes::int AS dislikes,
          NULL::smallint  AS my_vote
        FROM fish f
        JOIN users u ON u.id = f.owner_id
        WHERE f.in_pond = TRUE
        ORDER BY f.created_at DESC
      `;
      return NextResponse.json({ ok: true, fish: rows });
    }
  } catch (e) {
    console.error('GET /api/fish failed', e);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/** 画布保存鱼 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const name = (payload?.name ?? '').toString();
  const data_url = payload?.data_url as string;
  const w = Number(payload?.w) || 1;
  const h = Number(payload?.h) || 1;

  if (!data_url) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    // 1) 存鱼（likes/dislikes 由表默认值 0 保证）
    const { rows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id
    `;
    const fishId = rows[0].id as string;

    // 2) 公告：ADD 事件，写快照字段，避免后续改名影响历史公告
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
        ${name},
        (SELECT username FROM users WHERE id = ${session.id}),
        (SELECT username FROM users WHERE id = ${session.id})
      )
    `;

    return NextResponse.json({ ok: true, id: fishId });
  } catch (e) {
    console.error('POST /api/fish failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
