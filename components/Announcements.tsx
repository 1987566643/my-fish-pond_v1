
'use client';
import useSWR from 'swr';

const fetcher = (u:string)=>fetch(u).then(r=>r.json());

export default function Announcements(){
  const { data } = useSWR('/api/announcements?limit=60', fetcher, { refreshInterval: 5000 });
  const items = data?.events || [];
  return (
    <div>
      <h3 style={{margin:'8px 0'}}>公告栏</h3>
      <ul style={{listStyle:'none', padding:0, margin:0, display:'grid', gap:8}}>
        {items.map((ev:any, i:number)=>(
          <li key={i} className="muted">
            {ev.type==='ADD' ? '📢'
             : ev.type==='CATCH' ? '🎣'
             : ev.type==='RELEASE' ? '🪣'
             : ev.type==='DELETE' ? '🗑️' : '📌'}{' '}
            
            <strong>{ev.actor_name || ev.actor_username}</strong>{' '}
            {ev.type==='ADD' && <>放入了「{ev.fish_name}」</>}
            {ev.type==='CATCH' && <>钓走了 <strong>{ev.target_owner_name || ev.owner_username}</strong> 的「{ev.fish_name}」</>}
            {ev.type==='RELEASE' && <>放回了「{ev.fish_name}」</>}
            {ev.type==='DELETE' && <>删除了「{ev.fish_name}」</>}
            <div style={{fontSize:12, opacity:.7}}>{new Date(ev.created_at).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
