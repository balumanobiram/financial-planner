import { ImageUp } from "lucide-react";
import { useId, useRef, useState, type ChangeEvent } from "react";

import { readAsBase64 } from "../../lib/files";
import { cn } from "../../lib/cn";
import { BankLogo } from "./BankLogo";
import { Button } from "./Button";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // same limit as the backend
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** Client-side check before uploading; the server re-checks (and re-encodes) anyway. */
export function checkLogoFile(file: { type: string; size: number }): string | null {
  if (!ACCEPT.split(",").includes(file.type)) return "Pick a PNG, JPG, WEBP or GIF image.";
  if (file.size > MAX_LOGO_BYTES) return "That image is over 2 MB. Crop or resize it first.";
  return null;
}

type Props = {
  bankName: string;
  logo: string | null;
  uploading: boolean;
  /** Server error from the last upload, if any. */
  error?: string;
  onUpload: (contentBase64: string) => void;
};

/** Current logo + "Upload image": for banks whose website only offers a tiny, blurry icon. */
export function LogoUploadField({ bankName, logo, uploading, error, onUpload }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again still fires onChange
    if (!file) return;
    const problem = checkLogoFile(file);
    setFileError(problem);
    if (!problem) onUpload(await readAsBase64(file));
  };

  const message = fileError ?? error;
  return (
    <div>
      <p id={id} className="mb-1.5 text-sm font-medium">
        Bank logo
      </p>
      <div className="flex items-center gap-3">
        <BankLogo name={bankName} logo={logo} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploading}
          aria-describedby={`${id}-message`}
          icon={<ImageUp className="size-3.5" aria-hidden />}
          onClick={() => input.current?.click()}
        >
          Upload image
        </Button>
        <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={pick} aria-labelledby={id} />
      </div>
      <p id={`${id}-message`} className={cn("mt-1.5 text-xs", message ? "font-medium text-negative" : "text-muted")}>
        {message ?? `Blurry or missing? Upload a logo image — it's used for every ${bankName || "bank"} account and card.`}
      </p>
    </div>
  );
}
