import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/** 计算“北京时间 4 点”为边界的 day_key（在 SQL 里算） */
const DAY_KEY_SQL = `((now() at time zone 'Asia/Shanghai') - interval '4 hours')::date`;

type Body = {
  fishId: string;
  action: 'toggle_like' | 'toggle_dislike';
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { fishId, action } = body || ({} as Body);
  if (!fishId || (action !== 'toggle_like' && action !== 'toggle_dislike')) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    const result = await (sql as any).begin(async (tx: any) => {
      // 确认 fish 存在并加锁，避免计数竞争
      const fishRow = await tx/*sql*/`
        SELECT id, likes, dislikes
        FROM fish
        WHERE id = ${fishId}
        FOR UPDATE
      `;
      if (fishRow.rowCount === 0) {
        return { ok: false, status: 404, error: 'fish_not_found' };
      }

      // 读今天是否已有投票
      const { rows: exRows } = await tx/*sql*/`
        SELECT value
        FROM reactions
        WHERE user_id = ${session.id}
          AND fish_id = ${fishId}
          AND day_key = ${tx/*sql*/`${DAY_KEY_SQL}`}
        LIMIT 1
      `;
      const prev: 1 | -1 | null = exRows.length ? (exRows[0].value as 1 | -1) : null;

      // 计算切换后的目标状态 & 计数变化
      let newVote: 1 | -1 | null = null;
      let dLike = 0;
      let dDislike = 0;

      if (action === 'toggle_like') {
        if (prev === 1) {
          // 取消点赞
          await tx/*sql*/`
            DELETE FROM reactions
            WHERE user_id = ${session.id}
              AND fish_id = ${fishId}
              AND day_key = ${tx/*sql*/`${DAY_KEY_SQL}`}
          `;
          newVote = null;
          dLike = -1;
        } else if (prev === -1) {
          // 踩 -> 赞
          await tx/*sql*/`
            UPDATE reactions
            SET value = 1
            WHERE user_id = ${session.id}
              AND fish_id = ${fishId}
              AND day_key = ${tx/*sql*/`${DAY_KEY_SQL}`}
          `;
          newVote = 1;
          dLike = +1; dDislike = -1;
        } else {
          // 新增点赞
          await tx/*sql*/`
            INSERT INTO reactions (user_id, fish_id, day_key, value)
            VALUES (${session.id}, ${fishId}, ${tx/*sql*/`${DAY_KEY_SQL}`}, 1)
          `;
          newVote = 1;
          dLike = +1;
        }
      } else {
        // toggle_dislike
        if (prev === -1) {
          // 取消点踩
          await tx/*sql*/`
            DELETE FROM reactions
            WHERE user_id = ${session.id}
              AND fish_id = ${fishId}
              AND day_key = ${tx/*sql*/`${DAY_KEY_SQL}`}
          `;
          newVote = null;
          dDislike = -1;
        } else if (prev === 1) {
          // 赞 -> 踩
          await tx/*sql*/`
            UPDATE reactions
            SET value = -1
            WHERE user_id = ${session.id}
              AND fish_id = ${fishId}
              AND day_key = ${tx/*sql*/`${DAY_KEY_SQL}`}
          `;
          newVote = -1;
          dLike = -1; dDislike = +1;
        } else {
          // 新增点踩
          await tx/*sql*/`
            INSERT INTO reactions (user_id, fish_id, day_key, value)
            VALUES (${session.id}, ${fishId}, ${tx/*sql*/`${DAY_KEY_SQL}`}, -1)
          `;
          newVote = -1;
          dDislike = +1;
        }
      }

      // 同步累加器
      if (dLike !== 0 || dDislike !== 0) {
        await tx/*sql*/`
          UPDATE fish
          SET likes = likes + ${dLike},
              dislikes = dislikes + ${dDislike}
          WHERE id = ${fishId}
        `;
      }

      // 返回最新计数 & 我的当天投票
      const { rows: fin } = await tx/*sql*/`
        SELECT likes, dislikes FROM fish WHERE id = ${fishId}
      `;
      return {
        ok: true,
        likes: fin[0].likes as number,
        dislikes: fin[0].dislikes as number,
        my_vote: newVote as 1 | -1 | null,
      };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'server' }, { status: result.status || 500 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
