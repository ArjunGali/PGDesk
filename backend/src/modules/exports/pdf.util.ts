import PDFDocument from 'pdfkit';

export type Pdf = typeof PDFDocument extends new (...args: never[]) => infer R
  ? R
  : PDFKit.PDFDocument;

/** A4 layout constants shared by every generated document. */
export const A4 = {
  width: 595.28,
  height: 841.89,
  margin: 40,
} as const;

export const INK = {
  heading: '#111111',
  body: '#333333',
  muted: '#777777',
  rule: '#CCCCCC',
  panel: '#F4F4F4',
} as const;

export function createDocument(title: string): PDFKit.PDFDocument {
  return new PDFDocument({
    size: 'A4',
    margin: A4.margin,
    info: { Title: title, Creator: 'PG Management' },
  });
}

export function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function heading(
  doc: PDFKit.PDFDocument,
  text: string,
  subtitle?: string,
): void {
  doc
    .fillColor(INK.heading)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(text, { align: 'left' });
  if (subtitle) {
    doc
      .fillColor(INK.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(subtitle);
  }
  doc.moveDown(0.6);
  rule(doc);
  doc.moveDown(0.6);
}

export function sectionTitle(doc: PDFKit.PDFDocument, text: string): void {
  doc.moveDown(0.5);
  doc
    .fillColor(INK.heading)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(text.toUpperCase(), { characterSpacing: 0.6 });
  doc.moveDown(0.25);
  rule(doc);
  doc.moveDown(0.35);
}

export function rule(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc
    .strokeColor(INK.rule)
    .lineWidth(0.5)
    .moveTo(A4.margin, y)
    .lineTo(A4.width - A4.margin, y)
    .stroke();
}

/** Two-column label/value grid — the backbone of the tenant info sheet. */
export function fieldGrid(
  doc: PDFKit.PDFDocument,
  fields: Array<[string, string | null | undefined]>,
  columns = 2,
): void {
  const usable = A4.width - A4.margin * 2;
  const colWidth = usable / columns;
  const rowHeight = 30;
  let startY = doc.y;

  fields.forEach(([label, value], index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = A4.margin + col * colWidth;
    const y = startY + row * rowHeight;

    doc
      .fillColor(INK.muted)
      .font('Helvetica')
      .fontSize(7.5)
      .text(label.toUpperCase(), x, y, { width: colWidth - 12, characterSpacing: 0.4 });
    doc
      .fillColor(INK.body)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(value && value !== '' ? value : '—', x, y + 11, {
        width: colWidth - 12,
        ellipsis: true,
        height: 14,
      });
  });

  const rows = Math.ceil(fields.length / columns);
  doc.y = startY + rows * rowHeight;
  doc.x = A4.margin;
}

export interface TableColumn {
  header: string;
  /** Fraction of the usable width. Fractions should add up to 1. */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export function table(
  doc: PDFKit.PDFDocument,
  columns: TableColumn[],
  rows: string[][],
  options: { emptyMessage?: string } = {},
): void {
  const usable = A4.width - A4.margin * 2;
  const widths = columns.map((c) => c.width * usable);

  const drawRow = (
    cells: string[],
    opts: { bold?: boolean; color?: string; size?: number },
  ) => {
    if (doc.y > A4.height - A4.margin - 60) {
      doc.addPage();
    }
    const y = doc.y;
    let x = A4.margin;
    const size = opts.size ?? 8.5;

    let maxHeight = 0;
    cells.forEach((cell, i) => {
      doc
        .fillColor(opts.color ?? INK.body)
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size);
      const height = doc.heightOfString(cell, { width: widths[i] - 8 });
      maxHeight = Math.max(maxHeight, height);
      doc.text(cell, x + 2, y, {
        width: widths[i] - 8,
        align: columns[i].align ?? 'left',
      });
      x += widths[i];
    });
    doc.y = y + maxHeight + 5;
  };

  drawRow(
    columns.map((c) => c.header.toUpperCase()),
    { bold: true, color: INK.muted, size: 7.5 },
  );
  rule(doc);
  doc.moveDown(0.3);

  if (rows.length === 0) {
    doc
      .fillColor(INK.muted)
      .font('Helvetica-Oblique')
      .fontSize(9)
      .text(options.emptyMessage ?? 'No records', A4.margin, doc.y);
    doc.moveDown(0.5);
    return;
  }

  rows.forEach((row) => drawRow(row, {}));
}

export function footer(doc: PDFKit.PDFDocument, text: string): void {
  const y = A4.height - A4.margin - 12;
  doc
    .fillColor(INK.muted)
    .font('Helvetica')
    .fontSize(7.5)
    .text(text, A4.margin, y, { width: A4.width - A4.margin * 2, align: 'center' });
}
