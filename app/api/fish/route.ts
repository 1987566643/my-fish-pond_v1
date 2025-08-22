import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function bj4WindowISO() {
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 3600_000);
  const day4 = new Date(bjNow.getFullYear(), bjNow.getMonth(), bjNow.getDate(), 4, 0, 0, 0);
  const startBJ = bjNow.getTime() < day4.getTime() ? new Date(day4.getTime() - 86400_000) : day4;
  const endBJ = new Date(startBJ.getTime() + 86400_000);
  return {
    startISO: new Date(startBJ.getTime() - 8 * 3600_000).toISOString(),
    endISO: new Date(endBJ.getTime() - 8 * 3600_000).toISOString(),
  };
}

/** 列池塘里的鱼（含聚合 likes/dislikes；如已登录，附带今天 my_vote） */
export async function GET() {
  const session = await getSession().catch(() => null);
  const userIdParam = session?.id ?? '00000000-0000-0000-0000-000000000000';
  const { startISO, endISO } = bj4WindowISO();

  try {
    const { rows } = await sql/*sql*/`
      SELECT
        f.id, f.name, f.data_url, f.w, f.h, f.created_at, f.in_pond,
        u.username AS owner_name,
        COALESCE(agg.likes, 0)::int AS likes,
        COALESCE(agg.dislikes, 0)::int AS dislikes,
        mv.value AS my_vote
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      LEFT JOIN (
        SELECT fish_id,
               SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS likes,
               SUM(CASE WHEN value =-1 THEN 1 ELSE 0 END) AS dislikes
        FROM reactions
        GROUP BY fish_id
      ) agg ON agg.fish_id = f.id
      LEFT JOIN LATERAL (
        SELECT r.value
        FROM reactions r
        WHERE r.fish_id = f.id
          AND r.user_id = ${userIdParam}
          AND r.created_at >= ${startISO}
          AND r.created_at <  ${endISO}
        ORDER BY r.created_at DESC
        LIMIT 1
      ) mv ON TRUE
      WHERE f.in_pond = TRUE
      ORDER BY f.created_at DESC
    `;
    return NextResponse.json({ ok: true, fish: rows });
  } catch {
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
