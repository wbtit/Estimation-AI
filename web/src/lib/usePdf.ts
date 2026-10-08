import { useEffect, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Loads the project's stored PDF (byte-range requests; the file stays on the server). */
export function usePdf(projectId: string | null): {
  pdf: PDFDocumentProxy | null;
  error: string | null;
} {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPdf(null);
    setError(null);
    if (!projectId) return;
    const task = pdfjs.getDocument({
      url: `/api/projects/${projectId}/pdf-file`,
    });
    let alive = true;
    task.promise.then(
      (doc) => {
        if (alive) setPdf(doc);
      },
      (err: unknown) => {
        if (alive)
          setError(
            err instanceof Error ? err.message : "the PDF could not be opened",
          );
      },
    );
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [projectId]);
  return { pdf, error };
}
