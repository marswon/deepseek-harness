/**
 * Office-document draft intake (.pdf/.docx/.xlsx/.pptx): per-format text
 * extractors plus the runtime loader for the prebuilt parser bundles the web
 * app serves under `office-parsers/` (emitted by apps/web's vite build from
 * this package's parser dependencies).
 *
 * Parsers never ride the plugin bundle — the client bundle is a single CJS
 * artifact that inlines every dependency, so even a lazy `import()` of a
 * parser would ship its megabytes in client.js. They load as classic scripts
 * on first use instead: classic scripts work over both http(s) and the
 * desktop shell's file:// dist, where ESM `import()` of a URL is unavailable.
 * A loader or extractor failure rejects with DocumentParseError; the UI
 * boundary maps it to product copy.
 */

/** Office formats the intake funnel accepts, dispatched by extension. */
export type OfficeDocumentKind = 'pdf' | 'docx' | 'xlsx' | 'pptx'

/** Single-file byte cap for one office draft (10MB). */
export const MAX_DRAFT_DOCUMENT_BYTES = 10 * 1024 * 1024

/** Extracted-text byte cap; longer content is truncated with a visible note. */
export const MAX_EXTRACTED_TEXT_BYTES = 200 * 1024

const OFFICE_EXTENSIONS: ReadonlyMap<string, OfficeDocumentKind> = new Map([
  ['pdf', 'pdf'],
  ['docx', 'docx'],
  ['xlsx', 'xlsx'],
  ['pptx', 'pptx'],
])

/**
 * Classify one browser file as an office document by extension (MIME is
 * unreliable for these formats across platforms).
 * @param file - the browser File to classify.
 * @returns the document kind, or null when the extension is not an office one.
 */
export function officeDocumentKind(file: File): OfficeDocumentKind | null {
  const dot = file.name.lastIndexOf('.')
  if (dot <= 0) return null
  return OFFICE_EXTENSIONS.get(file.name.slice(dot + 1).toLowerCase()) ?? null
}

/** Office text extraction failed (loader, parser, or empty result), localized by the UI boundary. */
export class DocumentParseError extends Error {
  /** Offending file's display name. */
  readonly fileName: string
  /** Document kind under extraction, null when the kind itself was unclassifiable. */
  readonly kind: OfficeDocumentKind | null

  /**
   * @param fileName - offending file's display name.
   * @param kind - document kind under extraction, null when unclassifiable.
   * @param options - carries the underlying failure as `cause`.
   */
  constructor(fileName: string, kind: OfficeDocumentKind | null, options?: { cause: unknown }) {
    super(`failed to extract document text (${kind ?? 'unknown'}): ${fileName}`, options)
    this.name = 'DocumentParseError'
    this.fileName = fileName
    this.kind = kind
  }
}

/**
 * Truncate extracted text to a byte budget without splitting a UTF-8
 * sequence (the default non-fatal decoder drops the partial tail char).
 * @param text - the full extracted text.
 * @param maxBytes - the byte budget.
 * @returns the possibly-shortened text and whether truncation happened.
 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  // A cut through a multi-byte sequence backs off to its head byte (continuation
  // bytes are 10xxxxxx) so the decode never emits a replacement character.
  let end = maxBytes
  while (end > 0) {
    const byte = bytes[end]
    if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) break
    end -= 1
  }
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), truncated: true }
}

// ---- parser faces (structural: the bundles load as untyped globals) ----

/** The pdf.js v3 UMD global (`window.pdfjsLib`) slice the extractor uses. */
export interface PdfJsFace {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(request: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }>
      destroy(): Promise<void>
    }>
  }
}

/** The mammoth browser UMD global (`window.mammoth`) slice the extractor uses. */
export interface MammothFace {
  extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>
}

/** The SheetJS UMD global (`window.XLSX`) slice the extractor uses. */
export interface XlsxFace {
  read(data: ArrayBuffer, options: { type: 'array' }): {
    SheetNames: string[]
    Sheets: Record<string, unknown>
  }
  utils: { sheet_to_csv(sheet: unknown): string }
}

/** The JSZip UMD global (`window.JSZip`) slice the extractor uses. */
export interface JSZipFace {
  loadAsync(data: ArrayBuffer): Promise<{
    files: Record<string, unknown>
    file(name: string): { async(format: 'text'): Promise<string> } | null
  }>
}

/**
 * Extract the text of one PDF page range (all pages), one blank-line-separated
 * section per page. The worker script URL is pinned per call: pdf.js falls
 * back to a main-thread fake worker (loading the same script inline) when the
 * Worker constructor or the worker script fails, so a broken worker asset
 * degrades to slower parsing instead of an error.
 * @param pdfjs - the loaded pdf.js global.
 * @param data - the file bytes.
 * @param workerSrc - the served pdf.worker bundle URL.
 * @returns the document text.
 */
export async function extractPdfText(pdfjs: PdfJsFace, data: ArrayBuffer, workerSrc: string): Promise<string> {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const doc = await pdfjs.getDocument({ data }).promise
  try {
    const pages: string[] = []
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => item.str ?? '').join(' ').trim())
    }
    return requireText(pages.filter(page => page !== '').join('\n\n'))
  } finally {
    void doc.destroy()
  }
}

/**
 * Extract a Word document's raw text (mammoth's paragraph run, no styling).
 * @param mammoth - the loaded mammoth global.
 * @param data - the file bytes.
 * @returns the document text.
 */
export async function extractDocxText(mammoth: MammothFace, data: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: data })
  return requireText(result.value)
}

/**
 * Extract one CSV section per worksheet, headed by the sheet name.
 * @param xlsx - the loaded SheetJS global.
 * @param data - the file bytes.
 * @returns the workbook text.
 */
export function extractXlsxText(xlsx: XlsxFace, data: ArrayBuffer): string {
  const workbook = xlsx.read(data, { type: 'array' })
  return requireText(workbook.SheetNames.map((name) => {
    const sheet: unknown = workbook.Sheets[name]
    const csv = sheet === undefined ? '' : xlsx.utils.sheet_to_csv(sheet).trimEnd()
    return csv === '' ? '' : `# Sheet: ${name}\n${csv}`
  }).filter(section => section !== '').join('\n\n'))
}

/** XML entity references legal inside a DrawingML text run. */
function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

/**
 * Extract one section per slide (`# Slide N` heading, N from the slide part
 * name) from the slide XML's DrawingML text runs (`a:t` elements carry every
 * visible string). Slides without text runs are skipped.
 * @param JSZip - the loaded JSZip global.
 * @param data - the file bytes.
 * @returns the deck text.
 */
export async function extractPptxText(JSZip: JSZipFace, data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data)
  const slideNames = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumberOf(a) - slideNumberOf(b))
  const slides: string[] = []
  for (const name of slideNames) {
    const entry = zip.file(name)
    if (entry === null) continue
    const xml = await entry.async('text')
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(match => unescapeXmlText(match[1] ?? ''))
    if (runs.length === 0) continue
    slides.push(`# Slide ${slideNumberOf(name)}\n${runs.join(' ')}`)
  }
  return requireText(slides.join('\n\n'))
}

/** Every extractor's blank guard: an empty result is a parse failure. */
function requireText(text: string): string {
  if (text.trim() === '') throw new Error('document contains no extractable text')
  return text
}

/** The slide number out of a `ppt/slides/slideN.xml` part name. */
function slideNumberOf(name: string): number {
  return Number(name.slice(name.lastIndexOf('slide') + 'slide'.length, -'.xml'.length))
}

// ---- runtime parser loading (browser only; tests drive the extractors directly) ----

/** In-flight or settled parser loads, keyed by bundle file name. */
const parserLoads = new Map<string, Promise<unknown>>()

/** Absolute URL of one served parser bundle, relative to the app base (file://-safe). */
function parserUrl(name: string): string {
  return new URL(`office-parsers/${name}`, document.baseURI).toString()
}

/**
 * Load one prebuilt parser bundle as a classic script, once per bundle.
 * @param name - bundle file name under `office-parsers/`.
 * @param globalName - the global the UMD bundle publishes.
 * @returns the published global.
 */
function loadParser(name: string, globalName: string): Promise<unknown> {
  const cached = parserLoads.get(name)
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') {
    // Non-browser host (the unit lane drives the extractors through the
    // parsers' Node entries instead); never cache this rejection.
    return Promise.reject(new Error(`parser loading requires a browser document: ${name}`))
  }
  const promise = new Promise<unknown>((resolve, reject) => {
    const published = (window as unknown as Record<string, unknown>)[globalName]
    if (published !== undefined) {
      resolve(published)
      return
    }
    const script = document.createElement('script')
    script.src = parserUrl(name)
    script.onload = () => {
      const loaded = (window as unknown as Record<string, unknown>)[globalName]
      if (loaded === undefined) {
        parserLoads.delete(name)
        reject(new Error(`parser bundle "${name}" did not publish ${globalName}`))
        return
      }
      resolve(loaded)
    }
    script.onerror = () => {
      // A failed load is retryable: the next attachment re-attempts it.
      parserLoads.delete(name)
      reject(new Error(`failed to load parser bundle: ${name}`))
    }
    document.head.appendChild(script)
  })
  parserLoads.set(name, promise)
  return promise
}

/**
 * Extract one office document's full text with its format's parser.
 * @param file - the browser File (pre-classified by the intake funnel).
 * @param kind - the document kind to extract as.
 * @returns the extracted text (never blank — extractors reject a blank result).
 */
export async function extractDocumentText(file: File, kind: OfficeDocumentKind): Promise<string> {
  try {
    const data = await file.arrayBuffer()
    return await extractWith(kind, data)
  } catch (error: unknown) {
    if (error instanceof DocumentParseError) throw error
    throw new DocumentParseError(file.name, kind, { cause: error })
  }
}

/** Dispatch to one kind's loader + extractor. */
async function extractWith(kind: OfficeDocumentKind, data: ArrayBuffer): Promise<string> {
  switch (kind) {
    case 'pdf':
      return extractPdfText(
        await loadParser('pdf.min.js', 'pdfjsLib') as PdfJsFace,
        data,
        parserUrl('pdf.worker.min.js'),
      )
    case 'docx':
      return extractDocxText(await loadParser('mammoth.browser.min.js', 'mammoth') as MammothFace, data)
    case 'xlsx':
      return extractXlsxText(await loadParser('xlsx.js', 'XLSX') as XlsxFace, data)
    case 'pptx':
      return extractPptxText(await loadParser('jszip.min.js', 'JSZip') as JSZipFace, data)
    default:
      return assertNever(kind)
  }
}

function assertNever(value: never): never {
  throw new Error(`unknown office document kind: ${String(value)}`)
}
