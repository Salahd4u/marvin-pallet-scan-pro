import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Check, WifiOff } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ActionButton from "@/components/ActionButton";
import ScanProgress from "@/components/ScanProgress";
import Colors from "@/constants/colors";
import { useInspection } from "@/providers/InspectionProvider";
import { analyzeImage, OfflineError } from "@/services/api";

const STEPS = [
  "Analyzing pallet...",
  "Detecting items...",
  "Measuring dimensions...",
  "Detecting anomalies...",
] as const;

export default function AnalysisScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { staged, saveInspection } = useInspection();

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [offline, setOffline] = useState<boolean>(false);

  const scanLine = useRef(new Animated.Value(0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedRef = useRef<boolean>(false);

  const runAnalysis = useCallback(async () => {
    if (!staged) {
      router.replace("/");
      return;
    }
    setOffline(false);
    setStepIndex(0);
    setProgress(0);
    timers.current.forEach(clearTimeout);
    timers.current = [];

    // Drive the step messaging and progress while the request runs.
    STEPS.forEach((_, i) => {
      const t = setTimeout(() => {
        setStepIndex(i);
        setProgress((i + 1) / (STEPS.length + 0.5));
        if (Platform.OS !== "web") Haptics.selectionAsync();
      }, 700 * (i + 1));
      timers.current.push(t);
    });

    try {
      const minDuration = new Promise<void>((r) => {
        const t = setTimeout(r, 3000);
        timers.current.push(t);
      });
      const [{ result, source }] = await Promise.all([
        analyzeImage({ uri: staged.uri, width: staged.width, height: staged.height }),
        minDuration,
      ]);

      setProgress(1);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      saveInspection(staged.uri, result, source);
      const done = setTimeout(() => router.replace("/results"), 450);
      timers.current.push(done);
    } catch (err) {
      if (err instanceof OfflineError) {
        setOffline(true);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } else {
        console.log("[analysis] unexpected error", err);
        setOffline(true);
      }
    }
  }, [router, saveInspection, staged]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runAnalysis();
    return () => timers.current.forEach(clearTimeout);
  }, [runAnalysis]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(scanLine, {
        toValue: 1,
        duration: 1800,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [scanLine]);

  const retry = useCallback(() => {
    startedRef.current = true;
    runAnalysis();
  }, [runAnalysis]);

  if (!staged) return <View style={styles.container} />;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.imageFrame}>
        <Image source={{ uri: staged.uri }} style={styles.image} contentFit="cover" />
        <View style={styles.scrim} />
        {!offline && (
          <Animated.View
            style={[
              styles.scanLine,
              {
                transform: [
                  {
                    translateY: scanLine.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 240],
                    }),
                  },
                ],
              },
            ]}
          />
        )}
        {/* Corner brackets */}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {offline ? (
        <View style={styles.offlineBlock}>
          <View style={styles.offlineIcon}>
            <WifiOff size={28} color={Colors.dark.red} />
          </View>
          <Text style={styles.offlineTitle}>No Connection</Text>
          <Text style={styles.offlineText}>
            No connection available. Please reconnect and try again.
          </Text>
          <View style={styles.offlineActions}>
            <ActionButton label="Retry" onPress={retry} variant="primary" />
            <ActionButton
              label="Cancel"
              onPress={() => router.replace("/")}
              variant="secondary"
            />
          </View>
        </View>
      ) : (
        <View style={styles.progressBlock}>
          <ScanProgress progress={progress} label={STEPS[stepIndex]} />
          <View style={styles.stepList}>
            {STEPS.map((s, i) => {
              const active = i <= stepIndex;
              const complete = i < stepIndex || progress >= 1;
              return (
                <View key={s} style={styles.stepRow}>
                  <View
                    style={[
                      styles.stepDot,
                      active && styles.stepDotActive,
                      complete && styles.stepDotComplete,
                    ]}
                  >
                    {complete ? <Check size={11} color="#0B0F14" strokeWidth={3} /> : null}
                  </View>
                  <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{s}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const FRAME = 260;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.bg,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  imageFrame: {
    width: FRAME,
    height: FRAME,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: Colors.dark.surface,
    marginTop: 12,
    marginBottom: 36,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11,15,20,0.25)",
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: Colors.dark.amber,
    shadowColor: Colors.dark.amber,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  corner: {
    position: "absolute",
    width: 26,
    height: 26,
    borderColor: Colors.dark.amber,
  },
  cornerTL: { top: 10, left: 10, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cornerTR: { top: 10, right: 10, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cornerBL: {
    bottom: 10,
    left: 10,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 10,
    right: 10,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  progressBlock: {
    width: "100%",
    paddingHorizontal: 12,
  },
  stepList: {
    marginTop: 30,
    gap: 16,
    alignSelf: "stretch",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.dark.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: {
    borderColor: Colors.dark.amber,
  },
  stepDotComplete: {
    backgroundColor: Colors.dark.amber,
    borderColor: Colors.dark.amber,
  },
  stepLabel: {
    color: Colors.dark.textFaint,
    fontSize: 15,
    fontWeight: "500" as const,
  },
  stepLabelActive: {
    color: Colors.dark.text,
    fontWeight: "600" as const,
  },
  offlineBlock: {
    alignItems: "center",
    paddingHorizontal: 16,
    width: "100%",
  },
  offlineIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.dark.redSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  offlineTitle: {
    color: Colors.dark.text,
    fontSize: 22,
    fontWeight: "800" as const,
  },
  offlineText: {
    color: Colors.dark.textMuted,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 320,
  },
  offlineActions: {
    marginTop: 28,
    gap: 12,
    alignSelf: "stretch",
  },
});
