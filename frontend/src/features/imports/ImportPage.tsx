import { ArrowLeft, CircleCheck, FileSpreadsheet, ShieldCheck, Upload } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router";

import { useAccounts } from "../../api/accounts";
import { useCards } from "../../api/cards";
import {
  useParseImport,
  usePreviewImport,
  type ColumnMapping,
  type ImportFile,
  type ImportPreview,
  type ParseResult,
} from "../../api/imports";
import { Page } from "../../components/layout/Page";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { SelectField } from "../../components/ui/Field";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { base64FromDataUrl, checkFile, defaultSelection, importSource, initialMapping } from "./importForm";
import { MappingStep } from "./MappingStep";
import { ReviewStep } from "./ReviewStep";

type Step = "file" | "map" | "review" | "done";

const STEPS: Array<{ key: Exclude<Step, "done">; label: string }> = [
  { key: "file", label: "File" },
  { key: "map", label: "Columns" },
  { key: "review", label: "Review" },
];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(base64FromDataUrl(String(reader.result)));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Statement import wizard. The file lives only in this component's memory (as base64) and is
 * re-sent for each step; the server parses it in memory too and never stores it.
 */
export function ImportPage() {
  const [params] = useSearchParams();
  const initialSource = params.get("card_id") ? `card:${params.get("card_id")}` : params.get("account_id") ? `account:${params.get("account_id")}` : "";

  const accounts = useAccounts();
  const cards = useCards();
  const previewImport = usePreviewImport();
  const parseImport = useParseImport();

  const [step, setStep] = useState<Step>("file");
  const [source, setSource] = useState(initialSource);
  const [file, setFile] = useState<ImportFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [mappingFrom, setMappingFrom] = useState<"saved" | "suggested" | "blank">("blank");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [created, setCreated] = useState(0);

  const activeAccounts = (accounts.data?.items ?? []).filter((a) => !a.is_archived);
  const activeCards = (cards.data?.items ?? []).filter((c) => !c.is_archived);
  const apiSource = importSource(source);
  const isCard = source.startsWith("card:");
  const sourceName =
    activeCards.find((c) => `card:${c.id}` === source)?.card_name ?? activeAccounts.find((a) => `account:${a.id}` === source)?.nickname ?? "";

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // picking the same file again should still fire onChange
    if (!picked) return;
    const problem = checkFile(picked);
    setFileError(problem);
    setFile(null);
    if (problem) return;
    try {
      setFile({ filename: picked.name, content_base64: await readAsBase64(picked) });
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Couldn't read the file");
    }
  };

  const loadPreview = (headerRow?: number) => {
    if (!file || !apiSource) return;
    previewImport.mutate(
      { file, source: apiSource, ...(headerRow === undefined ? {} : { header_row: headerRow }) },
      {
        onSuccess: (p) => {
          setPreview(p);
          const initial = initialMapping(p, isCard);
          // Changing the heading row keeps what you picked if those columns still exist.
          const keep = headerRow !== undefined && mapping && [mapping.date_column, ...mapping.description_columns].every((c) => p.columns.includes(c));
          setMapping(keep ? { ...mapping, header_row: p.header_row } : initial.mapping);
          if (!keep) setMappingFrom(initial.from);
          setStep("map");
        },
      },
    );
  };

  const runParse = (m: ColumnMapping) => {
    if (!file || !apiSource) return;
    setMapping(m);
    parseImport.mutate(
      { file, source: apiSource, mapping: m },
      {
        onSuccess: (result) => {
          setParsed(result);
          setSelected(defaultSelection(result.rows));
          setStep("review");
        },
      },
    );
  };

  const restart = () => {
    setStep("file");
    setFile(null);
    setPreview(null);
    setParsed(null);
    previewImport.reset();
    parseImport.reset();
  };

  return (
    <Page title="Import statement" subtitle="Bring in transactions from your bank or card's CSV / Excel export">
      <div className="max-w-5xl space-y-5">
        {step !== "done" && <Stepper current={step} />}

        {step === "file" && (
          <Card className="space-y-5">
            <SelectField label="Which account or card is this statement for?" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Choose…</option>
              {activeCards.length > 0 && (
                <optgroup label="Cards">
                  {activeCards.map((c) => (
                    <option key={c.id} value={`card:${c.id}`}>
                      {c.bank_name} · {c.card_name}
                      {c.last4 ? ` ••${c.last4}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {activeAccounts.length > 0 && (
                <optgroup label="Bank accounts">
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={`account:${a.id}`}>
                      {a.bank_name} · {a.nickname}
                    </option>
                  ))}
                </optgroup>
              )}
            </SelectField>

            <label
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                "focus-within:border-primary hover:border-primary hover:bg-tint-blue/40",
                file ? "border-primary bg-tint-blue/40" : "border-line",
              )}
            >
              <span className="grid size-12 place-items-center rounded-full bg-tint-blue text-tint-blue-fg">
                {file ? <FileSpreadsheet className="size-6" aria-hidden /> : <Upload className="size-6" aria-hidden />}
              </span>
              <span className="font-semibold">{file ? file.filename : "Choose a statement file"}</span>
              <span className="text-sm text-muted">{file ? "Tap to choose a different file" : ".csv or .xlsx, up to 5 MB"}</span>
              <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={onPick} />
            </label>
            {fileError && <Notice tone="error">{fileError}</Notice>}
            {previewImport.isError && <Notice tone="error">{previewImport.error.message}</Notice>}

            <p className="flex items-start gap-2 text-xs text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              The file is read in memory and never saved — only the column layout is remembered for next time.
            </p>

            <div className="flex justify-end">
              <Button disabled={!file || !apiSource} loading={previewImport.isPending} onClick={() => loadPreview()}>
                Next: check columns
              </Button>
            </div>
          </Card>
        )}

        {step === "map" && preview && mapping && (
          <MappingStep
            preview={preview}
            mapping={mapping}
            from={mappingFrom}
            sourceName={sourceName}
            reloading={previewImport.isPending}
            parsing={parseImport.isPending}
            error={parseImport.isError ? parseImport.error.message : previewImport.isError ? previewImport.error.message : undefined}
            onHeaderRow={(row) => loadPreview(row)}
            onBack={restart}
            onNext={runParse}
          />
        )}

        {step === "review" && parsed && mapping && apiSource && (
          <ReviewStep
            parsed={parsed}
            mapping={mapping}
            source={apiSource}
            sourceName={sourceName}
            selected={selected}
            onSelected={setSelected}
            onBack={() => setStep("map")}
            onDone={(n) => {
              setCreated(n);
              setStep("done");
            }}
          />
        )}

        {step === "done" && (
          <Card flush className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-tint-blue text-tint-blue-fg">
              <CircleCheck className="size-7" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">
              Imported {created} {created === 1 ? "transaction" : "transactions"}
            </h2>
            <p className="max-w-sm text-sm text-muted">
              Balances are updated. They're tagged <span className="font-medium text-ink">#imported</span> so you can find and tidy them later.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Link
                to={`/transactions?${new URLSearchParams({ ...(apiSource ?? {}), q: "imported" })}`}
                className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg hover:bg-primary-hover"
              >
                See them
              </Link>
              <Button variant="secondary" onClick={restart}>
                Import another file
              </Button>
            </div>
          </Card>
        )}

        {step === "file" && (
          <Link to="/transactions" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden />
            Transactions
          </Link>
        )}
      </div>
    </Page>
  );
}

function Stepper({ current }: { current: Exclude<Step, "done"> }) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2" aria-current={i === index ? "step" : undefined}>
          <span
            className={cn(
              "grid size-7 place-items-center rounded-full text-xs font-bold",
              i < index ? "bg-primary text-primary-fg" : i === index ? "bg-tint-blue text-primary ring-2 ring-primary" : "bg-surface-muted text-muted",
            )}
          >
            {i + 1}
          </span>
          <span className={cn("font-medium", i === index ? "text-ink" : "text-muted max-sm:sr-only")}>{s.label}</span>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-line sm:w-10" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
