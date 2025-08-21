import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 计算“北京时间 4 点”为边界的今天窗口 [start, end)（UTC） */
function todayWindowBJ4(): { startIso: string; endIso: string } {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000); // UTC+8 视角
  const y = bj.getUTCFullYear();
  const m = bj.getUTCMonth();
  const d = bj.getUTCDate();
  const h = bj.getUTCHours();

  const startBJ = new Date(Date.UTC(y, m, d, 4, 0, 0, 0));
  if (h < 4) startBJ.setUTCDate(startBJ.getUTCDate() - 1);
  const endBJ = new Date(startBJ.getTime());
  endBJ.setUTCDate(endBJ.getUTCDate() + 1);

  return { startIso: startBJ.toISOString(), endIso: endBJ.toISOString() };
}

/**
 * POST /api/reaction
 * body: { fishId: string, value: 1 | -1 }
 *
 * 规则：
 * - 当天（北京 4 点为界）每个用户对每条鱼只能有一个投票（1 或 -1），可再次点击同一值“取消”；
 * - 点赞：fish.likes +1；取消点赞：likes -1；
 * - 点踩：fish.dislikes +1；取消点踩：dislikes -1；
 * - 点踩→点赞（或反之）：一个 -1 → 1（或 1 → -1），需要“对方 -1、当前 +1”。
 *
 * 返回：
 * { ok: true, my_vote: 1 | -1 | null, likes: number, dislikes: number }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { fishId, value } = await req.json().catch(() => ({} as any)) as {
    fishId?: string;
    value?: 1 | -1;
  };

  if (!fishId || (value !== 1 && value !== -1)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const { startIso, endIso } = todayWindowBJ4();

  try {
    // 1) 查池塘里是否有这条鱼（且在池塘或不限制池塘状态；此处不强制 in_pond）
    const fishRes = await sql/*sql*/`
      SELECT id, likes::int AS likes, dislikes::int AS dislikes
      FROM fish
      WHERE id = ${fishId}
      LIMIT 1
    `;
    if (fishRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'fish_not_found' }, { status: 404 });
    }

    // 2) 查“今天（4 点为界）我对该鱼的投票”
    const existing = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startIso}
        AND created_at <  ${endIso}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    let newVote: 1 | -1 | null = null;

    if (existing.rows.length === 0) {
      // —— 今天还没有投票：插入新投票，计数 +1 —— //
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      if (value === 1) {
        await sql/*sql*/`UPDATE fish SET likes = likes + 1 WHERE id = ${fishId}`;
      } else {
        await sql/*sql*/`UPDATE fish SET dislikes = dislikes + 1 WHERE id = ${fishId}`;
      }
      newVote = value;
    } else {
      const prevVal: 1 | -1 = existing.rows[0].value as 1 | -1;

      if (prevVal === value) {
        // —— 再点同一个：取消 —— //
        await sql/*sql*/`DELETE FROM reactions WHERE id = ${existing.rows[0].id}`;
        if (value === 1) {
          await sql/*sql*/`UPDATE fish SET likes = GREATEST(likes - 1, 0) WHERE id = ${fishId}`;
        } else {
          await sql/*sql*/`UPDATE fish SET dislikes = GREATEST(dislikes - 1, 0) WHERE id = ${fishId}`;
        }
        newVote = null;
      } else {
        // —— 从 -1 切到 1（或 1 切到 -1）：切换 —— //
        await sql/*sql*/`
          UPDATE reactions
          SET value = ${value}, created_at = NOW()
          WHERE id = ${existing.rows[0].id}
        `;
        if (value === 1) {
          await sql/*sql*/`
            UPDATE fish
            SET likes = likes + 1,
                dislikes = GREATEST(dislikes - 1, 0)
            WHERE id = ${fishId}
          `;
        } else {
          await sql/*sql*/`
            UPDATE fish
            SET dislikes = dislikes + 1,
                likes = GREATEST(likes - 1, 0)
            WHERE id = ${fishId}
          `;
        }
        newVote = value;
      }
    }

    // 3) 返回最新计数与我的状态
    const fresh = await sql/*sql*/`
      SELECT likes::int AS likes, dislikes::int AS dislikes
      FROM fish
      WHERE id = ${fishId}
      LIMIT 1
    `;
    const likes = fresh.rows[0].likes as number;
    const dislikes = fresh.rows[0].dislikes as number;

    // （可选）广播给前端：你可以在这里触发 SSE/WebSocket 或 window event
    // 略

    return NextResponse.json({ ok: true, my_vote: newVote, likes, dislikes });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
