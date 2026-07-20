import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import Colors from "@/constants/colors";
import { InspectionProvider } from "@/providers/InspectionProvider";

try {
  SplashScreen.preventAutoHideAsync();
} catch {
  // Silent — splash screen may already have hidden.
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.dark.bg },
        headerTintColor: Colors.dark.text,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.dark.bg },
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="analysis" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="results" options={{ title: "Inspection Report" }} />
      <Stack.Screen name="history" options={{ title: "Inspection History" }} />
      <Stack.Screen
        name="viewer"
        options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      // Splash screen may already be hidden; safe to ignore.
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <InspectionProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style="light" />
          <RootLayoutNav />
        </GestureHandlerRootView>
      </InspectionProvider>
    </QueryClientProvider>
  );
}
