export enum HttpCode {
  Ok = 200,
  Redirect = 302,
  NotFound = 404,
  BadRequest = 400,
  Unauthorized = 401,
  LargePayload = 413,
  ServerError = 500,
}

export class HttpError extends Error {
  public constructor(message: string, public readonly code: number) {
    super(message)
    this.name = this.constructor.name
  }
}

export enum ApiEndpoint {
  /**
   * Get whitelisted applications
   */
  applications = "/applications",
  /**
   * Connect to the nxagent.
   */
  nxagent = "/nxagent",
  /**
   * Spawwn and kill processes.
   */
  process = "/process",
  /**
   * Get recent files and directories from VS Code.
   */
  recent = "/recent",
  /**
   * Get code-server health information.
   */
  status = "/status",
}
