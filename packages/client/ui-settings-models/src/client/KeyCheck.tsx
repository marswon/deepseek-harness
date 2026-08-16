/**
 * The 检查 action beside an API-key field: one live, authenticated probe of
 * the provider the form describes, shared by the provider editor and the
 * first-run wizard so both judge a key exactly the same way. The host performs
 * the round trip (`llm.discoverModels` with `validate: true`); the key typed
 * into the field travels with the request and is never stored by it. The
 * get-a-key guidance line lives here too, so both call sites offer the same
 * console link for the same provider row.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** What one check asks the host about: the same probe facts the fetch action sends. */
export interface KeyCheckTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /** Route being checked; every call site edits or offers a known route. */
  provider: string
  /** Endpoint as the form currently shows it, when it names one. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored; absent means the stored credential answers. */
  apiKey?: string
}

/** The check's component-local outcome. */
export type KeyCheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; count: number }
  | { kind: 'failed'; message: string }

/** The controller half of the check action (see {@link useKeyCheck}). */
export interface KeyCheckController {
  /** Current outcome; a fresh form edit resets it to idle. */
  state: KeyCheckState
  /**
   * Run the live probe. Resolves with whether the key was accepted so a caller
   * that gates a later step (the wizard's 完成) can read the outcome without
   * subscribing to the state.
   */
  check: (target: KeyCheckTarget) => Promise<boolean>
  /** Forget the outcome — a new keystroke makes it stale. */
  reset: () => void
}

/**
 * Hold the check state for one key field. Subscribes to nothing external: the
 * state is component-local and the wire face arrives as an argument, so this
 * stays an ordinary behavioral hook both call sites compose.
 * @param api - the llm wire face the probe calls.
 * @returns the state, the probe action, and the reset.
 */
export function useKeyCheck(api: Pick<IApiClient, 'llm'>): KeyCheckController {
  const [state, setState] = useState<KeyCheckState>({ kind: 'idle' })
  const check = async (target: KeyCheckTarget): Promise<boolean> => {
    setState({ kind: 'checking' })
    try {
      const response = await api.llm.discoverModels({
        settingsNs: target.settingsNs,
        provider: target.provider,
        ...target.baseURL === undefined ? {} : { baseURL: target.baseURL },
        ...target.api === undefined ? {} : { api: target.api },
        ...target.apiKey === undefined ? {} : { apiKey: target.apiKey },
        validate: true,
      })
      if (!response.result.ok) {
        setState({ kind: 'failed', message: response.result.error.message })
        return false
      }
      setState({ kind: 'ok', count: response.result.value.models.length })
      return true
    } catch (error) {
      // The transport rejected rather than answering; without this the button
      // would stay busy with nothing shown.
      setState({ kind: 'failed', message: messageOf(error) })
      return false
    }
  }
  return { state, check, reset: () => { setState({ kind: 'idle' }) } }
}

/** What a failure message says about the key, as copy the user can act on. */
export function keyCheckFailureText(message: string, t: (key: keyof typeof en) => string): string {
  // The host names an authentication refusal by its status code and an
  // unreachable endpoint by the "could not reach" phrasing; anything else is
  // shown raw rather than guessed at.
  if (message.includes('answered 401') || message.includes('answered 403')) return t('keyCheckInvalid')
  if (message.includes('could not reach')) return t('keyCheckUnreachable')
  return message
}

/** Props of {@link KeyCheckButton}. */
export interface KeyCheckButtonProps {
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Current outcome, for the in-flight label. */
  state: KeyCheckState
  /** Refuse the gesture (read-only card, pending write, a key the field already rejected). */
  disabled: boolean
  /** Run the probe. */
  onCheck: () => void
}

/**
 * Render the 检查 button itself: a quiet ghost capsule beside the key input,
 * disabled and relabeled while a probe is in flight.
 * @param props - copy, state, and the probe action.
 * @returns the button.
 */
export function KeyCheckButton(props: KeyCheckButtonProps): ReactNode {
  const checking = props.state.kind === 'checking'
  return (
    <Button
      variant="ghost"
      size="sm"
      className={styles['keyCheckButton']}
      disabled={props.disabled || checking}
      onClick={props.onCheck}
    >
      {checking ? props.t('keyChecking') : props.t('keyCheck')}
    </Button>
  )
}

/**
 * Render the probe outcome under the key input: a green success naming how
 * many models the endpoint listed, or a red failure mapped to actionable copy.
 * @param props - copy and the current outcome.
 * @returns the status line, or null while there is nothing to report.
 */
export function KeyCheckStatus(props: {
  t: (key: keyof typeof en) => string
  state: KeyCheckState
}): ReactNode {
  const { state, t } = props
  if (state.kind === 'ok') {
    return (
      <p className={styles['keyCheckSuccess']} role="status">
        {t('keyCheckSuccess').replace('{count}', String(state.count))}
      </p>
    )
  }
  if (state.kind === 'failed') {
    return <p className={styles['error']}>{keyCheckFailureText(state.message, t)}</p>
  }
  return null
}

/**
 * Render the get-a-key guidance under the key input: the official DeepSeek
 * route explains what a key is and where one comes from; any other provider
 * whose directory entry names a console page gets a plain link. A provider
 * without a known console page renders nothing rather than guessing.
 * @param props - the provider identity, its console page, and copy.
 * @returns the guidance line, or null when no destination is known.
 */
export function KeyGuidance(props: {
  provider: string
  displayName: string
  consoleUrl: string | undefined
  t: (key: keyof typeof en) => string
}): ReactNode {
  const { consoleUrl, t } = props
  if (consoleUrl === undefined) return null
  const label = props.provider === 'deepseek-official'
    ? t('keyGuidanceGetDeepSeek')
    : t('keyGuidanceGetConsole').replace('{name}', props.displayName)
  return (
    <p className={styles['keyGuidance']}>
      {props.provider === 'deepseek-official' ? <span>{t('keyGuidanceDeepSeek')}</span> : null}
      {/* External by definition: the desktop shell routes http(s) navigation to
          the system browser, and a plain browser opens a new tab. */}
      <a className={styles['keyGuidanceLink']} href={consoleUrl} target="_blank" rel="noreferrer">
        {label}
      </a>
    </p>
  )
}
