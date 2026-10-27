/**
 * The view contract between the panel's state owner and its renderers.
 *
 * `src/client/index.tsx` owns the store and the slot registrations; the component
 * modules under `src/client/views/` are pure renderers of these props. That split
 * keeps the data flow reviewable without reading through JSX.
 *
 * @module dsh-plugin-github-issues/client/viewmodel
 */

import type { InputActions, Translate } from './context.ts'
import type {
  GitHubStatus, IssueCardVM, IssueDetailVM, IssueListPage, ProjectRefVM, Prefs, RepoPageVM,
  ScopeCatalog,
} from '../vm.ts'

/** One panel error, in a shape the renderer can display. */
export interface PanelError {
  /** The Host's code, when it had one (`missing_scope`, `rate_limited`, ...). */
  code?: string
  /** Human text. */
  message: string
}

/** The whole panel state. Replaced wholesale on change, never mutated. */
export interface PanelSnapshot {
  status?: GitHubStatus | undefined
  /** Viewer, organizations, and the viewer's own repositories. */
  catalog?: ScopeCatalog | undefined
  /** The selected organization's projects, loaded on demand. */
  orgProjects?: ProjectRefVM[] | undefined
  /** The selected organization's repositories, loaded on demand. */
  orgRepos?: RepoPageVM | undefined
  list?: IssueListPage | undefined
  loading: boolean
  loadingMore: boolean
  /** True while an organization's projects/repositories are loading. */
  scopeLoading: boolean
  error?: PanelError | undefined
  prefs: Prefs
  selected?: IssueCardVM | undefined
  detail?: IssueDetailVM | undefined
  detailLoading: boolean
  /** The issue pinned to the composer dock, kept in sync with the list. */
  pinnedCard?: IssueCardVM | undefined
  /** An issue a one-click handoff asked the composer dock to insert. */
  pendingHandoff?: IssueCardVM | undefined
  /** Transient confirmation locale key (renderers translate it). */
  toast?: string | undefined
  /** True when Projects v2 is unavailable because of the missing scope. */
  projectsBlocked: boolean
  projectsError?: string | undefined
}

/** Everything the renderers may ask the store to do. */
export interface PanelActions {
  /** Refetch the current list (drops Host caches). */
  refresh(): void
  /** Append the next page. */
  loadMore(): void
  /** Select the organization boundary; `undefined` means all organizations. */
  setOrg(org: string | undefined): void
  /** Select a Projects v2 board inside the organization. */
  setProject(projectId: string | undefined): void
  /** Select one repository inside the organization (or the viewer's repos). */
  setRepo(repo: string | undefined): void
  /** Choose who the list is assigned to: `@me`, `all`, or a login. */
  setAssignee(assignee: string): void
  /** Change the open/closed filter. */
  setStateFilter(state: Prefs['state']): void
  /** Load one issue's detail into the side pane. */
  selectIssue(card: IssueCardVM): void
  /** Close the detail pane. */
  closeDetail(): void
  /** Persist one preference patch. */
  savePrefs(patch: Partial<Prefs>): void
  /** Pin one issue to the composer dock and persist it. */
  pin(card: IssueCardVM): void
  /** Unpin the composer dock's issue. */
  unpin(): void
  /** One-click handoff: pin, switch to the Conversation, prefill the composer. */
  handoff(card: IssueCardVM): void
  /** Copy the issue's prompt to the clipboard. */
  copyPrompt(card: IssueCardVM): void
  /** The prompt text this profile would hand to the agent for one issue. */
  promptText(card: IssueCardVM): string
  /** Copy arbitrary text (e.g. the scope command) to the clipboard. */
  copyText(text: string): void
  /** Expand the catalog lazily (organizations and the viewer's repositories). */
  loadCatalog(): void
  /** Clear the transient toast. */
  clearToast(): void
}

/** Props of the full-page panel. */
export interface PageProps {
  snapshot: PanelSnapshot
  actions: PanelActions
  t: Translate
}

/** Props of the composer dock strip. */
export interface DockProps extends PageProps {
  /** Composer actions; absent until the session's composer is mounted. */
  inputActions?: InputActions
  sessionId?: string
  /** Whether a composer can accept the handoff right now. */
  composerReady: boolean
  /** Fill the composer draft with this issue and leave sending to the user. */
  onInsert(card: IssueCardVM): void
  /** Fill the composer draft and submit it immediately. */
  onSend(card: IssueCardVM): void
  /** Accept one dropped card (custom MIME or plain-text prompt). */
  onDropIssue(card: IssueCardVM): void
  /** Accept a dropped plain-text payload (e.g. an issue brief from elsewhere). */
  onDropText(text: string): void
}

/** Props of the settings page section. */
export interface SettingsProps extends PageProps {}

/** Props of the sidebar panel icon. */
export interface IconProps {
  /** Requested square edge in pixels. */
  size?: number
  /** Whether this panel is the selected one. */
  active?: boolean
}
