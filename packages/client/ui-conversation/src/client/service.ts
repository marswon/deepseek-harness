/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.
import type { ISessions, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ComposerAttachment, ComposerImageAttachment } from './contract/slots.ts'
import { foldDraftFileBlocks, MAX_DRAFT_FILE_BYTES } from './draft-files.ts'
import {
  DocumentParseError, extractDocumentText, MAX_DRAFT_DOCUMENT_BYTES, MAX_EXTRACTED_TEXT_BYTES,
  officeDocumentKind, truncateUtf8,
} from './draft-office.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './input/blocks.ts'
import type { DraftAttachmentId, SessionInputResolver } from './input/contract.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /**
   * The per-session composer-block registry: how a plugin the composer
   * cannot import makes a session's input inert with its own reason.
   */
  readonly blocks: ComposerBlocks
  /**
   * Send a prompt into the caller scope's session (queued turn).
   * @param text - prompt text, sent verbatim as one text block.
   * @returns completion; business failures reject (and land in promptError).
   */
  send(text: string): Promise<void>
  /**
   * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns completion; converged strict-steer races resolve, while other failures reject.
   */
  updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>
  /**
   * Cancel the scoped session's in-flight turn while preserving its pending Queue.
   * @returns completion; failures reject as in send.
   */
  cancel(): Promise<void>
  /**
   * Pull one older history page for the scoped session.
   * @returns completion of the page pull.
   */
  loadOlder(): Promise<void>
}

/** Create one browser-only draft image descriptor; only its id enters input state. */
function browserDraftAttachment(file: File): ComposerImageAttachment {
  return {
    kind: 'image',
    id: crypto.randomUUID() as DraftAttachmentId,
    previewUrl: URL.createObjectURL(file),
    file,
  }
}

interface ImageUrlEntry {
  readonly sessionId: SessionId
  readonly generation: number
  readonly pending: Promise<string>
}

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Draft file over its single-file byte cap, localized by the UI boundary. */
export class DraftFileTooLargeError extends Error {
  /** Offending file's display name. */
  readonly fileName: string
  /** The cap the file exceeded, in bytes. */
  readonly maxBytes: number

  /**
   * @param fileName - offending file's display name.
   * @param maxBytes - the cap the file exceeded, in bytes.
   */
  constructor(fileName: string, maxBytes: number) {
    super(`draft file too large (max ${maxBytes} bytes): ${fileName}`)
    this.name = 'DraftFileTooLargeError'
    this.fileName = fileName
    this.maxBytes = maxBytes
  }
}

/** Draft text file whose content read failed, localized by the UI boundary. */
export class DraftFileReadError extends Error {
  /** Offending file's display name. */
  readonly fileName: string

  /**
   * @param fileName - offending file's display name.
   * @param options - carries the underlying read failure as `cause`.
   */
  constructor(fileName: string, options?: { cause: unknown }) {
    super(`failed to read draft file: ${fileName}`, options)
    this.name = 'DraftFileReadError'
    this.fileName = fileName
  }
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  private readonly draftAttachments = new Map<DraftAttachmentId, ComposerAttachment>()
  private readonly imageUrls = new Map<string, ImageUrlEntry>()
  private readonly imageGenerations = new Map<SessionId, number>()
  private readonly createdImageUrls = new Set<string>()
  private disposed = false

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, config: { input: SessionInputResolver; blocks: ComposerBlocks }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    ctx.effect(() => () => {
      this.disposed = true
      for (const url of this.createdImageUrls) revokePreview(url)
      this.createdImageUrls.clear()
      this.draftAttachments.clear()
      this.imageUrls.clear()
      this.imageGenerations.clear()
    }, 'conversation attachment URL cache')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   */
  async send(text: string): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft attachments with text through one host admission.
   * Text files fold into the text part ahead of the typed draft (one fenced
   * block per file); images keep their leading base64 parts.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param imageIds - ordered draft-local attachment ids.
   * @param mode - queue or steer delivery selected by composer policy.
   */
  async sendSession(
    session: SessionFace,
    text: string,
    imageIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
  ): Promise<void> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.sendSession: one or more draft images are no longer available')
    }
    const images: ComposerImageAttachment[] = []
    const files: { name: string; text: string }[] = []
    for (const attachment of attachments) {
      if (attachment.kind === 'image') images.push(attachment)
      else files.push(attachment)
    }
    const uploaded = await this.serializeImages(images.map(attachment => attachment.file))
    const folded = foldDraftFileBlocks(files) + text
    const content = [...uploaded, ...(folded === '' ? [] : [{ type: 'text' as const, text: folded }])]
    const result = await session.prompt(content, mode)
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
    this.releaseDraftImages(attachments)
  }

  /**
   * Create runtime-only draft images and their object URLs.
   * @param files - browser files to register after MIME validation.
   * @returns ordered draft descriptors.
   */
  createDraftImages(files: readonly File[]): readonly ComposerAttachment[] {
    for (const file of files) imageMediaType(file.type)
    return files.map((file) => {
      const attachment = browserDraftAttachment(file)
      this.draftAttachments.set(attachment.id, attachment)
      this.createdImageUrls.add(attachment.previewUrl)
      return attachment
    })
  }

  /**
   * Create runtime-only draft text files with their full content read into
   * the registry. Every size is validated before any read starts, and the
   * registry changes only once every read succeeded.
   * @param files - browser files pre-classified as text by the intake funnel.
   * @returns ordered draft descriptors.
   */
  async createDraftFiles(files: readonly File[]): Promise<readonly ComposerAttachment[]> {
    for (const file of files) {
      if (file.size > MAX_DRAFT_FILE_BYTES) throw new DraftFileTooLargeError(file.name, MAX_DRAFT_FILE_BYTES)
    }
    const drafts = await Promise.all(files.map(async (file): Promise<ComposerAttachment> => ({
      kind: 'file',
      id: crypto.randomUUID() as DraftAttachmentId,
      name: file.name,
      text: await readDraftFileText(file),
    })))
    for (const draft of drafts) this.draftAttachments.set(draft.id, draft)
    return drafts
  }

  /**
   * Create runtime-only draft office documents: bytes are parsed locally in
   * the browser (the parser bundles load on first use, never eagerly), the
   * extracted text is truncated at the byte cap with the visible note
   * appended, and the registry changes only once every file succeeded.
   * @param files - browser files pre-classified as office documents.
   * @param truncatedNote - the localized note appended to truncated content.
   * @returns ordered draft descriptors.
   */
  async createDraftDocuments(files: readonly File[], truncatedNote: string): Promise<readonly ComposerAttachment[]> {
    for (const file of files) {
      if (file.size > MAX_DRAFT_DOCUMENT_BYTES) throw new DraftFileTooLargeError(file.name, MAX_DRAFT_DOCUMENT_BYTES)
    }
    const drafts = await Promise.all(files.map(async (file): Promise<ComposerAttachment> => {
      const kind = officeDocumentKind(file)
      if (kind === null) throw new DocumentParseError(file.name, null)
      const extracted = await extractDocumentText(file, kind)
      const clipped = truncateUtf8(extracted, MAX_EXTRACTED_TEXT_BYTES)
      return {
        kind: 'file',
        id: crypto.randomUUID() as DraftAttachmentId,
        name: file.name,
        text: clipped.truncated ? `${clipped.text}\n\n${truncatedNote}` : clipped.text,
      }
    }))
    for (const draft of drafts) this.draftAttachments.set(draft.id, draft)
    return drafts
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft attachments.
   * @param ids - draft attachment ids.
   * @returns descriptors that remain live, in requested order.
   */
  draftImages(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[] {
    const attachments: ComposerAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment !== undefined) attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Release one browser-owned draft attachment (and its preview URL for images).
   * @param id - draft attachment id.
   */
  releaseDraftImage(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined) return
    this.draftAttachments.delete(id)
    if (attachment.kind === 'image') {
      this.createdImageUrls.delete(attachment.previewUrl)
      revokePreview(attachment.previewUrl)
    }
  }

  /**
   * Release a set of browser-owned draft attachments.
   * @param attachments - descriptors to release.
   */
  releaseDraftImages(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftImage(attachment.id)
  }

  /**
   * Resolve and cache one session-authorized historical image URL.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until its rendered session is released.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('conversation.resolveImage: service is disposed'))
    const key = `${sessionId}:${attachment.attachmentId}`
    const cached = this.imageUrls.get(key)
    if (cached !== undefined) return cached.pending
    const generation = this.imageGenerations.get(sessionId) ?? 0
    const session = this.requireSessions().binding(sessionId)?.session
    if (session === undefined) {
      return Promise.reject(new Error(`conversation.resolveImage: unknown session "${sessionId}"`))
    }
    const pending = session.readAttachment(attachment.attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (this.disposed) throw new Error('conversation.resolveImage: service was disposed before loading completed')
        if ((this.imageGenerations.get(sessionId) ?? 0) !== generation) {
          throw new Error('historical image scope was released before loading completed')
        }
        if (typeof URL.createObjectURL !== 'function') {
          return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
        }
        const bytes = Uint8Array.from(result.value.data)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        this.createdImageUrls.add(url)
        return url
      })
      .catch((error: unknown) => {
        if (this.imageUrls.get(key)?.generation === generation) this.imageUrls.delete(key)
        throw error
      })
    this.imageUrls.set(key, { sessionId, generation, pending })
    return pending
  }

  /**
   * Release every historical image URL owned by one rendered session.
   * @param sessionId - rendered session scope.
   */
  releaseSessionImages(sessionId: SessionId): void {
    this.imageGenerations.set(sessionId, (this.imageGenerations.get(sessionId) ?? 0) + 1)
    for (const [key, entry] of this.imageUrls) {
      if (entry.sessionId !== sessionId) continue
      this.imageUrls.delete(key)
      void entry.pending.then((url) => {
        if (!this.createdImageUrls.delete(url)) return
        revokePreview(url)
      }, () => {
        // A failed or invalidated load owns no object URL.
      })
    }
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (
        action.kind === 'steer'
        && (result.error.code === 'steer-unavailable' || result.error.code === 'queue-item-not-found')
      ) return
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  /** Convert browser files to canonical base64 prompt parts. */
  private serializeImages(images: readonly File[]): Promise<Parameters<SessionFace['prompt']>[0]> {
    return Promise.all(images.map(async file => ({
      type: 'image' as const,
      mediaType: imageMediaType(file.type),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(file.name === '' ? {} : { name: file.name }),
    })))
  }
}

/** Read one draft file's full text, wrapping any read failure for locale mapping. */
async function readDraftFileText(file: File): Promise<string> {
  try {
    return await file.text()
  } catch (error: unknown) {
    throw new DraftFileReadError(file.name, { cause: error })
  }
}

function imageMediaType(value: string): ImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new UnsupportedImageMediaTypeError(value)
  }
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
