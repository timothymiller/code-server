export interface Application {
  readonly categories?: string[]
  readonly comment?: string
  readonly directory?: string
  readonly exec?: string
  readonly genericName?: string
  readonly icon?: string
  readonly installed?: boolean
  readonly name: string
  /**
   * Path if this is a browser app (like VS Code).
   */
  readonly path?: string
  /**
   * PID if this is a process.
   */
  readonly pid?: number
  readonly version?: string
}

export interface ApplicationsResponse {
  readonly applications: ReadonlyArray<Application>
}

export enum Event {
  /**
   * This window is connected and ready to be viewed.
   */
  Ready = "ide-ready",
  /**
   * This window failed to connect.
   */
  Error = "error",
  /**
   * Unable to spawn a new window, probably because popups are blocked.
   */
  WindowLoadFail = "window-load-fail",
  /**
   * Spawned a new window.
   */
  WindowLoad = "window-load",
}

export interface SessionResponse {
  /**
   * Whether the process was spawned or an existing one was returned.
   */
  created: boolean
  pid: number
}

export interface RecentResponse {
  readonly paths: string[]
  readonly workspaces: string[]
}

export interface HealthRequest {
  readonly event: "health"
}

export type ClientMessage = HealthRequest

export interface HealthResponse {
  readonly event: "health"
  readonly connections: number
}

export type ServerMessage = HealthResponse
