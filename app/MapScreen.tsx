import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  ActivityIndicator, 
} from "react-native";
import MapView, {
  Marker,
  Polyline,
  LatLng,
  Region,
  UrlTile,
  PROVIDER_GOOGLE, 
} from "react-native-maps";
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

/**
 * 🚨 DANGER: API KEY IS EXPOSED ON THE CLIENT
 *
 * This function is still using the API key in the app.
 * For a real application, you MUST move this entire function to a secure
 * backend (like a serverless function) and call that backend from your app.
 *
 * Do not ship your app with this code as-is.
 */
async function computeRoute(from: Coords, to: Coords): Promise<Coords[]> {
  // 🚨 TODO: MOVE THIS ENTIRE BLOCK TO A BACKEND FUNCTION
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_APIKEY, // 🚨 INSECURE
      "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } },
      destination: { location: { latLng: { latitude: to.latitude, longitude: to.longitude } } },
      travelMode: "BICYCLE", // ⬅️ Changed from "DRIVE"
      routingPreference: "TRAFFIC_AWARE",
    }),
  });
  // 🚨 END OF TODO BLOCK

  let json: any = null;
  try { json = await res.json(); } catch {}
  const encoded = json?.routes?.[0]?.polyline?.encodedPolyline;
  return encoded ? decodePolyline(encoded) : [];
}

/**
 * Custom hook to manage fetching and storing route directions.
 * Fetches the route only once when origin and destination are available.
 */
function useDirections(origin: Coords | null, destination: Coords | null) {
  const [routeCoords, setRouteCoords] = useState<Coords[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchAttempted = useRef(false); // ⬅️ NEW: Use a ref to track fetch attempt

  useEffect(() => {
    // Check for API key *before* anything else.
    if (!GOOGLE_MAPS_APIKEY) {
      console.warn("Google Maps API key is missing. Route will not be fetched.");
      return; // ⬅️ Return early, isLoading is still false.
    }

    // ⬇️ MODIFIED CHECK
    // Only fetch if we have origin, destination, AND we haven't attempted a fetch yet.
    if (!origin || !destination || fetchAttempted.current) {
      return;
    }

    let isAborted = false;

    const fetchRoute = async () => {
      setIsLoading(true); // ⬅️ Set loading
      fetchAttempted.current = true; // ⬅️ Mark as attempted immediately (and synchronously)
      try {
        const pts = await computeRoute(origin, destination);
        if (!isAborted) {
          setRouteCoords(pts);
          if (pts.length === 0) {
            console.warn("Route fetch returned no coordinates. Check Google API response/quota.");
          }
        }
      } catch (e) {
        console.error("Error fetching route:", e);
      } finally {
        if (!isAborted) {
          setIsLoading(false);
        }
      }
    };

    fetchRoute();

    return () => {
      isAborted = true;
    };
    // ⬇️ We only want this to run when origin/destination change.
    // The ref will block subsequent runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination]);

  return { routeCoords, isLoadingRoute: isLoading };
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
  // const routeFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // ⬅️ Removed
  const radarRefreshTimer = useRef<NodeJS.Timeout | null>(null);

  const { destLat, destLng, destName } = useLocalSearchParams();

  // Destination from params
  const [destination] = useState<Coords | null>(() => {
    const lat = Number(destLat);
    const lng = Number(destLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  });

  // User location
  const [origin, setOrigin] = useState<Coords | null>(null);
  const [loading, setLoading] = useState(true);
  
  // ⬇️ Route state now comes from our hook
  const { routeCoords, isLoadingRoute } = useDirections(origin, destination);
  // const [routeCoords, setRouteCoords] = useState<Coords[]>([]); // ⬅️ Removed

  // ---- Radar state ----
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.6);
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

  // ⬇️ REMOVED THE watchPositionAsync useEffect ⬇️
  // This was causing constant re-renders and likely re-triggering the hook's logic,
  // creating a "stuck" state. We only need the origin *once*.
  // The map's `showsUserLocation` prop will handle the live blue dot.

  // ⬅️ Removed the entire debounced route-fetching useEffect block
  
  // ⬇️ NEW: This effect will zoom the map to the route *after* it loads
  useEffect(() => {
    if (routeCoords.length > 0 && mapRef.current) {
      try {
        mapRef.current.fitToCoordinates(routeCoords, {
          edgePadding: { top: 60, bottom: 150, left: 40, right: 40 }, // ⬅️ Added more bottom padding
          animated: true,
        });
      } catch (e) {
        console.error("Error fitting map to coordinates:", e);
      }
    }
  }, [routeCoords]); // This runs only when routeCoords changes from [] to [...]

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

  // ... (Your existing radar logic remains unchanged)
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
        provider={PROVIDER_GOOGLE} // ⬅️ Added
        initialRegion={initialRegion}
        showsUserLocation
        followsUserLocation={false}
        showsMyLocationButton={Platform.OS === "android"}
      >
        {radarEnabled && radarUrlTemplate && (
          <UrlTile
            urlTemplate={radarUrlTemplate}
            zIndex={10}
            opacity={radarOpacity}
            maximumZ={12}
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

      {/* ... (Your existing Top controls) */}
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

          {/* ⬇️ NEW: Loading indicator for the route fetch ⬇️ */}
          {isLoadingRoute && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>Fetching bicycle route…</Text>
            </View>
          )}
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

  // ... (Your existing topWrap, controls, btn, etc. styles)
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

  // ... (Your existing bottomWrap, sliderWrap, etc. styles)
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

  // ⬇️ NEW: Styles for the loading indicator
  loadingRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 12,
    color: "#111",
    fontWeight: "600",
  },
});

