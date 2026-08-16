// Office-document extractors over real in-test fixtures (node env: the
// parser libraries run against their Node entries; the browser script-tag
// loading they ship with is wired in draft-office.ts and exercised by the
// browser lane). Covers per-format extraction, classification, the
// UTF-8-safe truncation budget, and the parse-failure wrap.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
// The browser entries match what the composer loads at runtime; mammoth's
// Node entry takes no arrayBuffer input, so tests drive the browser build.
import mammoth from 'mammoth/mammoth.browser'
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
import {
  DocumentParseError, extractDocumentText, extractDocxText, extractPdfText, extractPptxText,
  extractXlsxText, MAX_EXTRACTED_TEXT_BYTES, officeDocumentKind, truncateUtf8,
} from '../src/client/draft-office.ts'
import type { MammothFace, PdfJsFace } from '../src/client/draft-office.ts'

/** Assemble a minimal valid one-page PDF whose content stream prints `text`. */
function tinyPdf(text: string): ArrayBuffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf).buffer
}

/** A minimal .docx zip whose document part carries the given paragraphs. */
async function tinyDocx(paragraphs: readonly string[]): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>')
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
    + '</w:body></w:document>')
  return zip.generateAsync({ type: 'arraybuffer' })
}

/** A real .xlsx buffer built with SheetJS itself. */
function tinyXlsx(): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['名称', '数量'], ['苹果', 3], ['梨', 5]]), '库存')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['备注'], ['含中文']]), '第二表')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** A minimal .pptx zip with two slides of DrawingML text runs. */
async function tinyPptx(): Promise<ArrayBuffer> {
  const slide = (runs: readonly string[]) => '<?xml version="1.0" encoding="UTF-8"?>'
    + '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
    + '<p:cSld><p:spTree><p:sp><p:txBody><a:p>'
    + runs.map(text => `<a:r><a:t>${text}</a:t></a:r>`).join('')
    + '</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  const zip = new JSZip()
  zip.file('ppt/slides/slide2.xml', slide(['第二页']))
  zip.file('ppt/slides/slide1.xml', slide(['标题 &amp; 更多', '副标题']))
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('officeDocumentKind', () => {
  it('classifies by extension case-insensitively and refuses the rest', () => {
    expect(officeDocumentKind(new File(['x'], '报告.PDF'))).toBe('pdf')
    expect(officeDocumentKind(new File(['x'], 'a.docx'))).toBe('docx')
    expect(officeDocumentKind(new File(['x'], 'a.xlsx'))).toBe('xlsx')
    expect(officeDocumentKind(new File(['x'], 'a.pptx'))).toBe('pptx')
    expect(officeDocumentKind(new File(['x'], 'a.pdf.exe'))).toBeNull()
    expect(officeDocumentKind(new File(['x'], 'noext'))).toBeNull()
    // A leading dot alone is not an extension separator.
    expect(officeDocumentKind(new File(['x'], '.pdf'))).toBeNull()
  })
})

describe('office text extractors', () => {
  it('extracts PDF page text with pdf.js', async () => {
    // Node has no Worker: pdf.js falls back to its fake worker, which loads
    // the worker module from the workerSrc path — point it at the real file.
    const workerSrc = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.js')
    const text = await extractPdfText(pdfjsLib as unknown as PdfJsFace, tinyPdf('Hello Office'), workerSrc)
    expect(text).toContain('Hello Office')
  })

  it('extracts Word paragraphs with mammoth', async () => {
    const text = await extractDocxText(mammoth as MammothFace, await tinyDocx(['季度报告', '第二段']))
    expect(text).toContain('季度报告')
    expect(text).toContain('第二段')
  })

  it('extracts one CSV section per worksheet with SheetJS', async () => {
    const text = extractXlsxText(XLSX, tinyXlsx())
    expect(text).toContain('# Sheet: 库存')
    expect(text).toContain('苹果,3')
    expect(text).toContain('# Sheet: 第二表')
  })

  it('extracts one section per slide from DrawingML runs, unescaping entities', async () => {
    const text = await extractPptxText(JSZip, await tinyPptx())
    expect(text).toBe('# Slide 1\n标题 & 更多 副标题\n\n# Slide 2\n第二页')
  })

  it('wraps parser failures as DocumentParseError', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'broken.docx')
    await expect(extractDocumentText(file, 'docx')).rejects.toThrow(DocumentParseError)
    await expect(extractDocumentText(file, 'docx')).rejects.toThrow('broken.docx')
  })

  it('rejects a document whose extraction comes back blank', async () => {
    const textless = await tinyPptxBlank()
    await expect(extractPptxText(JSZip, textless))
      .rejects.toThrow(/no extractable text/)
  })
})

/** A .pptx whose slide carries no text runs at all. */
async function tinyPptxBlank(): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld '
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>')
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('truncateUtf8', () => {
  it('keeps text under the budget untouched', () => {
    expect(truncateUtf8('短文本', 1024)).toEqual({ text: '短文本', truncated: false })
  })

  it('truncates over-budget text without splitting a UTF-8 sequence', () => {
    // '中' is 3 UTF-8 bytes; a budget of 4 bytes must not keep half of the second one.
    const result = truncateUtf8('中中中中中', 4)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('中')
    expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(4)
  })

  it('honors the 200KB document budget', () => {
    const result = truncateUtf8('字'.repeat(MAX_EXTRACTED_TEXT_BYTES), MAX_EXTRACTED_TEXT_BYTES)
    expect(result.truncated).toBe(true)
    expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(MAX_EXTRACTED_TEXT_BYTES)
  })
})
