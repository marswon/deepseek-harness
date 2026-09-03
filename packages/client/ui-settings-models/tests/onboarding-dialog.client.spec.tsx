// @vitest-environment jsdom
/** First-run DeepSeek wizard behavior over the shared Models join. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingDialogProps } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

/** Credentials answers over the Remote carrier, which has no envelope. */
function remoteOk<T>(value: T) {
  return { ok: true as const, value }
}
function remoteFail(message: string) {
  return { ok: false as const, error: new RemoteError('gateway/internal', message, {}) }
}

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  reasoningEffort: Schema.union(['off', 'low', 'high', 'max']),
  defaultContextWindow: Schema.number().step(1).min(1),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  })),
})

const CONSOLE_URL = 'https://platform.deepseek.com/api_keys'

type AttentionSnapshot = Parameters<Parameters<DeepSeekOnboardingDialogProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: DeepSeekOnboardingDialogProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function deepSeekNamespace(apiKeyEnv: string | null): SettingsNamespaceView {
  const value = apiKeyEnv === null ? {} : { apiKeyEnv }
  return {
    ns: 'llm-deepseek',
    schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
    value,
    base: value,
    user: {},
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function harness(options: {
  provider?: boolean
  providerSettingsNs?: string
  providerActive?: boolean
  consoleUrl?: boolean
  settingsNamespace?: boolean
  apiKeyEnv?: string | null
  configured?: () => boolean
  credential?: { source?: string; writable: boolean }
  describeFailure?: string
  settingsWritable?: boolean
  providersFailure?: string
  setFailure?: string
  discover?: ReturnType<typeof vi.fn>
} = {}) {
  if (document.getElementById('root') === null) {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
  }
  let fileConfigured = false
  const configured = options.configured ?? (() => fileConfigured)
  const apiKeyEnv = options.apiKeyEnv === undefined ? 'DEEPSEEK_API_KEY' : options.apiKeyEnv
  const mutate = vi.fn(() => Promise.resolve(remoteOk(deepSeekNamespace(apiKeyEnv))))
  const set = vi.fn((_ref: string, _value: string) => {
    if (options.setFailure !== undefined) return Promise.resolve(remoteFail(options.setFailure))
    fileConfigured = true
    return Promise.resolve(remoteOk(undefined))
  })
  const discover = options.discover ?? vi.fn(() => Promise.resolve(remoteOk([
    { id: 'deepseek-v4-flash' },
    { id: 'deepseek-v4-pro' },
  ])))
  const face = {
    llm: {
      listProviders: () => {
        if (options.providersFailure !== undefined) return Promise.resolve(remoteFail(options.providersFailure))
        return Promise.resolve(remoteOk(
          options.provider === false || options.providerActive === false
            ? []
            : [{ id: 'deepseek-official', name: 'DeepSeek' }],
        ))
      },
      listConfigurableProviders: () => Promise.resolve(remoteOk(
        options.provider === false
          ? []
          : [{
            provider: 'deepseek-official',
            displayName: 'DeepSeek',
            settingsNs: options.providerSettingsNs ?? 'llm-deepseek',
            settingsPath: [],
            ...options.consoleUrl === false ? {} : { consoleUrl: CONSOLE_URL },
          }],
      )),
      discoverModels: discover,
    },
    settings: {
      describe: () => Promise.resolve(remoteOk({
        writable: options.settingsWritable ?? true,
        hasDocument: false,
        namespaces: options.settingsNamespace === false ? [] : [deepSeekNamespace(apiKeyEnv)],
      })),
      mutate,
    },
    credentials: {
      describe: () => options.describeFailure === undefined
        ? Promise.resolve(remoteOk({
          DEEPSEEK_API_KEY: {
            configured: configured(),
            ...configured() && options.credential?.source !== undefined
              ? { source: options.credential.source }
              : {},
            writable: options.credential?.writable ?? true,
          },
        }))
        : Promise.resolve(remoteFail(options.describeFailure)),
      set,
    },
  }
  // The page plugin's context, scripted down to the namespaces it reaches.
  const ctx = { remote: face } as never
  const operations = createModelsOperations(ctx)
  const controller = new ModelsSettingsStore(ctx, settingsSchema, new SettingsDescribeMirror(ctx))
  const openSection = vi.fn()
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: DeepSeekOnboardingDialogProps = {
    stepId: 'deepseek-official',
    complete,
    openSection,
    useSessions: unusedHook,
    useSessionPendingInteraction,
    useWorkspaces: unusedHook,
    controller,
    useModels: bindSnapshotSelector(controller.store),
    operations,
    schema: settingsSchema,
    t: key => en[key],
  }
  return {
    controller, complete, openSection, props, mutate, set, discover,
    configure: () => { fileConfigured = true },
  }
}

/** Walk from step 1 to step 2. */
async function toConfigureStep(): Promise<void> {
  await screen.findByRole('dialog', { name: en.onboardingTitle })
  fireEvent.click(screen.getByRole('button', { name: en.onboardingNext }))
}

/** Reach step 3 with a key the scripted endpoint accepts. */
async function toDoneStep(key = 'sk-live'): Promise<void> {
  await toConfigureStep()
  fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: key } })
  fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
  await screen.findByText(en.keyCheckSuccess.replace('{count}', '2'))
  fireEvent.click(screen.getByRole('button', { name: en.onboardingFinish }))
}

describe('DeepSeekOnboardingDialog', () => {
  it('renders when the shell root is absent', async () => {
    const h = harness()
    document.getElementById('root')!.remove()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
  })

  it('opens on the learn step, inerts the product, and focuses the title', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    const dialog = await screen.findByRole('dialog', { name: en.onboardingTitle })
    expect(document.getElementById('root')?.inert).toBe(true)
    expect(screen.getByText(en.onboardingLearnWhat)).toBeTruthy()
    expect(screen.getByText(en.onboardingLearnHow)).toBeTruthy()
    // The get-a-key link leaves the app: new tab / system browser.
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: en.keyGuidanceGetDeepSeek })
    expect(link.href).toBe(CONSOLE_URL)
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noreferrer')
    // The stepper names all three steps and marks the first as current.
    const steps = screen.getByRole('list', { name: en.onboardingStepsLabel })
    expect(steps.textContent).toContain(en.onboardingStepLearn)
    expect(steps.textContent).toContain(en.onboardingStepConfigure)
    expect(steps.textContent).toContain(en.onboardingStepDone)
    expect(dialog.contains(steps)).toBe(true)
    expect(screen.getByText(en.onboardingStepLearn).getAttribute('aria-current')).toBe('step')
    // No form control on this step, so the title holds focus.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(en.onboardingTitle)
    })
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('omits the console link when the directory names none', async () => {
    const h = harness({ consoleUrl: false })
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('cannot be dismissed implicitly and restores the previous inert state', async () => {
    const h = harness()
    const appRoot = document.getElementById('root')!
    appRoot.inert = true
    const view = render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()

    view.unmount()
    expect(appRoot.inert).toBe(true)
  })

  it('walks forward and back between the learn and configure steps', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toConfigureStep()

    // The key field takes focus on the configure step; 完成 waits on a check.
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(document.activeElement).toBe(key) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingFinish }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.keyCheck }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: en.onboardingBack }))
    expect(screen.getByText(en.onboardingLearnWhat)).toBeTruthy()
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('gates 完成 on a successful check and clears the verdict on a new keystroke', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toConfigureStep()

    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-live' } })
    const check = screen.getByRole<HTMLButtonElement>('button', { name: en.keyCheck })
    expect(check.disabled).toBe(false)
    fireEvent.click(check)
    await screen.findByText(en.keyCheckSuccess.replace('{count}', '2'))

    expect(h.discover).toHaveBeenCalledWith('llm-deepseek', {
      provider: 'deepseek-official',
      apiKey: 'sk-live',
      validate: true,
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingFinish }).disabled).toBe(false)

    // Editing the key afterwards makes the verdict stale: the step locks again.
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-live-2' } })
    expect(screen.queryByText(/Connected/)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingFinish }).disabled).toBe(true)
    expect(h.set).not.toHaveBeenCalled()
  })

  it('maps a refused key and an unreachable endpoint to actionable copy', async () => {
    const discover = vi.fn()
      .mockResolvedValueOnce(remoteFail('https://api.deepseek.com/models answered 401; check the API key'))
      .mockResolvedValueOnce(remoteFail('could not reach https://api.deepseek.com/models'))
      .mockResolvedValueOnce(remoteFail('endpoint answered 500'))
    const h = harness({ discover })
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toConfigureStep()
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-bad' } })

    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
    await screen.findByText(en.keyCheckInvalid)
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
    await screen.findByText(en.keyCheckUnreachable)
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))
    await screen.findByText('endpoint answered 500')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingFinish }).disabled).toBe(true)
    expect(h.set).not.toHaveBeenCalled()
  })

  it('disables the check button and relabels it while a probe is in flight', async () => {
    let finishDiscover: ((response: { ok: true; value: { id: string }[] }) => void) | undefined
    const discover = vi.fn(() => new Promise<{ ok: true; value: { id: string }[] }>((resolve) => {
      finishDiscover = resolve
    }))
    const h = harness({ discover })
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toConfigureStep()
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByRole('button', { name: en.keyCheck }))

    const checking = screen.getByRole<HTMLButtonElement>('button', { name: en.keyChecking })
    expect(checking.disabled).toBe(true)
    await act(async () => {
      finishDiscover?.(remoteOk([]))
      await Promise.resolve()
    })
    await screen.findByText(en.keyCheckSuccess.replace('{count}', '0'))
  })

  it('shows the DeepSeek guidance under the key field on the configure step', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toConfigureStep()
    expect(screen.getByText(en.keyGuidanceDeepSeek)).toBeTruthy()
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: en.keyGuidanceGetDeepSeek })
    expect(link.href).toBe(CONSOLE_URL)
  })

  it('skips setup without storing anything', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toConfigureStep()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingSkip }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.openSection).not.toHaveBeenCalled()
    expect(h.set).not.toHaveBeenCalled()
    expect(h.mutate).not.toHaveBeenCalled()
    expect(h.discover).not.toHaveBeenCalled()
  })

  it('leaves for the Models section from the bottom link', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en.onboardingUseOther }))
    expect(h.openSection).toHaveBeenCalledWith('models')
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.set).not.toHaveBeenCalled()
  })

  it('stores the checked key from the done step and completes on the refreshed join', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toDoneStep()

    expect(screen.getByText(en.onboardingDoneBody)).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingStart }))

    await waitFor(() => { expect(h.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-live') })
    expect(h.mutate).not.toHaveBeenCalled()
    // The key landed, the reloaded join reports the provider usable, and the
    // readiness effect is what transfers ownership — one completion.
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('trims paste whitespace from the key it stores', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toDoneStep('  sk-padded  ')
    fireEvent.click(screen.getByRole('button', { name: en.onboardingStart }))
    await waitFor(() => { expect(h.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-padded') })
  })

  it('keeps the done step open and reports a refused credential write', async () => {
    const h = harness({ setFailure: 'credential was rejected' })
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toDoneStep()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingStart }))
    expect(await screen.findByText('credential was rejected')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingStart }).disabled).toBe(false)
    expect(h.complete).not.toHaveBeenCalled()
    expect(h.mutate).not.toHaveBeenCalled()

    // Walking back keeps the failure visible on the configure step.
    fireEvent.click(screen.getByRole('button', { name: en.onboardingBack }))
    expect(screen.getByText('credential was rejected')).toBeTruthy()
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
  })

  it('walks back from the done step to the configure step with the key kept', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await toDoneStep()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingBack }))

    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    expect(key.value).toBe('sk-live')
    // The verdict survived the round trip, so 完成 is still available.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingFinish }).disabled).toBe(false)
    expect(h.set).not.toHaveBeenCalled()
  })

  it('does not block the product when DeepSeek setup is unavailable', async () => {
    for (const h of [
      harness({ describeFailure: 'credentials service is absent' }),
      harness({ credential: { writable: false } }),
      harness({ settingsWritable: false }),
      harness({ providersFailure: 'the provider directory is unavailable' }),
      harness({ providerActive: false }),
      harness({ settingsNamespace: false }),
      harness({ apiKeyEnv: null }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      expect(h.openSection).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('skips an absent adapter and an already-configured environment credential', async () => {
    for (const h of [
      harness({ provider: false }),
      harness({ providerSettingsNs: '' }),
      harness({ configured: () => true, credential: { source: 'env', writable: false } }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      view.unmount()
    }
  })

  it('closes when an external credential invalidation refreshes the shared join', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    h.configure()
    await act(async () => { await h.controller.load() })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(h.complete).toHaveBeenCalledOnce()
  })
})
