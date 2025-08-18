import { getSession } from '../../lib/auth';
import { redirect } from 'next/navigation';
import { sql } from '../../lib/db';

export default async function MinePage(){
  const session = await getSession();
  if(!session) redirect('/login');

  const { rows: myFish } = await sql/*sql*/`
    SELECT f.id, f.name, f.created_at, f.in_pond,
           u2.username AS angler, c.caught_at
    FROM fish f
    LEFT JOIN catches c ON c.fish_id = f.id
    LEFT JOIN users u2 ON u2.id = c.angler_id
    WHERE f.owner_id = ${session.id}
    ORDER BY f.created_at DESC
  `;

  const { rows: myCatches } = await sql/*sql*/`
    SELECT f.id, f.name, u.username AS owner, c.caught_at
    FROM catches c
    JOIN fish f ON f.id = c.fish_id
    JOIN users u ON u.id = f.owner_id
    WHERE c.angler_id = ${session.id}
    ORDER BY c.caught_at DESC
  `;

  return (
    <div className="grid" style={{gridTemplateColumns:'1fr 1fr'}}>
      <section className="panel">
        <h3>我画的鱼</h3>
        <ul>
          {myFish.map((f:any)=>(
            <li key={f.id} style={{marginBottom:8}}>
              <strong>{f.name}</strong>
              <div className="muted" style={{fontSize:13}}>
                {f.in_pond ? '在池塘里' : f.angler ? `已被 ${f.angler} 在 ${new Date(f.caught_at).toLocaleString()} 钓走` : '状态未知'}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h3>我的收获</h3>
        <ul>
          {myCatches.map((f:any)=>(
            <li key={f.id} style={{marginBottom:8}}>
              <strong>{f.name}</strong>
              <div className="muted" style={{fontSize:13}}>
                来自 {f.owner} · {new Date(f.caught_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
