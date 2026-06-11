import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import Colors from "@/constants/colors";

type ScanProgressProps = {
  progress: number; // 0..1
  label: string;
};

/** Circular progress ring with an animated value, plus the active status label. */
export default function ScanProgress({ progress, label }: ScanProgressProps) {
  const animated = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animated, {
      toValue: progress,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, animated]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const widthInterpolate = animated.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const pct = Math.round(progress * 100);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.glow,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] }),
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) },
            ],
          },
        ]}
      />
      <Text style={styles.pct}>{pct}%</Text>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: widthInterpolate }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    width: "100%",
  },
  glow: {
    position: "absolute",
    top: -10,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: Colors.dark.amberSoft,
  },
  pct: {
    color: Colors.dark.amber,
    fontSize: 52,
    fontWeight: "800" as const,
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },
  label: {
    color: Colors.dark.text,
    fontSize: 17,
    fontWeight: "600" as const,
    marginTop: 6,
    marginBottom: 22,
  },
  track: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.surfaceHigh,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: Colors.dark.amber,
  },
});
