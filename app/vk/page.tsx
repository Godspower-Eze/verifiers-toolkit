import VkWorkspace from '@/components/VkWorkspace';

export const metadata = {
  title: 'Upload VK - Cairo Verifiers Toolkit',
};

export default function VkPage() {
  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' as const }}>
      <VkWorkspace />
    </main>
  );
}
