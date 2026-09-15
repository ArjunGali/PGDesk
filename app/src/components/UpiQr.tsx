import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * A UPI payment QR, drawn locally.
 *
 * Generating it here rather than calling an image service keeps the app
 * working on a property with no internet beyond its own LAN, and means a
 * tenant's payment details never leave the premises.
 */
export function UpiQr({
  upiId,
  payeeName,
  amount,
  note,
  size = 220,
}: {
  upiId: string;
  payeeName?: string;
  amount?: string;
  note?: string;
  size?: number;
}) {
  const payload = useMemo(() => {
    const params = new URLSearchParams();
    params.set('pa', upiId);
    if (payeeName) params.set('pn', payeeName);
    if (amount && Number(amount) > 0) params.set('am', Number(amount).toFixed(2));
    params.set('cu', 'INR');
    if (note) params.set('tn', note);
    return `upi://pay?${params.toString()}`;
  }, [amount, note, payeeName, upiId]);

  // Encoding is left to a proven library: a QR code that a phone camera
  // cannot read is worse than no QR code at all, and the format's masking and
  // error-correction rules are not worth reimplementing for one screen.
  const matrix = useMemo(() => {
    try {
      // Type 0 picks the smallest version that fits; M tolerates a scuffed
      // screen or an awkward angle without needing a bigger code.
      const qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      const count = qr.getModuleCount();
      return Array.from({ length: count }, (_, y) =>
        Array.from({ length: count }, (_, x) => (qr.isDark(y, x) ? 1 : 0)),
      );
    } catch {
      return null;
    }
  }, [payload]);

  if (!matrix) {
    return (
      <p className="text-sm text-ink-muted text-center">
        This UPI ID is too long to show as a QR code.
      </p>
    );
  }

  const modules = matrix.length;
  const quiet = 2;
  const total = modules + quiet * 2;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* White ground and dark modules: QR scanners need the contrast, so this
          one element stays light in both themes. */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${total} ${total}`}
        role="img"
        aria-label={`UPI QR code for ${upiId}`}
        className="rounded-lg"
        shapeRendering="crispEdges"
      >
        <rect width={total} height={total} fill="#ffffff" />
        {matrix.map((row, y) =>
          row.map((on, x) =>
            on ? (
              <rect
                key={`${x}-${y}`}
                x={x + quiet}
                y={y + quiet}
                width={1}
                height={1}
                fill="#111111"
              />
            ) : null,
          ),
        )}
      </svg>
      <p className="text-xs text-ink-muted tabular">{upiId}</p>
    </div>
  );
}
