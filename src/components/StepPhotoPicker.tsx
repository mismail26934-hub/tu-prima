"use client";

import { useRef, useState } from "react";
import {
  compressStepPhotoFile,
  type StepPhotoDraft,
} from "@/lib/step-photo-client";
import { useT } from "@/i18n/useT";

export function StepPhotoPicker({
  existingUrl,
  draft,
  onChange,
  disabled,
  required,
}: {
  existingUrl?: string;
  draft: StepPhotoDraft | null;
  onChange: (draft: StepPhotoDraft | null) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const t = useT();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = draft?.previewUrl || existingUrl || "";

  async function onPick(
    file: File | undefined,
    input: HTMLInputElement | null
  ) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await compressStepPhotoFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("job.stepPhotoError"));
      onChange(null);
    } finally {
      setBusy(false);
      if (input) input.value = "";
    }
  }

  return (
    <div className="step-photo-picker">
      <p className="field-hint" style={{ marginTop: 0 }}>
        {t("job.stepPhotoHint")}
        {required ? ` ${t("job.stepPhotoRequired")}` : ""}
      </p>
      {preview ? (
        <img
          className="step-photo-preview"
          src={preview}
          alt={t("job.stepPhoto")}
        />
      ) : (
        <div className="step-photo-empty">{t("job.stepPhotoNone")}</div>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={disabled || busy}
        onChange={(e) => void onPick(e.target.files?.[0], e.currentTarget)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        hidden
        disabled={disabled || busy}
        onChange={(e) => void onPick(e.target.files?.[0], e.currentTarget)}
      />
      <div className="step-photo-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || busy}
          onClick={() => cameraRef.current?.click()}
        >
          {busy
            ? t("job.stepPhotoCompressing")
            : preview
              ? t("job.stepPhotoReplace")
              : t("job.stepPhotoPick")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || busy}
          onClick={() => galleryRef.current?.click()}
        >
          {t("job.stepPhotoGallery")}
        </button>
      </div>
      {error ? (
        <p className="field-hint" style={{ color: "var(--error-text)", marginBottom: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
