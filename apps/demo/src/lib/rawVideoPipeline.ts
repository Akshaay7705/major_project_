/**
 * Raw Video to C++ WebRTC Pipeline
 *
 * Captures VideoFrame from HeyGen MediaStreamTrack, resizes to 640x300 RGBA,
 * applies a binary frame protocol with ~16KB chunking, and transmits over
 * an RTCDataChannel to the C++ receiver with low-latency backpressure handling.
 */

export interface RawVideoPipelineConfig {
  signalingUrl?: string;
  targetWidth?: number;
  targetHeight?: number;
  chunkPayloadSize?: number;
  maxBufferedAmount?: number;
}

const DEFAULT_CONFIG: Required<RawVideoPipelineConfig> = {
  signalingUrl: "ws://localhost:8088",
  targetWidth: 640,
  targetHeight: 300,
  chunkPayloadSize: 16000, // ~16KB payload per chunk
  maxBufferedAmount: 4 * 1024 * 1024, // 4MB backpressure drop threshold
};

export class RawVideoPipeline {
  private config: Required<RawVideoPipelineConfig>;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  private isChannelOpen: boolean = false;
  private isDestroyed: boolean = false;
  private frameIdCounter: number = 0;

  // Reusable offscreen canvas for zero-allocation scaling
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx:
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  // Pre-allocated frame buffer: 640 * 300 * 4 = 768,000 bytes
  private frameBuffer: Uint8Array;
  private totalFrameSize: number;

  constructor(config?: RawVideoPipelineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.totalFrameSize =
      this.config.targetWidth * this.config.targetHeight * 4;
    this.frameBuffer = new Uint8Array(this.totalFrameSize);

    this.initCanvas();
  }

  private initCanvas() {
    const { targetWidth, targetHeight } = this.config;
    if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(targetWidth, targetHeight);
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    } else if (typeof document !== "undefined") {
      const el = document.createElement("canvas");
      el.width = targetWidth;
      el.height = targetHeight;
      this.canvas = el;
      this.ctx = el.getContext("2d", { willReadFrequently: true });
    }
  }

  public start() {
    this.isDestroyed = false;
    this.connectSignaling();
  }

  private connectSignaling() {
    if (this.isDestroyed) return;

    console.log(
      "[C++ WebRTC] Connecting to signaling:",
      this.config.signalingUrl,
    );
    try {
      this.ws = new WebSocket(this.config.signalingUrl);
    } catch (e) {
      console.error("[C++ WebRTC] Signaling connection error:", e);
      return;
    }

    this.ws.onopen = () => {
      console.log("[C++ WebRTC] Signaling connected");
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "register", role: "browser" }));
      }
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleSignalingMessage(msg);
      } catch (err) {
        console.error("[C++ WebRTC] Error handling signaling message:", err);
      }
    };

    this.ws.onerror = (err) => {
      console.warn("[C++ WebRTC] Signaling WebSocket error:", err);
    };

    this.ws.onclose = () => {
      console.log("[C++ WebRTC] Signaling WebSocket closed");
      this.isChannelOpen = false;
      // Auto-reconnect signaling after delay if not destroyed
      if (!this.isDestroyed) {
        setTimeout(() => this.connectSignaling(), 3000);
      }
    };
  }

  private async initPeerConnection() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    console.log("[C++ WebRTC] Initializing RTCPeerConnection");
    this.pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "candidate",
            candidate: event.candidate.toJSON
              ? event.candidate.toJSON()
              : event.candidate,
          }),
        );
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(
        "[C++ WebRTC] ICE connection state:",
        this.pc?.iceConnectionState,
      );
    };

    console.log("[C++ WebRTC] DataChannel opening");
    this.channel = this.pc.createDataChannel("raw-video", {
      ordered: false,
      maxRetransmits: 0,
    });
    this.channel.binaryType = "arraybuffer";

    this.channel.onopen = () => {
      console.log("[C++ WebRTC] DataChannel open");
      this.isChannelOpen = true;
    };

    this.channel.onclose = () => {
      console.log("[C++ WebRTC] DataChannel closed");
      this.isChannelOpen = false;
    };

    this.channel.onerror = (error) => {
      console.error("[C++ WebRTC] DataChannel error:", error);
    };

    // Create and send SDP Offer
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      console.log("[C++ WebRTC] Sending SDP Offer to signaling server");
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
      }
    } catch (e) {
      console.error("[C++ WebRTC] Error creating offer:", e);
    }
  }

  private async handleSignalingMessage(msg: any) {
    if (!msg || !this.pc) return;

    switch (msg.type) {
      case "cpp-ready": {
        console.log("[C++ WebRTC] C++ peer detected. Re-negotiating offer...");
        this.initPeerConnection();
        break;
      }
      case "answer": {
        console.log("[C++ WebRTC] Received SDP Answer from C++");
        await this.pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: msg.sdp }),
        );
        break;
      }
      case "candidate": {
        if (msg.candidate) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (e) {
            console.warn("[C++ WebRTC] Error adding ICE candidate:", e);
          }
        }
        break;
      }
    }
  }

  /**
   * Process a single VideoFrame: resize to 640x300 RGBA, packetize, and send over DataChannel.
   */
  public async sendRawFrame(frame: VideoFrame): Promise<void> {
    const frameId = this.frameIdCounter++;
    const { targetWidth, targetHeight, chunkPayloadSize, maxBufferedAmount } =
      this.config;

    // Check DataChannel readiness
    if (
      !this.channel ||
      !this.isChannelOpen ||
      this.channel.readyState !== "open"
    ) {
      // DataChannel not ready yet, skip frame
      return;
    }

    // REQUIREMENT 6: Backpressure control
    if (this.channel.bufferedAmount > maxBufferedAmount) {
      console.warn(
        `[WebRTC] Dropped frame ${frameId} - backpressure (${this.channel.bufferedAmount} bytes buffered)`,
      );
      return;
    }

    try {
      // REQUIREMENT 2: Frame resizing
      // WebCodecs copyTo() only performs sub-rectangle cropping without resampling.
      // We use an OffscreenCanvas with willReadFrequently for GPU-accelerated low-latency scaling.
      if (this.ctx && this.canvas) {
        this.ctx.drawImage(frame, 0, 0, targetWidth, targetHeight);
        const imgData = this.ctx.getImageData(0, 0, targetWidth, targetHeight);
        this.frameBuffer.set(imgData.data);
      } else if (
        frame.displayWidth === targetWidth &&
        frame.displayHeight === targetHeight
      ) {
        // Direct copy path if the frame is already the exact dimensions
        await frame.copyTo(this.frameBuffer, { format: "RGBA" });
      } else {
        return;
      }

      const totalSize = this.totalFrameSize;
      const totalChunks = Math.ceil(totalSize / chunkPayloadSize);
      const timestamp = BigInt(frame.timestamp || performance.now() * 1000);

      // REQUIREMENT 13: Debug log
      if (frameId % 60 === 0) {
        console.log(
          `[Video] Resolution: ${targetWidth}x${targetHeight} | Frame ID: ${frameId} | Bytes: ${totalSize} | Chunks: ${totalChunks}`,
        );
      }

      // REQUIREMENT 4 & 5: Framing & 16KB Chunking
      // Binary Header layout (36 bytes Little-Endian):
      // [0..3]   uint32 width
      // [4..7]   uint32 height
      // [8..11]  uint32 pixelFormat (0 = RGBA)
      // [12..15] uint32 frameSize
      // [16..23] uint64 timestamp
      // [24..27] uint32 frameId
      // [28..31] uint32 chunkIndex
      // [32..35] uint32 totalChunks
      const HEADER_SIZE = 36;

      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const offset = chunkIdx * chunkPayloadSize;
        const currentPayloadSize = Math.min(
          chunkPayloadSize,
          totalSize - offset,
        );

        const packet = new Uint8Array(HEADER_SIZE + currentPayloadSize);
        const view = new DataView(packet.buffer);

        view.setUint32(0, targetWidth, true);
        view.setUint32(4, targetHeight, true);
        view.setUint32(8, 0, true); // 0 = RGBA
        view.setUint32(12, totalSize, true);
        view.setBigUint64(16, timestamp, true);
        view.setUint32(24, frameId, true);
        view.setUint32(28, chunkIdx, true);
        view.setUint32(32, totalChunks, true);

        // Copy chunk payload
        packet.set(
          this.frameBuffer.subarray(offset, offset + currentPayloadSize),
          HEADER_SIZE,
        );

        // Send binary ArrayBuffer directly
        this.channel.send(packet.buffer);
      }

      if (frameId % 60 === 0) {
        console.log(`[WebRTC] Sent frame ${frameId}`);
      }
    } catch (e) {
      console.error(`[WebRTC] Error sending frame ${frameId}:`, e);
    }
  }

  public stop() {
    this.isDestroyed = true;
    this.isChannelOpen = false;

    if (this.channel) {
      try {
        this.channel.close();
      } catch (_) {}
      this.channel = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch (_) {}
      this.pc = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    console.log("[C++ WebRTC] Pipeline stopped and cleaned up");
  }
}
