import { PrintRoute } from "@/components/print/print-route";

export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <PrintRoute sessionId={sessionId} doc="approval-sheet" />;
}
