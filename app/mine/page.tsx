import MyMineClient from '../../components/MyMineClient';

export default async function MinePage() {
  return (
    <main style={{ padding: '16px' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>我的</h1>
      <MyMineClient />
    </main>
  );
}

