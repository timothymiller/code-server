import * as fs from "fs";
import { IncomingMessage } from "http";
import * as net from "net";
import { RTCPeerConnection } from "wrtc";
import * as ws from "ws";
import { HttpProvider, HttpProviderOptions, HttpResponse, Route } from "../http";
import { VscodeHttpProvider } from "./vscode";

export class WebRTCHttpProvider extends HttpProvider {
    public constructor(options: HttpProviderOptions, private readonly vscode: VscodeHttpProvider) {
        super(options)
    }

    public handleRequest(route: Route, request: IncomingMessage): Promise<HttpResponse<string | object | Buffer>> {
        throw new Error("Method not implemented.");
    }

    public async handleWebSocket(route: Route, request: IncomingMessage, socket: net.Socket, head: Buffer): Promise<void> {
        if (!this.authenticated(request)) {
            throw new Error("not authenticated")
        }

        const srv = new ws.Server({ noServer: true })
        srv.handleUpgrade(request, socket, head, (ws) => {
            new WebRTCSession(ws as any as WebSocket, this.vscode)
        })
    }
}

class WebRTCSession {
    private readonly rtc: RTCPeerConnection
    private dataChannel?: RTCDataChannel
    private netServer?: net.Server
    private localSocket?: net.Socket
    private processSocket?: net.Socket
    private firstMessage: boolean = true

    public constructor(
        private ws: WebSocket,
        private readonly vscode: VscodeHttpProvider) {
        if (ws.readyState !== ws.OPEN) {
            throw new Error("socket is closed")
        }

        this.ws.addEventListener("close", this.onWebSocketClose.bind(this))
        this.ws.addEventListener("message", this.onWebSocketMessage.bind(this))

        this.rtc = new RTCPeerConnection({
            iceServers: [{
                urls: ["stun:stun.services.mozilla.com"],
            }, {
                urls: ["stun:stun.l.google.com:19302"],
            }],
        })
        this.rtc.addEventListener("icecandidate", this.onRTCIceCandidate.bind(this))
        this.rtc.addEventListener("datachannel", this.onRTCDataChannel.bind(this))
        this.rtc.addEventListener("connectionstatechange", this.onRTCConnectionStateChange.bind(this))

    }

    private onDataChannelMessage(event: MessageEvent): void {
        if (!this.processSocket) {
            throw new Error("processSocket must exist!")
        }
        if (this.firstMessage) {
            // Storing query params to connect.
            console.log("Got query here!", event.data)

            this.firstMessage = false
            const params = new URLSearchParams(event.data)
            const o: any = {}
            params.forEach((v, k) => o[k] = v)
            o["skipWebSocketFrames"] = "true"
            
            console.log("Connecting with query", o)
            this.vscode.connect({
                type: "socket",
                query: o,
            }, this.processSocket!)
            return
        }

        console.log("Sending from main...", Buffer.from(event.data).toString())
        this.localSocket!.write(Buffer.from(event.data))
    }

    private onDataChannelOpen(): void {
        console.log("Data channel opened again!")

        fs.unlinkSync("/tmp/pipe.sock")
        this.netServer = net.createServer()
        this.netServer.on("listening", () => {
            this.localSocket = net.createConnection("/tmp/pipe.sock", () => {
                console.log("Socket opened!")
            })
            this.localSocket.on("data", (data) => {
                console.log("Sending back...", data.toString())
                this.dataChannel?.send(data)
            })
            this.localSocket.setNoDelay(true)
        })
        this.netServer.on("connection", (socket) => {
            this.processSocket = socket
            this.processSocket.setNoDelay(true)
        })
        this.netServer.listen("/tmp/pipe.sock")
    }

    private onDataChannelClose(): void {
        this.dispose()
    }

    private onRTCConnectionStateChange() {
        console.log("RTC connection state changed:", this.rtc.connectionState)
    }

    private onRTCDataChannel(event: RTCDataChannelEvent): void {
        this.dataChannel = event.channel
        this.dataChannel.addEventListener("open", this.onDataChannelOpen.bind(this))
        this.dataChannel.addEventListener("message", this.onDataChannelMessage.bind(this))
        this.dataChannel.addEventListener("close", this.onDataChannelClose.bind(this))
    }

    private onRTCIceCandidate(event: RTCPeerConnectionIceEvent): void {
        if (!event.candidate) {
            return
        }

        this.ws.send(JSON.stringify(event.candidate))
    }

    private onWebSocketClose(): void {
        // If closed when WebRTC is open, we can chill.
        console.log("websocket was closed")
    }

    private onWebSocketMessage(event: MessageEvent): void {
        (async () => {
            const msg = JSON.parse(event.data) as RTCSessionDescriptionInit | RTCIceCandidate

            if ("sdp" in msg) {
                // Handle SDP.
                await this.rtc.setRemoteDescription(msg)
                const answer = await this.rtc.createAnswer()
                await this.rtc.setLocalDescription(answer)
                this.ws.send(JSON.stringify(answer))
            } else if ("candidate" in msg) {
                // Handle ice candidate.
                await this.rtc.addIceCandidate(msg)
            } else {
                throw new Error("invalid msg: " + JSON.stringify(msg))
            }
        })().catch((ex) => {
            this.dispose(ex)
        })
    }

    public dispose(err?: Error): void {
        if (this.dataChannel) {
            this.dataChannel.close()
        }
        this.rtc.close()

        if (err) {
            console.error("dispose:", err)
        }
    }

}

export class WebRTCServer {

}