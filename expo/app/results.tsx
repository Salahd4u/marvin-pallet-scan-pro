import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  Boxes,
  CheckCircle2,
  Expand,
  Frame,
  Gauge,
  Maximize2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react-native";
import React, { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ActionButton from "@/components/ActionButton";
import AnnotatedImage from "@/components/AnnotatedImage";
import DefectCard from "@/components/DefectCard";
import StatCard from "@/components/StatCard";
import Colors from "@/constants/colors";
import { useInspection } from "@/providers/InspectionProvider";
import type { WindowType } from "@/types/inspection";
import { WINDOW_TYPE_MAP } from "@/types/inspection";

const EMPTY_STANDARD = "— × —";

export default function ResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { current } = useInspection();

  const openViewer = useCallback(() => {
    if (current) router.push("/viewer");
  }, [router, current]);

  if (!current) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No inspection loaded.</Text>
        <ActionButton label="Back to Home" onPress={() => router.replace("/")} />
      </View>
    );
  }

  const { result, imageUri } = current;
  const defects = result.defects ?? [];
  const defectCount = defects.length;
  const items = result.items ?? [];
  const hasFrames = result.count > 0;
  const pass = hasFrames && defectCount === 0;
  const standard =
    hasFrames && result.average_width > 0
      ? `${result.average_width} ${String.fromCharCode(0x00d7)} ${result.average_height}`
      : EMPTY_STANDARD;

  // Marvin window type breakdown
  const typeCounts = new Map<WindowType, number>();
  for (const it of items) {
    const t = it.windowType ?? "unknown";
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const typeRows = Array.from(typeCounts.entries())
    .map(([t, c]) => ({ entry: WINDOW_TYPE_MAP[t], count: c }))
    .sort((a, b) => b.count - a.count);
  const dominantType = typeRows[0]?.entry;

  // Highest-severity summary
  const highCount = defects.filter((d) => d.severity === "high").length;
  const mediumCount = defects.filter((d) => d.severity === "medium").length;
  const lowCount = defects.filter((d) => d.severity === "low").length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Status banner */}
      <View style={styles.statusBanner}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: !hasFrames
                ? Colors.dark.amber
                : pass
                  ? Colors.dark.green
                  : highCount > 0
                    ? Colors.dark.red
                    : Colors.dark.amber,
            },
          ]}
        />
        <Text style={styles.statusText}>
          {!hasFrames
            ? "No window frames detected — try a clearer photo"
            : pass
              ? "All windows passed inspection"
              : highCount > 0
                ? `${highCount} high-severity ${highCount === 1 ? "defect" : "defects"} require attention`
                : `${defectCount} ${defectCount === 1 ? "defect" : "defects"} found — review recommended`}
        </Text>
        <View style={styles.sourceChip}>
          <Text style={styles.sourceChipText}>AI VISION</Text>
        </View>
      </View>

      {/* Annotated image */}
      <Pressable onPress={openViewer} style={styles.imageWrap}>
        <AnnotatedImage uri={imageUri} result={result} />
        <View style={styles.expandBadge}>
          <Expand size={15} color={Colors.dark.text} />
          <Text style={styles.expandText}>Tap to zoom</Text>
        </View>
      </Pressable>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendCircle, { backgroundColor: Colors.dark.green }]} />
          <Text style={styles.legendText}>Window frame</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendCircle, { backgroundColor: Colors.dark.red }]} />
          <Text style={styles.legendText}>High severity</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendCircle, { backgroundColor: Colors.dark.amber }]} />
          <Text style={styles.legendText}>Low/Medium</Text>
        </View>
      </View>

      {/* Stats grid */}
      <View style={styles.statGrid}>
        <StatCard
          icon={Frame}
          label="Window Frames"
          value={String(result.count)}
          accent={Colors.dark.amber}
        />
        <StatCard
          icon={Boxes}
          label="Marvin Type"
          value={dominantType ? dominantType.short : "—"}
          accent={Colors.dark.blue}
        />
        <StatCard
          icon={Maximize2}
          label="Avg Frame Size"
          value={standard}
          unit={hasFrames ? "px" : undefined}
        />
        <StatCard
          icon={TriangleAlert}
          label="Defects Found"
          value={String(defectCount)}
          accent={defectCount > 0 ? Colors.dark.red : Colors.dark.green}
        />
        <StatCard
          icon={Gauge}
          label="Confidence"
          value={String(result.confidence)}
          unit="%"
          accent={Colors.dark.blue}
        />
      </View>

      {/* Marvin window-type match breakdown */}
      {hasFrames && typeRows.length > 0 ? (
        <View style={styles.typeSection}>
          <Text style={styles.sectionTitle}>Matched Marvin Window Types</Text>
          <Text style={styles.sectionSub}>
            Source: marvin.com/products/windows
          </Text>
          <View style={styles.typeList}>
            {typeRows.map(({ entry, count }) => (
              <View key={entry.id} style={styles.typeRow}>
                <View style={styles.typeRowLeft}>
                  <View style={styles.typeThumbWrap}>
                    {entry.imageUrl ? (
                      <Image
                        source={{ uri: entry.imageUrl }}
                        style={styles.typeThumb}
                        contentFit="contain"
                        transition={120}
                      />
                    ) : (
                      <View
                        style={[
                          styles.typeDot,
                          {
                            backgroundColor:
                              entry.id === "unknown"
                                ? Colors.dark.amber
                                : Colors.dark.blue,
                          },
                        ]}
                      />
                    )}
                  </View>
                  <View>
                    <Text style={styles.typeName}>{entry.name}</Text>
                    <Text style={styles.typeStyle}>{entry.style}</Text>
                  </View>
                </View>
                <View style={styles.typeRowRight}>
                  <View style={styles.typeCountBadge}>
                    <Text style={styles.typeCountText}>{count}</Text>
                  </View>
                  <Text style={styles.typeMatch}>{`×${count}`}</Text>
                </View>
              </View>
            ))}
          </View>
          {dominantType && dominantType.id !== "unknown" ? (
            <Text style={styles.typeHint}>
              Matched against the Marvin window catalog. Tap a type below to view the product page.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Severity breakdown */}
      {defectCount > 0 ? (
        <View style={styles.severityRow}>
          <SeverityPill label="High" count={highCount} color={Colors.dark.red} />
          <SeverityPill label="Medium" count={mediumCount} color="#FF9F1C" />
          <SeverityPill label="Low" count={lowCount} color={Colors.dark.amber} />
        </View>
      ) : null}

      {/* Defects section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {pass ? "Defects" : `Detected Defects (${defectCount})`}
        </Text>
      </View>

      {!hasFrames ? (
        <View style={styles.passCard}>
          <TriangleAlert size={26} color={Colors.dark.amber} />
          <Text style={styles.passText}>
            No window frames were detected. Make sure the window(s) fill the frame, are well lit,
            and captured straight-on, then run a new inspection.
          </Text>
        </View>
      ) : pass ? (
        <View style={[styles.passCard, { backgroundColor: Colors.dark.greenSoft }]}>
          <CheckCircle2 size={26} color={Colors.dark.green} />
          <Text style={styles.passText}>
            All {result.count} window {result.count === 1 ? "frame" : "frames"} passed with no
            defects detected.
          </Text>
        </View>
      ) : (
        <View style={styles.defectList}>
          {defects.map((d, i) => (
            <DefectCard
              key={d.id}
              defect={d}
              standardWidth={result.average_width}
              standardHeight={result.average_height}
              index={i}
            />
          ))}
        </View>
      )}

      <View style={styles.footerActions}>
        <ActionButton
          label="New Inspection"
          icon={RotateCcw}
          onPress={() => router.replace("/")}
          variant="primary"
        />
      </View>
    </ScrollView>
  );
}

function SeverityPill({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <View style={[styles.severityPill, { borderColor: color }]}>
      <View style={[styles.severityDot, { backgroundColor: color }]} />
      <Text style={[styles.severityLabel, { color }]}>{label}</Text>
      <Text style={[styles.severityCount, { color }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.bg,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
    backgroundColor: Colors.dark.bg,
  },
  emptyText: {
    color: Colors.dark.textMuted,
    fontSize: 16,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 14.5,
    fontWeight: "600" as const,
  },
  sourceChip: {
    backgroundColor: Colors.dark.blue + "22",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourceChipText: {
    color: Colors.dark.blue,
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.8,
  },
  imageWrap: {
    position: "relative",
  },
  expandBadge: {
    position: "absolute",
    bottom: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(11,15,20,0.72)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  expandText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "600" as const,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 12,
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  legendCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  legendText: {
    color: Colors.dark.textMuted,
    fontSize: 13,
    fontWeight: "500" as const,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  severityRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    flexWrap: "wrap",
  },
  severityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: Colors.dark.surface,
  },
  severityDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  severityLabel: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  severityCount: {
    fontSize: 14,
    fontWeight: "800" as const,
    fontVariant: ["tabular-nums"],
  },
  sectionHeader: {
    marginTop: 26,
    marginBottom: 12,
  },
  sectionTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: "700" as const,
  },
  typeSection: {
    marginTop: 22,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 16,
    padding: 16,
  },
  sectionSub: {
    color: Colors.dark.textFaint,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 12,
  },
  typeList: {
    gap: 10,
  },
  typeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  typeRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  typeThumbWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: Colors.dark.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  typeThumb: {
    width: "100%",
    height: "100%",
  },
  typeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  typeName: {
    color: Colors.dark.text,
    fontSize: 14.5,
    fontWeight: "700" as const,
  },
  typeStyle: {
    color: Colors.dark.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  typeRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  typeCountBadge: {
    backgroundColor: Colors.dark.blue + "22",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeCountText: {
    color: Colors.dark.blue,
    fontSize: 13,
    fontWeight: "800" as const,
    fontVariant: ["tabular-nums"],
  },
  typeMatch: {
    color: Colors.dark.textMuted,
    fontSize: 12.5,
    fontWeight: "600" as const,
  },
  typeHint: {
    color: Colors.dark.textFaint,
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
  },
  passCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.dark.amberSoft,
    borderRadius: 14,
    padding: 16,
  },
  passText: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 14.5,
    lineHeight: 21,
  },
  defectList: {
    gap: 10,
  },
  footerActions: {
    marginTop: 28,
  },
});
