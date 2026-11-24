import type { MetadataRoute } from "next";

// Lets Chrome/Edge "Install CDEMS" as a desktop app with its own icon and window.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CDEMS · Capstone Defense Evaluation and Management System",
    short_name: "CDEMS",
    description: "JHCSC School of Computing Studies capstone defense scheduling, grading and documents.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a1726",
    theme_color: "#0a1726",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
