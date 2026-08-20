/**
 * Official-DeepSeek first-run wizard. Readiness comes from the same
 * provider/settings/credential join as the Models page: any provider the user
 * can already talk to ends the step, and only a user with none is offered the
 * official DeepSeek route. The dialog itself is an in-component three-step
 * state machine — 了解 (what a key is and where one comes from), 配置 (paste
 * and live-check it), 完成 (confirm and store) — inside the onboarding
 * plugin's shared modal; the slot framework sees one step whose id and
 * complete() semantics are unchanged. The key check is the same component and
 * hook the provider editor uses, so a key is judged one way everywhere.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { KeyCheckButton, KeyCheckStatus, KeyGuidance, useKeyCheck } from './KeyCheck.tsx'
import { refFor } from './ProviderEditor.tsx'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { messageOf, onboardingReadiness } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Existing wire face reused by the Models credential editor. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<DeepSeekOnboardingInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/** The wizard's three steps, in order. */
type WizardStep = 1 | 2 | 3

/** Step labels as the stepper reads them. */
const STEP_LABELS: readonly (keyof typeof en)[] = [
  'onboardingStepLearn',
  'onboardingStepConfigure',
  'onboardingStepDone',
]

/**
 * Prompt a first-run user for the official DeepSeek credential while no
 * provider can serve requests and that credential is writable.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, openSection, controller, useModels, api, schema, t } = props
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)
  const [step, setStep] = useState<WizardStep>(1)
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const keyCheck = useKeyCheck(api)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (
      readiness.kind === 'adapter-absent'
      || readiness.kind === 'provider-ready'
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind])

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'provider-ready':
    case 'unavailable':
      return null
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  const row = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  const namespace = state.namespaces.get('llm-deepseek')
  /* v8 ignore next 2 -- credential-missing is derived only from this exact joined row. */
  if (row === undefined || namespace === undefined) return null

  const keyValue = keyDraft.trim()
  const checked = keyCheck.state.kind === 'ok'

  const checkKey = (): void => {
    void keyCheck.check({
      settingsNs: 'llm-deepseek',
      provider: 'deepseek-official',
      ...keyValue.length === 0 ? {} : { apiKey: keyValue },
    })
  }

  /**
   * The finish action's write: exactly the credential half of the provider
   * editor's credentialOnly save — the key stores under the reference the
   * profile resolves through, and no settings write is owed (the whole-section
   * profile already exists). Completion rides the refreshed join flipping
   * readiness to provider-ready, the same path the old embedded editor took.
   */
  const start = async (): Promise<void> => {
    setSaving(true)
    setFailure(undefined)
    try {
      const stored = await api.credentials.set({
        ref: refFor(schema, namespace, row.entry.settingsPath, row.entry.provider),
        value: keyValue,
      })
      if (!stored.result.ok) {
        setFailure(stored.result.error.message)
        return
      }
      void controller.load()
    } catch (error) {
      // A transport failure rejects rather than answering; the step stays so
      // the gesture can be retried instead of vanishing.
      setFailure(messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  /** The bottom link every step carries: leave the wizard for the Models page. */
  const useOther = (
    <div className={styles.footer}>
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => {
          openSection('models')
          complete()
        }}
      >
        {t('onboardingUseOther')}
      </button>
    </div>
  )

  return (
    <OnboardingModal title={t('onboardingTitle')} focusTitle={step !== 2}>
      <ol className={styles.steps} aria-label={t('onboardingStepsLabel')}>
        {STEP_LABELS.map((label, index) => {
          const position = (index + 1) as WizardStep
          return (
            <li
              key={label}
              className={position === step ? styles.stepCurrent : styles.stepItem}
              aria-current={position === step ? 'step' : undefined}
            >
              <span className={styles.stepIndex} aria-hidden="true">{position}</span>
              {t(label)}
            </li>
          )
        })}
      </ol>
      {step === 1
        ? (
          <>
            <p className={styles.description}>{t('onboardingLearnWhat')}</p>
            <p className={styles.description}>{t('onboardingLearnHow')}</p>
            {row.entry.consoleUrl === undefined
              ? null
              : (
                <p className={styles.description}>
                  <a
                    className={styles.consoleLink}
                    href={row.entry.consoleUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('keyGuidanceGetDeepSeek')}
                  </a>
                </p>
              )}
            <div className={styles.actions}>
              <Button variant="primary" autoFocus onClick={() => { setStep(2) }}>
                {t('onboardingNext')}
              </Button>
            </div>
            {useOther}
          </>
        )
        : null}
      {step === 2
        ? (
          <>
            <div className={styles.keyField}>
              <span className={styles.keyLabel}>{t('keyInput')}</span>
              <div className={styles.keyRow}>
                <Input
                  type="password"
                  autoComplete="off"
                  value={keyDraft}
                  placeholder={t('keyPlaceholder')}
                  aria-label={t('keyInput')}
                  autoFocus
                  disabled={saving}
                  onChange={(event) => {
                    setKeyDraft(event.target.value)
                    // A verdict belongs to the key it probed; a new keystroke
                    // makes it stale, so it clears instead of reading as current.
                    keyCheck.reset()
                  }}
                />
                <KeyCheckButton
                  t={t}
                  state={keyCheck.state}
                  disabled={saving || keyValue.length === 0}
                  onCheck={checkKey}
                />
              </div>
              <KeyCheckStatus t={t} state={keyCheck.state} />
              <KeyGuidance
                provider={row.entry.provider}
                displayName={row.entry.displayName}
                consoleUrl={row.entry.consoleUrl}
                t={t}
              />
            </div>
            {failure === undefined ? null : <p className={styles.error}>{failure}</p>}
            <div className={styles.actions}>
              <Button variant="ghost" disabled={saving} onClick={() => { complete() }}>
                {t('onboardingSkip')}
              </Button>
              <Button variant="outline" disabled={saving} onClick={() => { setStep(1) }}>
                {t('onboardingBack')}
              </Button>
              {/* The finish step is reached only through a key the provider
                  actually accepted; skipping stays available for the user who
                  would rather set nothing up. */}
              <Button
                variant="primary"
                disabled={!checked || saving}
                title={checked ? undefined : t('keyCheckFinishHint')}
                onClick={() => { setStep(3) }}
              >
                {t('onboardingFinish')}
              </Button>
            </div>
            {useOther}
          </>
        )
        : null}
      {step === 3
        ? (
          <>
            <p className={styles.description}>{t('onboardingDoneBody')}</p>
            {failure === undefined ? null : <p className={styles.error}>{failure}</p>}
            <div className={styles.actions}>
              <Button variant="outline" disabled={saving} onClick={() => { setStep(2) }}>
                {t('onboardingBack')}
              </Button>
              <Button variant="primary" disabled={saving} onClick={() => { void start() }}>
                {saving ? t('onboardingSaving') : t('onboardingStart')}
              </Button>
            </div>
            {useOther}
          </>
        )
        : null}
    </OnboardingModal>
  )
}
