import { field, logger } from "@coder/logger"
import * as cp from "child_process"
import * as fs from "fs-extra"
import * as path from "path"
import * as util from "util"
import { Application } from "../../common/api"

const getVscodeVersion = (): string => {
  try {
    return require(path.resolve(__dirname, "../../../lib/vscode/package.json")).version
  } catch (error) {
    return "unknown"
  }
}

export const Vscode: Application & { path: string } = {
  categories: ["Editor"],
  icon: `data:image/png;base64,${fs
    .readFileSync(path.resolve(__dirname, "../../../lib/vscode/resources/linux/code.png"))
    .toString("base64")}`,
  installed: true,
  name: "VS Code",
  path: "/vscode",
  version: getVscodeVersion(),
}

export const Jupyter: Application & { exec: string } = {
  categories: ["Editor"],
  name: "Jupyter",
  path: "/jupyter",
  exec: "jupyter",
}

export const findApplicationDirectories = async (): Promise<ReadonlyArray<string>> => {
  const dirs = []
  const snapDir = path.resolve("/var/lib/snapd/desktop/applications")
  if (await fs.pathExists(snapDir)) {
    dirs.push(snapDir)
  }
  const appDir = path.resolve("/usr/share/applications")
  if (await fs.pathExists(appDir)) {
    dirs.push(appDir)
  }
  return dirs
}

interface DesktopFile {
  Categories?: string
  Comment?: string
  Exec?: string
  GenericName?: string
  Icon?: string
  Name?: string
  NoDisplay?: string
  NotShowIn?: string
  OnlyShowIn?: string
  Terminal?: string
  Type?: string
  "X-GNOME-Provides"?: string
}

export const parseDesktopFile = (content: string): DesktopFile | undefined => {
  const lines = content.split("\n")
  if (lines[0] !== "[Desktop Entry]") {
    return
  }
  const obj: { [key: string]: string } = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const parts = line.split("=")
    if (parts.length <= 1) {
      continue
    }
    if (obj[parts[0]]) {
      continue
    }
    obj[parts[0]] = parts.slice(1).join("=")
  }
  return obj as DesktopFile
}

export const findApplications = async (): Promise<ReadonlyArray<Application>> => {
  const apps: Application[] = [Vscode]

  const dirs = await findApplicationDirectories()
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i]
    const appFiles = await fs.readdir(dir)
    for (let i = 0; i < appFiles.length; i++) {
      const appFile = appFiles[i]
      if (!appFile.endsWith(".desktop")) {
        continue
      }
      const content = await fs.readFile(path.join(dir, appFile))
      const desktop = parseDesktopFile(content.toString())
      if (!desktop) {
        continue
      }
      if (
        desktop.Type !== "Application" ||
        !desktop.Name ||
        !desktop.Exec ||
        desktop.NoDisplay ||
        (desktop.OnlyShowIn && desktop.OnlyShowIn.startsWith("GNOME")) ||
        desktop.Terminal === "true" ||
        (desktop.NotShowIn && desktop.NotShowIn.startsWith("GNOME"))
      ) {
        if (!(desktop["X-GNOME-Provides"] && desktop["X-GNOME-Provides"] === "windowmanager")) {
          continue
        }
      }
      let icon: string | undefined
      if (desktop.Icon) {
        let iconPath = desktop.Icon
        let exists = await fs.pathExists(iconPath)
        if (!exists) {
          iconPath = path.join(`/usr/share/icons/hicolor/128x128/apps/${iconPath}.png`)
          exists = await fs.pathExists(iconPath)
        }
        if (exists) {
          icon = `data:image/png;base64,${(await fs.readFile(iconPath)).toString("base64")}`
        }
      }

      if (!desktop.Exec || !desktop.Name) {
        logger.warn("desktop file is missing `Exec` and/or `Name`", field("path", appFile))
        continue
      }

      // Exclude VS Code variants.
      if (["Code - OSS", "Visual Studio Code"].find((name) => desktop.Name && desktop.Name.includes(name))) {
        continue
      }

      const categories = desktop.Categories ? desktop.Categories.replace(/^;+|;+$/g, "").split(";") : []
      const category = categories.includes("TextEditor") || categories.includes("IDE") ? "Editor" : "Other"
      apps.push({
        categories: [category],
        comment: desktop.Comment,
        exec: desktop.Exec.replace(/%[FfuU]/, "").trim(),
        genericName: desktop.GenericName,
        icon,
        installed: true,
        name: desktop.Name,
      })
    }
  }

  return apps.sort((a, b): number => a.name.localeCompare(b.name))
}

export const findWhitelistedApplications = async (): Promise<ReadonlyArray<Application>> => {
  const getAppDetails = async (app: Application): Promise<Partial<Application>> => {
    const details = {
      // App might already have a version.
      version: app.version,
      // If there's no exec, it's a browser app that is already "installed".
      installed: !app.exec,
      icon: app.icon,
    }

    const iconPath = path.join(__dirname, `../../../src/node/app/icons/${app.exec}.svg`)
    if (await fs.pathExists(iconPath)) {
      const icon = await fs.readFile(iconPath)
      details.icon = `data:image/svg+xml;base64,${icon.toString("base64")}`
    }

    if (!details.installed) {
      try {
        await util.promisify(cp.exec)(`which ${app.exec}`, { shell: process.env.SHELL })
        details.installed = true
      } catch (error) {
        // Not installed.
      }
    }

    if (!details.version && details.installed) {
      try {
        switch (app.exec) {
          case "clion":
          case "datagrip":
          case "goland":
          case "intellij-idea-community":
          case "intellij-idea-ultimate":
          case "phpstorm":
          case "pycharm":
          case "rider":
          case "rubymine":
          case "webstorm": {
            const result = await util.promisify(cp.exec)(`which ${app.exec}`, {
              shell: process.env.SHELL,
            })
            const linkPath = await fs.realpath(result.stdout.toString().trim())
            let basePath: string
            if (path.extname(linkPath) === "sh") {
              // We found the script!
              basePath = path.join(linkPath, "..", "..")
            } else {
              basePath = path.join(path.sep, "snap", app.exec, "current")
            }
            const productInfoPath = path.join(basePath, "product-info.json")
            if (!(await fs.pathExists(productInfoPath))) {
              break
            }
            const productInfo = JSON.parse((await fs.readFile(productInfoPath)).toString())
            details.version = productInfo.version
            break
          }
          case "eclipse":
          default: {
            const result = await util.promisify(cp.exec)(`${app.exec} --version | head -1`, {
              shell: process.env.SHELL,
            })
            const matches = result.stdout && result.stdout.match(/\bv?([0-9]+\.[0-9]+(?:\.[0-9]+)?)\b/)
            if (!matches || matches.length < 2) {
              logger.debug("Unable to extract version", field("exec", app.exec), field("stdout", result.stdout))
            } else {
              details.version = matches[1]
            }
          }
        }
      } catch (error) {
        logger.debug("unable to extract version", field("exec", app.exec), field("error", error.message))
        details.version = "unknown"
      }
    }

    return details
  }

  const apps: ReadonlyArray<Application> = [
    // Web-based applications.
    Vscode,

    // Hybrid (both an exec and a path, uses the proxy).
    Jupyter,

    // JetBrains editors
    { name: "CLion", exec: "clion" },
    { name: "Datagrip", exec: "datagrip" },
    { name: "GoLand", exec: "goland" },
    { name: "IntelliJ IDEA Ultimate", exec: "intellij-idea-ultimate" },
    { name: "IntelliJ IDEA Community", exec: "intellij-idea-community" },
    { name: "PhpStorm", exec: "phpstorm" },
    { name: "PyCharm", exec: "pycharm" },
    { name: "Rider", exec: "rider" },
    { name: "RubyMine", exec: "rubymine" },
    { name: "WebStorm", exec: "webstorm" },

    // Extras
    { name: "Eclipse", exec: "eclipse" },
    { name: "Oni", exec: "Oni" },
    { name: "MonoDevelop", exec: "monodevelop" },
    { name: "Emacs", exec: "emacs" },
  ]

  const details = await Promise.all(apps.map(getAppDetails))

  return apps.map((app, i) => ({
    ...app,
    ...details[i],
  }))
}
