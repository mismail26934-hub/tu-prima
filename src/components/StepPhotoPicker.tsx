"use client";

import { useRef, useState } from "react";
import {
  compressStepPhotoFiles,
  type StepPhotoDraft,
} from "@/lib/step-photo-client";
import {
  MAX_STEP_PHOTOS,
  type StepPhotoRef,
} from "@/lib/step-photo-url";
import { useT } from "@/i18n/useT";

export function StepPhotoPicker({
  existing,
  drafts,
  onDraftsChange,
  onRemoveExisting,
  disabled,
  required,
}: {
  existing: StepPhotoRef[];
  drafts: StepPhotoDraft[];
  onDraftsChange: (drafts: StepPhotoDraft[]) => void;
  onRemoveExisting?: (photoId: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const t = useT();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remaining = Math.max(0, MAX_STEP_PHOTOS - existing.length - drafts.length);
  const canAdd = !disabled && !busy && remaining > 0;

  async function onPick(list: FileList | null, input: HTMLInputElement | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const next = await compressStepPhotoFiles(files.slice(0, remaining));
      onDraftsChange([...drafts, ...next].slice(0, MAX_STEP_PHOTOS - existing.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("job.stepPhotoError"));
    } finally {
      setBusy(false);
      if (input) input.value = "";
    }
  }

  return (
    <div className="step-photo-picker">
      <p className="field-hint" style={{ marginTop: 0 }}>
        {t("job.stepPhotoHint")}
        {required ? ` ${t("job.stepPhotoRequired")}` : ""}{" "}
        {t("job.stepPhotoMax").replace("{max}", String(MAX_STEP_PHOTOS))}
      </p>
      {existing.length || drafts.length ? (
        <div className="step-photo-grid">
          {existing.map((photo) => (
            <div className="step-photo-tile" key={photo.id}>
              <img
                src={photo.thumb_url || photo.url}
                alt=""
                loading="lazy"
                decoding="async"
              />
              {onRemoveExisting && !disabled ? (
                <button
                  type="button"
                  className="step-photo-tile-remove"
                  onClick={() => onRemoveExisting(photo.id)}
                  aria-label={t("job.stepPhotoRemove")}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {drafts.map((draft, i) => (
            <div className="step-photo-tile" key={`draft-${i}-${draft.name}`}>
              <img src={draft.previewUrl} alt="" decoding="async" />
              {!disabled ? (
                <button
                  type="button"
                  className="step-photo-tile-remove"
                  onClick={() =>
                    onDraftsChange(drafts.filter((_, idx) => idx !== i))
                  }
                  aria-label={t("job.stepPhotoRemove")}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="step-photo-empty">{t("job.stepPhotoNone")}</div>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={!canAdd}
        onChange={(e) => void onPick(e.target.files, e.currentTarget)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={!canAdd}
        onChange={(e) => void onPick(e.target.files, e.currentTarget)}
      />
      <div className="step-photo-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canAdd}
          onClick={() => cameraRef.current?.click()}
        >
          {busy ? t("job.stepPhotoCompressing") : t("job.stepPhotoPick")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canAdd}
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
