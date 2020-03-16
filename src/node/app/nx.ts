import { field, Field, logger, Logger, Level } from "@coder/logger"
import * as cp from "child_process"
import * as fs from "fs-extra"
import * as net from "net"
import * as os from "os"
import * as path from "path"
import * as WebSocket from "ws"
import { SessionError } from "../../common/api"
import { Emitter } from "../../common/emitter"

const findAvailableDisplay = async (): Promise<number> => {
  logger.debug("finding available display")
  let display = 0
  const x11unixDir = path.join(os.tmpdir(), ".X11-unix")
  // Skip existing displays. We can't connect to them to see if they're in use
  // because doing so will crash the nxagent listening on that socket.
  while (await fs.pathExists(path.join(x11unixDir, `X${display}`))) {
    logger.debug("display is taken", field("display", display))
    ++display
  }
  return display
}

const findAvailablePort = async (): Promise<number> => {
  const server = net.createServer()
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, () => {
      resolve((server.address() as net.AddressInfo).port)
    })
    server.on("error", (err) => reject(err))
  })
  server.close()
  return port
}

enum NXAgentState {
  NONE = "NONE",
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  TERMINATING = "TERMINATING",
  TERMINATED = "TERMINATED",
  SUSPENDING = "SUSPENDING",
  SUSPENDED = "SUSPENDED",
  RESUMING = "RESUMING",
  ACCEPTING = "ACCEPTING",
}

export type NXAgentOptions =
  | {
      readonly mode: "rootless"
    }
  | {
      readonly mode: "shadow"
      readonly display: number
      readonly readonly: boolean
    }

/**
 * NXAgent can allow for reconnects.
 */
export class NXAgent {
  public display = -1
  private port = -1
  private statefilePath?: string
  private _process?: cp.ChildProcess
  private _logger?: Logger

  private _started: Promise<void>
  private _taken = false

  protected readonly _onExit = new Emitter<NXAgentState>()
  public readonly onExit = this._onExit.event

  public constructor(private readonly options: NXAgentOptions) {
    this._started = this.start()
  }

  private get logger(): Logger {
    if (!this._logger) {
      throw new Error("tried to access logger before being set")
    }
    return this._logger
  }

  private get process(): cp.ChildProcess {
    if (!this._process) {
      throw new Error("tried to access process before being set")
    }
    return this._process
  }

  public kill(): void {
    this._taken = false
    if (this.process) {
      this.process.kill()
    }
  }

  /**
   * Returns if the proxy instance has been taken
   */
  public get taken(): boolean {
    return this._taken
  }

  /**
   * Resolves if the NXProxy is started.
   */
  public get started(): Promise<void> {
    return this._started
  }

  /**
   * Returns true if the nxagent is ready to accept a new connection
   */
  public get isReady(): boolean {
    return this.state === NXAgentState.STARTING || this.state === NXAgentState.SUSPENDED
  }

  /**
   * Accepts a websocket.
   */
  public async accept(ws: WebSocket): Promise<void> {
    if (this._taken) {
      throw new Error("Socket already accepted!")
    }
    this._taken = true
    try {
      /**
       * Wait for the NXAgent to be started.
       */
      await this._started
    } catch (ex) {
      return ws.close(SessionError.FailedToStart, ex.toString())
    }

    if (this.state === NXAgentState.SUSPENDED) {
      this.process.kill("SIGHUP")
      try {
        await this.untilState([NXAgentState.RUNNING])
      } catch (ex) {
        return ws.close(SessionError.FailedToStart, `Failed to resume: ${ex.toString()}`)
      }
      this.logger.debug("Resumed!")
    }

    const socket = net.createConnection(this.port)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve)
        socket.on("error", reject)
      })
    } catch (ex) {
      return ws.close(SessionError.FailedToStart, ex.toString())
    }

    ws.on("close", () => {
      logger.debug("web socket closed")
      socket.end()
      if (this.options.mode === "shadow") {
        this.kill()
      }
    })
    ws.on("message", (data: ArrayBuffer) => socket.write(Buffer.from(data)))
    socket.on("data", (data) => ws.send(data))
    socket.on("close", () => {
      logger.debug("socket closed")
      this._taken = false
      ws.close(SessionError.Unknown)
      // TEMP@ash: For now just kill since the suspend/resume workflow causes
      // nxagent to crash and not clean up the socket. We can't just remove the
      // socket because connecting still fails until some keeper process exits,
      // and I don't know how to listen for that.
      this.kill()

      // this.untilState([NXAgentState.SUSPENDED])
      //   .then(() => {
      //     if (this.process && !this.process.killed) {
      //       this.logger.debug("Suspended!")
      //     }
      //   })
      //   .catch(() => undefined)
    })

    if (logger.level <= Level.Trace) {
      socket.on("data", () => console.log("got socket data"))
      ws.on("message", () => console.log("got ws message"))
    }
  }

  /**
   * Starts the NX proxy.
   * Intended to be stored in in the `started` variable.
   */
  private async start(): Promise<void> {
    if (this.display === -1) {
      this.display = await findAvailableDisplay()
    }
    if (this.port === -1) {
      this.port = await findAvailablePort()
    }
    this._logger = logger.named(`nxagent :${this.display} (${this.options.mode})`)

    await fs.mkdirp(path.join(os.tmpdir(), "coder"))
    this.statefilePath = path.join(os.tmpdir(), `coder/.codesrv-nx-${this.port}:${this.display}`)
    this._process = cp.spawn(
      path.resolve(__dirname, "../../../node_modules/@coder/x11wasm/out/nxagent"),
      [this.options.mode === "shadow" ? "-S" : "-R", `:${this.display}`],
      {
        env: {
          ...process.env,
          DISPLAY: this.displayOptions,
        },
      },
    )

    logger.debug(
      "spawned nxproxy",
      field("pid", this._process.pid),
      field("options", this.options),
      field("display", this.display),
    )

    if (logger.level <= Level.Trace && this._process.stdout && this._process.stderr) {
      logger.trace("forwarding nxproxy stdio")
      this._process.stdout.on("data", (data) => process.stdout.write(data))
      this._process.stderr.on("data", (data) => process.stderr.write(data))
    }

    try {
      await Promise.race([
        this.untilState([NXAgentState.RUNNING]),
        new Promise<string>((_, reject) => {
          this.process.on("error", reject)
          this.process.on("exit", reject)
        }),
      ])
    } catch (error) {
      this.process.kill()
      throw typeof error === "number"
        ? new Error(`nxagent terminated unexpectedly with code ${error}`)
        : error || new Error("nxagent terminated unexpectedly")
    }

    this.process.on("exit", (code) => {
      this.logger.debug(`nxagent terminated unexpectedly with code ${code}`)
      this._onExit.emit(this.state)
    })

    const fields: Field<number | string | boolean>[] = [
      field("display", this.display),
      field("port", this.port),
      field("mode", this.options.mode),
    ]

    if (this.options.mode === "shadow") {
      fields.push(field("shadow-display", this.options.display), field("shadow-readonly", this.options.readonly))
    }

    this.logger.debug("Started!", ...fields)
  }

  /**
   * Build options for the nxagent.
   */
  private get displayOptions(): string {
    const opts = [
      "nx/nx",
      "link=adsl",
      "pack=2m-png",
      "cache=128M",
      "images=128M",
      "accept=localhost",
      `listen=${this.port}`,
      `state=${this.statefilePath}`,
      "client=linux",
    ]

    if (this.options.mode === "shadow") {
      opts.push(`shadow=:${this.options.display}`, `shadowmode=${this.options.readonly ? "0" : "1"}`)
    }

    return `${opts.join(",")}:${this.display}`
  }

  private async untilState(targetStates: NXAgentState[], loops = 10, delay = 100): Promise<void> {
    for (let i = 0; i < loops; i++) {
      const currentState = this.state
      if (targetStates.indexOf(currentState) !== -1) {
        return
      }
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  /**
   * Returns the current state of the nxagent
   */
  private get state(): NXAgentState {
    if (!this.statefilePath) {
      throw new Error("NXAgent hasn't started yet!")
    }
    try {
      const content = fs.readFileSync(this.statefilePath)
      const value = NXAgentState[content.toString().trim() as NXAgentState] as NXAgentState
      if (!value) {
        throw new Error(`NXAgent reported unknown state "${content.toString().trim()}"`)
      }
      return value
    } catch (ex) {
      return NXAgentState.NONE
    }
  }
}

export class NXSession {
  private root?: NXAgent
  private readonly shadows: NXAgent[] = []
  protected readonly _onExit = new Emitter<void>()
  public readonly onExit = this._onExit.event

  public async accept(ws: WebSocket): Promise<void> {
    await this.prepare()
    if (!this.root) {
      throw new Error("not possible")
    }

    if (this.root.taken) {
      const shadow = new NXAgent({ mode: "shadow", display: this.root.display, readonly: false })
      await shadow.started
      this.shadows.push(shadow)
      return shadow.accept(ws)
    }

    return this.root.accept(ws)
  }

  public dispose(): void {
    if (this.root) {
      this.root.kill()
    }
  }

  public async prepare(): Promise<void> {
    if (!this.root) {
      this.root = new NXAgent({ mode: "rootless" })
      this.root.onExit(() => {
        for (let i = 0; i < this.shadows.length; i++) {
          const shadow = this.shadows[i]
          shadow.kill()
        }

        this._onExit.emit()
      })
    }
    await this.root.started
  }

  public get rootDisplay(): number {
    if (!this.root) {
      throw new Error("NXAgent not active!")
    }
    return this.root.display
  }
}
