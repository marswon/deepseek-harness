// @vitest-environment jsdom
/** The 检查 button, its three states, and the get-a-key guidance in the provider editor. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { CredentialInfo, RemoteResult, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { keyCheckFailureText } from '../src/client/KeyCheck.tsx'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

/** Credentials answers over the Remote carrier, which has no envelope. */
function remoteOk<T>(value: T) {
  return { ok: true as const, value }
}
function remoteFail(message: string) {
  return {
    ok: false as const,
    error: new RemoteError('llm/model-discovery-rejected', message, { settingsNs: 'llm-deepseek' }),
  }
}

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string(),
})

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    api: Schema.union(['openai-completions', 'openai-responses']),
  })),
})

function deepSeekNamespace(): SettingsNamespaceView {
  return {
    ns: 'llm-deepseek',
    schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
    value: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
    base: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
    user: {},
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function piAiNamespace(): SettingsNamespaceView {
  const profile = {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseURL: 'https://proxy.example/v1',
    api: 'openai-completions',
  }
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
    value: { providers: { openai: profile } },
    base: { providers: {} },
    user: { providers: { openai: profile } },
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function mountEditor(options: {
  namespace?: SettingsNamespaceView
  settingsPath?: readonly string[]
  provider?: string
  displayName?: string
  consoleUrl?: string
  credentialConfigured?: boolean
  discover?: ReturnType<typeof vi.fn>
} = {}) {
  const discover = options.discover ?? vi.fn(() => Promise.resolve(remoteOk([
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ])))
  const face = {
    llm: { discoverModels: discover },
    settings: { mutate: vi.fn() },
    credentials: {
      describe: vi.fn((refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>> =>
        Promise.resolve(remoteOk(
          Object.fromEntries(refs.map(ref => [ref, {
            configured: options.credentialConfigured ?? false,
            writable: true,
          }])),
        ))),
      set: vi.fn(),
    },
  }
  // The page plugin's context, scripted down to the namespaces the card reaches.
  const operations = createModelsOperations({ remote: face } as never)
  const onClose = vi.fn()
  render(
    <ProviderEditor
      provider={options.provider ?? 'deepseek-official'}
      displayName={options.displayName ?? 'DeepSeek'}
      {...options.consoleUrl === undefined ? {} : { consoleUrl: options.consoleUrl }}
      namespace={options.namespace ?? deepSeekNamespace()}
      schema={settingsSchema}
      settingsPath={options.settingsPath ?? []}
      operations={operations}
      t={t}
      readOnly={false}
      onClose={onClose}
    />,
  )
  return { discover, face, onClose }
}

/** Type a key and run the check. */
function runCheck(key: string): void {
  fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: key } })
  fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
}

describe('key check', () => {
  it('probes the endpoint the form shows with the typed key, and counts the models', async () => {
    const { discover } = mountEditor()
    runCheck('sk-live')

    await screen.findByText(en.keyCheckSuccess.replace('{count}', '3'))
    expect(discover).toHaveBeenCalledWith('llm-deepseek', {
      provider: 'deepseek-official',
      apiKey: 'sk-live',
      validate: true,
    })
    expect(screen.getByRole('status').textContent).toContain('3')
  })

  it('carries an edited-but-unsaved base URL', async () => {
    const { discover } = mountEditor()
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://edited.example/v1' } })
    runCheck('sk-live')

    await screen.findByText(en.keyCheckSuccess.replace('{count}', '3'))
    expect(discover).toHaveBeenCalledWith('llm-deepseek', {
      provider: 'deepseek-official',
      baseURL: 'https://edited.example/v1',
      apiKey: 'sk-live',
      validate: true,
    })
  })

  it('omits the key when the field is empty, letting the stored credential answer', async () => {
    const { discover } = mountEditor({ credentialConfigured: true })
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))

    await screen.findByText(en.keyCheckSuccess.replace('{count}', '3'))
    const payload = discover.mock.calls[0]?.[1] as Record<string, unknown>
    expect('apiKey' in payload).toBe(false)
  })

  it('disables the button and relabels it while the probe is in flight', async () => {
    let finishDiscover: ((response: { ok: true; value: { id: string }[] }) => void) | undefined
    const discover = vi.fn(() => new Promise<{ ok: true; value: { id: string }[] }>((resolve) => {
      finishDiscover = resolve
    }))
    mountEditor({ discover })
    runCheck('sk-live')

    const checking = screen.getByRole<HTMLButtonElement>('button', { name: en.keyChecking })
    expect(checking.disabled).toBe(true)
    await act(async () => {
      finishDiscover?.(remoteOk([{ id: 'a' }]))
      await Promise.resolve()
    })
    await screen.findByText(en.keyCheckSuccess.replace('{count}', '1'))
  })

  it('maps a refused key and an unreachable endpoint to actionable copy, else shows the raw message', async () => {
    const discover = vi.fn()
      .mockResolvedValueOnce(remoteFail('https://api.deepseek.com/models answered 401; check the API key'))
      .mockResolvedValueOnce(remoteFail('https://api.deepseek.com/models answered 403'))
      .mockResolvedValueOnce(remoteFail('could not reach https://api.deepseek.com/models'))
      .mockResolvedValueOnce(remoteFail('endpoint answered 500'))
    mountEditor({ discover })
    runCheck('sk-bad')

    await screen.findByText(en.keyCheckInvalid)
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
    await screen.findByText(en.keyCheckInvalid, { exact: true })
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
    await screen.findByText(en.keyCheckUnreachable)
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
    await screen.findByText('endpoint answered 500')
    expect(discover).toHaveBeenCalledTimes(4)
  })

  it('clears the verdict on a new keystroke', async () => {
    mountEditor()
    runCheck('sk-live')
    await screen.findByText(en.keyCheckSuccess.replace('{count}', '3'))

    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-live-2' } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('refuses to spend a round trip on a key the field already rejects', async () => {
    const { discover } = mountEditor()
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'has space' } })

    expect(screen.getByText(en.keyIllegalCharacters)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.keyCheck }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
    expect(discover).not.toHaveBeenCalled()
  })

  it('carries the wire protocol a pi-ai profile names', async () => {
    const { discover } = mountEditor({
      namespace: piAiNamespace(),
      settingsPath: ['providers', 'openai'],
      provider: 'openai',
      displayName: 'OpenAI',
    })
    runCheck('sk-live')

    await screen.findByText(en.keyCheckSuccess.replace('{count}', '3'))
    expect(discover).toHaveBeenCalledWith('llm-pi-ai', {
      provider: 'openai',
      baseURL: 'https://proxy.example/v1',
      api: 'openai-completions',
      apiKey: 'sk-live',
      validate: true,
    })
  })

  it('maps failure messages the same way wherever the check runs', () => {
    expect(keyCheckFailureText('x answered 401', t)).toBe(en.keyCheckInvalid)
    expect(keyCheckFailureText('x answered 403', t)).toBe(en.keyCheckInvalid)
    expect(keyCheckFailureText('could not reach x', t)).toBe(en.keyCheckUnreachable)
    expect(keyCheckFailureText('anything else', t)).toBe('anything else')
  })
})

describe('get-a-key guidance', () => {
  it('renders the DeepSeek blurb and console link for the official route', () => {
    mountEditor({ consoleUrl: 'https://platform.deepseek.com/api_keys' })
    expect(screen.getByText(en.keyGuidanceDeepSeek)).toBeTruthy()
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: en.keyGuidanceGetDeepSeek })
    expect(link.href).toBe('https://platform.deepseek.com/api_keys')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noreferrer')
  })

  it('renders the generic console link for another provider that names one', () => {
    mountEditor({
      namespace: piAiNamespace(),
      settingsPath: ['providers', 'openai'],
      provider: 'openai',
      displayName: 'OpenAI',
      consoleUrl: 'https://platform.openai.com/api-keys',
    })
    expect(screen.queryByText(en.keyGuidanceDeepSeek)).toBeNull()
    const link = screen.getByRole<HTMLAnchorElement>('link', {
      name: en.keyGuidanceGetConsole.replace('{name}', 'OpenAI'),
    })
    expect(link.href).toBe('https://platform.openai.com/api-keys')
  })

  it('renders nothing when the directory entry names no console page', () => {
    mountEditor()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('also renders in the credential-only posture', async () => {
    const discover = vi.fn(() => Promise.resolve(remoteOk([{ id: 'a' }])))
    const face = {
      llm: { discoverModels: discover },
      settings: { mutate: vi.fn() },
      credentials: {
        describe: vi.fn(() => Promise.resolve(remoteOk({}))),
        set: vi.fn(),
      },
    }
    const operations = createModelsOperations({ remote: face } as never)
    render(
      <ProviderEditor
        provider="deepseek-official"
        displayName="DeepSeek"
        consoleUrl="https://platform.deepseek.com/api_keys"
        hideTitle
        namespace={deepSeekNamespace()}
        schema={settingsSchema}
        settingsPath={[]}
        operations={operations}
        t={t}
        readOnly={false}
        credentialOnly
        credentialRequired
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(en.keyGuidanceDeepSeek)).toBeTruthy()
    runCheck('sk-live')
    await screen.findByText(en.keyCheckSuccess.replace('{count}', '1'))
    expect(discover).toHaveBeenCalledWith('llm-deepseek', {
      provider: 'deepseek-official',
      apiKey: 'sk-live',
      validate: true,
    })
    // The fold stays off in this posture.
    expect(screen.queryByText(en.customized)).toBeNull()
    await waitFor(() => { expect(screen.getByLabelText(en.keyInput)).toBeTruthy() })
  })
})

/**
 * The page-level join carries `consoleUrl` from the directory entry into both
 * cards that host the editor: the row/setup card and the add card. Mounted
 * here end to end because the guidance's presence is decided by that join.
 */
describe('guidance through the Models page', () => {
  async function mountPage(options: {
    anthropicConsole?: boolean
    deepSeekConsole?: boolean
    deepSeekKeyConfigured?: boolean
  } = {}) {
    const face = {
      llm: {
        listProviders: vi.fn(() => Promise.resolve(remoteOk([
          { id: 'deepseek-official', name: 'DeepSeek' },
        ]))),
        listConfigurableProviders: vi.fn(() => Promise.resolve(remoteOk([
          {
            provider: 'deepseek-official',
            displayName: 'DeepSeek',
            settingsNs: 'llm-deepseek',
            settingsPath: [],
            ...options.deepSeekConsole === false ? {} : { consoleUrl: 'https://platform.deepseek.com/api_keys' },
          },
          {
            provider: 'anthropic',
            displayName: 'Anthropic',
            settingsNs: 'llm-pi-ai',
            settingsPath: ['providers', 'anthropic'],
            declared: false,
            ...options.anthropicConsole === false ? {} : { consoleUrl: 'https://console.anthropic.com/settings/keys' },
          },
        ]))),
        discoverModels: vi.fn(() => Promise.resolve(remoteOk([]))),
      },
      settings: {
        describe: vi.fn(() => Promise.resolve(remoteOk({
          writable: true,
          hasDocument: false,
          namespaces: [deepSeekNamespace(), piAiNamespace()],
        }))),
        mutate: vi.fn(),
      },
      credentials: {
        describe: vi.fn((refs: string[]) => Promise.resolve(remoteOk(
          Object.fromEntries(refs.map(ref => [ref, {
            configured: options.deepSeekKeyConfigured === true && ref === 'DEEPSEEK_API_KEY',
            writable: true,
          }])),
        ))),
        set: vi.fn(),
        unset: vi.fn(),
      },
    }
    // The page plugin's context, scripted down to the namespaces it reaches.
    const ctx = { remote: face } as never
    const controller = new ModelsSettingsStore(ctx, settingsSchema, new SettingsDescribeMirror(ctx))
    await controller.load()
    const injected: ModelsSectionProps = {
      controller,
      useSnapshot: bindSnapshotSelector(controller.store),
      operations: createModelsOperations(ctx),
      schema: settingsSchema,
      t,
      renderSlot: vi.fn(() => null),
    }
    render(<ModelsSection {...injected} />)
    return { face, controller }
  }

  it('shows the DeepSeek guidance on the first-run setup card', async () => {
    await mountPage()
    // Nothing is usable yet, so the DeepSeek card opens itself — with the
    // blurb and console link the directory entry carried.
    expect(screen.getByText(en.keyGuidanceDeepSeek)).toBeTruthy()
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: en.keyGuidanceGetDeepSeek })
    expect(link.href).toBe('https://platform.deepseek.com/api_keys')
  })

  it('shows the generic console link on the add card for the picked provider', async () => {
    await mountPage({ deepSeekKeyConfigured: true })
    // DeepSeek's key is stored, so the page is out of the first-run posture
    // and the add flow is where a dormant provider's editor appears.
    expect(screen.queryByText(en.keyGuidanceDeepSeek)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.add }))

    const link = await screen.findByRole('link', {
      name: en.keyGuidanceGetConsole.replace('{name}', 'Anthropic'),
    })
    expect((link as HTMLAnchorElement).href).toBe('https://console.anthropic.com/settings/keys')
  })

  it('shows no guidance on the add card when the picked provider names no console page', async () => {
    await mountPage({ deepSeekKeyConfigured: true, anthropicConsole: false })
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    await screen.findByLabelText(en.keyInput)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
