import { Asset } from "expo-asset";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

import type { AnalyzeResponse } from "@/types/inspection";

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
    }, 60000);

    _pending = { resolve, reject, timeout };

    const msg = JSON.stringify({ type: "process-image", uri: imageUri });
    _webViewRef.postMessage(msg);
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
