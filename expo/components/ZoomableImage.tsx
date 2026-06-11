import { Image } from "expo-image";
import React, { useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import {
  PanGestureHandler,
  PinchGestureHandler,
  State,
  type PanGestureHandlerStateChangeEvent,
  type PinchGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";

type ZoomableImageProps = {
  uri: string;
};

/**
 * Fullscreen pinch-to-zoom + pan image viewer for high-resolution inspection.
 * Built on react-native-gesture-handler with the Animated API (no reanimated).
 */
export default function ZoomableImage({ uri }: ZoomableImageProps) {
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const scale = Animated.multiply(baseScale, pinchScale);
  const lastScale = useRef(1);

  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastOffset = useRef({ x: 0, y: 0 });

  const pinchRef = useRef(null);
  const panRef = useRef(null);

  const onPinchEvent = Animated.event([{ nativeEvent: { scale: pinchScale } }], {
    useNativeDriver: true,
  });

  const onPinchStateChange = (e: PinchGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      let next = lastScale.current * e.nativeEvent.scale;
      next = Math.max(1, Math.min(next, 5));
      lastScale.current = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);

      if (next === 1) {
        lastOffset.current = { x: 0, y: 0 };
        Animated.parallel([
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
        ]).start();
      }
    }
  };

  const onPanEvent = Animated.event(
    [{ nativeEvent: { translationX: translateX, translationY: translateY } }],
    { useNativeDriver: true }
  );

  const onPanStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      lastOffset.current.x += e.nativeEvent.translationX;
      lastOffset.current.y += e.nativeEvent.translationY;
      translateX.setOffset(lastOffset.current.x);
      translateX.setValue(0);
      translateY.setOffset(lastOffset.current.y);
      translateY.setValue(0);
    }
  };

  return (
    <View style={styles.container}>
      <PanGestureHandler
        ref={panRef}
        simultaneousHandlers={pinchRef}
        minPointers={1}
        maxPointers={2}
        onGestureEvent={onPanEvent}
        onHandlerStateChange={onPanStateChange}
      >
        <Animated.View style={styles.fill}>
          <PinchGestureHandler
            ref={pinchRef}
            simultaneousHandlers={panRef}
            onGestureEvent={onPinchEvent}
            onHandlerStateChange={onPinchStateChange}
          >
            <Animated.View style={styles.fill}>
              <Animated.View
                style={[
                  styles.fill,
                  { transform: [{ scale }, { translateX }, { translateY }] },
                ]}
              >
                <Image
                  source={{ uri }}
                  style={styles.image}
                  contentFit="contain"
                  transition={150}
                />
              </Animated.View>
            </Animated.View>
          </PinchGestureHandler>
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  fill: {
    flex: 1,
  },
  image: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
});
