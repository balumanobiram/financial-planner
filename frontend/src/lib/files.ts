/** Reading a picked file in the browser, for APIs that take base64 inside JSON (nothing touches disk). */

/** "data:text/csv;base64,AAAA" → "AAAA" (what FileReader.readAsDataURL gives us). */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(base64FromDataUrl(String(reader.result)));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file"));
    reader.readAsDataURL(file);
  });
}
