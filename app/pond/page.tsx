import { getSession } from '../../lib/auth';
import { redirect } from 'next/navigation';
import PondClient from '../../components/PondClient';
import Announcements from '../../components/Announcements';

export default async function PondPage(){
  const session = await getSession();
  if(!session) redirect('/login');
  return (
    <div className="panel" style={{padding:0}}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:12}}>
  <div><PondClient /></div>
  <aside className="panel" style={{maxHeight: '70vh', overflowY:'auto', padding:12}}>
    <Announcements />
  </aside>
</div>
    </div>
  );
}
