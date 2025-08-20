import { NextResponse } from 'next/server';
import { sql } from '../../../../../lib/db';
import { getSessionUserId } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

type MyDrawnRow = {
  id: string;
  name: string;
  data_url: string;
  in_pond: boolean;
  caught: boolean;
};

type MyCatchRow = {
  catch_id: string;
  fish_id: string;
  name: string;
  data_url: string;
  owner_id: string;
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 我画的鱼（判断是否已被钓走）
  const myDrawn = await sql<MyDrawnRow[]>/*sql*/`
    SELECT
      f.id,
      f.name,
      f.data_url,
      f.in_pond,
      (c.id IS NOT NULL) AS caught
    FROM fish f
    LEFT JOIN catches c ON c.fish_id = f.id
    WHERE f.owner_id = ${userId}
    ORDER BY f.created_at DESC
  `;

  // 我的收获
  const myCatch = await sql<MyCatchRow[]>/*sql*/`
    SELECT
      c.id       AS catch_id,
      f.id       AS fish_id,
      f.name,
      f.data_url,
      f.owner_id AS owner_id
    FROM catches c
    JOIN fish f ON f.id = c.fish_id
    WHERE c.angler_id = ${userId}
    ORDER BY c.created_at DESC
  `;

  return NextResponse.json({ myDrawn, myCatch }, { status: 200 });
}
