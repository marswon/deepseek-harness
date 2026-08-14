import { contextBridge, ipcRenderer } from 'electron'
import type { ShellAction } from '../main/shell-page.ts'

/**
 * Sandboxed-renderer bridge. The only surface the shell page gets is
 * `shellAction`; the Harness UI itself runs without any Node or bridge access.
 */
contextBridge.exposeInMainWorld('dshDesktop', {
  /**
   * Forward a shell-page action (retry / view-logs / quit) to the main process.
   * @param action - the action identifier from the clicked button.
   */
  shellAction: (action: ShellAction) => { ipcRenderer.send('dsh-desktop:shell-action', action) },
})
