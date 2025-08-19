import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';

export async function GET() {
  const { rows } = await sql/*sql*/`
    SELECT
      id, type, created_at,
      actor_id, target_fish_id, target_owner_id,
      fish_name, owner_username, actor_username
    FROM pond_events
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return NextResponse.json({ ok: true, events: rows });

}
