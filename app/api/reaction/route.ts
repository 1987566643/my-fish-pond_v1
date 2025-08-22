import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 计算“今天(北京时区) 4:00 边界”的 [startISO, endISO]（UTC 时间） */
function bj4Window() {
  const nowUtcMs = Date.now();
  const BJ_OFFSET = 8 * 3600_000;

  // 把当前时刻换算成“北京时间”的日历（通过 +8h）
  const bjNow = new Date(nowUtcMs + BJ_OFFSET);

  // 取出“北京日历”的年月日
  const y = bjNow.getUTCFullYear();
  const m = bjNow.getUTCMonth();
  const d = bjNow.getUTCDate();

  // 这个 y-m-d 是“北京这一天”的日期。北京当天 00:00 (BJ) 换算到 UTC 就是 Date.UTC(y,m,d,0) - 8h
  const bjMidnightUtcMs = Date.UTC(y, m, d, 0, 0, 0, 0) - BJ_OFFSET;

  // 北京 04:00 对应 UTC = 北京 00:00(UTC) + 4h
  const startMs = bjMidnightUtcMs + 4 * 3600_000;
  const endMs = startMs + 24 * 3600_000;

  return {
    startISO: new Date(startMs).toISOString(),
    endISO: new Date(endMs).toISOString(),
  };
}

/** 点赞 / 点踩（幂等 + 可取消 + 可切换） */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const fishId = String(body.fishId || '');
  const raw = Number(body.value);
  if (!fishId || (raw !== 1 && raw !== -1)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  const value = raw as 1 | -1;

  const { startISO, endISO } = bj4Window();

  try {
    // 1) 查我今天对这条鱼是否已有投票
    const { rows: exists } = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (exists.length) {
      const cur = Number(exists[0].value);
      if (cur === value) {
        // —— 再次点击同一个：取消本日投票 —— //
        await sql/*sql*/`
          DELETE FROM reactions
          WHERE id = ${exists[0].id}
        `;
      } else {
        // —— 切换（赞 <-> 踩）：直接改值，并把时间戳刷新到现在 —— //
        await sql/*sql*/`
          UPDATE reactions
          SET value = ${value}, created_at = NOW()
          WHERE id = ${exists[0].id}
        `;
      }
    } else {
      // —— 今天第一次投票：插入一条记录 —— //
      await sql/*sql*/`
        INSERT INTO reactions (fish_id, user_id, value)
        VALUES (${fishId}, ${session.id}, ${value})
      `;
    }

    // 2) 汇总总计（历史维度，不按天过滤）
    const { rows: agg } = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1  THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = Number(agg?.[0]?.likes ?? 0);
    const dislikes = Number(agg?.[0]?.dislikes ?? 0);

    // 3) 取我今天的最新态，给前端渲染“取消点赞/点踩”的提示
    const { rows: my } = await sql/*sql*/`
      SELECT value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const my_vote: 1 | -1 | null = my.length ? (Number(my[0].value) === 1 ? 1 : -1) : null;

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    // 保守返回 500
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
