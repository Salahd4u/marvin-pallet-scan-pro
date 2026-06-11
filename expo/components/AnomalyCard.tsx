import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import Colors from "@/constants/colors";
import type { Anomaly } from "@/types/inspection";

type AnomalyCardProps = {
  anomaly: Anomaly;
  standardWidth: number;
  standardHeight: number;
  index: number;
};

/** Detailed card for a single flagged anomaly shown below the results image. */
export default function AnomalyCard({
  anomaly,
  standardWidth,
  standardHeight,
  index,
}: AnomalyCardProps) {
  const oversized = anomaly.width * anomaly.height > standardWidth * standardHeight;
  const TrendIcon = oversized ? ArrowUpRight : ArrowDownRight;
  const severe = anomaly.deviation >= 25;

  return (
    <View style={styles.card}>
      <View style={styles.indexWrap}>
        <AlertTriangle size={16} color={Colors.dark.red} />
        <Text style={styles.indexText}>{String(index + 1).padStart(2, "0")}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Item #{anomaly.id}</Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: severe ? Colors.dark.redSoft : Colors.dark.amberSoft },
            ]}
          >
            <TrendIcon size={12} color={severe ? Colors.dark.red : Colors.dark.amber} />
            <Text
              style={[
                styles.badgeText,
                { color: severe ? Colors.dark.red : Colors.dark.amber },
              ]}
            >
              {anomaly.deviation}% dev
            </Text>
          </View>
        </View>

        <Text style={styles.meta}>
          {anomaly.width}×{anomaly.height}px · position ({anomaly.x}, {anomaly.y})
        </Text>
        <Text style={styles.note}>
          {oversized ? "Oversized" : "Undersized"} relative to {standardWidth}×{standardHeight}px
          standard
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.dark.red,
    padding: 14,
    gap: 12,
  },
  indexWrap: {
    alignItems: "center",
    gap: 4,
    paddingTop: 2,
  },
  indexText: {
    color: Colors.dark.textFaint,
    fontSize: 12,
    fontWeight: "700" as const,
    fontVariant: ["tabular-nums"],
  },
  body: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "700" as const,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
  meta: {
    color: Colors.dark.textMuted,
    fontSize: 13,
    marginTop: 6,
    fontVariant: ["tabular-nums"],
  },
  note: {
    color: Colors.dark.textFaint,
    fontSize: 12.5,
    marginTop: 2,
  },
});
