import { useRouter } from "expo-router";
import {
  Boxes,
  CheckCircle2,
  Expand,
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
import AnomalyCard from "@/components/AnomalyCard";
import StatCard from "@/components/StatCard";
import Colors from "@/constants/colors";
import { useInspection } from "@/providers/InspectionProvider";

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
  const anomalyCount = result.anomalies.length;
  const pass = anomalyCount === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.statusBanner}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: pass ? Colors.dark.green : Colors.dark.red },
          ]}
        />
        <Text style={styles.statusText}>
          {pass ? "Pallet passed inspection" : `${anomalyCount} anomalies require review`}
        </Text>

      </View>

      <Pressable onPress={openViewer} style={styles.imageWrap}>
        <AnnotatedImage uri={imageUri} result={result} />
        <View style={styles.expandBadge}>
          <Expand size={15} color={Colors.dark.text} />
          <Text style={styles.expandText}>Tap to zoom</Text>
        </View>
      </Pressable>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { borderColor: Colors.dark.green }]} />
          <Text style={styles.legendText}>Normal item</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.dark.red }]} />
          <Text style={styles.legendText}>Anomaly</Text>
        </View>
      </View>

      <View style={styles.statGrid}>
        <StatCard icon={Boxes} label="Total Items" value={String(result.count)} />
        <StatCard
          icon={Maximize2}
          label="Standard Size"
          value={`${result.average_width}×${result.average_height}`}
          unit="px"
        />
        <StatCard
          icon={TriangleAlert}
          label="Anomalies"
          value={String(anomalyCount)}
          accent={anomalyCount > 0 ? Colors.dark.red : Colors.dark.green}
        />
        <StatCard
          icon={Gauge}
          label="Confidence"
          value={String(result.confidence)}
          unit="%"
          accent={Colors.dark.blue}
        />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {pass ? "Detected Anomalies" : `Detected Anomalies (${anomalyCount})`}
        </Text>
      </View>

      {pass ? (
        <View style={styles.passCard}>
          <CheckCircle2 size={26} color={Colors.dark.green} />
          <Text style={styles.passText}>
            No anomalies detected. All {result.count} items are within tolerance.
          </Text>
        </View>
      ) : (
        <View style={styles.anomalyList}>
          {result.anomalies.map((a, i) => (
            <AnomalyCard
              key={a.id}
              anomaly={a}
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
  estChip: {
    backgroundColor: Colors.dark.amberSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  estChipText: {
    color: Colors.dark.amber,
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
    gap: 20,
    marginTop: 12,
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 2,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
  sectionHeader: {
    marginTop: 26,
    marginBottom: 12,
  },
  sectionTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: "700" as const,
  },
  passCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.dark.greenSoft,
    borderRadius: 14,
    padding: 16,
  },
  passText: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 14.5,
    lineHeight: 21,
  },
  anomalyList: {
    gap: 10,
  },
  footerActions: {
    marginTop: 28,
  },
});
