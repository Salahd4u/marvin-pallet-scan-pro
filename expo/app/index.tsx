import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Camera, Clock, ImageIcon, ScanLine, ShieldCheck } from "lucide-react-native";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ActionButton from "@/components/ActionButton";
import Logo from "@/components/Logo";
import Colors from "@/constants/colors";
import { useInspection } from "@/providers/InspectionProvider";

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { stageImage, history } = useInspection();

  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2600,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const handleResult = useCallback(
    (result: ImagePicker.ImagePickerResult) => {
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      const uri = asset.uri;
      // Use Image.getSize to resolve true pixel dimensions — the picker's
      // reported width/height can be wrong after cropping on some devices.
      Image.getSize(
        uri,
        (w, h) => {
          stageImage({ uri, width: w, height: h });
          router.push("/analysis");
        },
        () => {
          // Fallback on failure
          stageImage({
            uri,
            width: asset.width ?? 1000,
            height: asset.height ?? 1000,
          });
          router.push("/analysis");
        }
      );
    },
    [router, stageImage]
  );

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.9,
      mediaTypes: ["images"],
    });
    handleResult(result);
  }, [handleResult]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      quality: 0.9,
      mediaTypes: ["images"],
    });
    handleResult(result);
  }, [handleResult]);

  const openHistory = useCallback(() => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    router.push("/history");
  }, [router]);

  const sweepTranslate = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-60, 60],
  });

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brandRow}>
          <ScanLine size={18} color={Colors.dark.amber} />
          <Text style={styles.brandText}>PALLETPRO</Text>
        </View>
        <Pressable
          onPress={openHistory}
          style={styles.historyChip}
          hitSlop={8}
        >
          <Clock size={15} color={Colors.dark.textMuted} />
          <Text style={styles.historyChipText}>{history.length}</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.logoStage}>
          <Animated.View
            pointerEvents="none"
            style={[styles.sweep, { transform: [{ translateX: sweepTranslate }] }]}
          />
          <Logo size={108} />
        </View>

        <Text style={styles.title}>Pallet Inspection</Text>
        <Text style={styles.subtitle}>
          Capture a pallet and let computer vision count items, measure dimensions, and flag
          anomalies in seconds.
        </Text>

        <View style={styles.featureRow}>
          <Feature icon={ShieldCheck} text="QC grade" />
          <Feature icon={ScanLine} text="Auto-detect" />
          <Feature icon={Camera} text="On-site" />
        </View>
      </View>

      <View style={[styles.actions, { paddingBottom: insets.bottom + 20 }]}>
        <ActionButton label="Take Photo" icon={Camera} onPress={takePhoto} variant="primary" />
        <ActionButton
          label="Choose From Gallery"
          icon={ImageIcon}
          onPress={pickPhoto}
          variant="secondary"
        />
        <Text style={styles.hint}>Tip: fill the frame with the full pallet face for best accuracy.</Text>
      </View>
    </View>
  );
}

function Feature({
  icon: Icon,
  text,
}: {
  icon: typeof Camera;
  text: string;
}) {
  return (
    <View style={styles.feature}>
      <Icon size={15} color={Colors.dark.amber} />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.bg,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: "800" as const,
    letterSpacing: 2.5,
  },
  historyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  historyChipText: {
    color: Colors.dark.textMuted,
    fontSize: 13,
    fontWeight: "700" as const,
    fontVariant: ["tabular-nums"],
  },
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  logoStage: {
    width: 168,
    height: 168,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.bgElevated,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    overflow: "hidden",
    marginBottom: 28,
  },
  sweep: {
    position: "absolute",
    width: 70,
    height: 240,
    backgroundColor: Colors.dark.amberSoft,
    transform: [{ rotate: "18deg" }],
  },
  title: {
    color: Colors.dark.text,
    fontSize: 30,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  subtitle: {
    color: Colors.dark.textMuted,
    fontSize: 15.5,
    lineHeight: 23,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 360,
  },
  featureRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 26,
  },
  feature: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  featureText: {
    color: Colors.dark.textMuted,
    fontSize: 13,
    fontWeight: "600" as const,
  },
  actions: {
    paddingHorizontal: 20,
    gap: 12,
  },
  hint: {
    color: Colors.dark.textFaint,
    fontSize: 12.5,
    textAlign: "center",
    marginTop: 6,
  },
});
