import { field, logger, time } from "@coder/logger"
import * as x11wasm from "@coder/x11wasm"
import { ReadyMessage, SessionError } from "../../common/api"
import { ApiEndpoint } from "../../common/http"
import { normalize } from "../../common/util"
import { decode, ReconnectingSocket } from "../socket"

export class Worker {
  private xs: Promise<x11wasm.XServer>
  private socket?: ReconnectingSocket
  private client?: x11wasm.XClient

  public constructor() {
    const start = time(500)
    logger.debug("creating server...")
    this.xs = x11wasm.createXServer("../../node_modules/@coder/x11wasm/out/index.wasm").then((xs) => {
      logger.debug("created server", field("time", start))
      return xs
    })
    self.addEventListener("connect", async (event) => {
      const port = (event as MessageEvent).ports[0]
      x11wasm.acceptPort(await this.xs, port)
      port.start()
    })
  }

  public connect(): Promise<void> {
    if (this.socket) {
      throw new Error("already connected")
    }

    // Strip out the options query variable and add the socket type.
    const url = new URL(location.href)
    url.searchParams.delete("options")
    url.searchParams.set("type", "x11")
    url.pathname = normalize(`${location.pathname}/../../../../../api${ApiEndpoint.run}`)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const socket = new ReconnectingSocket(url.toString())
    socket.binaryType = "arraybuffer"
    this.socket = socket

    // Create a new client every time the socket (re)connects.
    socket.onConnect(async () => {
      const start = time(500)
      logger.debug("creating client...")

      // Wait for the first message from the server.
      const acceptMsg = await new Promise<ReadyMessage>((resolve) => {
        const disposable = socket.onMessage(async (message) => {
          disposable.dispose()
          logger.debug("server reports it is ready")
          resolve(JSON.parse(decode(message)))
        })
      })

      const server = await this.xs

      logger.debug("creating client...", field("time", start), field("accept", acceptMsg.protocol))
      const client = await x11wasm.dial(server, {
        nxproxy: acceptMsg.protocol === "nx",
      })

      client.on("data", (d) => {
        socket.send(d)
      })

      client.on("close", () => {
        logger.debug("client disconnected")
      })

      this.client = client
    })

    socket.onMessage((m) => {
      if (this.client) {
        this.client.write(new Uint8Array(m as ArrayBuffer))
      } else {
        logger.trace("discarding message (no client)")
      }
    })

    // Close the client on disconnect. A new one will be created once the
    // socket reconnects.
    socket.onDisconnect((code) => {
      logger.debug("got disconnected", field("code", code))
      if (this.client) {
        this.client.close()
        this.client = undefined
      }

      // These are permanent failures.
      switch (code) {
        case SessionError.FailedToStart:
          socket.close(code)
          break
      }
    })

    // The close event is permanent so dispose everything.
    socket.onClose((code) => {
      logger.debug("got closed")
      switch (code) {
        case SessionError.FailedToStart:
          return this.dispose(new Error("session failed to start"))
      }
      this.dispose(new Error(`socket closed with code ${code}`))
    })

    return socket.connect()
  }

  public dispose(error?: Error): void {
    if (error) {
      logger.error(error.message)
    }
    this.xs.then((xs) => xs.close())
    if (this.socket) {
      this.socket.close()
      this.socket = undefined
    }
    if (this.client) {
      this.client.close()
      this.client = undefined
    }
  }
}
