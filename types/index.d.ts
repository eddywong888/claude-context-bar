export type ContextFill = { percent: number; tokens: number; window: number }
export type Limit = { kind: string; percent: number; resetsAt?: string }
export type GitInfo = { branch: string; changed: number; ahead: number; behind: number }
export type RunningTool = { id: string; tool: string; detail?: string }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      fill: ContextFill | null
      compactAt: number | null
      limits: Limit[]
      startedAt: number | null
      now: number
      running: RunningTool[]
      agents: string[]
      warned: boolean
      lastTurnMs: number | null
      turnStartedAt: number | null
      tickOwner: string | null
      isHidden: boolean
      resetNoticed: string | null
      git: GitInfo | null
      gitAt: number | null
    }
  }
}
