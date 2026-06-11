import * as Haptics from "expo-haptics";
import { LucideIcon } from "lucide-react-native";
import React, { useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, ViewStyle } from "react-native";

import Colors from "@/constants/colors";

type ActionButtonProps = {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  style?: ViewStyle;
};

/** Primary/secondary CTA with press-scale animation and haptic feedback. */
export default function ActionButton({
  label,
  icon: Icon,
  onPress,
  variant = "primary",
  disabled = false,
  style,
}: ActionButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const isPrimary = variant === "primary";

  const animate = (to: number) => {
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  const handlePress = () => {
    if (disabled) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onPress();
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={() => animate(0.96)}
        onPressOut={() => animate(1)}
        disabled={disabled}
        style={[
          styles.base,
          isPrimary ? styles.primary : styles.secondary,
          disabled && styles.disabled,
        ]}
      >
        {Icon ? (
          <Icon size={20} color={isPrimary ? "#0B0F14" : Colors.dark.text} strokeWidth={2.4} />
        ) : null}
        <Text style={[styles.label, isPrimary ? styles.labelPrimary : styles.labelSecondary]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 20,
  },
  primary: {
    backgroundColor: Colors.dark.amber,
  },
  secondary: {
    backgroundColor: Colors.dark.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.dark.borderStrong,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 16.5,
    fontWeight: "700" as const,
  },
  labelPrimary: {
    color: "#0B0F14",
  },
  labelSecondary: {
    color: Colors.dark.text,
  },
});
