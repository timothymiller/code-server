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

if (typeof document !== "undefined") {
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

  const showError = (error: Error): void => {
    logger.error(error.message, field("stack", error.stack))
    const notification = document.createElement("div")
    notification.classList.add("notification", "-error")
    const text = document.createElement("div")
    text.className = "text"
    text.innerText = error.message
    notification.appendChild(text)
    document.body.appendChild(notification)
  }

  const src = (document.currentScript as HTMLScriptElement).src
  const worker = new SharedWorker(src, "x11")
  worker.addEventListener("error", (event) => {
    logger.error("error in shared worker", field("event", event))
    window.dispatchEvent(new CustomEvent(Event.Error))
    showError(new Error("error in shared worker"))
  })

  const w = new Window(worker, options.base)
  w.init(options.commit === "development")
    .then(() => {
      window.dispatchEvent(new CustomEvent(Event.Ready))
    })
    .catch((error) => {
      window.dispatchEvent(new CustomEvent(Event.Error))
      showError(error)
    })

  bindForm()
} else {
  const worker = new Worker()
  worker.connect().catch((error) => {
    logger.error(error.message, field("stack", error.stack))
  })
}
