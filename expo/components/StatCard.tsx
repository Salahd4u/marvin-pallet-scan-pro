import { LucideIcon } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import Colors from "@/constants/colors";

type StatCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  accent?: string;
};

/** Compact metric tile used in the Results summary grid. */
export default function StatCard({ icon: Icon, label, value, unit, accent }: StatCardProps) {
  const tint = accent ?? Colors.dark.amber;
  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: `${tint}22` }]}>
        <Icon size={18} color={tint} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{value}</Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: "47%",
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  label: {
    color: Colors.dark.textMuted,
    fontSize: 12.5,
    fontWeight: "600" as const,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 4,
    gap: 4,
  },
  value: {
    color: Colors.dark.text,
    fontSize: 26,
    fontWeight: "800" as const,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  unit: {
    color: Colors.dark.textFaint,
    fontSize: 14,
    fontWeight: "600" as const,
  },
});
