import * as x11wasm from "@coder/x11wasm"
import { Event } from "../../common/api"
import { normalize } from "../../common/util"

class FPS {
  private frames = new Array<number>()

  public calculate(now: number): number {
    this.prune(now)
    this.frames.push(now)

    return this.frames.length
  }

  private prune(now: number): void {
    this.frames = this.frames.filter((t) => {
      return now - t <= 1000
    })
  }
}

export class Window {
  private xs: x11wasm.XServer
  private w?: x11wasm.Window

  constructor(private readonly worker: SharedWorker.SharedWorker, private readonly showFps: boolean) {
    this.xs = x11wasm.dialWorker(this.worker.port)
    this.xs.on("window", (w) => {
      const url = new URL(location.href)
      url.searchParams.set("wid", `${w.wid}`)
      url.pathname = normalize(url.pathname + "/app/", true)
      if (!window.open(url.toString(), "", `innerWidth=${w.width},innerHeight=${w.height}`)) {
        const event = new CustomEvent(Event.WindowLoadFail)
        window.dispatchEvent(event)
      }
    })
    window.addEventListener("beforeunload", () => {
      if (this.w) {
        this.w.send("close")
      }
      this.xs.close()
    })
    this.worker.port.start()

    const url = new URL(location.href)
    const wid = url.searchParams.get("wid")
    if (wid !== null) {
      this.bindDOM(parseInt(wid))
    }
  }

  private readonly themeMeta = document.createElement("meta")
  private readonly fpsDiv = document.createElement("div")

  private async bindDOM(wid: number): Promise<void> {
    await this.bindWindow(wid)
    this.bindCSS()
    this.bindFPS()
    this.bindMeta()
    this.bindTitle()
    this.bindClip()

    const fps = new FPS()
    const render = async (now: number): Promise<void> => {
      if (this.w) {
        await this.w.render()
      }
      this.fpsDiv.textContent = `fps ${fps.calculate(now)}`
      requestAnimationFrame(render)
    }
    render(performance.now())
  }

  private async bindWindow(wid: number): Promise<void> {
    const view = document.createElement("div")
    view.style.height = "100vh"
    view.style.width = "100vw"
    view.style.outline = "none"
    view.tabIndex = 0 // enables programmatic focus.
    view.style.position = "fixed"
    document.body.appendChild(view)
    view.focus()

    this.w = (await this.xs.window(wid)) as x11wasm.Window
    if (!this.w) {
      // No window for us.
      window.close()
      return
    }
    await x11wasm.bindDOM(this.w, view)
    this.w.on("close", () => window.close())
  }

  private bindCSS(): void {
    document.body.style.margin = "0"
    const cssStyle = document.createElement("style")
    cssStyle.innerText = `::-webkit-scrollbar {
    display: none;
  }`
    document.head.appendChild(cssStyle)
  }

  private bindFPS(): void {
    this.fpsDiv.style.position = "fixed"
    this.fpsDiv.style.right = "10px"
    this.fpsDiv.style.top = "10px"
    this.fpsDiv.style.fontFamily = "monospace"
    this.fpsDiv.style.fontSize = "20px"
    this.fpsDiv.style.pointerEvents = "none"
    this.fpsDiv.style.background = "rgba(255, 255, 255, 0.5)"
    this.fpsDiv.style.borderRadius = "4px"
    this.fpsDiv.style.padding = "3px"
    if (this.showFps) {
      document.body.appendChild(this.fpsDiv)
    }
  }

  private bindMeta(): void {
    this.themeMeta.name = "theme-color"
    document.head.appendChild(this.themeMeta)
  }

  private bindTitle(): void {
    if (this.w) {
      document.title = this.w.title
      this.w.on("title", () => (document.title = this.w ? this.w.title : "code-server"))
    }
  }

  private bindClip(): void {
    let needsSet = false
    const clipboardLoop = async (): Promise<void> => {
      try {
        if (needsSet && this.w) {
          await window.navigator.clipboard.writeText(this.w.clipboard)
          needsSet = false
        } else if (this.w) {
          const clip = await window.navigator.clipboard.readText()
          if (clip !== this.w.clipboard) {
            this.w.send("clipboard", clip)
          }
        }
      } catch (error) {
        // Ignore.
      }
      setTimeout(clipboardLoop, 1000 / 100)
    }
    clipboardLoop()

    if (this.w) {
      this.w.on("clipboard", () => (needsSet = true))
    }
  }
}
