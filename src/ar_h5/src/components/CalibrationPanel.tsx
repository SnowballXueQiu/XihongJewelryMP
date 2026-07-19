import { RotateCcw, X } from "lucide-react";
import type { UserCalibration } from "../types/ar";
import { DEFAULT_USER_CALIBRATION } from "../data/products";

type Props = {
  value: UserCalibration;
  occlusion: boolean;
  onChange: (value: UserCalibration) => void;
  onOcclusionChange: (value: boolean) => void;
  onClose: () => void;
};

type Field = {
  key: keyof UserCalibration;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
};

const FIELDS: Field[] = [
  { key: "scale", label: "尺寸", min: 0.7, max: 1.35, step: 0.01, format: (value) => `${Math.round(value * 100)}%` },
  { key: "offsetX", label: "横向", min: -70, max: 70, step: 1, format: (value) => `${Math.round(value)}` },
  { key: "offsetY", label: "纵向", min: -70, max: 70, step: 1, format: (value) => `${Math.round(value)}` },
  { key: "rotation", label: "旋转", min: -0.8, max: 0.8, step: 0.01, format: (value) => `${Math.round((value * 180) / Math.PI)}°` },
];

export function CalibrationPanel({
  value,
  occlusion,
  onChange,
  onOcclusionChange,
  onClose,
}: Props) {
  return (
    <aside className="calibration-panel" aria-label="模型标定">
      <div className="calibration-panel__header">
        <div>
          <strong>模型标定</strong>
          <span>当前首饰</span>
        </div>
        <div className="calibration-panel__actions">
          <button
            type="button"
            className="icon-button icon-button--dark"
            aria-label="重置标定"
            title="重置标定"
            onClick={() => onChange(DEFAULT_USER_CALIBRATION)}
          >
            <RotateCcw size={18} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--dark"
            aria-label="关闭标定"
            title="关闭"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="calibration-fields">
        {FIELDS.map((field) => (
          <label key={field.key} className="calibration-field">
            <span>
              <b>{field.label}</b>
              <output>{field.format(value[field.key])}</output>
            </span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={value[field.key]}
              onChange={(event) =>
                onChange({ ...value, [field.key]: Number(event.currentTarget.value) })
              }
            />
          </label>
        ))}
      </div>

      <label className="occlusion-toggle">
        <span>
          <b>手腕遮挡</b>
          <small>隐藏首饰背侧</small>
        </span>
        <input
          type="checkbox"
          checked={occlusion}
          onChange={(event) => onOcclusionChange(event.currentTarget.checked)}
        />
        <span className="toggle-track" aria-hidden="true"><span /></span>
      </label>
    </aside>
  );
}
