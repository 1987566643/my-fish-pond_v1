import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { sql } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: { id: string } };

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const fishId = params.id;

  try {
    const res = await sql/*sql*/`
      UPDATE fish
      SET in_pond = FALSE
      WHERE id = ${fishId}
        AND owner_id = ${session.id}
        AND in_pond = TRUE
      RETURNING id, name
    `;
    if (res.rows.length === 0) {
      return NextResponse.json({ ok: true }); // 幂等
    }

    const fishName = res.rows[0].name as string;

    await sql/*sql*/`
      INSERT INTO pond_events
        (type, actor_id, target_fish_id, target_owner_id,
         fish_name, actor_username, owner_username)
      VALUES
        ('DELETE', ${session.id}, ${fishId}, ${session.id},
         ${fishName},
         (SELECT username FROM users WHERE id = ${session.id}),
         (SELECT username FROM users WHERE id = ${session.id}))
    `;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
