import { useCallback, useEffect, useState } from 'react';
import { Sheet } from './ui';

/**
 * The floating calculator utility.
 *
 * Rent, part-months and settlements get worked out by hand constantly, so this
 * is always one tap away. Deliberately a plain four-function calculator with
 * large keys — not a formula engine.
 */
export function Calculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [display, setDisplay] = useState('0');
  const [accumulator, setAccumulator] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [freshEntry, setFreshEntry] = useState(true);
  const [history, setHistory] = useState<string[]>([]);

  const reset = useCallback(() => {
    setDisplay('0');
    setAccumulator(null);
    setPendingOp(null);
    setFreshEntry(true);
  }, []);

  const inputDigit = useCallback(
    (digit: string) => {
      setDisplay((current) => {
        if (freshEntry) return digit;
        if (current === '0' && digit !== '.') return digit;
        if (digit === '.' && current.includes('.')) return current;
        // Stop the display overflowing its box on a narrow phone.
        if (current.replace(/[^\d]/g, '').length >= 12) return current;
        return current + digit;
      });
      setFreshEntry(false);
    },
    [freshEntry],
  );

  const applyOp = useCallback(
    (op: Op | null) => {
      const value = Number(display);
      if (pendingOp !== null && accumulator !== null && !freshEntry) {
        const result = compute(accumulator, value, pendingOp);
        setHistory((h) =>
          [`${format(accumulator)} ${SYMBOLS[pendingOp]} ${format(value)} = ${format(result)}`, ...h].slice(0, 6),
        );
        setDisplay(String(result));
        setAccumulator(op === null ? null : result);
      } else {
        setAccumulator(op === null ? null : value);
      }
      setPendingOp(op);
      setFreshEntry(true);
    },
    [accumulator, display, freshEntry, pendingOp],
  );

  // A physical keyboard is handy on a tablet with a case.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      const { key } = event;
      if (/^[0-9.]$/.test(key)) inputDigit(key);
      else if (key === '+') applyOp('add');
      else if (key === '-') applyOp('sub');
      else if (key === '*') applyOp('mul');
      else if (key === '/') { event.preventDefault(); applyOp('div'); }
      else if (key === 'Enter' || key === '=') { event.preventDefault(); applyOp(null); }
      else if (key === 'Backspace') {
        setDisplay((c) => (c.length <= 1 ? '0' : c.slice(0, -1)));
      } else if (key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, inputDigit, applyOp, reset]);

  const percent = (): void => {
    // "x% of the accumulator" is what rent workings actually need.
    const value = Number(display);
    const base = accumulator ?? 0;
    const result = pendingOp ? (base * value) / 100 : value / 100;
    setDisplay(String(round(result)));
    setFreshEntry(true);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Calculator">
      <div className="mb-3 min-h-[3.5rem] flex flex-col items-end justify-end">
        {history.length > 0 && (
          <p className="text-xs text-ink-faint tabular truncate max-w-full">{history[0]}</p>
        )}
        <output className="text-3xl font-semibold tabular tracking-tight break-all text-right">
          {formatDisplay(display)}
        </output>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Key label="C" onPress={reset} variant="function" />
        <Key label="⌫" onPress={() => setDisplay((c) => (c.length <= 1 ? '0' : c.slice(0, -1)))} variant="function" />
        <Key label="%" onPress={percent} variant="function" />
        <Key label="÷" onPress={() => applyOp('div')} variant="operator" active={pendingOp === 'div'} />

        <Key label="7" onPress={() => inputDigit('7')} />
        <Key label="8" onPress={() => inputDigit('8')} />
        <Key label="9" onPress={() => inputDigit('9')} />
        <Key label="×" onPress={() => applyOp('mul')} variant="operator" active={pendingOp === 'mul'} />

        <Key label="4" onPress={() => inputDigit('4')} />
        <Key label="5" onPress={() => inputDigit('5')} />
        <Key label="6" onPress={() => inputDigit('6')} />
        <Key label="−" onPress={() => applyOp('sub')} variant="operator" active={pendingOp === 'sub'} />

        <Key label="1" onPress={() => inputDigit('1')} />
        <Key label="2" onPress={() => inputDigit('2')} />
        <Key label="3" onPress={() => inputDigit('3')} />
        <Key label="+" onPress={() => applyOp('add')} variant="operator" active={pendingOp === 'add'} />

        <Key label="0" onPress={() => inputDigit('0')} className="col-span-2" />
        <Key label="." onPress={() => inputDigit('.')} />
        <Key label="=" onPress={() => applyOp(null)} variant="primary" />
      </div>

      {history.length > 1 && (
        <div className="mt-5 pt-4 border-t border-line">
          <p className="stat-label mb-2">Recent</p>
          <ul className="space-y-1 text-sm text-ink-muted tabular">
            {history.slice(1).map((line, i) => (
              <li key={i} className="truncate">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

type Op = 'add' | 'sub' | 'mul' | 'div';

const SYMBOLS: Record<Op, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case 'add': return round(a + b);
    case 'sub': return round(a - b);
    case 'mul': return round(a * b);
    case 'div': return b === 0 ? 0 : round(a / b);
  }
}

/** Two decimals is the only precision that matters for money. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function format(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}

function formatDisplay(raw: string): string {
  if (raw.endsWith('.')) return `${format(Number(raw.slice(0, -1)))}.`;
  const [whole, decimals] = raw.split('.');
  const formatted = format(Number(whole));
  return decimals !== undefined ? `${formatted}.${decimals}` : formatted;
}

function Key({
  label,
  onPress,
  variant = 'digit',
  active = false,
  className = '',
}: {
  label: string;
  onPress: () => void;
  variant?: 'digit' | 'operator' | 'function' | 'primary';
  active?: boolean;
  className?: string;
}) {
  const variants = {
    digit: 'bg-surface-raised text-ink border-line',
    operator: 'bg-surface-raised text-accent border-line',
    function: 'bg-surface-sunken text-ink-muted border-line',
    primary: 'bg-accent text-accent-ink border-accent',
  };
  return (
    <button
      type="button"
      onClick={onPress}
      className={`h-16 rounded-lg border text-xl font-medium transition-colors
                  active:brightness-125 ${variants[variant]}
                  ${active ? 'ring-1 ring-accent' : ''} ${className}`}
    >
      {label}
    </button>
  );
}
