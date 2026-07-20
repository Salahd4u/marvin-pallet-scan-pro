import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ChevronRight, Clock, Frame, Trash2, TriangleAlert } from "lucide-react-native";
import React, { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { useInspection } from "@/providers/InspectionProvider";
import type { Inspection } from "@/types/inspection";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { history, setCurrent, clearHistory } = useInspection();

  const openInspection = useCallback(
    (item: Inspection) => {
      setCurrent(item);
      router.push("/results");
    },
    [router, setCurrent]
  );

  const renderItem = useCallback(
    ({ item }: { item: Inspection }) => {
      const defects = item.result.defects?.length ?? 0;
      const frames = item.result.count;
      return (
        <Pressable style={styles.row} onPress={() => openInspection(item)}>
          <Image source={{ uri: item.imageUri }} style={styles.thumb} contentFit="cover" />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>
              {frames} {frames === 1 ? "window" : "windows"}
            </Text>
            <View style={styles.rowMetaLine}>
              <Clock size={12} color={Colors.dark.textFaint} />
              <Text style={styles.rowMeta}>{formatDate(item.createdAt)}</Text>
            </View>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: defects > 0 ? Colors.dark.redSoft : Colors.dark.greenSoft,
                },
              ]}
            >
              {defects > 0 ? (
                <TriangleAlert size={11} color={Colors.dark.red} />
              ) : (
                <Frame size={11} color={Colors.dark.green} />
              )}
              <Text
                style={[
                  styles.statusPillText,
                  { color: defects > 0 ? Colors.dark.red : Colors.dark.green },
                ]}
              >
                {defects > 0
                  ? `${defects} ${defects === 1 ? "defect" : "defects"}`
                  : "Passed"}
              </Text>
            </View>
          </View>
          <ChevronRight size={20} color={Colors.dark.textFaint} />
        </Pressable>
      );
    },
    [openInspection]
  );

  if (history.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <Clock size={28} color={Colors.dark.textFaint} />
        </View>
        <Text style={styles.emptyTitle}>No inspections yet</Text>
        <Text style={styles.emptyText}>
          Completed window inspections will appear here for quick review.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={
          <Pressable style={styles.clearBtn} onPress={clearHistory}>
            <Trash2 size={15} color={Colors.dark.textMuted} />
            <Text style={styles.clearText}>Clear history</Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.bg,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  clearText: {
    color: Colors.dark.textMuted,
    fontSize: 13,
    fontWeight: "600" as const,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 14,
    padding: 10,
  },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: 10,
    backgroundColor: Colors.dark.surfaceHigh,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "700" as const,
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  rowMeta: {
    color: Colors.dark.textFaint,
    fontSize: 12.5,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 2,
  },
  statusPillText: {
    fontSize: 11.5,
    fontWeight: "700" as const,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: Colors.dark.bg,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    color: Colors.dark.text,
    fontSize: 19,
    fontWeight: "700" as const,
  },
  emptyText: {
    color: Colors.dark.textMuted,
    fontSize: 14.5,
    textAlign: "center",
    lineHeight: 21,
    marginTop: 6,
    maxWidth: 300,
  },
});
