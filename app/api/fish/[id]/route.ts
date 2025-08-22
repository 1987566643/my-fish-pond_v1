import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { sql } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const fishId = params.id;

  try {
    // 只允许删除“我自己画且仍在池塘里的鱼”
    const ret = await sql/*sql*/`
      UPDATE fish
      SET in_pond = FALSE
      WHERE id = ${fishId}
        AND owner_id = ${session.id}
        AND in_pond = TRUE
      RETURNING id, name
    `;

    if (ret.rows.length === 0) {
      // 幂等：已不在池塘/不属于我 → 返回 ok
      return NextResponse.json({ ok: true });
    }

    // 这里**不再**往 pond_events 写一个未被允许的类型（例如 REMOVE），
    // 若你想在公告里显示“删除了…”，请先修改数据库的 check 枚举再开启：
    // await sql`INSERT INTO pond_events(...) VALUES ('REMOVE', ...)`

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
