/**
 * Save a Blob as a file. A temporary object URL + <a download> works in desktop browsers,
 * Android Chrome and iOS Safari (which opens its PDF preview with Share / Save to Files).
 * The URL is released after a minute rather than immediately: iOS opens the preview after
 * the click returns, and revoking right away gives it a dead link.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link); // Firefox needs it in the document
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
