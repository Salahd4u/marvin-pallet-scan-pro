import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { ExternalLink, X } from "lucide-react-native";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import type { WindowTypeCatalogEntry } from "@/types/inspection";

const SCREEN_H = Dimensions.get("window").height;

type WindowTypeSheetProps = {
  entry: WindowTypeCatalogEntry | null;
  count?: number;
  visible: boolean;
  onClose: () => void;
};

/**
 * Bottom sheet showing full details for a matched Marvin window type:
 * product image, name, style, visual cues, match count, and a link to
 * the Marvin product page.
 */
export default function WindowTypeSheet({
  entry,
  count,
  visible,
  onClose,
}: WindowTypeSheetProps) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  // Slide-up animation whenever the sheet opens.
  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.spring(slide, {
        toValue: 1,
        useNativeDriver: true,
        speed: 36,
        bounciness: 6,
      }).start();
    }
  }, [visible, slide]);

  const close = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    Animated.timing(slide, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(onClose);
  };

  const translateY = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H, 0],
  });
  const backdropOpacity = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.6],
  });

  if (!entry) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={close}>
      <View style={styles.root}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
          pointerEvents="none"
        />
        <Pressable style={styles.backdropPress} onPress={close} />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + 12, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            <Text style={styles.sheetTitle}>Window Type Details</Text>
            <Pressable onPress={close} style={styles.closeBtn} hitSlop={12}>
              <X size={20} color={Colors.dark.textMuted} strokeWidth={2.6} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Product image */}
            <View style={styles.imageWrap}>
              {entry.imageUrl ? (
                <Image
                  source={{ uri: entry.imageUrl }}
                  style={styles.image}
                  contentFit="contain"
                  transition={150}
                />
              ) : (
                <View style={[styles.imagePlaceholder]}>
                  <Text style={styles.imagePlaceholderText}>No image</Text>
                </View>
              )}
            </View>

            {/* Name + style */}
            <Text style={styles.name}>{entry.name}</Text>
            <Text style={styles.style}>{entry.style}</Text>

            {/* Match badge */}
            {typeof count === "number" && count > 0 ? (
              <View style={styles.matchBadge}>
                <Text style={styles.matchBadgeText}>
                  {count} {count === 1 ? "match" : "matches"} in this scan
                </Text>
              </View>
            ) : null}

            {/* Visual cues */}
            <Text style={styles.sectionLabel}>Identifying features</Text>
            <Text style={styles.cuesText}>{entry.visualCues}</Text>

            {/* Product link */}
            <Pressable
              style={styles.linkBtn}
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
              }}
            >
              <ExternalLink size={16} color={Colors.dark.amber} strokeWidth={2.4} />
              <Text style={styles.linkText} numberOfLines={1}>
                View on marvin.com
              </Text>
              <Text style={styles.linkUrl} numberOfLines={1}>
                {entry.url.replace("https://www.marvin.com/products/windows", "") || "/"}
              </Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.dark.borderStrong,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: SCREEN_H * 0.85,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.borderStrong,
    alignSelf: "center",
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sheetTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "700" as const,
    letterSpacing: -0.1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingBottom: 16,
  },
  imageWrap: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: Colors.dark.bgElevated,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  imagePlaceholderText: {
    color: Colors.dark.textFaint,
    fontSize: 14,
  },
  name: {
    color: Colors.dark.text,
    fontSize: 22,
    fontWeight: "800" as const,
    letterSpacing: -0.3,
  },
  style: {
    color: Colors.dark.amber,
    fontSize: 14,
    fontWeight: "600" as const,
    marginTop: 4,
  },
  matchBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.dark.green + "22",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 12,
  },
  matchBadgeText: {
    color: Colors.dark.green,
    fontSize: 12.5,
    fontWeight: "700" as const,
  },
  sectionLabel: {
    color: Colors.dark.textMuted,
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 8,
  },
  cuesText: {
    color: Colors.dark.text,
    fontSize: 14.5,
    lineHeight: 21,
  },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.dark.bgElevated,
    borderWidth: 1,
    borderColor: Colors.dark.borderStrong,
    borderRadius: 14,
  },
  linkText: {
    color: Colors.dark.amber,
    fontSize: 14,
    fontWeight: "700" as const,
    flexShrink: 1,
  },
  linkUrl: {
    color: Colors.dark.textFaint,
    fontSize: 12,
    marginLeft: "auto",
  },
});
