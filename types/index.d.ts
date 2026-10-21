export type ContextFill = { percent: number; tokens: number; window: number }
export type Limit = { kind: string; percent: number; resetsAt?: string }
export type GitInfo = { branch: string; changed: number; ahead: number; behind: number }
export type BreakdownRow = { name: string; tokens: number; color: string; isDeferred: boolean; kind: string }
export type Breakdown = { rows: BreakdownRow[]; total: number; max: number; model: string }
export type UsageSample = { at: number; percent: number }
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
      soundOn: boolean
      themeName: string
      autoCompactOn: boolean
      modelInUse: { model: string; effort?: string } | null
      fiveHist: UsageSample[]
      tokHist: number[]
      lastGrowth: number | null
      costUsd: number | null
      toolsTurn: number
      toolsTotal: number
      stepsByModel: Record<string, number>
      isHidden: boolean
      resetNoticed: string | null
      git: GitInfo | null
      gitAt: number | null
      breakdown: Breakdown | null
    }
  }
}
