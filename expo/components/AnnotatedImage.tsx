import { Image } from "expo-image";
import React, { useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";

import Colors from "@/constants/colors";
import type { AnalyzeResponse } from "@/types/inspection";

type AnnotatedImageProps = {
  uri: string;
  result: AnalyzeResponse;
};

/**
 * Displays the inspected image with detection overlays.
 *
 * Two rendering paths:
 * 1. **Backend-annotated image** — when the backend returns an annotated JPEG
 *    (stored as a local file URI in `result.annotated_image_base64`), we show
 *    that image directly.  OpenCV has already drawn green/red boxes server-side
 *    so the alignment is pixel-perfect.
 *
 * 2. **Client-side SVG overlay** — safety net when no annotated image is
 *    available (e.g. encoding failure).  Renders green outlines on normal items
 *    and red rects+dots on anomalies via react-native-svg, mapping detection
 *    coordinates through the image's native dimensions.
 */
export default function AnnotatedImage({ uri, result }: AnnotatedImageProps) {
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const imgW = result.image_width ?? 1000;
  const imgH = result.image_height ?? 1000;
  const aspect = imgW / imgH;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: width, h: height });
  };

  // The api.ts layer converts backend base64 → local file URI and writes it
  // back into annotated_image_base64.  If it starts with "file://" (or is a
  // non-empty path-like string) we treat it as a pre-annotated image.
  const annotatedUri = result.annotated_image_base64;

  const items = result.items ?? [];
  const showSvgOverlay = !annotatedUri && box.w > 0 && box.h > 0;

  return (
    <View style={[styles.container, { aspectRatio: aspect }]} onLayout={onLayout}>
      {annotatedUri ? (
        /* Server-rendered annotated JPEG – boxes are baked in */
        <Image
          source={{ uri: annotatedUri }}
          style={styles.image}
          contentFit="fill"
          transition={300}
        />
      ) : (
        /* Original image + client-side SVG overlay */
        <>
          <Image source={{ uri }} style={styles.image} contentFit="fill" transition={200} />
          {showSvgOverlay && (
            <Svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: box.w,
                height: box.h,
              }}
              viewBox={`0 0 ${imgW} ${imgH}`}
              pointerEvents="none"
            >
              {items.map((item) => (
                <Rect
                  key={`item-${item.id}`}
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  rx={2}
                  fill="transparent"
                  stroke={Colors.dark.green}
                  strokeWidth={2.5}
                  opacity={0.9}
                />
              ))}
              {result.anomalies.map((a) => {
                const cx = a.x + a.width / 2;
                const cy = a.y + a.height / 2;
                return (
                  <React.Fragment key={`anom-${a.id}`}>
                    <Rect
                      x={a.x}
                      y={a.y}
                      width={a.width}
                      height={a.height}
                      rx={2}
                      fill={Colors.dark.redSoft}
                      stroke={Colors.dark.red}
                      strokeWidth={2.5}
                    />
                    <Circle cx={cx} cy={cy} r={7} fill={Colors.dark.red} opacity={0.25} />
                    <Circle cx={cx} cy={cy} r={3.5} fill={Colors.dark.red} />
                  </React.Fragment>
                );
              })}
            </Svg>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: Colors.dark.surface,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
