import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

import type { AnalyzeResponse } from "@/types/inspection";

/**
 * On-device AI detection engine — no backend, no cloud, no internet required.
 *
 * A hidden WebView runs a Canvas-based computer vision pipeline that detects
 * wood pieces on pallets: Sobel edges → morphological close → connected
 * components → rectangular blob filter → sort & number → size-based anomaly
 * detection.
 *
 * To swap in a TensorFlow Lite model later, replace
 * `assets/detection/processor.html` with a TFLite-based implementation — the
 * rest of the app won't need changes.
 */

/** Resolved local URI for the detection processor HTML asset. */
let _processorUri: string | null = null;

async function getProcessorUri(): Promise<string> {
  if (_processorUri) return _processorUri;

  if (Platform.OS === "web") {
    _processorUri = "/assets/detection/processor.html";
    return _processorUri;
  }

  const asset = Asset.fromModule(require("@/assets/detection/processor.html"));
  await asset.downloadAsync();
  _processorUri = asset.localUri ?? asset.uri;
  return _processorUri;
}

/**
 * Convert any image URI (file://, content://, ph://, asset, data:, http) into
 * a base64 data URI the WebView can draw without tainting the canvas. Tainted
 * canvases throw on getImageData, which would silently break detection.
 */
async function toDataUri(uri: string): Promise<string> {
  // Already a data URI — use as-is.
  if (uri.startsWith("data:")) return uri;

  if (Platform.OS === "web") {
    // On web, fetch the blob and read it as a data URL.
    try {
      const res = await fetch(uri);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read image."));
        reader.readAsDataURL(blob);
      });
    } catch {
      return uri;
    }
  }

  // Native: read the file bytes as base64 and wrap in a data URI.
  try {
    let fileUri = uri;
    // Android content:// URIs must be copied into the cache dir first.
    if (uri.startsWith("content://") || uri.startsWith("ph://")) {
      const dest = `${FileSystem.cacheDirectory}pallet_scan_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      fileUri = dest;
    }

    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const mime = fileUri.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg";
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    console.log("[detection] failed to convert image to data URI", err);
    throw new Error("Could not load the image for analysis.");
  }
}

type PendingRequest = {
  resolve: (result: AnalyzeResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/** Singleton state shared across the app. */
let _webViewRef: WebView | null = null;
let _pending: PendingRequest | null = null;
let _processorReady = false;
const _queue: Array<{
  uri: string;
  resolve: (r: AnalyzeResponse) => void;
  reject: (e: Error) => void;
}> = [];

function flushQueue() {
  while (_queue.length > 0 && !_pending) {
    const next = _queue.shift()!;
    runDetection(next.uri).then(next.resolve).catch(next.reject);
  }
}

function runDetection(imageUri: string): Promise<AnalyzeResponse> {
  return new Promise((resolve, reject) => {
    if (!_webViewRef) {
      reject(new Error("Detection engine is not ready. Please try again."));
      return;
    }

    if (_pending) {
      clearTimeout(_pending.timeout);
      _pending.reject(new Error("Detection cancelled by new request."));
      _pending = null;
    }

    const timeout = setTimeout(() => {
      _pending = null;
      reject(new Error("Detection timed out. The image may be too large."));
      flushQueue();
    }, 90000);

    _pending = { resolve, reject, timeout };

    // Convert to a data URI first so the canvas stays untainted and
    // getImageData works reliably inside the WebView.
    toDataUri(imageUri)
      .then((dataUri) => {
        if (!_webViewRef) {
          if (_pending) {
            clearTimeout(_pending.timeout);
            _pending.reject(new Error("Detection engine is not ready."));
            _pending = null;
          }
          return;
        }
        const msg = JSON.stringify({ type: "process-image", uri: dataUri });
        _webViewRef.postMessage(msg);
      })
      .catch((err: unknown) => {
        if (_pending) {
          clearTimeout(_pending.timeout);
          _pending.reject(
            err instanceof Error
              ? err
              : new Error("Failed to prepare image for analysis.")
          );
          _pending = null;
          flushQueue();
        }
      });
  });
}

function handleMessage(event: WebViewMessageEvent): void {
  try {
    const payload = JSON.parse(event.nativeEvent.data) as {
      type: string;
      data?: AnalyzeResponse;
      message?: string;
    };

    if (payload.type === "detection-result" && payload.data) {
      if (_pending) {
        clearTimeout(_pending.timeout);
        _pending.resolve(payload.data);
        _pending = null;
        flushQueue();
      }
    } else if (payload.type === "detection-error") {
      if (_pending) {
        clearTimeout(_pending.timeout);
        _pending.reject(new Error(payload.message ?? "Detection failed."));
        _pending = null;
        flushQueue();
      }
    }
  } catch {
    // Ignore non-JSON messages
  }
}

/** Hook that provides a hidden WebView processor and the analyze function. */
export function useDetectionEngine() {
  const [ready, setReady] = useState(_processorReady);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    let cancelled = false;

    getProcessorUri()
      .then(() => {
        if (cancelled) return;
        _processorReady = true;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const onWebViewRef = useCallback((ref: WebView | null) => {
    webViewRef.current = ref;
    _webViewRef = ref;
  }, []);

  const analyze = useCallback(async (imageUri: string): Promise<AnalyzeResponse> => {
    if (!_processorReady) {
      await getProcessorUri();
      _processorReady = true;
    }
    return runDetection(imageUri);
  }, []);

  const onMessage = useCallback(handleMessage, []);

  return {
    ready,
    webViewRef: onWebViewRef,
    onMessage,
    analyze,
  };
}

/** Standalone analyze function for non-hook usage. */
export async function detectOnDevice(imageUri: string): Promise<AnalyzeResponse> {
  if (!_processorReady) {
    await getProcessorUri();
    _processorReady = true;
  }
  return runDetection(imageUri);
}

/**
 * Hidden WebView component that hosts the Canvas-based detection processor.
 * Must be mounted in the root layout and stay alive across navigation.
 */
export function DetectionWebView() {
  const { webViewRef, onMessage } = useDetectionEngine();

  if (!_processorUri) {
    // Trigger asset resolution
    getProcessorUri();
    return null;
  }

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ uri: _processorUri }}
        onMessage={onMessage}
        originWhitelist={["*"]}
        javaScriptEnabled={true}
        allowFileAccess={true}
        mixedContentMode="always"
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  webview: {
    width: 1,
    height: 1,
  },
});
