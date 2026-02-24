import VkWorkspace from '@/components/VkWorkspace';

export const metadata = {
  title: 'Upload VK - Cairo Verifiers Toolkit',
};

export default function VkPage() {
  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-200">
      <VkWorkspace />
    </main>
  );
}
