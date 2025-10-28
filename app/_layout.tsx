// app/_layout.tsx
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack>
        <Stack.Screen 
          name="index" 
          options={{ headerShown: false }} />
        <Stack.Screen 
          name="MapScreen" 
          options={{ title: "Map View", headerShown: true }} />
      </Stack>
    </SafeAreaProvider>
  );
}
