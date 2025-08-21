import { NextResponse } from 'next/server';
import { sql } from '../../../../../lib/db';
import { getSession } from '../../../../../lib/auth';

// 点赞 / 取消赞
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const fishId = params.id;
  const userId = session.id;

  try {
    // 查询当天是否已有投票
    const { rows: existing } = await sql/*sql*/`
      SELECT id, vote_type
      FROM fish_votes
      WHERE user_id = ${userId} AND fish_id = ${fishId}
        AND date_trunc('day', created_at AT TIME ZONE 'Asia/Shanghai') = date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')
    `;

    if (existing.length > 0) {
      const prev = existing[0];
      if (prev.vote_type === 'LIKE') {
        // 再次点赞 → 取消
        await sql/*sql*/`DELETE FROM fish_votes WHERE id = ${prev.id}`;
        await sql/*sql*/`UPDATE fish SET likes = likes - 1 WHERE id = ${fishId}`;
        return NextResponse.json({ status: 'unliked' });
      } else {
        // 点踩 → 改为点赞
        await sql/*sql*/`UPDATE fish_votes SET vote_type = 'LIKE', created_at = now() WHERE id = ${prev.id}`;
        await sql/*sql*/`UPDATE fish SET dislikes = dislikes - 1, likes = likes + 1 WHERE id = ${fishId}`;
        return NextResponse.json({ status: 'changed_to_like' });
      }
    } else {
      // 新增点赞
      await sql/*sql*/`
        INSERT INTO fish_votes (user_id, fish_id, vote_type)
        VALUES (${userId}, ${fishId}, 'LIKE')
      `;
      await sql/*sql*/`UPDATE fish SET likes = likes + 1 WHERE id = ${fishId}`;
      return NextResponse.json({ status: 'liked' });
    }
  } catch (err) {
    console.error('POST /fish/[id]/like error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

