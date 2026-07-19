import type { FaceMode } from "../types/ar";

const MODES: Array<{ value: FaceMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "front", label: "正面" },
  { value: "back", label: "背面" },
];

type Props = {
  value: FaceMode;
  onChange: (mode: FaceMode) => void;
};

export function FaceModeControl({ value, onChange }: Props) {
  return (
    <div className="face-control" role="group" aria-label="首饰朝向">
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={value === mode.value ? "is-active" : undefined}
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
