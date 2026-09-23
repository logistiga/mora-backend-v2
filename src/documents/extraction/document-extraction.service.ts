import { Injectable, Logger } from '@nestjs/common';

export interface ExtractedTable {
  sheetName?: string;
  tableIndex: number;
  title?: string;
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
}

export interface ExtractionResult {
  text: string;
  tables: ExtractedTable[];
  /** True when no exploitable text/table was found — a future OCR fallback would trigger here (Phase E ships no OCR, see AGENTS §4). */
  needsOcrFallback: boolean;
}

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx']);

/**
 * Format-specific text/table extraction (AGENTS Phase E §4/§15). OCR is
 * explicitly NOT implemented here — `needsOcrFallback: true` is returned
 * when a PDF has no extractable text layer (e.g. a scanned image), and the
 * intake pipeline marks the document `needs_review` rather than pretending
 * to have read it. Real OCR is Phase G's job (vision).
 */
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  isSupported(extension: string): boolean {
    return SUPPORTED_EXTENSIONS.has(extension.toLowerCase());
  }

  async extract(buffer: Buffer, extension: string): Promise<ExtractionResult> {
    const ext = extension.toLowerCase();
    switch (ext) {
      case '.pdf':
        return this.extractPdf(buffer);
      case '.docx':
        return this.extractDocx(buffer);
      case '.txt':
      case '.md':
        return { text: buffer.toString('utf-8'), tables: [], needsOcrFallback: false };
      case '.csv':
        return this.extractCsv(buffer);
      case '.xlsx':
        return this.extractXlsx(buffer);
      default:
        throw new Error(`Unsupported extension: ${ext}`);
    }
  }

  private async extractPdf(buffer: Buffer): Promise<ExtractionResult> {
    // pdf-parse v2's class-based API — `getText()` gives real per-page text
    // (kept in `metadata.page` per chunk downstream via the chunker's page
    // tracking, when populated) rather than one undifferentiated blob.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const text = result.text?.trim() ?? '';
      return { text, tables: [], needsOcrFallback: text.length === 0 };
    } finally {
      await parser.destroy();
    }
  }

  private async extractDocx(buffer: Buffer): Promise<ExtractionResult> {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value?.trim() ?? '';
    return { text, tables: [], needsOcrFallback: text.length === 0 };
  }

  private async extractCsv(buffer: Buffer): Promise<ExtractionResult> {
    const { parse } = await import('csv-parse/sync');
    const records = parse(buffer, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<
      string,
      unknown
    >[];
    const columns = records.length > 0 ? Object.keys(records[0]).map((name) => ({ name, type: 'text' })) : [];
    const table: ExtractedTable = { tableIndex: 0, columns, rows: records };
    // A plain-text rendering also feeds the semantic chunker (a table isn't
    // only queried structurally — a user may also ask a free-form question
    // about it, see AGENTS §15/§16).
    const text = records
      .slice(0, 500) // bounded — the structured DocumentTable is the real source of truth for large data
      .map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(', '))
      .join('\n');
    return { text, tables: records.length > 0 ? [table] : [], needsOcrFallback: false };
  }

  private async extractXlsx(buffer: Buffer): Promise<ExtractionResult> {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const tables: ExtractedTable[] = [];
    const textParts: string[] = [];

    workbook.worksheets.forEach((sheet, sheetIdx) => {
      const rows: Record<string, unknown>[] = [];
      let header: string[] = [];
      sheet.eachRow((row, rowNumber) => {
        const values = (row.values as unknown[]).slice(1); // exceljs pads index 0
        if (rowNumber === 1) {
          header = values.map((v, i) => (v ? String(v) : `col_${i + 1}`));
          return;
        }
        const record: Record<string, unknown> = {};
        header.forEach((col, i) => {
          record[col] = values[i] ?? null;
        });
        rows.push(record);
      });

      if (rows.length > 0) {
        tables.push({
          sheetName: sheet.name,
          tableIndex: sheetIdx,
          columns: header.map((name) => ({ name, type: 'text' })),
          rows,
        });
        textParts.push(
          `[${sheet.name}]\n` +
            rows
              .slice(0, 200)
              .map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(', '))
              .join('\n'),
        );
      }
    });

    return { text: textParts.join('\n\n'), tables, needsOcrFallback: false };
  }
}
