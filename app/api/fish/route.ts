import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/fish
// 返回池塘里的所有鱼（包含点赞 / 点踩数）
export async function GET() {
  try {
    const { rows } = await sql/*sql*/`
      SELECT f.id, f.name, f.data_url, f.w, f.h,
             f.in_pond, f.created_at,
             f.likes, f.dislikes,
             u.username AS owner_username
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      WHERE f.in_pond = TRUE
      ORDER BY f.created_at DESC
    `;
    return NextResponse.json({ fish: rows });
  } catch (err) {
    console.error('GET /api/fish error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

// POST /api/fish
// 用于用户新增鱼
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { name, data_url, w, h } = body;

    const { rows } = await sql/*sql*/`
      INSERT INTO fish (name, data_url, w, h, owner_id, in_pond, likes, dislikes)
      VALUES (${name}, ${data_url}, ${w}, ${h}, ${session.id}, TRUE, 0, 0)
      RETURNING id, name, data_url, w, h, in_pond, created_at, likes, dislikes
    `;

    // 记录事件：放鱼
    await sql/*sql*/`
      INSERT INTO pond_events (type, actor_id, fish_id, fish_name, created_at)
      VALUES ('ADD', ${session.id}, ${rows[0].id}, ${rows[0].name}, NOW())
    `;

    return NextResponse.json({ fish: rows[0] });
  } catch (err) {
    console.error('POST /api/fish error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

// DELETE /api/fish/:id
// 删除我的鱼（仅限自己且仍在池塘）
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fishId = searchParams.get('id');
  if (!fishId) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  try {
    const { rowCount } = await sql/*sql*/`
      DELETE FROM fish
      WHERE id = ${fishId} AND owner_id = ${session.id} AND in_pond = TRUE
    `;
    if (rowCount === 0) {
      return NextResponse.json({ error: 'forbidden_or_not_in_pond' }, { status: 403 });
    }

    // 不记录事件（删除不会出现在公告）
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/fish error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
