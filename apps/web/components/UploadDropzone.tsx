import { useCallback, useId, useRef, useState } from "react";

export type UploadDropzoneProps = {
  accept?: string;
  maxBytes?: number;
  label?: string;
  hint?: string;
  disabled?: boolean;
  onFile: (file: File) => void | Promise<void>;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Styled upload dropzone replacing native "Choose File" inputs.
 * Shows filename, size, and limit.
 */
export function UploadDropzone({
  accept = "image/*",
  maxBytes = 4_500_000,
  label = "Upload file",
  hint,
  disabled,
  onFile,
}: UploadDropzoneProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || disabled) return;
      setError(null);
      if (file.size > maxBytes) {
        setError(`File exceeds ${formatBytes(maxBytes)} limit`);
        setFileMeta(null);
        return;
      }
      setFileMeta({ name: file.name, size: file.size });
      setBusy(true);
      try {
        await onFile(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    },
    [disabled, maxBytes, onFile],
  );

  return (
    <div className="upload-dropzone-wrap">
      <span className="field-label-text">{label}</span>
      <div
        className={`upload-dropzone${dragOver ? " is-dragover" : ""}${disabled ? " is-disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-disabled={disabled}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          disabled={disabled || busy}
          className="upload-dropzone-input"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        {fileMeta ? (
          <p className="text-body-md" style={{ margin: 0 }}>
            <strong>{fileMeta.name}</strong>
            <span className="text-meta"> · {formatBytes(fileMeta.size)}</span>
          </p>
        ) : (
          <p className="text-body-md" style={{ margin: 0 }}>
            Drop a file here or <span style={{ color: "var(--primary-700)", fontWeight: 700 }}>browse</span>
          </p>
        )}
        <p className="text-meta" style={{ margin: "var(--space-1) 0 0" }}>
          {hint || `Max ${formatBytes(maxBytes)}`}
          {busy ? " · Uploading…" : ""}
        </p>
      </div>
      {error ? (
        <p className="text-meta" style={{ color: "var(--danger-700)", margin: "var(--space-1) 0 0" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
