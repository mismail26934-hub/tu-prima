"use client";

import { useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import {
  readStepNotePdfFile,
  type StepNotePdfDraft,
} from "@/lib/step-note-file-client";

type Props = {
  existingName?: string;
  existingUrl?: string;
  draft?: StepNotePdfDraft | null;
  removed?: boolean;
  disabled?: boolean;
  onDraftChange: (draft: StepNotePdfDraft | null) => void;
  onRemoveExisting?: () => void;
};

export function StepNotePdfPicker({
  existingName,
  existingUrl,
  draft,
  removed,
  disabled,
  onDraftChange,
  onRemoveExisting,
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const showExisting = Boolean(existingName && existingUrl && !removed && !draft);
  const fileLabel = draft?.name || existingName || "";

  return (
    <div className="step-note-pdf">
      <span className="field-hint">{t("job.stepNotePdf")}</span>
      <p className="field-hint step-note-pdf-hint">{t("job.stepNotePdfHint")}</p>
      {fileLabel ? (
        <div className="step-note-pdf-file" title={fileLabel}>
          {showExisting && existingUrl ? (
            <a href={existingUrl} target="_blank" rel="noreferrer">
              {fileLabel}
            </a>
          ) : (
            <span>{fileLabel}</span>
          )}
        </div>
      ) : null}
      {!disabled ? (
        <div className="step-note-pdf-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t(draft || showExisting ? "job.stepNotePdfReplace" : "job.stepNotePdfPick")}
          </button>
          {draft ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                onDraftChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              {t("job.stepNotePdfClear")}
            </button>
          ) : null}
          {showExisting && onRemoveExisting ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onRemoveExisting}
            >
              {t("job.stepNotePdfRemove")}
            </button>
          ) : null}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        disabled={disabled || busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError("");
          try {
            onDraftChange(await readStepNotePdfFile(file));
          } catch (err) {
            onDraftChange(null);
            setError(err instanceof Error ? err.message : t("job.stepNotePdfError"));
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <p className="field-hint step-note-pdf-error">{error}</p> : null}
    </div>
  );
}
