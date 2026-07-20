import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Boxes, Check, Loader2 } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ActionButton from "@/components/ActionButton";
import WindowTypeSheet from "@/components/WindowTypeSheet";
import ZoomablePreview from "@/components/ZoomablePreview";
import Colors from "@/constants/colors";
import { useInspection } from "@/providers/InspectionProvider";
import { detectOnDevice } from "@/services/api";
import type { AnalyzeResponse, WindowType, WindowTypeCatalogEntry } from "@/types/inspection";
import { WINDOW_TYPE_MAP } from "@/types/inspection";

const STEPS = [
  "Loading inspection engine",
  "Analyzing image",
  "Detecting window frames",
  "Scanning for defects",
  "Scoring severity",
] as const;

export default function AnalysisScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { staged, saveInspection } = useInspection();

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [sheetEntry, setSheetEntry] = useState<WindowTypeCatalogEntry | null>(null);
  const [sheetCount, setSheetCount] = useState<number>(0);

  const scanLine = useRef(new Animated.Value(0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedRef = useRef<boolean>(false);

  // Step progression that pauses on the final "Scoring severity" step until the
  // real detection returns, so the UI never falsely reports 100% while waiting.
  const runAnalysis = useCallback(async () => {
    if (!staged) {
      router.replace("/");
      return;
    }
    setError(null);
    setStepIndex(0);
    setProgress(0);
    setResult(null);
    timers.current.forEach(clearTimeout);
    timers.current = [];

    // Walk through the first STEPS-1 steps quickly while the API runs in
    // parallel. The last step is only marked complete when detection resolves.
    const PRE_STEPS = STEPS.length - 1;
    const PRE_DURATION = 2400; // ms spread across the pre-steps
    STEPS.slice(0, PRE_STEPS).forEach((_, i) => {
      const t = setTimeout(() => {
        setStepIndex(i + 1);
        setProgress((i + 1) / STEPS.length);
        if (Platform.OS !== "web") Haptics.selectionAsync();
      }, (PRE_DURATION / PRE_STEPS) * (i + 1));
      timers.current.push(t);
    });

    try {
      const result = await detectOnDevice(staged.uri);

      // Clear any pending pre-step timers so we jump cleanly to the final state.
      timers.current.forEach(clearTimeout);
      timers.current = [];

      setProgress(1);
      setStepIndex(STEPS.length - 1);
      setResult(result);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      saveInspection(staged.uri, result, "on-device");
      const done = setTimeout(() => router.replace("/results"), 2600);
      timers.current.push(done);
    } catch (err: unknown) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
      console.log("[analysis] detection failed", err);
    }
  }, [router, saveInspection, staged]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runAnalysis();
    return () => timers.current.forEach(clearTimeout);
  }, [runAnalysis]);

  // Smooth ping-pong scan line: down then up, seamlessly looped.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLine, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scanLine]);

  // Continuous spinner rotation for the in-progress step + working indicator.
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const spinTransform = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const retry = useCallback(() => {
    startedRef.current = true;
    runAnalysis();
  }, [runAnalysis]);

  if (!staged) return <View style={styles.container} />;

  // Preserve the uploaded image's aspect ratio so all four corners are visible.
  const MAX_FRAME = 300;
  const imgAspect = staged.width && staged.height ? staged.width / staged.height : 1;
  const frameW = imgAspect >= 1 ? MAX_FRAME : MAX_FRAME * imgAspect;
  const frameH = imgAspect >= 1 ? MAX_FRAME / imgAspect : MAX_FRAME;
  const scanRange = frameH - 4;
  const scanTranslate = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, scanRange],
  });
  const trailOpacity = scanLine.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.0, 0.55, 0.0],
  });
  const pct = Math.round(progress * 100);
  const scanning = !error && progress < 1;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Inspecting</Text>
        <View style={styles.liveChip}>
          <View style={[styles.liveDot, scanning && styles.liveDotActive]} />
          <Text style={styles.liveText}>{scanning ? "SCANNING" : "DONE"}</Text>
        </View>
      </View>

      <View style={[styles.imageFrame, { width: frameW, height: frameH }]}>
        {/* Pinch-to-zoom + pan image preview. Defaults to `contain` so all
            four corners of the uploaded image stay visible at 1x. */}
        <ZoomablePreview uri={staged.uri} width={frameW} height={frameH} />
        <View style={styles.scrim} pointerEvents="none" />

        {/* Rule-of-thirds grid overlay for a scanner feel */}
        <View style={styles.grid} pointerEvents="none">
          <View style={[styles.gridLine, styles.gridLineV, { left: "33.33%" }]} />
          <View style={[styles.gridLine, styles.gridLineV, { left: "66.66%" }]} />
          <View style={[styles.gridLine, styles.gridLineH, { top: "33.33%" }]} />
          <View style={[styles.gridLine, styles.gridLineH, { top: "66.66%" }]} />
        </View>

        {/* Scan line with trailing glow */}
        {!error && (
          <Animated.View
            style={[
              styles.scanLineWrap,
              { transform: [{ translateY: scanTranslate }] },
            ]}
            pointerEvents="none"
          >
            <Animated.View style={[styles.scanTrail, { opacity: trailOpacity }]} />
            <View style={styles.scanLine} />
            <View style={styles.scanGlow} />
          </Animated.View>
        )}

        {/* Corner brackets */}
        <View style={[styles.corner, styles.cornerTL]} pointerEvents="none" />
        <View style={[styles.corner, styles.cornerTR]} pointerEvents="none" />
        <View style={[styles.corner, styles.cornerBL]} pointerEvents="none" />
        <View style={[styles.corner, styles.cornerBR]} pointerEvents="none" />
      </View>

      {error ? (
        <View style={styles.errorBlock}>
          <View style={styles.errorIcon}>
            <Text style={styles.errorIconText}>!</Text>
          </View>
          <Text style={styles.errorTitle}>Inspection Failed</Text>
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <ActionButton label="Retry" onPress={retry} variant="primary" />
            <ActionButton label="Cancel" onPress={() => router.replace("/")} variant="secondary" />
          </View>
        </View>
      ) : (
        <View style={styles.progressBlock}>
          <View style={styles.pctRow}>
            <Text style={styles.pct}>{pct}%</Text>
            {scanning ? (
              <View style={styles.workingRow}>
                <Animated.View style={[styles.spinnerWrap, { transform: [{ rotate: spinTransform }] }]}>
                  <Loader2 size={14} color={Colors.dark.amber} strokeWidth={2.6} />
                </Animated.View>
                <Text style={styles.workingText}>Working...</Text>
              </View>
            ) : (
              <View style={styles.doneRow}>
                <Check size={14} color={Colors.dark.green} strokeWidth={3} />
                <Text style={styles.doneText}>Complete</Text>
              </View>
            )}
          </View>

          <View style={styles.track}>
            <Animated.View
              style={[
                styles.fill,
                { width: `${Math.max(4, pct)}%` },
              ]}
            />
          </View>

          <Text style={styles.currentStep}>{STEPS[stepIndex]}...</Text>

          <View style={styles.stepList}>
            {STEPS.map((s, i) => {
              const active = i === stepIndex && progress < 1;
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
                    {complete ? (
                      <Check size={11} color="#0B0F14" strokeWidth={3} />
                    ) : active ? (
                      <Animated.View style={[styles.stepSpinner, { transform: [{ rotate: spinTransform }] }]}>
                        <Loader2 size={11} color={Colors.dark.amber} strokeWidth={2.8} />
                      </Animated.View>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      active && styles.stepLabelActive,
                      complete && styles.stepLabelComplete,
                    ]}
                  >
                    {s}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Matched Marvin window types — shown the moment the scan completes */}
          {result && progress >= 1 ? (
            <MatchedTypesPanel
              result={result}
              onViewResults={() => router.replace("/results")}
              onOpenType={(entry, count) => {
                setSheetEntry(entry);
                setSheetCount(count);
              }}
            />
          ) : null}
        </View>
      )}

      <WindowTypeSheet
        entry={sheetEntry}
        count={sheetCount}
        visible={sheetEntry !== null}
        onClose={() => setSheetEntry(null)}
      />
    </View>
  );
}

/** Compact summary of matched Marvin window types, shown inline when a scan resolves. */
function MatchedTypesPanel({
  result,
  onViewResults,
  onOpenType,
}: {
  result: AnalyzeResponse;
  onViewResults: () => void;
  onOpenType: (entry: WindowTypeCatalogEntry, count: number) => void;
}) {
  const items = result.items ?? [];
  const counts = new Map<WindowType, number>();
  for (const it of items) {
    const t = it.windowType ?? "unknown";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const rows = Array.from(counts.entries())
    .map(([t, c]) => ({ entry: WINDOW_TYPE_MAP[t], count: c, type: t }))
    .sort((a, b) => b.count - a.count);

  const hasMatches = rows.length > 0 && rows.some((r) => r.type !== "unknown");
  const dominant = rows[0]?.entry;

  return (
    <View style={styles.matchPanel}>
      <View style={styles.matchHeader}>
        <Boxes size={15} color={Colors.dark.green} strokeWidth={2.4} />
        <Text style={styles.matchTitle}>Windows Matched</Text>
        <View style={styles.matchCountBadge}>
          <Text style={styles.matchCountText}>{result.count}</Text>
        </View>
      </View>

      {dominant ? (
        <Text style={styles.matchDominant}>
          {hasMatches
            ? `Primary match: ${dominant.name}`
            : `${result.count} ${result.count === 1 ? "window" : "windows"} detected — type uncertain`}
        </Text>
      ) : (
        <Text style={styles.matchDominant}>No window frames detected.</Text>
      )}

      {rows.length > 0 ? (
        <ScrollView
          style={styles.matchScroll}
          contentContainerStyle={styles.matchScrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {rows.map(({ entry, count, type }) => (
            <Pressable
              key={entry.id}
              style={({ pressed }) => [
                styles.matchRow,
                pressed && styles.matchRowPressed,
              ]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onOpenType(entry, count);
              }}
            >
              <View style={styles.matchThumbWrap} pointerEvents="none">
                {entry.imageUrl ? (
                  <Image
                    source={{ uri: entry.imageUrl }}
                    style={styles.matchThumb}
                    contentFit="contain"
                    transition={120}
                  />
                ) : (
                  <View
                    style={[
                      styles.matchDot,
                      {
                        backgroundColor:
                          type === "unknown" ? Colors.dark.amber : Colors.dark.green,
                      },
                    ]}
                  />
                )}
              </View>
              <View style={styles.matchRowText}>
                <Text style={styles.matchRowName} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={styles.matchRowStyle} numberOfLines={1}>
                  {entry.style}
                </Text>
              </View>
              <View
                style={[
                  styles.matchPill,
                  {
                    backgroundColor:
                      type === "unknown"
                        ? Colors.dark.amber + "22"
                        : Colors.dark.green + "22",
                  },
                ]}
                pointerEvents="none"
              >
                <Text
                  style={[
                    styles.matchPillText,
                    {
                      color:
                        type === "unknown"
                          ? Colors.dark.amber
                          : Colors.dark.green,
                    },
                  ]}
                  pointerEvents="none"
                >
                  {count}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <Pressable
        style={styles.matchFooter}
        onPress={onViewResults}
      >
        <Text style={styles.matchFooterText}>View full inspection report</Text>
        <Text style={styles.matchFooterArrow}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.bg,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 18,
  },
  headerTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: "800" as const,
    letterSpacing: -0.2,
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.dark.textFaint,
  },
  liveDotActive: {
    backgroundColor: Colors.dark.amber,
    shadowColor: Colors.dark.amber,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  liveText: {
    color: Colors.dark.textMuted,
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
  },
  imageFrame: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: Colors.dark.surface,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: Colors.dark.borderStrong,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11,15,20,0.32)",
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLine: {
    position: "absolute",
    backgroundColor: "rgba(255,107,0,0.12)",
  },
  gridLineV: {
    top: 0,
    bottom: 0,
    width: 1,
  },
  gridLineH: {
    left: 0,
    right: 0,
    height: 1,
  },
  scanLineWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  scanTrail: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 70,
  },
  scanLine: {
    width: "100%",
    height: 2,
    backgroundColor: Colors.dark.amber,
  },
  scanGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -3,
    height: 8,
    backgroundColor: Colors.dark.amber,
    opacity: 0.35,
    shadowColor: Colors.dark.amber,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  corner: {
    position: "absolute",
    width: 22,
    height: 22,
    borderColor: Colors.dark.amber,
  },
  cornerTL: { top: 8, left: 8, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 6 },
  cornerTR: { top: 8, right: 8, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 6 },
  cornerBL: {
    bottom: 8,
    left: 8,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 8,
    right: 8,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 6,
  },
  progressBlock: {
    width: "100%",
    paddingHorizontal: 8,
  },
  pctRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  pct: {
    color: Colors.dark.text,
    fontSize: 40,
    fontWeight: "800" as const,
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },
  workingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  spinnerWrap: {},
  workingText: {
    color: Colors.dark.amber,
    fontSize: 12.5,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  doneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  doneText: {
    color: Colors.dark.green,
    fontSize: 12.5,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  track: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.dark.surfaceHigh,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: Colors.dark.amber,
  },
  currentStep: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: "600" as const,
    marginTop: 14,
    marginBottom: 22,
  },
  stepList: {
    gap: 13,
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
    backgroundColor: "rgba(255,107,0,0.10)",
  },
  stepDotComplete: {
    backgroundColor: Colors.dark.amber,
    borderColor: Colors.dark.amber,
  },
  stepSpinner: {},
  stepLabel: {
    color: Colors.dark.textFaint,
    fontSize: 14.5,
    fontWeight: "500" as const,
  },
  stepLabelActive: {
    color: Colors.dark.text,
    fontWeight: "600" as const,
  },
  stepLabelComplete: {
    color: Colors.dark.textMuted,
  },
  errorBlock: {
    alignItems: "center",
    paddingHorizontal: 16,
    width: "100%",
  },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.dark.redSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  errorIconText: {
    color: Colors.dark.red,
    fontSize: 30,
    fontWeight: "800" as const,
  },
  errorTitle: {
    color: Colors.dark.text,
    fontSize: 22,
    fontWeight: "800" as const,
  },
  errorText: {
    color: Colors.dark.textMuted,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 320,
  },
  errorActions: {
    marginTop: 28,
    gap: 12,
    alignSelf: "stretch",
  },
  matchPanel: {
    width: "100%",
    marginTop: 24,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 16,
    padding: 14,
  },
  matchHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  matchTitle: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: "700" as const,
    letterSpacing: -0.1,
  },
  matchCountBadge: {
    backgroundColor: Colors.dark.green + "22",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  matchCountText: {
    color: Colors.dark.green,
    fontSize: 13,
    fontWeight: "800" as const,
    fontVariant: ["tabular-nums"],
  },
  matchDominant: {
    color: Colors.dark.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  matchScroll: {
    maxHeight: 180,
  },
  matchScrollContent: {
    gap: 8,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: Colors.dark.bgElevated,
    borderRadius: 10,
  },
  matchRowPressed: {
    backgroundColor: Colors.dark.surfaceHigh,
  },
  matchThumbWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: Colors.dark.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  matchThumb: {
    width: "100%",
    height: "100%",
  },
  matchDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  matchRowText: {
    flex: 1,
  },
  matchRowName: {
    color: Colors.dark.text,
    fontSize: 13.5,
    fontWeight: "600" as const,
  },
  matchRowStyle: {
    color: Colors.dark.textFaint,
    fontSize: 11.5,
    marginTop: 1,
  },
  matchPill: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minWidth: 28,
    alignItems: "center",
  },
  matchPillText: {
    fontSize: 12.5,
    fontWeight: "800" as const,
    fontVariant: ["tabular-nums"],
  },
  matchFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  matchFooterText: {
    color: Colors.dark.amber,
    fontSize: 13.5,
    fontWeight: "700" as const,
  },
  matchFooterArrow: {
    color: Colors.dark.amber,
    fontSize: 20,
    fontWeight: "800" as const,
  },
});
