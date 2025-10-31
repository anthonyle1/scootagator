// app/MapScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  Image,
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

type Coords = LatLng;

/** ===== Tunables ===== */
const MAX_NATIVE_Z = 12;                // RainViewer native max zoom
const MAP_MAX_Z = 22;                   // allow deep zoom; tiles upscale
const TILE_SIZE_IOS = 256;              // iOS: safer with 256
const TILE_SIZE_ANDROID = 512;          // Android: crisp with 512
const NEIGHBOR_RADIUS = 1;              // 3x3 neighborhood
const PREFETCH_Z_SPREAD = [0, -1];      // prefetch zClamp and zClamp-1
const CONCURRENCY = 8;                  // prefetch pool size
const PREFETCH_DEBOUNCE_MS = 150;       // debounce region/frame prefetch
const MAX_FRAMES_TO_CACHE = 18;         // ~last 2h at ~6-10min cadence
const ANIM_MS = 2500;                   // playback speed (slower = bigger number)
const WARM_START_THRESHOLD = 0.85;      // start playing once 85% cached

/** ===== Helpers ===== */
function pad2(n: number) { return String(n).padStart(2, "0"); }

function decodePolyline(t: string): Coords[] {
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
  let json: any = null; try { json = await res.json(); } catch {}
  const encoded = json?.routes?.[0]?.polyline?.encodedPolyline;
  return encoded ? decodePolyline(encoded) : [];
}

function closestFrameIndex(frames: number[], target: number) {
  if (!frames.length) return -1;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (frames[mid] < target) lo = mid + 1; else hi = mid; }
  const a = lo, b = Math.max(0, lo - 1);
  return Math.abs(frames[a] - target) < Math.abs(frames[b] - target) ? a : b;
}

function regionToZoom(r: Region) { return Math.max(0, Math.log2(360 / r.longitudeDelta)); }
function lngLatToTile(lon: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y, z };
}
function tileUrl(ts: number, z: number, x: number, y: number, size = 256) {
  return `https://tilecache.rainviewer.com/v2/radar/${ts}/${size}/${z}/${x}/${y}/2/1_1.png`;
}

/** ===== Simple tile cache + concurrency-limited prefetch queue ===== */
const tileCache = new Set<string>();
async function prefetchUrlOnce(url: string) {
  if (tileCache.has(url)) return true;
  const ok = await Image.prefetch(url).catch(() => false);
  if (ok) tileCache.add(url);
  return ok;
}
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency = CONCURRENCY, onProgress?: (done: number, total: number) => void) {
  let i = 0, done = 0;
  const total = tasks.length;
  const results: Promise<T>[] = [];
  const workers = new Array(Math.min(concurrency, tasks.length)).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = tasks[idx]().finally(() => { done += 1; onProgress?.(done, total); });
      await results[idx].catch(() => undefined);
    }
  });
  await Promise.all(workers);
  return Promise.allSettled(results);
}

/** ===== Component ===== */
export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const routeFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const radarRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefetchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { destLat, destLng, destName } = useLocalSearchParams();

  const [destination] = useState<Coords | null>(() => {
    const lat = Number(destLat), lng = Number(destLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  });

  const [origin, setOrigin] = useState<Coords | null>(null);
  const [routeCoords, setRouteCoords] = useState<Coords[]>([]);
  const [loading, setLoading] = useState(true);

  // radar states
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.6);

  // frames + indexing
  const [frames, setFrames] = useState<number[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);

  // timestamps
  const [activeTs, setActiveTs] = useState<number | undefined>(undefined);
  const [desiredTs, setDesiredTs] = useState<number | undefined>(undefined);

  // region (for prefetch + clamp)
  const [region, setRegion] = useState<Region | null>(null);

  // loading state
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);

  // playback + warm-up
  const [isPlaying, setIsPlaying] = useState(false);
  const [warming, setWarming] = useState(false);
  const [warmProgress, setWarmProgress] = useState(0);
  const lastWarmSig = useRef<string | null>(null);

  // clock (UI nicety)
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // location: initial + watch
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
    return () => { sub?.remove(); };
  }, []);

  // route compute (debounced)
  useEffect(() => {
    if (!origin || !destination || !GOOGLE_MAPS_APIKEY) return;
    if (routeFetchTimer.current) { clearTimeout(routeFetchTimer.current); routeFetchTimer.current = null; }
    const o = origin, d = destination;

    routeFetchTimer.current = setTimeout(async () => {
      try {
        const pts = await computeRoute(o, d);
        setRouteCoords(pts);
        const initialRegion: Region = { latitude: o.latitude, longitude: o.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 };
        if (pts.length && mapRef.current) {
          mapRef.current.fitToCoordinates(pts, { edgePadding: { top: 60, bottom: 60, left: 40, right: 40 }, animated: true });
        } else if (mapRef.current) {
          mapRef.current.animateToRegion(initialRegion, 500);
        }
        setRegion((r) => r ?? initialRegion);
      } catch {}
    }, 600);

    return () => { if (routeFetchTimer.current) { clearTimeout(routeFetchTimer.current); routeFetchTimer.current = null; } };
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude]);

  // frames fetch/refresh
  useEffect(() => {
    const fetchFrames = async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!res.ok) return;
        const json: any = await res.json().catch(() => null);
        const past = Array.isArray(json?.radar?.past) ? json.radar.past : [];
        const nowcast = Array.isArray(json?.radar?.nowcast) ? json.radar.nowcast : [];
        const merged = [...past, ...nowcast]
          .map((f) => Number((f as any)?.time))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        if (!merged.length) return;
        setFrames(merged);

        if (activeTs === undefined) {
          const nowSec = Math.floor(Date.now() / 1000);
          const idx = closestFrameIndex(merged, nowSec);
          const ts = idx >= 0 ? merged[idx] : undefined;
          setActiveTs(ts);
          setDesiredTs(ts);
          setFrameIdx(Math.max(0, idx));
        }
      } catch {}
    };
    fetchFrames();
    radarRefreshTimer.current = setInterval(fetchFrames, 3 * 60 * 1000);
    return () => { if (radarRefreshTimer.current) { clearInterval(radarRefreshTimer.current); radarRefreshTimer.current = null; } };
  }, []);

  // window frames (last 2h)
  const windowFrames = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const twoHoursAgo = nowSec - 120 * 60;
    const w = frames.filter(ts => ts >= twoHoursAgo && ts <= nowSec);
    return w.slice(-MAX_FRAMES_TO_CACHE);
  }, [frames]);

  // keep frameIdx valid when window updates
  useEffect(() => {
    if (!windowFrames.length) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const idx = closestFrameIndex(windowFrames, nowSec);
    setFrameIdx(Math.max(0, Math.min(idx, windowFrames.length - 1)));
  }, [windowFrames]);

  // commit desiredTs from frameIdx changes
  useEffect(() => {
    if (!windowFrames.length) return;
    const idx = Math.max(0, Math.min(frameIdx, windowFrames.length - 1));
    setDesiredTs(windowFrames[idx]);
  }, [frameIdx, windowFrames]);

  /** ===== Prefetch helpers ===== */
  const TILE_SIZE = Platform.OS === "ios" ? TILE_SIZE_IOS : TILE_SIZE_ANDROID;

  const schedulePrefetchAll = (r: Region | null, framesToPrefetch: number[]) => {
    if (!r || !framesToPrefetch.length) return;
    if (prefetchDebounce.current) { clearTimeout(prefetchDebounce.current); prefetchDebounce.current = null; }

    prefetchDebounce.current = setTimeout(async () => {
      const zApprox = Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(r))));
      const base = lngLatToTile(r.longitude, r.latitude, zApprox);

      const tasks: Array<() => Promise<unknown>> = [];
      for (const ts of framesToPrefetch) {
        for (const dz of PREFETCH_Z_SPREAD) {
          const z = Math.max(0, Math.min(MAX_NATIVE_Z, base.z + dz));
          for (let dx = -NEIGHBOR_RADIUS; dx <= NEIGHBOR_RADIUS; dx++) {
            for (let dy = -NEIGHBOR_RADIUS; dy <= NEIGHBOR_RADIUS; dy++) {
              const x = base.x + dx, y = base.y + dy;
              const url = tileUrl(ts, z, x, y, TILE_SIZE);
              tasks.push(() => prefetchUrlOnce(url));
            }
          }
        }
      }
      await runWithConcurrency(tasks, CONCURRENCY);
    }, PREFETCH_DEBOUNCE_MS);
  };

  // prefetch when region or windowFrames change
  useEffect(() => { schedulePrefetchAll(region, windowFrames); }, [region, windowFrames]);

  // prefetch desiredTs neighborhood; swap when ready
  useEffect(() => {
    if (!desiredTs) return;
    if (!region) { setActiveTs(desiredTs); return; }

    setIsLoadingFrame(true);
    const zClamp = Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(region))));
    const base = lngLatToTile(region.longitude, region.latitude, zClamp);

    const urls: string[] = [];
    for (const dz of PREFETCH_Z_SPREAD) {
      const z = Math.max(0, Math.min(MAX_NATIVE_Z, base.z + dz));
      for (let dx = -NEIGHBOR_RADIUS; dx <= NEIGHBOR_RADIUS; dx++) {
        for (let dy = -NEIGHBOR_RADIUS; dy <= NEIGHBOR_RADIUS; dy++) {
          const x = base.x + dx, y = base.y + dy;
          urls.push(tileUrl(desiredTs, z, x, y, TILE_SIZE));
        }
      }
    }

    const tasks = urls.map(u => () => prefetchUrlOnce(u));
    runWithConcurrency(tasks, CONCURRENCY).finally(() => {
      setActiveTs(desiredTs);
      setIsLoadingFrame(false);
    });

    return () => setIsLoadingFrame(false);
  }, [desiredTs, region]);

  /** ===== Playback warm-up ===== */
  function warmSignature(r: Region | null, framesList: number[], tileSize: number) {
    if (!r || !framesList.length) return null;
    const zClamp = Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(r))));
    const key = `${tileSize}|${zClamp}|${framesList[0]}-${framesList[framesList.length - 1]}|${Math.round(r.latitude * 1000)},${Math.round(r.longitude * 1000)}`;
    return key;
  }

  async function warmPlaybackCache(r: Region, framesList: number[]) {
    const zClamp = Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(r))));
    const base = lngLatToTile(r.longitude, r.latitude, zClamp);

    const urls: string[] = [];
    for (const ts of framesList) {
      for (const dz of PREFETCH_Z_SPREAD) {
        const z = Math.max(0, Math.min(MAX_NATIVE_Z, base.z + dz));
        for (let dx = -NEIGHBOR_RADIUS; dx <= NEIGHBOR_RADIUS; dx++) {
          for (let dy = -NEIGHBOR_RADIUS; dy <= NEIGHBOR_RADIUS; dy++) {
            const x = base.x + dx, y = base.y + dy;
            urls.push(tileUrl(ts, z, x, y, TILE_SIZE));
          }
        }
      }
    }

    setWarming(true);
    setWarmProgress(0);
    await runWithConcurrency(
      urls.map(u => () => prefetchUrlOnce(u)),
      CONCURRENCY,
      (done, total) => setWarmProgress(done / total)
    );
    setWarming(false);
    setWarmProgress(1);
  }

  // playback timer (always forward, loop at end)
  useEffect(() => {
    if (!isPlaying || windowFrames.length < 2) {
      if (animTimer.current) { clearInterval(animTimer.current); animTimer.current = null; }
      return;
    }
    if (animTimer.current) clearInterval(animTimer.current);

    animTimer.current = setInterval(() => {
      setFrameIdx(prev => {
        const last = windowFrames.length - 1;
        return prev >= last ? 0 : prev + 1;
      });
    }, ANIM_MS);

    return () => {
      if (animTimer.current) { clearInterval(animTimer.current); animTimer.current = null; }
    };
  }, [isPlaying, windowFrames.length]);

  // labels
  const liveClock = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const shownIdx = pendingIdx ?? frameIdx;
  const shownTs = windowFrames[shownIdx] ?? activeTs;
  const selectedDate = shownTs ? new Date(shownTs * 1000) : null;
  const frameLabel = selectedDate ? selectedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const deltaMin = selectedDate ? Math.round((selectedDate.getTime() - now.getTime()) / 60000) : 0;

  if (loading || !destination) {
    return <View style={[styles.center, styles.container]}><Text>{loading ? "Locating…" : "Missing destination"}</Text></View>;
  }

  const initialRegion: Region = {
    latitude: origin?.latitude ?? destination.latitude,
    longitude: origin?.longitude ?? destination.longitude,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  // Android: Google Maps TileOverlay uses 'transparency' (0..1). iOS uses 'opacity' (0..1).
  const androidTransparency = 1 - Math.max(0, Math.min(1, radarOpacity));
  const urlTileCommonProps: any = {
    maximumNativeZ: MAX_NATIVE_Z,
    maximumZ: MAP_MAX_Z,
    tileSize: TILE_SIZE,
    zIndex: 999,
    shouldReplaceMapContent: false,
  };

  // handle pressing Play with warm-up gate
  const onPressPlay = async () => {
    if (!region || windowFrames.length < 2) return;
    const sig = warmSignature(region, windowFrames, TILE_SIZE);
    if (sig && sig === lastWarmSig.current) {
      setIsPlaying(p => !p);
      return;
    }
    setIsPlaying(false);
    await warmPlaybackCache(region, windowFrames);
    lastWarmSig.current = sig;
    if (warmProgress >= WARM_START_THRESHOLD) setIsPlaying(true);
  };

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        onRegionChangeComplete={(r) => setRegion(r)}
        showsUserLocation
        followsUserLocation={false}
        showsMyLocationButton={Platform.OS === "android"}
        maxZoomLevel={MAP_MAX_Z}
      >
        {radarEnabled && activeTs && (
          <UrlTile
            key={`${activeTs}-${TILE_SIZE}-${Math.round(radarOpacity * 100)}`}
            urlTemplate={`https://tilecache.rainviewer.com/v2/radar/${activeTs}/${TILE_SIZE}/{z}/{x}/{y}/2/1_1.png`}
            {...urlTileCommonProps}
            opacity={Platform.OS === "ios" ? radarOpacity : 1}
            // @ts-ignore
            tileOverlayTransparency={Platform.OS === "android" ? androidTransparency : 0}
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

      {/* Top controls */}
      <View style={styles.topWrap}>
        <View style={styles.controls}>
          <Pressable style={[styles.btn, radarEnabled ? styles.btnOn : styles.btnOff]} onPress={() => setRadarEnabled(v => !v)}>
            <Text style={styles.btnText}>{radarEnabled ? "Radar: ON" : "Radar: OFF"}</Text>
          </Pressable>

          <View style={styles.row}>
            <Pressable style={styles.smallBtn} onPress={() => setRadarOpacity(o => Math.max(0, +(o - 0.1).toFixed(2)))} disabled={!radarEnabled}>
              <Text style={styles.smallBtnText}>–</Text>
            </Pressable>
            <Text style={styles.opacityLabel}>{Math.round(radarOpacity * 100)}%</Text>
            <Pressable style={styles.smallBtn} onPress={() => setRadarOpacity(o => Math.min(1, +(o + 0.1).toFixed(2)))} disabled={!radarEnabled}>
              <Text style={styles.smallBtnText}>+</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, (isPlaying || warming) ? styles.btnOn : styles.btnOff]}
              onPress={onPressPlay}
              disabled={!windowFrames.length || warming}
            >
              <Text style={styles.btnText}>
                {warming ? `Loading ${Math.round(warmProgress * 100)}%` : (isPlaying ? "Pause" : "Play")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Bottom slider (frame index) + times + loading) */}
      <View style={styles.bottomWrap}>
        <View style={styles.sliderWrap}>
          <Text style={styles.sliderLabel}>
            {windowFrames.length ? `Frames (last 2h): ${windowFrames.length}` : "Loading radar timeline…"}
          </Text>

          <Slider
            style={styles.slider}
            value={Math.min(pendingIdx ?? frameIdx, Math.max(0, windowFrames.length - 1))}
            onValueChange={(n: number) => setPendingIdx(Math.round(n))}
            onSlidingComplete={(n: number) => {
              const idx = Math.round(n);
              setPendingIdx(null);
              setIsPlaying(false);
              setFrameIdx(idx);
            }}
            minimumValue={0}
            maximumValue={Math.max(0, windowFrames.length - 1)}
            step={1}
            disabled={!windowFrames.length}
            minimumTrackTintColor="#007AFF"
            maximumTrackTintColor="#c7c7cc"
            thumbTintColor="#007AFF"
          />

          <View style={styles.timebar}>
            <Text style={styles.liveText}>● Live {liveClock}</Text>
            <Text style={styles.subText}>
              Frame: {frameLabel} ({deltaMin === 0 ? "now" : `${deltaMin} min`})
            </Text>
          </View>

          {(isLoadingFrame || warming) && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>
                {warming ? `Warming playback cache… ${Math.round(warmProgress * 100)}%` : "Fetching weather radar frame…"}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** ===== styles ===== */
const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { justifyContent: "center", alignItems: "center" },

  topWrap: { position: "absolute", top: 10, left: 10, right: 10 },
  controls: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    flexWrap: "wrap", gap: 6,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  btn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 88, alignItems: "center" },
  btnOn: { backgroundColor: "#00796b" }, btnOff: { backgroundColor: "#9e9e9e" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  smallBtn: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#607d8b",
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  opacityLabel: { minWidth: 40, textAlign: "center", fontWeight: "700", color: "#111", fontSize: 12, marginHorizontal: 4 },

  bottomWrap: { position: "absolute", left: 0, right: 0, bottom: 18, paddingHorizontal: 12 },
  sliderWrap: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  sliderLabel: { textAlign: "center", marginBottom: 6, color: "#111", fontWeight: "600", fontSize: 13 },
  slider: { width: "100%", height: 30 },

  timebar: { marginTop: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  liveText: { fontSize: 12, fontWeight: "700", color: "#1b5e20" },
  subText: { fontSize: 11, color: "#333" },

  loadingRow: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  loadingText: { marginLeft: 6, fontSize: 12, color: "#111", fontWeight: "600" },
});
