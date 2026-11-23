"use client";
import * as React from "react";
import { Check, Copy, ExternalLink, Lock, Save, Shuffle, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateRegistrationCode } from "@/lib/admin";
import type { AccessSettings } from "@/lib/types";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

/**
 * Open/close switch, shareable link and access code for a public page
 * (group registration or faculty sign-up).
 */
export function AccessCodeCard({ title, description, path, prefix, audience, load, save }: {
  title: string;
  description: string;
  /** Public page, e.g. "/register". */
  path: string;
  /** Code prefix, e.g. "SCS" or "FAC". */
  prefix: string;
  /** Who the link and code go to, e.g. "group leaders". */
  audience: string;
  load: () => Promise<AccessSettings>;
  save: (s: AccessSettings) => Promise<void>;
}) {
  const [settings, setSettings] = React.useState<AccessSettings | null>(null);
  const [codeDraft, setCodeDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = React.useState<"link" | "code" | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const s = await load();
      setSettings(s);
      setCodeDraft(s.access_code);
    } catch (e) {
      setNotice({ ok: false, text: `Could not load settings: ${errorText(e)}` });
    }
  }, [load]);
  React.useEffect(() => { void reload(); }, [reload]);

  const apply = async (next: AccessSettings, ok: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await save(next);
      setNotice({ ok: true, text: ok });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const link = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  const codeChanged = !!settings && codeDraft.trim() !== settings.access_code;
  const copy = (what: "link" | "code", text: string) =>
    void navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(null), 2000); });

  const regenerate = () => {
    if (!settings) return;
    const code = generateRegistrationCode(prefix);
    setCodeDraft(code);
    void apply({ ...settings, access_code: code },
      settings.is_open ? `New code ${code} saved. The old code no longer works; share the new one.` : `New code ${code} saved.`);
  };
  const open = () => {
    const code = codeDraft.trim().length >= 4 ? codeDraft.trim() : generateRegistrationCode(prefix);
    setCodeDraft(code);
    void apply({ is_open: true, access_code: code }, `Now open with code ${code}. Share the link and code with ${audience}.`);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {settings && (settings.is_open
          ? <Badge variant="success"><Unlock className="size-3" /> Open</Badge>
          : <Badge variant="muted"><Lock className="size-3" /> Closed</Badge>)}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        {notice && <p role="status" className={notice.ok ? "text-sm text-success" : "text-sm text-destructive"}>{notice.text}</p>}
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-link`}>Link to share with {audience}</Label>
          <div className="flex gap-2">
            <Input id={`${prefix}-link`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={() => copy("link", link)}>
              {copied === "link" ? <Check /> : <Copy />} {copied === "link" ? "Copied" : "Copy"}
            </Button>
            <Button asChild variant="ghost" size="icon" aria-label={`Open ${title}`}><a href={path} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor={`${prefix}-code`}>Code</Label>
            <div className="flex gap-2">
              <Input id={`${prefix}-code`} value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} placeholder="Click Generate, or type your own"
                autoComplete="off" className="font-mono" />
              <Button type="button" variant="outline" disabled={!codeDraft.trim()} aria-label="Copy code" onClick={() => copy("code", codeDraft.trim())}>
                {copied === "code" ? <Check /> : <Copy />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Generate makes a random code and saves it. You can also type your own (at least 4 characters) and click Save. Not case-sensitive.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy || !settings} onClick={regenerate}><Shuffle /> Generate code</Button>
            {codeChanged && (
              <Button type="button" variant="outline" disabled={busy}
                onClick={() => settings && void apply({ ...settings, access_code: codeDraft }, "Code saved.")}><Save /> Save</Button>
            )}
          </div>
          {settings?.is_open ? (
            <Button type="button" variant="destructive" disabled={busy}
              onClick={() => void apply({ is_open: false, access_code: codeDraft }, "Now closed. The page no longer accepts submissions.")}>
              <Lock /> Close
            </Button>
          ) : (
            <Button type="button" disabled={busy || !settings} onClick={open}><Unlock /> Open</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
