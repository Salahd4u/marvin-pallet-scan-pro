import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ZoomableImage from "@/components/ZoomableImage";
import Colors from "@/constants/colors";
import { useInspection } from "@/providers/InspectionProvider";

export default function ViewerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { current } = useInspection();

  return (
    <View style={styles.container}>
      {current ? <ZoomableImage uri={current.imageUri} /> : null}

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Text style={styles.hint}>Pinch to zoom · drag to pan</Text>
        <Pressable onPress={() => router.back()} style={styles.close} hitSlop={10}>
          <X size={22} color={Colors.dark.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  hint: {
    color: Colors.dark.textMuted,
    fontSize: 13,
    fontWeight: "500" as const,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
});
