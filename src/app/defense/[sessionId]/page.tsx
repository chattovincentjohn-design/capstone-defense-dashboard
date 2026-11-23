import { DefenseWorkspace } from "@/components/defense/workspace";

export default async function DefensePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <DefenseWorkspace sessionId={sessionId} />;
}
