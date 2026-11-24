"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Registers the service worker and shows "Install CDEMS" when the browser allows it. */
export function InstallApp() {
  const [prompt, setPrompt] = React.useState<InstallPrompt | null>(null);
  React.useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  if (!prompt) return null;
  return (
    <Button size="sm" variant="outline" title="Add CDEMS to your desktop and Start menu"
      onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>
      <Download /> Install CDEMS
    </Button>
  );
}
