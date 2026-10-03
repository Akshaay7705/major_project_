// Type declarations for WebCodecs and Insertable Streams

interface VideoFrameInit {
  duration?: number;
  timestamp?: number;
  alpha?: "keep" | "discard";
  visibleRect?: DOMRectInit;
  displayWidth?: number;
  displayHeight?: number;
}

interface VideoFrameCopyToOptions {
  rect?: DOMRectInit;
  layout?: PlaneLayout[];
  format?: string;
  colorSpace?: VideoColorSpaceInit;
}

interface PlaneLayout {
  offset: number;
  stride: number;
}

interface VideoColorSpaceInit {
  primaries?: string;
  transfer?: string;
  matrix?: string;
  fullRange?: boolean;
}

declare class VideoFrame {
  constructor(image: CanvasImageSource, init?: VideoFrameInit);
  readonly format: string | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly codedRect: DOMRectReadOnly | null;
  readonly visibleRect: DOMRectReadOnly | null;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly duration: number | null;
  readonly timestamp: number | null;
  readonly colorSpace: VideoColorSpace;
  allocationSize(options?: VideoFrameCopyToOptions): number;
  copyTo(
    destination: BufferSource,
    options?: VideoFrameCopyToOptions,
  ): Promise<PlaneLayout[]>;
  clone(): VideoFrame;
  close(): void;
}

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

declare class MediaStreamTrackProcessor<T = VideoFrame> {
  constructor(init: MediaStreamTrackProcessorInit);
  readonly readable: ReadableStream<T>;
}
