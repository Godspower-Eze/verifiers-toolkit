import VerifyWorkspace from '@/components/VerifyWorkspace';

export const metadata = {
  title: 'Verify Proof - Cairo Verifiers Toolkit',
};

export default function VerifyPage() {
  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' as const }}>
      <VerifyWorkspace />
    </main>
  );
}
