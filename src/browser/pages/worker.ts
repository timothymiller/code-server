import { field, logger, time } from "@coder/logger"
import * as x11wasm from "@coder/x11wasm"
import { Delay } from "../../common/delay"
import { ApiEndpoint } from "../../common/http"
import { normalize } from "../../common/util"

export class Worker extends Delay {
  private readonly xs: Promise<x11wasm.XServer>

  public constructor() {
    super()

    const start = time(500)
    logger.debug("creating server...")
    this.xs = x11wasm.createXServer("../../node_modules/@coder/x11wasm/index.wasm").then((xs) => {
      logger.debug("created server", field("time", start))
      return xs
    })

    self.addEventListener("connect", async (event) => {
      const port = (event as MessageEvent).ports[0]
      x11wasm.acceptPort(await this.xs, port)
      port.start()
    })
  }

  public async connect(): Promise<void> {
    const xs = await this.xs

    const url = this.getSocketUrl("x11", ApiEndpoint.nxagent)
    const ws = new WebSocket(url.toString())
    ws.binaryType = "arraybuffer"

    ws.addEventListener("open", async () => {
      logger.info("connected to nxagent")
      this.reset()

      const cl = await x11wasm.dial(xs, {
        nxproxy: true,
      })

      cl.on("data", (p) => ws.send(p))
      cl.on("close", () => ws.close(1000))

      ws.addEventListener("message", (p: { data: ArrayBuffer }) => {
        cl.write(new Uint8Array(p.data))
      })
      ws.addEventListener("close", () => cl.close())
    })

    ws.addEventListener("close", (event) => {
      const delay = this.delay
      logger.warn("nxagent websocket reconnecting", field("event", event), field("delay", delay))
      setTimeout(() => this.connect(), delay)
    })
  }

  /**
   * Get the URL for connecting to a socket.
   */
  private getSocketUrl(type: string, endpoint: ApiEndpoint): URL {
    // Use the current URL as a base so it works if there's a proxy that
    // rewrites using a base path.
    const url = new URL(location.href)
    url.searchParams.delete("options")
    url.searchParams.set("type", type)
    url.pathname = normalize(`${location.pathname}/../../../../../api${endpoint}`)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    return url
  }
}
