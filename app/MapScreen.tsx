// app/MapScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import MapView, { Marker, Polyline, LatLng, Region, UrlTile } from "react-native-maps";
import { useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import Slider from "@react-native-community/slider";

const GOOGLE_MAPS_APIKEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

// ---------- Types ----------
type Coords = LatLng;
type RainViewerData = {
  radar: { past: { time: number }[]; nowcast: { time: number }[] };
};

// ---------- Helpers ----------
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function decodePolyline(t: string): Coords[] {
  const out: Coords[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < t.length) {
    let b, shift = 0, result = 0;
    do { b = t.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0; result = 0;
    do { b = t.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dlng;
    out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return out;
}

async function computeRoute(from: Coords, to: Coords): Promise<Coords[]> {
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_APIKEY,
      "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } },
      destination: { location: { latLng: { latitude: to.latitude, longitude: to.longitude } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    }),
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  const encoded = json?.routes?.[0]?.polyline?.encodedPolyline;
  return encoded ? decodePolyline(encoded) : [];
}

// Binary search for closest frame index to a target timestamp (seconds)
function closestFrameIndex(frames: number[], target: number) {
  if (!frames.length) return -1;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid] < target) lo = mid + 1; else hi = mid;
  }
  const a = lo;
  const b = Math.max(0, lo - 1);
  return Math.abs(frames[a] - target) < Math.abs(frames[b] - target) ? a : b;
}

// ========== Component ==========
export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const routeFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const radarRefreshTimer = useRef<NodeJS.Timeout | null>(null);

  const { destLat, destLng, destName } = useLocalSearchParams();

  // Destination from params
  const [destination] = useState<Coords | null>(() => {
    const lat = Number(destLat);
    const lng = Number(destLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  });

  // User location + route polyline
  const [origin, setOrigin] = useState<Coords | null>(null);
  const [routeCoords, setRouteCoords] = useState<Coords[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- Radar state ----
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.6);

  // Raw frame timestamps (sorted, seconds)
  const [frames, setFrames] = useState<number[]>([]);

  const MIN_OFFSET = -120;
  const MAX_OFFSET = 0;
  const [sliderOffsetMin, setSliderOffsetMin] = useState(0); // 0 = now

  // Live clock
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ====== LOCATION: initial + live watch ======
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") { setLoading(false); return; }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setOrigin({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 2000, distanceInterval: 5 },
        (loc) => setOrigin({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      );
    })();
    return () => sub?.remove();
  }, []);

  // ====== ROUTE: debounced on origin/destination changes ======
  useEffect(() => {
    if (!origin || !destination || !GOOGLE_MAPS_APIKEY) return;
    const o = origin, d = destination;
    if (routeFetchTimer.current) clearTimeout(routeFetchTimer.current);
    routeFetchTimer.current = setTimeout(async () => {
      try {
        const pts = await computeRoute(o, d);
        setRouteCoords(pts);
        if (pts.length && mapRef.current) {
          mapRef.current.fitToCoordinates(pts, {
            edgePadding: { top: 60, bottom: 60, left: 40, right: 40 },
            animated: true,
          });
        } else if (mapRef.current && o) {
          mapRef.current.animateToRegion(
            { latitude: o.latitude, longitude: o.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 },
            500
          );
        }
      } catch {}
    }, 600);
    return () => { if (routeFetchTimer.current) clearTimeout(routeFetchTimer.current); };
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude]);

  // ====== RAINVIEWER: fetch/refresh frames every 3 min ======
  useEffect(() => {
    const fetchFrames = async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        const json: RainViewerData = await res.json();
        const list = [...(json.radar.past || []), ...(json.radar.nowcast || [])]
          .map((f) => f.time)
          .sort((a, b) => a - b);
        if (!list.length) return;
        setFrames(list);
      } catch {}
    };
    fetchFrames();
    radarRefreshTimer.current = setInterval(fetchFrames, 3 * 60 * 1000);
    return () => radarRefreshTimer.current && clearInterval(radarRefreshTimer.current);
  }, []);

  // Slider (minutes offset) → closest available frame timestamp
  const selectedTs = useMemo(() => {
    if (!frames.length) return undefined;
    const nowSec = Math.floor(Date.now() / 1000);
    const target = nowSec + sliderOffsetMin * 60; // sliderOffsetMin ≤ 0
    const idx = closestFrameIndex(frames, target);
    return idx >= 0 ? frames[idx] : undefined;
  }, [frames, sliderOffsetMin]);

  const radarUrlTemplate =
    selectedTs !== undefined
      ? `https://tilecache.rainviewer.com/v2/radar/${selectedTs}/256/{z}/{x}/{y}/2/1_1.png`
      : undefined;

  // Labels for bottom UI
  const liveClock = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const selectedDate = selectedTs ? new Date(selectedTs * 1000) : null;
  const frameLabel = selectedDate
    ? selectedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
  const deltaMin = selectedDate ? Math.round((selectedDate.getTime() - now.getTime()) / 60000) : 0;
  const deltaLabel = deltaMin === 0 ? "now" : `${deltaMin} min`;

  if (loading || !destination) {
    return (
      <View style={[styles.center, styles.container]}>
        <Text>{loading ? "Locating…" : "Missing destination"}</Text>
      </View>
    );
  }

  const initialRegion: Region = {
    latitude: origin?.latitude ?? destination.latitude,
    longitude: origin?.longitude ?? destination.longitude,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        followsUserLocation={false}
        showsMyLocationButton={Platform.OS === "android"}
      >
        {radarEnabled && radarUrlTemplate && (
          <UrlTile
            urlTemplate={radarUrlTemplate}
            zIndex={10}          // keep radar below route
            opacity={radarOpacity}
            maximumZ={12}        // ensures visibility at deep zoom
            tileSize={256}
          />
        )}

        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={5} strokeColor="#007AFF" zIndex={20} />
        )}

        <Marker
          coordinate={destination}
          title={typeof destName === "string" ? decodeURIComponent(destName) : "Destination"}
          pinColor="red"
        />
      </MapView>

      {/* Top: thinner controls (no time here) */}
      <View style={styles.topWrap}>
        <View style={styles.controls}>
          <Pressable
            style={[styles.btn, radarEnabled ? styles.btnOn : styles.btnOff]}
            onPress={() => setRadarEnabled((v) => !v)}
          >
            <Text style={styles.btnText}>{radarEnabled ? "Radar: ON" : "Radar: OFF"}</Text>
          </Pressable>

          <View style={styles.row}>
            <Pressable
              style={styles.smallBtn}
              onPress={() => setRadarOpacity((o) => Math.max(0, +(o - 0.1).toFixed(2)))}
              disabled={!radarEnabled}
            >
              <Text style={styles.smallBtnText}>–</Text>
            </Pressable>
            <Text style={styles.opacityLabel}>{Math.round(radarOpacity * 100)}%</Text>
            <Pressable
              style={styles.smallBtn}
              onPress={() => setRadarOpacity((o) => Math.min(1, +(o + 0.1).toFixed(2)))}
              disabled={!radarEnabled}
            >
              <Text style={styles.smallBtnText}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Bottom: past-only slider + times */}
      <View style={styles.bottomWrap}>
        <View style={styles.sliderWrap}>
          <Text style={styles.sliderLabel}>Past 2h  ←  Time  →  now</Text>

          <Slider
            style={styles.slider}
            value={sliderOffsetMin}
            onValueChange={(n: number) => setSliderOffsetMin(Math.round(n))}
            minimumValue={MIN_OFFSET}
            maximumValue={MAX_OFFSET}
            step={1}
            minimumTrackTintColor="#007AFF"
            maximumTrackTintColor="#c7c7cc"
            thumbTintColor="#007AFF"
          />

          <View style={styles.timebar}>
            <Text style={styles.liveText}>● Live {liveClock}</Text>
            <Text style={styles.subText}>Frame: {frameLabel} ({deltaLabel})</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { justifyContent: "center", alignItems: "center" },

  // Thinner, screen-fitting top bar
  topWrap: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
  },
  controls: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 88,
    alignItems: "center",
  },
  btnOn: { backgroundColor: "#00796b" },
  btnOff: { backgroundColor: "#9e9e9e" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  smallBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "#607d8b",
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  opacityLabel: { minWidth: 40, textAlign: "center", fontWeight: "700", color: "#111", fontSize: 12 },

  bottomWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
    paddingHorizontal: 12,
  },
  sliderWrap: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sliderLabel: {
    textAlign: "center",
    marginBottom: 6,
    color: "#111",
    fontWeight: "600",
    fontSize: 13,
  },
  slider: { width: "100%", height: 30 },

  timebar: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  liveText: { fontSize: 12, fontWeight: "700", color: "#1b5e20" },
  subText: { fontSize: 11, color: "#333" },
});
