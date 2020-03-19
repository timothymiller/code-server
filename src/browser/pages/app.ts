import { field, logger } from "@coder/logger"
import { Event } from "../../common/api"
import { ApiEndpoint } from "../../common/http"
import { getOptions, normalize } from "../../common/util"
import { Window } from "./window"
import { Worker } from "./worker"

import "./error.css"
import "./global.css"
import "./home.css"
import "./login.css"
import "./update.css"

const options = getOptions()

const bindForm = (): void => {
  const isInput = (el: Element): el is HTMLInputElement => {
    return !!(el as HTMLInputElement).name
  }

  document.querySelectorAll("form").forEach((form) => {
    if (!form.classList.contains("-x11")) {
      return
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      const values: { [key: string]: string } = {}
      Array.from(form.elements).forEach((element) => {
        if (isInput(element)) {
          values[element.name] = element.value
        }
      })
      fetch(normalize(`${options.base}/api/${ApiEndpoint.process}`), {
        method: "POST",
        body: JSON.stringify(values),
      })
    })
  })
}

if (typeof document !== "undefined") {
  const src = (document.currentScript as HTMLScriptElement).src
  const worker = new SharedWorker(src, "x11")
  worker.addEventListener("error", (event) => {
    logger.error("error in shared worker", field("event", event))
  })
  new Window(worker, options.commit === "development", options.base)
  bindForm()
  // TEMP: Until we can get the real ready event.
  const event = new CustomEvent(Event.IdeReady)
  window.dispatchEvent(event)
} else {
  const worker = new Worker()
  worker.connect().catch((e) => worker.dispose(e))
}
