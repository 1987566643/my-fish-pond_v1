import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 规则（幂等）：
 * - body: { fishId: string, value: 1 | -1 }
 * - 如果数据库当前是同一个 value => 这次点击视为“取消”（置为 NULL）
 * - 如果数据库是相反值或为空 => 置为这次的 value
 * - 返回：{ ok, likes, dislikes, my_vote }
 *
 * 注意：本实现假设 reactions 主键是 (fish_id, user_id) 或有唯一约束。
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fishId = String(body.fishId || '');
  const rawVal = Number(body.value);
  const value = rawVal === 1 ? 1 : rawVal === -1 ? -1 : null;

  if (!fishId || value === null) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  try {
    // 读取当前我的投票
    const cur = await sql/*sql*/`
      SELECT value
      FROM reactions
      WHERE fish_id = ${fishId} AND user_id = ${session.id}
      LIMIT 1
    `;

    const current: 1 | -1 | null = cur.rows.length ? (cur.rows[0].value === 1 ? 1 : cur.rows[0].value === -1 ? -1 : null) : null;

    // 目标状态：同值 => 取消（NULL）；不同或无 => 设置为 value
    const next: 1 | -1 | null = current === value ? null : value;

    if (cur.rows.length === 0) {
      // 首次写入（或并发下可能撞唯一约束，catch 里再走更新）
      if (next === null) {
        // 点击就取消且本来没有记录：什么也不用做
      } else {
        try {
          await sql/*sql*/`
            INSERT INTO reactions (fish_id, user_id, value)
            VALUES (${fishId}, ${session.id}, ${next})
          `;
        } catch {
          // 唯一键冲突等并发情况，回退为 UPDATE
          await sql/*sql*/`
            UPDATE reactions
            SET value = ${next}
            WHERE fish_id = ${fishId} AND user_id = ${session.id}
          `;
        }
      }
    } else {
      // 已有记录，直接更新或清空
      await sql/*sql*/`
        UPDATE reactions
        SET value = ${next}
        WHERE fish_id = ${fishId} AND user_id = ${session.id}
      `;
    }

    // 聚合这条鱼的票数 + 我当前的投票
    const agg = await sql/*sql*/`
      SELECT
        SUM(CASE WHEN value = 1  THEN 1 ELSE 0 END)::int  AS likes,
        SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END)::int  AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const mine = await sql/*sql*/`
      SELECT value
      FROM reactions
      WHERE fish_id = ${fishId} AND user_id = ${session.id}
      LIMIT 1
    `;

    const likes = Number(agg.rows?.[0]?.likes ?? 0);
    const dislikes = Number(agg.rows?.[0]?.dislikes ?? 0);
    const my_vote = mine.rows.length ? (mine.rows[0].value === 1 ? 1 : mine.rows[0].value === -1 ? -1 : null) : null;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    // 尽量避免 500 让前端误判；但这里确实是服务器异常
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
