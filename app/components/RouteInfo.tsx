// app/components/RouteInfo.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

function secondsToReadable(sec: number) {
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

// expects distanceText like "12.3 mi" or "20.1 km"
function parseMiles(distanceText: string) {
  if (!distanceText) return null;
  const lower = distanceText.toLowerCase();
  if (lower.includes("mi")) {
    const n = parseFloat(lower.replace("mi", "").trim());
    return n;
  } else if (lower.includes("km")) {
    const km = parseFloat(lower.replace("km", "").trim());
    return +(km * 0.621371).toFixed(2);
  }
  return null;
}

export default function RouteInfo({
  distanceText,
  durationSeconds,
  destCoords,
}: {
  distanceText: string;
  durationSeconds: number;
  destCoords: { latitude: number; longitude: number } | null;
}) {
  const router = useRouter();
  const miles = parseMiles(distanceText);
  return (
    <View style={styles.container}>
      <Text style={styles.line}>Distance: {distanceText}{miles ? ` (${miles} mi)` : ""}</Text>
      <Text style={styles.line}>ETA: {secondsToReadable(durationSeconds)}</Text>
      {destCoords && (
        <TouchableOpacity
          style={styles.arriveBtn}
          onPress={() =>
            router.push(`/arrival?latitude=${destCoords.latitude}&longitude=${destCoords.longitude}`)
          }
        >
          <Text style={styles.arriveBtnText}>I've Arrived / Rate Parking</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 120,
    left: 12,
    right: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    padding: 12,
    borderRadius: 12,
    elevation: 4,
  },
  line: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  arriveBtn: {
    backgroundColor: "#00796b",
    padding: 12,
    borderRadius: 10,
    marginTop: 8,
    alignItems: "center",
  },
  arriveBtnText: { color: "#fff", fontWeight: "700" },
});
