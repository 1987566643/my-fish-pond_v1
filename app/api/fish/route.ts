import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** —— 计算“北京时间 4:00”为边界的今天起止，并转 UTC ISO，供 SQL 绑定 —— */
function beijing4amBoundsISO() {
  const now = new Date();
  // 北京时间相对 UTC 偏移 +8
  const bjNow = new Date(now.getTime() + 8 * 3600_000);
  const y = bjNow.getUTCFullYear();
  const m = bjNow.getUTCMonth();
  const d = bjNow.getUTCDate();
  // 当天 04:00 (北京时间) -> 减去 8 小时转成 UTC
  let startBj = new Date(Date.UTC(y, m, d, 4, 0, 0, 0));
  // 如果当前时间（北京时间）还没到 4 点，边界用“昨天 4 点”
  if (bjNow.getUTCHours() < 4) {
    startBj = new Date(startBj.getTime() - 24 * 3600_000);
  }
  const startUtc = new Date(startBj.getTime() - 8 * 3600_000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600_000);
  return { startISO: startUtc.toISOString(), endISO: endUtc.toISOString() };
}

/** 列池塘里的鱼（聚合总点赞/点踩；如果登录，返回今天我的投票 my_vote） */
export async function GET() {
  const session = await getSession().catch(() => null);
  const hasUser = !!session?.id;

  try {
    // 基本鱼 + 总计数
    const { rows: fish } = await sql/*sql*/`
      SELECT
        f.id, f.name, f.data_url, f.w, f.h, f.created_at, f.in_pond,
        u.username AS owner_name,
        COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 ELSE 0 END),0)::int AS likes,
        COALESCE(SUM(CASE WHEN r.value =-1 THEN 1 ELSE 0 END),0)::int AS dislikes
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      LEFT JOIN reactions r ON r.fish_id = f.id
      WHERE f.in_pond = TRUE
      GROUP BY f.id, u.username
      ORDER BY f.created_at DESC
    `;

    // 可选：查出“今天我对这些鱼的最后一次投票”
    let myVotes: Record<string, 1 | -1> = {};
    if (hasUser && fish.length) {
      const { startISO, endISO } = beijing4amBoundsISO();
      const fishIds = fish.map(f => f.id);
      const { rows: mv } = await sql/*sql*/`
        SELECT sub.fish_id, sub.value
        FROM (
          SELECT r.fish_id,
                 r.value,
                 ROW_NUMBER() OVER (PARTITION BY r.fish_id ORDER BY r.created_at DESC) AS rn
          FROM reactions r
          WHERE r.user_id = ${session!.id}
            AND r.fish_id = ANY(${fishIds})
            AND r.created_at >= ${startISO}
            AND r.created_at <  ${endISO}
        ) sub
        WHERE sub.rn = 1
      `;
      myVotes = Object.create(null);
      for (const row of mv as any[]) {
        const v = row.value;
        if (v === 1 || v === -1) myVotes[row.fish_id] = v;
      }
    }

    const withVote = fish.map((f: any) => ({
      ...f,
      my_vote: myVotes[f.id] ?? null,
    }));

    return NextResponse.json({ ok: true, fish: withVote });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/** 画布保存鱼（入池 + 公告） */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();

  if (!name || !data_url || !w || !h) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    // 1) 存鱼
    const { rows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id
    `;
    const fishId = rows[0].id as string;

    // 2) 公告：ADD 事件
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
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
