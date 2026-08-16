// @vitest-environment jsdom
// ConversationController scope addressing over the runtime's real scope tag:
// TestSessions mints tagged scopes through the production createScope, so the
// service's scopeOf/binding path runs against production resolution (no local
// tag probe).
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { QueuedMessage, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'
import { InputHub } from '../src/client/input/hub.ts'
import {
  ConversationController, DraftFileReadError, DraftFileTooLargeError, UnsupportedImageMediaTypeError,
} from '../src/client/service.ts'
import { DocumentParseError, MAX_EXTRACTED_TEXT_BYTES } from '../src/client/draft-office.ts'
import { extractDocumentText } from '../src/client/draft-office.ts'
import { zh } from '../src/client/locales.ts'

// The parser-bundle script loading is browser runtime wiring (covered by the
// extractor spec through the libraries' Node entries); here the extraction
// itself is stubbed so the registry/cap/truncation choreography is pinned.
vi.mock('../src/client/draft-office.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/draft-office.ts')>()
  return { ...actual, extractDocumentText: vi.fn(async (file: File) => `提取自 ${file.name}`) }
})

async function bench(readAttachment?: SessionFace['readAttachment']) {
  const runtime = await SlotTestRuntime.create()
  const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const updateQueue = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const cancel = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const loadOlder = vi.fn(() => Promise.resolve())
  await runtime.sessions.add({
    id: 's1',
    session: { prompt, updateQueue, cancel, loadOlder, ...(readAttachment === undefined ? {} : { readAttachment }) },
  })
  // config.input is required (the apply shares its hub with the inject
  // factories); the bench passes its own instance explicitly.
  const hub = new InputHub(runtime.ctx, makeTranslate(zh, {}))
  const fiber = runtime.ctx.plugin(ConversationController, {
    input: hub,
    blocks: new ComposerBlockRegistry(),
  })
  await fiber.await()
  const root = runtime.ctx.get('conversation') as ConversationController
  const scoped = runtime.sessions.scope('s1')!.get('conversation') as ConversationController
  const shell = hub.shellFor(runtime.sessions.binding('s1')!)
  return { runtime, fiber, root, scoped, hub, shell, prompt, updateQueue, cancel, loadOlder }
}

describe('ConversationController', () => {
  it('routes operations through the public Session binding', async () => {
    const b = await bench()
    await b.scoped.send('hello')
    await b.scoped.updateQueue('item-1' as never, { kind: 'remove' })
    await b.scoped.cancel()
    await b.scoped.loadOlder()
    expect(b.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue')
    expect(b.updateQueue).toHaveBeenCalledWith('item-1', { kind: 'remove' })
    expect(b.cancel).toHaveBeenCalledOnce()
    expect(b.loadOlder).toHaveBeenCalledOnce()
    await b.runtime.dispose()
  })

  it('folds Session business failures into callback rejections', async () => {
    const b = await bench()
    b.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'busy', details: {} } } as never)
    await expect(b.scoped.send('x')).rejects.toThrow('conversation.send failed: agent-busy: busy')
    b.cancel.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'nope', details: {} } } as never)
    await expect(b.scoped.cancel()).rejects.toThrow('conversation.cancel failed: internal: nope')
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'internal', message: 'broken', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-1' as never, { kind: 'steer' }))
      .rejects.toThrow('conversation.updateQueue failed: internal: broken')
    await b.runtime.dispose()
  })

  it('treats strict-steer races as converged Queue delivery', async () => {
    const b = await bench()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'steer-unavailable', message: 'closed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-1' as never, { kind: 'steer' })).resolves.toBeUndefined()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-2' as never, { kind: 'steer' })).resolves.toBeUndefined()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-3' as never, { kind: 'remove' }))
      .rejects.toThrow('conversation.updateQueue failed: queue-item-not-found: claimed')
    await b.runtime.dispose()
  })

  it('releases draft previews when their session scope is disposed', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:draft-1')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    try {
      const [attachment] = b.root.createDraftImages([
        new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }),
      ])
      if (attachment === undefined) throw new Error('draft attachment missing')
      b.root.input.for(b.runtime.sessions.scope('s1')!).addImages([attachment.id])
      await b.runtime.sessions.remove('s1')
      expect(b.root.draftImages([attachment.id])).toEqual([])
      expect(revoked).toHaveBeenCalledWith('blob:draft-1')
    } finally {
      created.mockRestore()
      revoked.mockRestore()
    }
    await b.runtime.dispose()
  })

  it('validates every MIME type before allocating previews', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    expect(() => b.root.createDraftImages([
      new File([Uint8Array.of(1)], 'valid.png', { type: 'image/png' }),
      new File([Uint8Array.of(2)], 'invalid.svg', { type: 'image/svg+xml' }),
    ])).toThrow(UnsupportedImageMediaTypeError)
    expect(created).not.toHaveBeenCalled()
    created.mockRestore()
    await b.runtime.dispose()
  })

  it('invalidates pending historical image loads when the rendered session is released', async () => {
    const read = Promise.withResolvers<Awaited<ReturnType<SessionFace['readAttachment']>>>()
    const b = await bench(() => read.promise)
    const sessionId = b.runtime.sessions.behavior('s1').sessionId
    const attachment = {
      attachmentId: AttachmentId('image-1'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } as const
    const pending = b.root.resolveImage(sessionId, attachment)
    b.root.releaseSessionImages(sessionId)
    read.resolve({ ok: true, value: { attachment, data: Uint8Array.of(1) } })
    await expect(pending).rejects.toThrow('historical image scope was released')
    await b.runtime.dispose()
  })

  it('fails loudly from the root scope, on an unbound session, or without SessionRuntime', async () => {
    const b = await bench()
    await expect(b.root.send('x')).rejects.toThrow(/requires a session scope/)
    await b.runtime.sessions.remove('s1')
    await expect(b.scoped.send('x')).rejects.toThrow(/resolved no binding/)
    await b.runtime.dispose()
    // No SessionRuntime at all: a bare context (the runtime always provides one).
    const bare = new Context()
    await bare.plugin(ConversationController, {
      input: new InputHub(bare, makeTranslate(zh, {})),
      blocks: new ComposerBlockRegistry(),
    }).await()
    const orphan = bare.get('conversation') as ConversationController
    await expect(orphan.send('x')).rejects.toThrow(/sessions service unavailable/)
  })
})

describe('ConversationController draft text files', () => {
  it('creates draft files, resolves them, and folds them ahead of the typed text', async () => {
    const b = await bench()
    const session = b.runtime.sessions.binding('s1')!.session
    const drafts = await b.root.createDraftFiles([
      new File(['文件内容'], 'a.md', { type: 'text/markdown' }),
      new File(['second'], 'b.txt', { type: 'text/plain' }),
    ])
    expect(b.root.draftImages(drafts.map(draft => draft.id))).toEqual(drafts)
    await b.root.sendSession(session, '用户文本', drafts.map(draft => draft.id), 'queue')
    expect(b.prompt).toHaveBeenCalledWith([{
      type: 'text',
      text: '文件 a.md 的内容：\n```\n文件内容\n```\n\n文件 b.txt 的内容：\n```\nsecond\n```\n\n用户文本',
    }], 'queue')
    // A successful send releases the drafts.
    expect(b.root.draftImages(drafts.map(draft => draft.id))).toEqual([])
    await b.runtime.dispose()
  })

  it('sends a files-only prompt as the file blocks alone', async () => {
    const b = await bench()
    const session = b.runtime.sessions.binding('s1')!.session
    const drafts = await b.root.createDraftFiles([new File(['内容'], 'only.md', { type: 'text/markdown' })])
    await b.root.sendSession(session, '', drafts.map(draft => draft.id), 'queue')
    expect(b.prompt).toHaveBeenCalledWith([
      { type: 'text', text: '文件 only.md 的内容：\n```\n内容\n```\n\n' },
    ], 'queue')
    await b.runtime.dispose()
  })

  it('keeps image parts first and folds file blocks before the typed text', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:draft-img')
    try {
      const session = b.runtime.sessions.binding('s1')!.session
      const [image] = b.root.createDraftImages([new File([Uint8Array.of(1)], 'a.png', { type: 'image/png' })])
      const [file] = await b.root.createDraftFiles([new File(['正文'], 'notes.md', { type: 'text/markdown' })])
      if (image === undefined || file === undefined) throw new Error('draft attachment missing')
      await b.root.sendSession(session, '看看', [image.id, file.id], 'steer')
      expect(b.prompt).toHaveBeenCalledWith([
        { type: 'image', mediaType: 'image/png', data: 'AQ==', name: 'a.png' },
        { type: 'text', text: '文件 notes.md 的内容：\n```\n正文\n```\n\n看看' },
      ], 'steer')
    } finally {
      created.mockRestore()
    }
    await b.runtime.dispose()
  })

  it('refuses a file over the byte cap before any read starts', async () => {
    const b = await bench()
    const big = new File([new ArrayBuffer(256 * 1024 + 1)], 'big.txt', { type: 'text/plain' })
    const read = vi.spyOn(big, 'text')
    await expect(b.root.createDraftFiles([big])).rejects.toThrow(DraftFileTooLargeError)
    expect(read).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('wraps a content read failure', async () => {
    const b = await bench()
    const good = new File(['ok'], 'good.txt', { type: 'text/plain' })
    const broken = new File(['x'], 'broken.txt', { type: 'text/plain' })
    vi.spyOn(broken, 'text').mockRejectedValue(new Error('nope'))
    const error = await b.root.createDraftFiles([good, broken]).then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(DraftFileReadError)
    expect((error as DraftFileReadError).fileName).toBe('broken.txt')
    await b.runtime.dispose()
  })

  it('releases a file draft without touching preview URLs', async () => {
    const b = await bench()
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    try {
      const [draft] = await b.root.createDraftFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])
      if (draft === undefined) throw new Error('draft attachment missing')
      b.root.releaseDraftImage(draft.id)
      expect(b.root.draftImages([draft.id])).toEqual([])
      expect(revoked).not.toHaveBeenCalled()
    } finally {
      revoked.mockRestore()
    }
    await b.runtime.dispose()
  })
})

describe('ConversationController draft office documents', () => {
  it('extracts locally, registers, and folds like a text file', async () => {
    const b = await bench()
    const session = b.runtime.sessions.binding('s1')!.session
    const drafts = await b.root.createDraftDocuments([new File(['%PDF-1.4'], '报告.pdf')], '内容过长已截断')
    expect(vi.mocked(extractDocumentText)).toHaveBeenCalledWith(expect.any(File), 'pdf')
    await b.root.sendSession(session, '', drafts.map(draft => draft.id), 'queue')
    expect(b.prompt).toHaveBeenCalledWith([
      { type: 'text', text: '文件 报告.pdf 的内容：\n```\n提取自 报告.pdf\n```\n\n' },
    ], 'queue')
    await b.runtime.dispose()
  })

  it('truncates over-long extracted text at the byte cap and appends the note', async () => {
    // 70k CJK chars = 210KB of UTF-8, over the 200KB budget.
    vi.mocked(extractDocumentText).mockResolvedValueOnce('字'.repeat(70_000))
    const b = await bench()
    const [draft] = await b.root.createDraftDocuments([new File(['x'], 'big.pdf')], '内容过长已截断')
    if (draft?.kind !== 'file') throw new Error('draft attachment missing')
    expect(draft.text.endsWith('\n\n内容过长已截断')).toBe(true)
    expect(new TextEncoder().encode(draft.text).length)
      .toBeLessThanOrEqual(MAX_EXTRACTED_TEXT_BYTES + '\n\n内容过长已截断'.length * 3)
    await b.runtime.dispose()
  })

  it('refuses an office file over the 10MB cap before extraction runs', async () => {
    const mocked = vi.mocked(extractDocumentText)
    mocked.mockClear()
    const b = await bench()
    const big = new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], 'huge.pdf')
    const error = await b.root.createDraftDocuments([big], 'x').then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(DraftFileTooLargeError)
    expect((error as DraftFileTooLargeError).maxBytes).toBe(10 * 1024 * 1024)
    expect(mocked).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('propagates extraction failures as DocumentParseError', async () => {
    vi.mocked(extractDocumentText).mockRejectedValueOnce(new DocumentParseError('broken.pdf', 'pdf'))
    const b = await bench()
    await expect(b.root.createDraftDocuments([new File(['x'], 'broken.pdf')], 'x'))
      .rejects.toThrow(DocumentParseError)
    await b.runtime.dispose()
  })
})

describe('InputHub queue steering (empty-draft accelerated Enter)', () => {
  const row = (id: string): QueuedMessage => ({
    id: id as never,
    messageId: `message-${id}` as never,
    placement: 'queued',
    content: [{ type: 'text', text: id }],
    preview: id,
    text: id,
  })

  it('steers every queued row in FIFO order and leaves steering rows alone', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), { ...row('q-2'), placement: 'steering' }, row('q-3')]
    })
    b.shell.steerQueue()
    await vi.waitFor(() => {
      expect(b.updateQueue).toHaveBeenCalledTimes(2)
    })
    expect(b.updateQueue).toHaveBeenNthCalledWith(1, 'q-1', { kind: 'steer' })
    expect(b.updateQueue).toHaveBeenNthCalledWith(2, 'q-3', { kind: 'steer' })
    expect(b.shell.notices.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('converges silently when the turn closes or a row is claimed mid-steer', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), row('q-2')]
    })
    // The turn closes before the second row: the flush stops, silently.
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'steer-unavailable', message: 'closed', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => { expect(b.updateQueue).toHaveBeenCalledTimes(1) })
    expect(b.shell.notices.getSnapshot()).toBeNull()

    // A row the host already claimed (e.g. a repeated empty-draft chord):
    // the duplicate strict steer is a silent no-op.
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-3')]
    })
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => { expect(b.updateQueue).toHaveBeenCalledTimes(2) })
    expect(b.shell.notices.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('surfaces one notice on a genuine steer failure and stops', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), row('q-2')]
    })
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'internal', message: 'broken', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => {
      expect(b.shell.notices.getSnapshot()).toEqual(
        expect.objectContaining({ level: 'error', text: '插话发送失败，请重试。' }),
      )
    })
    expect(b.updateQueue).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('no-ops without queued rows', async () => {
    const b = await bench()
    b.shell.steerQueue()
    expect(b.updateQueue).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })
})
