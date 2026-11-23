import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CapstoneProject } from "@/lib/types";

export function ArtifactsPane({ project }: { project: CapstoneProject }) {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {project.manuscript_url && (
          <Button asChild size="sm" variant="outline">
            <a href={project.manuscript_url} target="_blank" rel="noreferrer"><FileText /> Open Manuscript</a>
          </Button>
        )}
        {project.demo_url ? (
          <Button asChild size="sm" variant="outline">
            <a href={project.demo_url} target="_blank" rel="noreferrer"><ExternalLink /> Live System Demo</a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">No live demo link (proposal stage)</span>
        )}
      </div>
      {project.abstract && (
        <p className="rounded-md border bg-background/40 p-3 text-sm"><span className="font-semibold">Abstract. </span>{project.abstract}</p>
      )}
      {project.manuscript_url ? (
        <iframe src={project.manuscript_url} title="Manuscript PDF" className="min-h-[520px] w-full flex-1 rounded-md border bg-white" />
      ) : (
        <p className="text-sm text-muted-foreground">No manuscript uploaded.</p>
      )}
    </div>
  );
}
