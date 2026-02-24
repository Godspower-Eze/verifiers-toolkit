export default function VkWorkspace() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-900 border-x border-slate-800">
      <h1 className="text-3xl font-bold text-slate-100 mb-4 tracking-tight">VK → Verifier</h1>
      <p className="text-slate-400 max-w-lg">
        Upload a <code className="text-indigo-400 bg-indigo-950/50 px-1 rounded">verification_key.json</code> to generate and deploy a Cairo Groth16 Verifier.
      </p>
    </div>
  );
}
