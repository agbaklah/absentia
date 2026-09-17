import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Renders every page of a PDF to canvases with pdf.js — no browser plugin
 * needed, so previews work on phones and in embedded webviews. The library
 * (~400 KB) is loaded on first use only.
 */
export function PdfPages({ url, zoom = 1 }: { url: string; zoom?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    setState("loading");
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        setPages(doc.numPages);
        const width = Math.max(320, (el.clientWidth || 800) - 32) * zoom;
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${width}px`;
          canvas.className = "mx-auto mb-3 block bg-white shadow";
          el.appendChild(canvas);
          await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
        }
        if (!cancelled) setState("ready");
      } catch (e) {
        console.error(e);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, zoom]);

  return (
    <div className="relative min-h-full p-4">
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering PDF…
        </div>
      )}
      {state === "error" && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Could not render this PDF — use the download button to open it.
        </div>
      )}
      <div ref={host} />
      {state === "ready" && pages > 1 && (
        <div className="text-center text-xs text-muted-foreground">{pages} pages</div>
      )}
    </div>
  );
}
