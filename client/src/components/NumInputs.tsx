// 숫자 입력: 금액(천 단위 쉼표), 비율(%)

/** 금액 입력 (천 단위 쉼표) */
export function MoneyInput({ value, onChange, disabled, placeholder }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <input
      className="num-input"
      inputMode="numeric"
      placeholder={placeholder}
      value={value == null ? '' : value.toLocaleString('ko-KR')}
      disabled={disabled}
      onChange={(e) => {
        const d = e.target.value.replace(/[^\d]/g, '');
        onChange(d ? Number(d) : null);
      }}
    />
  );
}
/** 비율 입력 (%) */
export function PctInput({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <span className="pct-input">
      <input type="number" step="0.1" min="0" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      <span>%</span>
    </span>
  );
}
