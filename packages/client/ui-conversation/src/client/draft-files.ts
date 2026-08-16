/** Draft text-file intake: the classification allowlist, the single-file
 * byte cap, and the prompt-text folding shared by the composer intake funnel
 * (skeleton/InputBar) and the send path (service.ts). */

/** Single-file byte cap for one draft text file (256KB). */
export const MAX_DRAFT_FILE_BYTES = 256 * 1024

/**
 * Byte count as user-facing KB/MB (`256KB`, `10MB`, `2.5MB`) for the
 * intake cap copy.
 * @param bytes - the byte count.
 * @returns the rounded size text.
 */
export function fileSizeText(bytes: number): string {
  const kb = bytes / 1024
  if (kb < 1024) return `${Number.isInteger(kb) ? String(kb) : kb.toFixed(1)}KB`
  const mb = kb / 1024
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)}MB`
}

/** Lowercase extensions (no dot) whose content is treated as text. */
const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'md', 'txt', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'py', 'java', 'go', 'rs',
  'c', 'cpp', 'h', 'hpp', 'cs', 'yml', 'yaml', 'toml', 'xml', 'html', 'css', 'scss',
  'sh', 'bash', 'sql', 'log', 'csv', 'ini', 'cfg', 'conf',
])

/** Dotfile names whose extension heuristic fails but whose content is text by convention. */
const TEXT_FILE_NAMES: ReadonlySet<string> = new Set([
  '.gitignore', '.gitattributes', '.dockerignore', '.npmignore', '.editorconfig',
  '.env.example', '.env.sample', '.env.template',
])

/**
 * Classify one browser file as a text draft: a `text/*` MIME type, a known
 * dotfile name, or an allowlisted extension. Anything else (binaries,
 * extensionless names, unknown dotfiles) is refused by the intake funnel.
 * @param file - the browser File to classify.
 * @returns whether the file is accepted as a text attachment.
 */
export function isTextDraftFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  const name = file.name.toLowerCase()
  if (TEXT_FILE_NAMES.has(name)) return true
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return TEXT_FILE_EXTENSIONS.has(name.slice(dot + 1))
}

/**
 * Fold draft text files into prompt text ahead of the typed draft: one
 * fenced block per file, in draft order. The folded blocks ride the ordinary
 * text part, so the session log captures them with no new event.
 * @param files - draft file descriptors in send order.
 * @returns the concatenated file blocks (empty string without files).
 */
export function foldDraftFileBlocks(files: readonly { name: string; text: string }[]): string {
  return files.map(file => `文件 ${file.name} 的内容：\n\`\`\`\n${file.text}\n\`\`\`\n\n`).join('')
}
