import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET：列池塘里的鱼（稳定版）
 * - 仅过滤 in_pond=TRUE
 * - 聚合 reactions 当前快照（每个 user 对每条鱼一条记录），统计 value=1 / -1 数
 * - 不做“按天窗口”过滤，避免把返回吃空
 * - my_vote 可选：如需前端高亮，可读取当前用户对每条鱼的 value
 */
export async function GET() {
  // 前端不一定需要 my_vote；如果取到了 session 就顺便带上
  const session = await getSession().catch(() => null);

  try {
    // 基础列表（池塘里的鱼）
    const { rows: fish } = await sql/*sql*/`
      SELECT
        f.id,
        f.name,
        f.data_url,
        f.w,
        f.h,
        f.created_at,
        f.in_pond,
        u.username AS owner_name
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      WHERE f.in_pond IS TRUE
      ORDER BY f.created_at DESC
    `;

    if (fish.length === 0) {
      return NextResponse.json({ ok: true, fish: [] });
    }

    // 汇总点赞/点踩（基于 reactions 当前快照表：每个 user 对每条鱼一条，仅统计 value）
    const { rows: agg } = await sql/*sql*/`
      SELECT
        r.fish_id,
        COALESCE(SUM(CASE WHEN r.value = 1  THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions r
      WHERE r.fish_id = ANY(${fish.map((f: any) => f.id)})
      GROUP BY r.fish_id
    `;
    const aggMap = new Map<string, { likes: number; dislikes: number }>();
    for (const a of agg as any[]) {
      aggMap.set(a.fish_id, { likes: Number(a.likes) || 0, dislikes: Number(a.dislikes) || 0 });
    }

    // 如果拿到了 session，再取一下“我对这些鱼的投票”用于前端高亮（可选）
    let myMap = new Map<string, 1 | -1 | null>();
    if (session?.id) {
      const { rows: mine } = await sql/*sql*/`
        SELECT fish_id, value
        FROM reactions
        WHERE user_id = ${session.id}
          AND fish_id = ANY(${fish.map((f: any) => f.id)})
      `;
      myMap = new Map(mine.map((r: any) => [r.fish_id as string, (r.value === 1 || r.value === -1) ? r.value : null]));
    }

    const list = (fish as any[]).map((f) => ({
      id: f.id,
      name: f.name,
      data_url: f.data_url,
      w: f.w,
      h: f.h,
      created_at: f.created_at,
      owner_name: f.owner_name,
      likes: aggMap.get(f.id)?.likes ?? 0,
      dislikes: aggMap.get(f.id)?.dislikes ?? 0,
      my_vote: myMap.get(f.id) ?? null,
    }));

    return NextResponse.json({ ok: true, fish: list });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/**
 * POST：保存新鱼
 * - 记得写 in_pond = TRUE，否则 GET 查不到
 * - 写一条 ADD 公告
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name, data_url, w, h } = await req.json();

  try {
    const { rows } = await sql/*sql*/`
      INSERT INTO fish (owner_id, name, data_url, w, h, in_pond)
      VALUES (${session.id}, ${name}, ${data_url}, ${w}, ${h}, TRUE)
      RETURNING id
    `;
    const fishId = rows[0].id as string;

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
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
