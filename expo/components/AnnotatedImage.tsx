import { Image } from "expo-image";
import React, { useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import Svg, { Circle, Rect, Text as SvgText } from "react-native-svg";

import Colors from "@/constants/colors";
import type { AnalyzeResponse } from "@/types/inspection";

type AnnotatedImageProps = {
  uri: string;
  result: AnalyzeResponse;
};

/**
 * Displays the inspected image with detection overlays.
 *
 * Renders green numbered circles on normal wood pieces and red rectangles
 * + numbered circles on anomalies. Uses the items/anomalies arrays from
 * the on-device detection engine mapped through the source image dimensions.
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

  const items = result.items ?? [];
  const anomalyIds = new Set(result.anomalies.map((a) => a.id));
  const showSvg = box.w > 0 && box.h > 0 && (items.length > 0 || result.anomalies.length > 0);

  // Font size scales with image dimensions
  const baseFontSize = Math.max(9, Math.min(imgW, imgH) / 35);
  const circleRadius = baseFontSize * 0.9;

  return (
    <View style={[styles.container, { aspectRatio: aspect }]} onLayout={onLayout}>
      <Image source={{ uri }} style={styles.image} contentFit="fill" transition={200} />
      {showSvg && (
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
          {/* Normal items: green rect + numbered circle */}
          {items.map((item) => {
            const isAnomaly = anomalyIds.has(item.id);
            if (isAnomaly) return null;

            const cx = item.x + item.width / 2;
            const cy = item.y + item.height / 2;
            const r = Math.max(circleRadius, Math.min(item.width, item.height) * 0.18);

            return (
              <React.Fragment key={`item-${item.id}`}>
                <Rect
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  rx={3}
                  fill="transparent"
                  stroke={Colors.dark.green}
                  strokeWidth={Math.max(1.8, imgW / 400)}
                  opacity={0.85}
                />
                <Circle cx={cx} cy={cy} r={r + 2} fill="rgba(34,197,94,0.25)" />
                <Circle cx={cx} cy={cy} r={r} fill={Colors.dark.green} />
                <SvgText
                  x={cx}
                  y={cy + 1}
                  fill="#0B0F14"
                  fontSize={Math.round(r * 1.1)}
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="central"
                >
                  {String(item.id)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* Anomalies: red rect + red numbered circle */}
          {result.anomalies.map((a) => {
            const cx = a.x + a.width / 2;
            const cy = a.y + a.height / 2;
            const r = Math.max(circleRadius, Math.min(a.width, a.height) * 0.18);

            return (
              <React.Fragment key={`anom-${a.id}`}>
                <Rect
                  x={a.x}
                  y={a.y}
                  width={a.width}
                  height={a.height}
                  rx={3}
                  fill={Colors.dark.redSoft}
                  stroke={Colors.dark.red}
                  strokeWidth={Math.max(2, imgW / 300)}
                  opacity={0.9}
                />
                <Circle cx={cx} cy={cy} r={r + 3} fill="rgba(255,59,48,0.35)" />
                <Circle cx={cx} cy={cy} r={r} fill={Colors.dark.red} />
                <SvgText
                  x={cx}
                  y={cy + 1}
                  fill="#FFFFFF"
                  fontSize={Math.round(r * 1.1)}
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="central"
                >
                  {String(a.id)}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
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
