import { Suspense } from 'react';
import EditorWorkspace from '@/components/EditorWorkspace';

export const metadata = {
  title: 'Cairo Verifier Generator',
  description: 'Compile Circom circuits and generate Cairo Groth16 verifiers using Garaga.',
};

export default function Home() {
  return (
    <Suspense fallback={<div className="loading">Loading editor…</div>}>
      <EditorWorkspace />
    </Suspense>
  );
}
