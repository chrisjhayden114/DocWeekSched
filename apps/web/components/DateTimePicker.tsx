import { useId } from "react";

export type DateTimePickerProps = {
  name: string;
  label: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  onChange?: (value: string) => void;
  /** Help text under the field */
  hint?: string;
};

/**
 * Design-system date-time control. Uses datetime-local under the hood
 * with consistent label styling; swap implementation later without call-site churn.
 */
export function DateTimePicker({
  name,
  label,
  value,
  defaultValue,
  required,
  disabled,
  onChange,
  hint,
}: DateTimePickerProps) {
  const id = useId();
  return (
    <label className="field-label" htmlFor={id}>
      <span className="field-label-text">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        id={id}
        className="input"
        type="datetime-local"
        name={name}
        required={required}
        disabled={disabled}
        {...(value !== undefined
          ? { value, onChange: (e) => onChange?.(e.target.value) }
          : { defaultValue: defaultValue || undefined })}
      />
      {hint ? <span className="text-meta">{hint}</span> : null}
    </label>
  );
}
