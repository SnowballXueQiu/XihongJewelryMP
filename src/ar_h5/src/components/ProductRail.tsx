import { Check } from "lucide-react";
import type { JewelryProduct } from "../types/ar";

type Props = {
  products: JewelryProduct[];
  selectedId: string;
  onSelect: (product: JewelryProduct) => void;
};

export function ProductRail({ products, selectedId, onSelect }: Props) {
  return (
    <div className="product-rail" aria-label="选择首饰">
      {products.map((product) => {
        const selected = product.id === selectedId;
        return (
          <button
            key={product.id}
            type="button"
            className={`product-option${selected ? " product-option--selected" : ""}`}
            aria-pressed={selected}
            onClick={() => onSelect(product)}
          >
            <span className={`product-option__visual product-option__visual--${product.metal}`} aria-hidden="true">
              <span style={{ borderColor: product.accent }} />
            </span>
            <span className="product-option__copy">
              <strong>{product.name}</strong>
              <small>{product.subtitle}</small>
            </span>
            {selected ? <Check className="product-option__check" size={14} strokeWidth={2.4} /> : null}
          </button>
        );
      })}
    </div>
  );
}
