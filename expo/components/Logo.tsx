import React from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import Colors from "@/constants/colors";

type LogoProps = {
  size?: number;
};

/** WindowCheck mark: a window frame with mullions inside an amber machine-vision reticle. */
export default function Logo({ size = 84 }: LogoProps) {
  const r = 18;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#1E2733" />
            <Stop offset="1" stopColor="#0E1216" />
          </LinearGradient>
          <LinearGradient id="amber" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FF8A2B" />
            <Stop offset="1" stopColor={Colors.dark.amber} />
          </LinearGradient>
        </Defs>

        <Rect x="2" y="2" width="96" height="96" rx={r} fill="url(#bg)" />
        <Rect
          x="2.75"
          y="2.75"
          width="94.5"
          height="94.5"
          rx={r - 0.75}
          fill="none"
          stroke={Colors.dark.border}
          strokeWidth="1.5"
        />

        {/* Reticle corner brackets */}
        {[
          "M22 30 V22 H30",
          "M70 22 H78 V30",
          "M78 70 V78 H70",
          "M30 78 H22 V70",
        ].map((d) => (
          <Path
            key={d}
            d={d}
            fill="none"
            stroke="url(#amber)"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Window frame outer */}
        <Rect
          x="32"
          y="38"
          width="36"
          height="30"
          rx="2"
          fill="none"
          stroke="url(#amber)"
          strokeWidth="3.2"
        />
        {/* Mullions (cross dividing the window into 4 panes) */}
        <Rect x="49" y="38" width="2" height="30" fill={Colors.dark.amberDim} />
        <Rect x="32" y="52" width="36" height="2" fill={Colors.dark.amberDim} />

        {/* Defect marker — a small red dot on a pane */}
        <Rect x="40" y="44" width="4" height="4" rx="1" fill={Colors.dark.red} />

        {/* Scan sweep line */}
        <Rect x="24" y="53" width="52" height="2" rx="1" fill="#FFD7A8" opacity={0.55} />
      </Svg>
    </View>
  );
}
