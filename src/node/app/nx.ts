import { logger } from "@coder/logger"
import * as nxagent from "@coder/x11wasm/nxagent"
import * as WebSocket from "ws"
import { Delay } from "../../common/delay"

export class NxAgent extends Delay {
  private nx?: nxagent.Session

  public constructor() {
    super()
    process.on("exit", () => this.dispose())
  }

  public dispose(): void {
    if (typeof this.nx !== "undefined") {
      this.nx.close()
    }
  }

  /**
   * Bind exit to the *current* nxagent process.
   */
  public onExit(fn: () => void): void {
    if (typeof this.nx === "undefined") {
      throw new Error("nxagent not running")
    }
    this.nx.on("close", fn)
  }

  public get display(): string {
    if (typeof this.nx === "undefined") {
      throw new Error("nxagent not running")
    }
    return this.nx.display
  }

  /**
   * Spawn nxagent if it hasn't been spawned already.
   */
  public async ensure(): Promise<void> {
    if (typeof this.nx !== "undefined") {
      return
    }

    this.nx = await nxagent.spawn()

    logger.info(`nxagent listening on DISPLAY=${this.nx.display}`)
    this.reset()

    this.nx.on("log", (p) => process.stdout.write(p))
    this.nx.on("close", () => {
      logger.warn("nxagent exited unexpectedly")
      this.nx = undefined
      setTimeout(() => this.ensure(), this.delay)
    })
  }

  /**
   * Connect a socket to the agent.
   */
  public async accept(ws: WebSocket): Promise<void> {
    logger.info("connecting to nxagent")
    if (typeof this.nx === "undefined") {
      return ws.close(1011, "nxagent not running")
    }
    const nxcl = await this.nx.dial()
    nxcl.on("close", () => ws.close())
    ws.on("close", () => nxcl.close())

    nxcl.on("data", (p) => ws.send(p))
    ws.on("message", (d: ArrayBuffer) => nxcl.write(new Uint8Array(d)))
  }
}
