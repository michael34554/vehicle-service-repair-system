import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type { Response } from 'express';

export interface ReportColumn {
  header: string;
  key: string;
  width: number;
}

export interface MechanicReportInput {
  title: string;
  filename: string;
  rangeLabel: string;
  columns: ReportColumn[];
  records: Record<string, string | number | null>[];
  generatedAt: string;
}

// Uses the same PDFKit/ExcelJS conventions as the existing inventory reports.
export function sendMechanicReport(response: Response, input: MechanicReportInput): void {
  const { title, filename, rangeLabel, columns, records, generatedAt } = input;
  const format = response.req.query.format;
  if (format !== 'pdf' && format !== 'xlsx') {
    response.status(400).json({ error: 'Report format must be pdf or xlsx.' });
    return;
  }
  const outputName = `NEXTGEN_${filename}.${format}`;
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);

  if (format === 'xlsx') {
    void (async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'NEXTGEN';
      workbook.created = new Date(generatedAt);
      workbook.subject = title;
      workbook.title = `${title} - NEXTGEN`;
      const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 4 }] });
      sheet.columns = columns.map((column) => ({ key: column.key, width: column.width }));
      sheet.mergeCells(1, 1, 1, columns.length);
      sheet.getCell(1, 1).value = 'NEXTGEN | VEHICLE SERVICE & REPAIR';
      sheet.getCell(1, 1).font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B63' } };
      sheet.getRow(1).height = 30;
      sheet.mergeCells(2, 1, 2, columns.length);
      sheet.getCell(2, 1).value = title;
      sheet.getCell(2, 1).font = { size: 14, bold: true, color: { argb: 'FF173B63' } };
      sheet.mergeCells(3, 1, 3, columns.length);
      sheet.getCell(3, 1).value = `Generated ${new Date(generatedAt).toLocaleString()} · ${rangeLabel}`;
      sheet.getCell(3, 1).font = { size: 10, color: { argb: 'FF64748B' } };
      const header = sheet.getRow(4);
      header.values = columns.map((column) => column.header);
      header.height = 24;
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563A6' } };
      header.alignment = { vertical: 'middle', wrapText: true };
      records.forEach((record) => sheet.addRow(columns.map((column) => record[column.key] ?? '')));
      sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
      response.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      response.send(Buffer.from(await workbook.xlsx.writeBuffer()));
    })().catch((error: unknown) => {
      console.error('Mechanic XLSX report failed:', error);
      if (!response.headersSent) response.status(500).json({ error: 'Could not generate the report.' });
    });
    return;
  }

  response.type('application/pdf');
  const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 34, bufferPages: true, compress: false });
  document.pipe(response);
  const left = 34;
  const pageWidth = 774;
  const printHeader = (pageNumber: number) => {
    document.font('Helvetica-Bold').fontSize(15).fillColor('#173b63').text('NEXTGEN', left, 28);
    document.font('Helvetica').fontSize(8).fillColor('#64748b').text('VEHICLE SERVICE & REPAIR', left + 78, 34);
    document.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(title, left, 56);
    document.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Generated ${new Date(generatedAt).toLocaleString()}  |  ${rangeLabel}`, left, 75, { width: pageWidth });
    document.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Page ${pageNumber}`, 740, 30, { width: 68, align: 'right' });
    const widths = columns.map((column) => column.width);
    const widthTotal = widths.reduce((total, width) => total + width, 0);
    let x = left;
    document.rect(left, 96, pageWidth, 22).fill('#2563a6');
    columns.forEach((column, index) => {
      const width = pageWidth * widths[index] / widthTotal;
      document.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff')
        .text(column.header, x + 4, 103, { width: width - 8, height: 12, ellipsis: true });
      x += width;
    });
    return { y: 118, widths, widthTotal };
  };
  let pageNumber = 1;
  let layout = printHeader(pageNumber);
  records.forEach((record, rowIndex) => {
    if (layout.y > 555) {
      document.addPage();
      pageNumber += 1;
      layout = printHeader(pageNumber);
    }
    const rowY = layout.y;
    if (rowIndex % 2 === 1) document.rect(left, rowY, pageWidth, 22).fill('#f1f5f9');
    let x = left;
    columns.forEach((column, index) => {
      const width = pageWidth * layout.widths[index] / layout.widthTotal;
      const rawValue = record[column.key];
      const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
      document.font('Helvetica').fontSize(7).fillColor('#1e293b')
        .text(value, x + 4, rowY + 7, { width: width - 8, height: 12, ellipsis: true });
      x += width;
    });
    layout.y += 22;
  });
  if (records.length === 0) {
    document.font('Helvetica').fontSize(10).fillColor('#64748b')
      .text('No records found for this report.', left, layout.y + 14);
  }
  document.end();
}
