import { field, logger } from "@coder/logger"
import * as cp from "child_process"
import * as fs from "fs-extra"
import * as http from "http"
import * as path from "path"
import { HttpProvider, HttpProviderOptions, HttpResponse, Route, WsResponse } from "../http"
import { xdgLocalDir } from "../util"
import { Jupyter } from "./bin"

export class JupyterHttpProvider extends HttpProvider {
  private jupyter?: Promise<cp.ChildProcess>
  private readonly port = "8888"
  private logger = logger.named("jupyter")
  private configPath = path.join(xdgLocalDir, "jupyter_notebook_config.py")

  public constructor(options: HttpProviderOptions, private readonly startDir: string = process.cwd()) {
    super(options)
  }

  public get running(): boolean {
    return !!this.jupyter
  }

  public async dispose(): Promise<void> {
    if (this.jupyter) {
      const jupyter = await this.jupyter
      jupyter.removeAllListeners()
      jupyter.kill()
      this.jupyter = undefined
    }
  }

  private async ensureConfig(): Promise<void> {
    if (!(await fs.pathExists(this.configPath))) {
      await fs.writeFile(
        this.configPath,
        [
          // The token is not necessary since code-server has its own authentication.
          "c.NotebookApp.token = ''",
          // TODO: base_url won't work if code-server itself has a base path.
          // Potential solutions:
          // 1. Add back a base path option to code-server.
          // 2. Modify Jupyter to support relative paths.
          // 3. Manually edit the base url in the Jupyter config as the user.
          `c.NotebookApp.base_url = '${this.options.base}'`,
          "c.NotebookApp.allow_remote_access = True",
        ].join("\n"),
      )
    }
  }

  private async ensureSpawned(): Promise<cp.ChildProcess> {
    if (this.jupyter) {
      return this.jupyter
    }
    this.jupyter = new Promise((resolve, reject) => {
      logger.debug("spawning jupyter...")
      const logLevel = (process.env.LOG_LEVEL || "info").toUpperCase()

      const jupyter = cp.spawn(
        Jupyter.exec,
        [
          "notebook",
          `--log-level=${logLevel === "trace" ? "debug" : logLevel}`,
          "-y",
          "--allow-root",
          `--port=${this.port}`,
          "--ip=127.0.0.1",
          `--config=${this.configPath}`,
          this.startDir,
        ],
        {
          env: {
            ...process.env,
            // This ensures there is output we can use to determine that Jupyter
            // is ready even if the log level is high enough that normally there
            // wouldn't be any output during startup. If we try proxying too
            // early we'll just fail to connect.
            BROWSER: "echo",
          },
          shell: process.env.SHELL || true,
        },
      )

      // Once Jupyter starts outputting stuff assume it's ready.
      if (jupyter.stdout) {
        jupyter.stdout.setEncoding("utf8")
        jupyter.stdout.once("data", () => resolve(jupyter))
        jupyter.stdout.on("data", (data) => {
          this.logger.info("stdout", field("data", data))
        })
      }

      if (jupyter.stderr) {
        jupyter.stderr.setEncoding("utf8")
        jupyter.stderr.on("data", (data) => {
          this.logger.error("stderr", field("data", data))
        })
      }

      jupyter.once("error", (error) => reject(error))
      jupyter.once("exit", (code) => {
        reject(new Error(`jupyter exited unexpectedly with code ${code}`))
      })
    })

    this.jupyter.catch((error) => {
      logger.error(error.message)
      this.jupyter = undefined
    })

    return this.jupyter
  }

  public async handleWebSocket(_: Route, request: http.IncomingMessage): Promise<WsResponse> {
    this.ensureAuthenticated(request)
    return {
      proxy: {
        // When using a base Jupyter expects to receive the whole URL, so we
        // don't want to do any rewriting by providing the base here.
        port: this.port,
      },
    }
  }

  public async handleRequest(_: Route, request: http.IncomingMessage): Promise<HttpResponse> {
    this.ensureAuthenticated(request)
    await this.ensureConfig()
    await this.ensureSpawned()
    return {
      proxy: {
        // When using a base Jupyter expects to receive the whole URL, so we
        // don't want to do any rewriting by providing the base here.
        port: this.port,
      },
    }
  }
}
