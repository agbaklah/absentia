import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fmtBytes } from "@/lib/expenses";
import { PdfPages } from "@/components/PdfPages";
import { cn } from "@/lib/utils";

export type ViewerFile = {
  name: string;
  mime: string;
  size: number;
  /** Signed URL (private bucket) or object URL for a not-yet-uploaded file. */
  url: string | null;
};

/**
 * In-app preview for receipts: images zoom/pan, PDFs render inline, anything
 * else offers a download. Arrow keys / buttons step through several files.
 */
export function ReceiptViewer({
  files,
  index,
  onIndexChange,
  onClose,
}: {
  files: ViewerFile[];
  /** null = closed */
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const open = index !== null && index >= 0 && index < files.length;
  const file = open ? files[index] : null;

  useEffect(() => {
    setZoom(1);
    setLoaded(false);
  }, [index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index! < files.length - 1) onIndexChange(index! + 1);
      if (e.key === "ArrowLeft" && index! > 0) onIndexChange(index! - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, files.length, onIndexChange]);

  const isImage = file?.mime.startsWith("image/") ?? false;
  const isPdf = file?.mime === "application/pdf";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="z-[70] flex h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
            {file?.name}
            {file && (
              <span className="ml-2 font-normal text-muted-foreground">{fmtBytes(file.size)}</span>
            )}
          </DialogTitle>
          {files.length > 1 && (
            <span className="text-xs text-muted-foreground tabular">
              {index! + 1} / {files.length}
            </span>
          )}
          {(isImage || isPdf) && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center text-xs tabular">{Math.round(zoom * 100)}%</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </>
          )}
          {file?.url && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="mr-6 h-8 w-8"
              aria-label="Open original"
            >
              <a href={file.url} target="_blank" rel="noreferrer" download={file.name}>
                <Download className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>

        <div className="relative flex-1 overflow-auto bg-muted/40">
          {file && !file.url && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing preview…
            </div>
          )}
          {file?.url && isImage && (
            <div className="flex min-h-full items-center justify-center p-4">
              {!loaded && (
                <Loader2 className="absolute h-5 w-5 animate-spin text-muted-foreground" />
              )}
              <img
                src={file.url}
                alt={file.name}
                onLoad={() => setLoaded(true)}
                onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
                className={cn(
                  "max-w-none cursor-zoom-in select-none transition-transform",
                  zoom !== 1 && "cursor-zoom-out",
                )}
                style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? "100%" : undefined }}
              />
            </div>
          )}
          {file?.url && isPdf && <PdfPages url={file.url} zoom={zoom} />}
          {file?.url && !isImage && !isPdf && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <FileText className="h-10 w-10 opacity-50" />
              No inline preview for this file type.
              <Button asChild variant="outline" size="sm">
                <a href={file.url} target="_blank" rel="noreferrer" download={file.name}>
                  <Download className="h-4 w-4" /> Download {file.name}
                </a>
              </Button>
            </div>
          )}

          {files.length > 1 && (
            <>
              <Button
                variant="secondary"
                size="icon"
                className="absolute left-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full shadow"
                disabled={index! <= 0}
                onClick={() => onIndexChange(index! - 1)}
                aria-label="Previous"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full shadow"
                disabled={index! >= files.length - 1}
                onClick={() => onIndexChange(index! + 1)}
                aria-label="Next"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
