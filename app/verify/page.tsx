import VerifyWorkspace from '@/components/VerifyWorkspace';

export const metadata = {
  title: 'Verify Proof - Cairo Verifiers Toolkit',
};

export default function VerifyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-200">
      <VerifyWorkspace />
    </main>
  );
}
