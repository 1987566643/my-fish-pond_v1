// /app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 点赞/点踩（再次点击同一按钮就是取消，value 可以为 1 / -1 / 0）
 * 规则：
 * - reactions 以 (fish_id, user_id) 唯一；总是 UPSERT 覆盖 value
 * - 计数使用聚合：SUM(value=1)、SUM(value=-1)，不会重复累计
 * - 返回 { ok, likes, dislikes, my_vote }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fishId = String(body.fishId || '');
  // 允许 1 / -1 / 0（0 代表取消）
  const raw = Number(body.value);
  const value = raw === 1 ? 1 : raw === -1 ? -1 : 0;

  if (!fishId || !Number.isFinite(value)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  try {
    // 1) UPSERT：覆盖本用户对该鱼的投票
    // 如果表里有 updated_at 列，更推荐更新 updated_at；没有就更新 created_at 也行。
    await sql/*sql*/`
      INSERT INTO reactions (fish_id, user_id, value, created_at)
      VALUES (${fishId}, ${session.id}, ${value}, NOW())
      ON CONFLICT (fish_id, user_id)
      DO UPDATE SET
        value = EXCLUDED.value,
        created_at = NOW()
    `;

    // 2) 聚合最新计数
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;

    // 3) 当前用户的最新状态
    const mine = await sql/*sql*/`
      SELECT value
      FROM reactions
      WHERE fish_id = ${fishId} AND user_id = ${session.id}
      LIMIT 1
    `;

    const likes = Number(agg.rows?.[0]?.likes ?? 0);
    const dislikes = Number(agg.rows?.[0]?.dislikes ?? 0);
    const my_vote_raw = Number(mine.rows?.[0]?.value ?? 0);
    const my_vote: 1 | -1 | null =
      my_vote_raw === 1 ? 1 : my_vote_raw === -1 ? -1 : null;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    // 兜底日志，便于快速定位
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
