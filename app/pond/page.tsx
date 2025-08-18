import { getSession } from '../../lib/auth';
import { redirect } from 'next/navigation';
import PondClient from '../../components/PondClient';

export default async function PondPage(){
  const session = await getSession();
  if(!session) redirect('/login');
  return (
    <div className="panel" style={{padding:0}}>
      <PondClient />
    </div>
  );
}
