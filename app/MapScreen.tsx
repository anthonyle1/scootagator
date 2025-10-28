// app/MapScreen.tsx
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import MapView, { Marker, Polyline, LatLng, Region, UrlTile } from "react-native-maps";
import { useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";

const GOOGLE_MAPS_APIKEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

type Coords = LatLng;

type RainViewerData = {
  radar: { past: { time: number }[]; nowcast: { time: number }[] };
};

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const routeFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { destLat, destLng, destName } = useLocalSearchParams();

  const [origin, setOrigin] = useState<Coords | null>(null);
  const [destination] = useState<Coords | null>(() => {
    const lat = Number(destLat);
    const lng = Number(destLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  });
  const [routeCoords, setRouteCoords] = useState<Coords[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Radar state ---
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.6); // 0..1
  const [frames, setFrames] = useState<number[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const radarLoopTimer = useRef<NodeJS.Timeout | null>(null);
  const radarRefreshTimer = useRef<NodeJS.Timeout | null>(null);

  // ====== LOCATION (initial + live) ======
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLoading(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setOrigin({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } finally {
        setLoading(false);
      }
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

  // ====== ROUTE (debounced on origin/destination changes) ======
  useEffect(() => {
    if (!origin || !destination || !GOOGLE_MAPS_APIKEY) return;
    if (routeFetchTimer.current) clearTimeout(routeFetchTimer.current);
    routeFetchTimer.current = setTimeout(() => {
      computeRoute(origin, destination)
        .then((pts) => {
          setRouteCoords(pts);
          if (pts.length && mapRef.current) {
            mapRef.current.fitToCoordinates(pts, {
              edgePadding: { top: 60, bottom: 60, left: 40, right: 40 },
              animated: true,
            });
          } else if (mapRef.current) {
            mapRef.current.animateToRegion(
              { latitude: origin.latitude, longitude: origin.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 },
              500
            );
          }
        })
        .catch(() => {});
    }, 600);
    return () => {
      if (routeFetchTimer.current) clearTimeout(routeFetchTimer.current);
    };
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude]);

  // ====== RAINVIEWER: fetch frames list (every 3 min) ======
  useEffect(() => {
    const fetchFrames = async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        const json: RainViewerData = await res.json();
        const list = [...(json.radar.past || []), ...(json.radar.nowcast || [])].map((f) => f.time);
        if (list.length) {
          setFrames(list);
          setFrameIndex(list.length - 1); // latest frame
        }
      } catch {
        // ignore
      }
    };
    fetchFrames();
    radarRefreshTimer.current = setInterval(fetchFrames, 3 * 60 * 1000); // refresh timestamps every 3 min
    return () => radarRefreshTimer.current && clearInterval(radarRefreshTimer.current);
  }, []);

  // ====== RAIN LOOP TIMER ======
  useEffect(() => {
    if (!radarEnabled || !frames.length || !playing) {
      if (radarLoopTimer.current) {
        clearInterval(radarLoopTimer.current);
        radarLoopTimer.current = null;
      }
      return;
    }
    radarLoopTimer.current = setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, 500); // animation speed
    return () => {
      if (radarLoopTimer.current) clearInterval(radarLoopTimer.current);
    };
  }, [radarEnabled, frames, playing]);

  // ====== HELPERS ======
  const computeRoute = async (from: Coords, to: Coords): Promise<Coords[]> => {
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
    const json = await res.json();
    const encoded = json?.routes?.[0]?.polyline?.encodedPolyline;
    return encoded ? decodePolyline(encoded) : [];
  };

  const decodePolyline = (t: string): Coords[] => {
    const out: Coords[] = [];
    let index = 0, lat = 0, lng = 0;
    while (index < t.length) {
      let b, shift = 0, result = 0;
      do { b = t.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const dlat = (result & 1) ? ~(result >> 1) : result >> 1; lat += dlat;
      shift = 0; result = 0;
      do { b = t.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const dlng = (result & 1) ? ~(result >> 1) : result >> 1; lng += dlng;
      out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return out;
  };

  // Build RainViewer URL for the current frame
  const radarUrlTemplate = frames.length
    ? `https://tilecache.rainviewer.com/v2/radar/${frames[frameIndex]}/256/{z}/{x}/{y}/2/1_1.png`
    : undefined;

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
        {/* Weather radar tiles on top of the basemap */}
        {radarEnabled && radarUrlTemplate && (
          <UrlTile
            /**
             * RainViewer tiles are PNG with transparent background.
             * This overlays radar echoes over the base map.
             */
            urlTemplate={radarUrlTemplate}
            zIndex={10}
            opacity={radarOpacity}
            maximumZ={18} // radar tiles available up to ~12
            tileSize={256}
          />
        )}

        {/* Route polyline + destination marker */}
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={5} strokeColor="#007AFF" zIndex={20} />
        )}
        <Marker
          coordinate={destination}
          title={typeof destName === "string" ? decodeURIComponent(destName) : "Destination"}
          pinColor="red"
        />
      </MapView>

      {/* Simple overlay controls */}
      <View style={styles.controls}>
        <Pressable style={[styles.btn, radarEnabled ? styles.btnOn : styles.btnOff]} onPress={() => setRadarEnabled((v) => !v)}>
          <Text style={styles.btnText}>{radarEnabled ? "Radar: ON" : "Radar: OFF"}</Text>
        </Pressable>

        <Pressable style={[styles.btn, styles.btnNeutral]} onPress={() => setPlaying((p) => !p)} disabled={!radarEnabled || !frames.length}>
          <Text style={styles.btnText}>{playing ? "Pause" : "Play"}</Text>
        </Pressable>

        <View style={styles.row}>
          <Pressable
            style={[styles.smallBtn]}
            onPress={() => setRadarOpacity((o) => Math.max(0, +(o - 0.1).toFixed(2)))}
            disabled={!radarEnabled}
          >
            <Text style={styles.smallBtnText}>–</Text>
          </Pressable>
          <Text style={styles.opacityLabel}>{Math.round(radarOpacity * 100)}%</Text>
          <Pressable
            style={[styles.smallBtn]}
            onPress={() => setRadarOpacity((o) => Math.min(1, +(o + 0.1).toFixed(2)))}
            disabled={!radarEnabled}
          >
            <Text style={styles.smallBtnText}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { justifyContent: "center", alignItems: "center" },

  controls: {
    position: "absolute",
    top: 56,
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 100,
    alignItems: "center",
  },
  btnOn: { backgroundColor: "#00796b" },
  btnOff: { backgroundColor: "#9e9e9e" },
  btnNeutral: { backgroundColor: "#3f51b5" },
  btnText: { color: "#fff", fontWeight: "700" },

  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#607d8b",
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  opacityLabel: { minWidth: 44, textAlign: "center", fontWeight: "700", color: "#111" },
});
