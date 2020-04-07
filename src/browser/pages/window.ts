import * as x11wasm from "@coder/x11wasm"
import { Event } from "../../common/api"
import { normalize } from "../../common/util"

export class Window {
  private xs: x11wasm.XServer
  private w?: x11wasm.Window

  constructor(private readonly worker: SharedWorker.SharedWorker, base: string) {
    this.xs = x11wasm.dialWorker(this.worker.port)
    this.xs.on("window", (w) => {
      const url = new URL(location.href)
      url.searchParams.set("wid", `${w.wid}`)
      url.pathname = normalize(`${base}/app/`, true)
      if (!window.open(url.toString(), "", `innerWidth=${w.width},innerHeight=${w.height}`)) {
        window.dispatchEvent(new CustomEvent(Event.WindowLoadFail))
      } else {
        window.dispatchEvent(new CustomEvent(Event.WindowLoad))
      }
    })
    window.addEventListener("beforeunload", () => {
      if (typeof this.w !== "undefined") {
        this.w.send("close")
      }
      this.xs.close()
    })
    this.worker.port.start()
  }

  public async init(showFps: boolean): Promise<void> {
    const url = new URL(location.href)
    const wid = url.searchParams.get("wid")
    // If this is null then it's probably the blank root window.
    if (wid !== null) {
      this.w = await this.xs.window(parseInt(wid))
      if (typeof this.w === "undefined") {
        throw new Error("no window found")
      }
      return x11wasm.bindWindow(this.w, { window, fps: showFps })
    }
  }
}
