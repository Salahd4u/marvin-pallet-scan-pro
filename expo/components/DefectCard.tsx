import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import Colors from "@/constants/colors";
import type { Defect } from "@/types/inspection";

type DefectCardProps = {
  defect: Defect;
  standardWidth: number;
  standardHeight: number;
  index: number;
};

const SEVERITY_COLOR = {
  low: Colors.dark.amber,
  medium: "#FF9F1C",
  high: Colors.dark.red,
} as const;

const SEVERITY_BG = {
  low: Colors.dark.amberSoft,
  medium: "rgba(255,159,28,0.16)",
  high: Colors.dark.redSoft,
} as const;

const SEVERITY_LABEL = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

/** Detailed card for a single detected defect shown below the results image. */
export default function DefectCard({
  defect,
  standardWidth,
  standardHeight,
  index,
}: DefectCardProps) {
  const area = defect.width * defect.height;
  const standard = standardWidth * standardHeight;
  const oversized = standard > 0 && area > standard * 0.6;
  const TrendIcon = oversized ? ArrowUpRight : ArrowDownRight;
  const color = SEVERITY_COLOR[defect.severity];
  const bg = SEVERITY_BG[defect.severity];
  const severe = defect.severity === "high";

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.indexWrap}>
        <AlertTriangle size={16} color={color} />
        <Text style={styles.indexText}>{String(index + 1).padStart(2, "0")}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            #{defect.id} · {defect.label}
          </Text>
          <View style={[styles.badge, { backgroundColor: bg }]}>
            <TrendIcon size={12} color={color} />
            <Text style={[styles.badgeText, { color }]}>
              {SEVERITY_LABEL[defect.severity]}
            </Text>
          </View>
        </View>

        <Text style={styles.meta}>
          {defect.width}×{defect.height}px · position ({defect.x}, {defect.y})
        </Text>
        {defect.note ? (
          <Text style={styles.note}>{defect.note}</Text>
        ) : (
          <Text style={styles.note}>
            {severe ? "Requires immediate attention" : "Review recommended"}
          </Text>
        )}
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
    flexWrap: "wrap",
    gap: 6,
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
