# API Reference

Successful requests will have a 200 code.

## Get whitelisted applications

**Request**

```
GET http://localhost:8080/api/applications
```

**Response**

```
{
  "applications": [
    {
      "categories": [
        "Editor"
      ],
      "icon": "<base64 icon>",
      "installed": true,
      "name": "VS Code",
      "path": "/vscode",
      "version": "1.42.0"
    },
    {
      "name": "GoLand",
      "exec": "goland",
      "installed": false
    }
  ]
}
```

## Spawn a process

**Request**

```
POST http://localhost:8080/api/process
```

**Body**

```
{
  "exec": "emacs"
}
```

**Response**

```
{
  "created": true,
  "pid": 16386
}
```

## Kill a process by PID

**Request**

```
DELETE http://localhost:8080/api/process
```

**Body**

```
{
  "pid": 16386
}
```

**Response**
Killing a process generates no output.

## Kill a process by path

**Request**

```
DELETE http://localhost:8080/api/process
```

**Body**

```
{
  "path": "/vscode"
}
```

**Response**
Killing a process generates no output.

## Get recent VS Code directories and workspaces

**Request**

```
GET http://localhost:8080/api/recent
```

**Response**

```
{
  "paths": [
    "/home/test"
  ],
  "workspaces": [
    "/home/test/ws.code-workspace"
  ]
}
```

Only directories and workspaces that currently exist will be returned.

## Connect to nxagent

Point a web socket at `/api/run` to connect to the nxagent.
