/**
 * The GitHub section of the Harness Settings page.
 *
 * Four cards: the read-only authorization facts (token source and scopes), the
 * handoff behavior, the prompt template editor, and the privacy note. Nothing here writes to
 * GitHub; the only writes are preference saves through `PanelActions`.
 *
 * @module dsh-plugin-github-issues/client/views/Settings
 */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { DEFAULT_PROMPT_TEMPLATE } from '../../vm.ts'
import type { SettingsProps } from '../viewmodel.ts'
import {
  Badge, Button, ErrorBanner, Pill, Spinner, StyleSheet, TextArea, Toast,
  CONTROLS_CSS, type Tone,
} from './controls.tsx'
import { RefreshGlyph } from './Icon.tsx'
import {
  PAGE_CSS, PAGE_CONTENT_STYLE, PAGE_H1_STYLE, PAGE_HEAD_STYLE, PAGE_ROOT_STYLE, PAGE_SUBTITLE_STYLE,
} from './Page.tsx'

/** The stylesheet chunk owned by this module. */
export const SETTINGS_CSS = `
.ghs-cards{display:flex;flex-direction:column;gap:16px;margin-top:20px;padding-bottom:8px}
.ghs-card{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;padding:16px;border:0.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l3));border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1))}
.ghs-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ghs-card-title{margin:0;font-size:var(--dsh-content-font-size,14px);line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ghs-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ghs-kv{display:flex;flex-direction:column;gap:4px;margin:0}
.ghs-kv-row{display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:18px}
.ghs-kv-row dt{flex:none;min-width:88px;margin:0;color:var(--dsw-alias-label-tertiary)}
.ghs-kv-row dd{margin:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.ghs-scopes{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ghs-warn{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;padding:10px 12px;border:0.5px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-layer-1));font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghs-choices{display:flex;flex-direction:column;gap:6px}
.ghs-choice{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;cursor:pointer;text-align:left}
.ghs-choice:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ghs-choice[aria-checked=true]{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.ghs-choice:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.ghs-choice-dot{box-sizing:border-box;width:14px;height:14px;border:1.5px solid var(--dsw-alias-border-l3);border-radius:50%;flex:none}
.ghs-choice[aria-checked=true] .ghs-choice-dot{border:4px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-link))}
.ghs-field{display:flex;flex-direction:column;gap:6px}
.ghs-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ghs-about{display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ghs-about p{margin:0}
.ghs-page-head{padding-bottom:0}
`.trim()

/** The body wrapper shared by the settings cards. */
const CARDS_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column' }

/**
 * The GitHub settings section.
 * @param props - the panel snapshot, actions, and translate function.
 * @returns the page-like settings section.
 */
export function GitHubSettings({ snapshot, actions, t }: SettingsProps) {
  const status = snapshot.status
  const prefs = snapshot.prefs
  const [template, setTemplate] = useState(prefs.promptTemplate)

  // A save (or a reset) flows back through prefs; keep the editor in sync.
  useEffect(() => {
    setTemplate(prefs.promptTemplate)
  }, [prefs.promptTemplate])

  const authTone: Tone = status === undefined
    ? 'neutral'
    : status.ghInstalled === false ? 'error' : status.signedIn ? 'success' : 'warn'
  const authLabel = status === undefined
    ? t('settings.loading')
    : status.ghInstalled === false
      ? t('settings.ghMissing')
      : status.signedIn
        ? t('settings.signedIn', { login: status.login ?? status.host })
        : t('settings.signedOut')
  const subtitle = status === undefined
    ? t('settings.loading')
    : status.signedIn
      ? t('settings.signedIn', { login: status.login ?? status.host })
      : t('settings.signedOut')

  /** Put the editor back to the default template and persist it. */
  const resetTemplate = (): void => {
    setTemplate(DEFAULT_PROMPT_TEMPLATE)
    actions.savePrefs({ promptTemplate: DEFAULT_PROMPT_TEMPLATE })
  }

  return (
    <section className="ghp-page" style={PAGE_ROOT_STYLE} data-github-settings aria-label={t('settings.title')}>
      <StyleSheet chunks={[CONTROLS_CSS, PAGE_CSS, SETTINGS_CSS]} />
      <div className="ghp-content" style={PAGE_CONTENT_STYLE}>
        <header className="ghp-head" style={PAGE_HEAD_STYLE} data-window-drag>
          <div className="ghp-title-block">
            <h1 className="ghp-h1" style={PAGE_H1_STYLE}>{t('settings.title')}</h1>
            <div className="ghp-subtitle" style={PAGE_SUBTITLE_STYLE}>{subtitle}</div>
          </div>
          <div className="ghp-head-actions">
            <Button variant="outline" onClick={() => actions.refresh()} disabled={snapshot.loading}>
              {snapshot.loading ? <Spinner size={12} /> : <RefreshGlyph size={13} />}
              {snapshot.loading ? t('settings.loading') : t('settings.refresh')}
            </Button>
          </div>
        </header>

        {snapshot.error !== undefined && (
          <ErrorBanner
            message={t('settings.error', { message: snapshot.error.message })}
            retryLabel={t('settings.refresh')}
            onRetry={() => actions.refresh()}
          />
        )}

        <div className="ghs-cards" style={CARDS_STYLE}>
          <section className="ghs-card" aria-labelledby="gh-settings-auth">
            <div className="ghs-card-head">
              <h2 className="ghs-card-title" id="gh-settings-auth">{t('settings.auth')}</h2>
            </div>

            {status === undefined
              ? <span className="ghp-muted">{t('settings.loading')}</span>
              : (
                <>
                  <div className="ghs-row">
                    <Pill tone={authTone} dot>{authLabel}</Pill>
                    <span className="ghp-muted">{t('settings.authModeGh')}</span>
                  </div>

                  {status.error !== undefined && (
                    <ErrorBanner message={t('settings.error', { message: status.error })} />
                  )}

                  <dl className="ghs-kv">
                    <div className="ghs-kv-row">
                      <dt>{t('settings.login')}</dt>
                      <dd>{status.login ?? '—'}</dd>
                    </div>
                    <div className="ghs-kv-row">
                      <dt>{t('settings.host')}</dt>
                      <dd>{status.host}</dd>
                    </div>
                    <div className="ghs-kv-row">
                      <dt>{t('settings.tokenSource')}</dt>
                      <dd>{status.tokenSource ?? '—'}</dd>
                    </div>
                  </dl>

                  <div className="ghs-scopes">
                    <span className="gh-field-label">{t('settings.scopes')}</span>
                    {status.scopes.length === 0
                      ? <span className="ghp-muted">—</span>
                      : status.scopes.map(scope => <Badge key={scope} tone="neutral">{scope}</Badge>)}
                  </div>
                </>
              )}
          </section>

          <section className="ghs-card" aria-labelledby="gh-settings-handoff">
            <h2 className="ghs-card-title" id="gh-settings-handoff">{t('settings.handoff')}</h2>
            <div className="ghs-choices" role="radiogroup" aria-label={t('settings.handoff')}>
              {(['draft', 'send'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={prefs.handoffMode === mode}
                  className="ghs-choice"
                  onClick={() => actions.savePrefs({ handoffMode: mode })}
                >
                  <span className="ghs-choice-dot" aria-hidden="true" />
                  <span>{mode === 'draft' ? t('settings.handoff.draft') : t('settings.handoff.send')}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="ghs-card" aria-labelledby="gh-settings-template">
            <h2 className="ghs-card-title" id="gh-settings-template">{t('settings.template')}</h2>
            <div className="ghs-field">
              <TextArea
                value={template}
                onChange={setTemplate}
                ariaLabel={t('settings.template')}
                rows={9}
                mono
              />
              <span className="ghp-muted">{t('settings.template.help')}</span>
            </div>
            <div className="ghs-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={() => actions.savePrefs({ promptTemplate: template })}
                disabled={template === prefs.promptTemplate}
              >
                {t('settings.save')}
              </Button>
              <Button variant="ghost" size="sm" onClick={resetTemplate}>{t('settings.reset')}</Button>
            </div>
          </section>

          <section className="ghs-card" aria-labelledby="gh-settings-about">
            <h2 className="ghs-card-title" id="gh-settings-about">{t('settings.about')}</h2>
            <div className="ghs-about">
              <p>{t('settings.aboutText')}</p>
              <p>{t('settings.credentialHint')}</p>
            </div>
          </section>
        </div>
      </div>

      {snapshot.toast !== undefined && (
        <Toast text={t(snapshot.toast)} onDismiss={() => actions.clearToast()} dismissLabel={t('panel.close')} />
      )}
    </section>
  )
}
