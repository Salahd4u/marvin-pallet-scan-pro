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

const SEVERITY_COLOR: Record<"low" | "medium" | "high", string> = {
  low: Colors.dark.amber,
  medium: "#FF9F1C",
  high: Colors.dark.red,
};

/**
 * Displays the inspected window image with detection overlays.
 *
 * Renders green numbered circles on normal window frames and red/amber
 * rectangles + severity tags on defects. Uses the items/defects arrays
 * mapped through the source image dimensions.
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
  const showSvg =
    box.w > 0 &&
    box.h > 0 &&
    (items.length > 0 || (result.defects?.length ?? 0) > 0);

  const baseFontSize = Math.max(9, Math.min(imgW, imgH) / 35);
  const circleRadius = baseFontSize * 0.9;
  const frameStroke = Math.max(1.8, imgW / 420);
  const defectStroke = Math.max(2.2, imgW / 320);

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
          {/* Window frames: green rect + numbered circle */}
          {items.map((item) => {
            const cx = item.x + item.width / 2;
            const cy = item.y + item.height / 2;
            const r = Math.max(circleRadius, Math.min(item.width, item.height) * 0.12);

            return (
              <React.Fragment key={`frame-${item.id}`}>
                <Rect
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  rx={3}
                  fill="transparent"
                  stroke={Colors.dark.green}
                  strokeWidth={frameStroke}
                  opacity={0.85}
                />
                <Circle cx={cx} cy={cy} r={r + 2} fill="rgba(34,197,94,0.22)" />
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

          {/* Defects: colored rect + severity corner tag */}
          {(result.defects ?? []).map((d) => {
            const color = SEVERITY_COLOR[d.severity];
            const tagW = Math.max(28, d.width * 0.4);
            const tagH = Math.max(16, Math.min(imgH / 40, d.height * 0.3));
            return (
              <React.Fragment key={`defect-${d.id}`}>
                <Rect
                  x={d.x}
                  y={d.y}
                  width={d.width}
                  height={d.height}
                  rx={3}
                  fill={`${color}33`}
                  stroke={color}
                  strokeWidth={defectStroke}
                  opacity={0.95}
                />
                <Rect
                  x={d.x}
                  y={d.y}
                  width={tagW}
                  height={tagH}
                  rx={3}
                  fill={color}
                  opacity={0.92}
                />
                <SvgText
                  x={d.x + tagW / 2}
                  y={d.y + tagH / 2 + 1}
                  fill="#0B0F14"
                  fontSize={Math.round(tagH * 0.62)}
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="central"
                >
                  {`#${d.id}`}
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
