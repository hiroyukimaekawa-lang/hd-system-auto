import fs from 'node:fs/promises';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const [inputFile, outputFile, qaDir] = process.argv.slice(2);
const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const workbook = Workbook.create();
for (const [sheetName, data] of Object.entries(input.sheets)) {
  const sheet = workbook.worksheets.add(sheetName);
  const matrix = [data.header, ...data.rows];
  const range = sheet.getRangeByIndexes(0, 0, matrix.length, data.header.length); range.values = matrix;
  sheet.getRangeByIndexes(0, 0, 1, data.header.length).format = { fill: '#1F4E78', font: { bold: true, color: '#FFFFFF' }, wrapText: false };
  sheet.freezePanes.freezeRows(1); sheet.showGridLines = true;
  range.format.autofitColumns();
  for (let column = 0; column < data.header.length; column += 1) {
    const header = data.header[column]; const columnRange = sheet.getRangeByIndexes(0, column, matrix.length, 1);
    if (['名前','住所１','住所２','URL','備考','履歴','最新履歴'].includes(header)) columnRange.format.columnWidthPx = header === 'URL' ? 300 : 180;
    else if (/^Tel|電話/.test(header)) { columnRange.format.columnWidthPx = 110; columnRange.format.numberFormat = '@'; }
    else columnRange.format.columnWidthPx = Math.min(130, Math.max(70, String(header).length * 14));
  }
  range.format.rowHeightPx = 20;
}
await fs.mkdir(qaDir, { recursive: true });
for (const sheetName of Object.keys(input.sheets)) {
  const preview = await workbook.render({ sheetName, range: 'A1:AE20', scale: 1, format: 'png' });
  await fs.writeFile(`${qaDir}/${sheetName.replace(/[\\/:*?"<>|]/g, '_')}.png`, new Uint8Array(await preview.arrayBuffer()));
}
const check = await workbook.inspect({ kind: 'sheet,table', maxChars: 8000, tableMaxRows: 3, tableMaxCols: 31 });
await fs.writeFile(`${qaDir}/inspect.ndjson`, check.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'formula error scan' });
await fs.writeFile(`${qaDir}/errors.ndjson`, errors.ndjson);
await fs.mkdir(new URL('.', `file://${outputFile}`).pathname, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook); await output.save(outputFile);
