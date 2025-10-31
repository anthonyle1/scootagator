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
  LayoutChangeEvent,
} from "react-native";
import MapView, {
  Marker,
  Polyline,
  LatLng,
  Region,
  UrlTile,
  PROVIDER_GOOGLE,
  Callout,
  CalloutSubview,
} from "react-native-maps";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import Slider from "@react-native-community/slider";
import racksGeoJSON from "../assets/data/uf_bike_racks_with_busy.json";

const GOOGLE_MAPS_APIKEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

/** ===== Types ===== */
type Coords = LatLng;
type RackFeature = {
  type: "Feature";
  properties: {
    OBJECTID?: number | null;
    RackID?: string | null;
    RackType?: string | null;
    BikeCapacity?: number | null;
    RackOwner?: string | null;
    RackNotes?: string | null;
    BRCondition?: string | null;
    Cover?: number | null;
    busy?: {
      level: "LOW" | "MEDIUM" | "HIGH";
      occupancy?: number | null;
      updatedAt?: string | null;
      confidence?: number | null;
    };
  };
  geometry: { type: "Point"; coordinates: [number, number] };
};
type BikeRack = {
  id: string | number;
  latitude: number;
  longitude: number;
  props: RackFeature["properties"];
};

/** ===== Tunables ===== */
const MAX_NATIVE_Z = 12;
const MAP_MAX_Z = 22;
const TILE_SIZE = 256;
const NEIGHBOR_RADIUS = 1;
const PREFETCH_Z_SPREAD = [0, -1];
const CONCURRENCY = 8;
const PREFETCH_DEBOUNCE_MS = 150;
const MAX_FRAMES_TO_CACHE = 18;
const ANIM_MS = 2500; // playback speed (ms per frame)
const WARM_START_THRESHOLD = 0.85;
const NEARBY_RACK_RADIUS_M = 350;

/** ===== Helpers ===== */
function pad2(n: number) { return String(n).padStart(2, "0"); }
function haversineMeters(a:{latitude:number;longitude:number}, b:{latitude:number;longitude:number}) {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI/180;
  const dLon = (b.longitude - a.longitude) * Math.PI/180;
  const lat1 = a.latitude * Math.PI/180, lat2 = b.latitude * Math.PI/180;
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
}
function decodePolyline(t: string): Coords[] {
  const out: Coords[] = []; let i=0, lat=0, lng=0;
  while (i<t.length) {
    let b, shift=0, result=0;
    do { b=t.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; } while (b>=0x20);
    const dlat=(result&1)?~(result>>1):(result>>1); lat+=dlat;
    shift=0; result=0;
    do { b=t.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; } while (b>=0x20);
    const dlng=(result&1)?~(result>>1):(result>>1); lng+=dlng;
    out.push({latitude:lat/1e5, longitude:lng/1e5});
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
  let json:any=null; try{ json=await res.json(); }catch{}
  const enc=json?.routes?.[0]?.polyline?.encodedPolyline;
  return enc ? decodePolyline(enc) : [];
}
function closestFrameIndex(frames:number[], target:number){
  if(!frames.length) return -1; let lo=0, hi=frames.length-1;
  while(lo<hi){ const mid=(lo+hi)>>1; if(frames[mid]<target) lo=mid+1; else hi=mid; }
  const a=lo, b=Math.max(0, lo-1);
  return Math.abs(frames[a]-target)<Math.abs(frames[b]-target)?a:b;
}
function regionToZoom(r:Region){ return Math.max(0, Math.log2(360/r.longitudeDelta)); }
function lngLatToTile(lon:number, lat:number, z:number){
  const n=Math.pow(2,z);
  const x=Math.floor(((lon+180)/360)*n);
  const latRad=(lat*Math.PI)/180;
  const y=Math.floor((1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2*n);
  return {x,y,z};
}
function tileUrl(ts:number, z:number, x:number, y:number, size=256){
  return `https://tilecache.rainviewer.com/v2/radar/${ts}/${size}/${z}/${x}/${y}/2/1_1.png`;
}

/** ===== Simple cache + prefetch ===== */
const tileCache = new Set<string>();
async function prefetchUrlOnce(url:string){
  if(tileCache.has(url)) return true;
  const ok = await Image.prefetch(url).catch(()=>false);
  if(ok) tileCache.add(url);
  return ok;
}
async function runWithConcurrency<T>(tasks:Array<()=>Promise<T>>, concurrency=CONCURRENCY, onProgress?:(d:number,t:number)=>void){
  let i=0, done=0; const total=tasks.length; const results:Promise<T>[]=[];
  const workers=new Array(Math.min(concurrency, tasks.length)).fill(0).map(async()=>{
    while(i<tasks.length){
      const idx=i++; results[idx]=tasks[idx]().finally(()=>{ done+=1; onProgress?.(done,total); });
      await results[idx].catch(()=>undefined);
    }
  });
  await Promise.all(workers);
  return Promise.allSettled(results);
}

/** ===== Component ===== */
export default function MapScreen(){
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const routeFetchTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const radarRefreshTimer = useRef<ReturnType<typeof setInterval>|null>(null);
  const prefetchDebounce = useRef<ReturnType<typeof setTimeout>|null>(null);
  const animTimer = useRef<ReturnType<typeof setInterval>|null>(null);

  const { destLat, destLng, destName } = useLocalSearchParams();

  // Destination is now MUTABLE so we can switch to a rack
  const [destination, setDestination] = useState<Coords|null>(() => {
    const lat=Number(destLat), lng=Number(destLng);
    return Number.isFinite(lat)&&Number.isFinite(lng)?{latitude:lat, longitude:lng}:null;
  });
  const [destLabel, setDestLabel] = useState<string>(() =>
    typeof destName === "string" ? decodeURIComponent(destName) : "Destination"
  );

  // Keep the original/main destination always pinned
  const [mainDestination] = useState<Coords|null>(() => {
    const lat=Number(destLat), lng=Number(destLng);
    return Number.isFinite(lat)&&Number.isFinite(lng)?{latitude:lat, longitude:lng}:null;
  });
  const [mainDestLabel] = useState<string>(() =>
    typeof destName === "string" ? decodeURIComponent(destName) : "Destination"
  );

  const [origin, setOrigin] = useState<Coords|null>(null);
  const [routeCoords, setRouteCoords] = useState<Coords[]>([]);
  const [loading, setLoading] = useState(true);

  const [radarEnabled, setRadarEnabled] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.5);

  const [frames, setFrames] = useState<number[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [pendingIdx, setPendingIdx] = useState<number|null>(null);

  const [activeTs, setActiveTs] = useState<number|undefined>(undefined);
  const [desiredTs, setDesiredTs] = useState<number|undefined>(undefined);

  const [region, setRegion] = useState<Region|null>(null);
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [warming, setWarming] = useState(false);
  const [warmProgress, setWarmProgress] = useState(0);
  const lastWarmSig = useRef<string|null>(null);

  const racks:BikeRack[] = useMemo(()=>{
    const feats=(racksGeoJSON?.features ?? []) as RackFeature[];
    return feats.map(f=>({
      id: f.properties.OBJECTID ?? f.properties.RackID ?? f.geometry.coordinates.join(","),
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
      props: f.properties,
    }));
  },[]);
  const [filterNotBusy] = useState(false);
  const [nearbyRacks, setNearbyRacks] = useState<BikeRack[]>([]);

  // Track Marker refs so we can hide callouts programmatically
  const markerRefs = useRef<Record<string | number, any>>({});

  // UI layout state
  const [showTimeline, setShowTimeline] = useState(false);
  const [dockHeight, setDockHeight] = useState(0);
  const [timelineHeight, setTimelineHeight] = useState(0);
  const [fabHeight, setFabHeight] = useState(0);

  const [now, setNow] = useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()), 1000); return ()=>clearInterval(t); },[]);

  useEffect(()=>{
    (async()=>{
      try{
        const { status } = await Location.requestForegroundPermissionsAsync();
        if(status!=="granted"){ setLoading(false); return; }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setOrigin({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } finally { setLoading(false); }
    })();
  },[]);
  useEffect(()=>{
    let sub: Location.LocationSubscription|undefined;
    (async()=>{
      const { status } = await Location.getForegroundPermissionsAsync();
      if(status!=="granted") return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 2000, distanceInterval: 5 },
        (loc)=>setOrigin({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      );
    })();
    return ()=>{ sub?.remove(); };
  },[]);

  // Recompute route whenever origin or destination change
  useEffect(()=>{
    if(!origin || !destination || !GOOGLE_MAPS_APIKEY) return;
    if(routeFetchTimer.current){ clearTimeout(routeFetchTimer.current); routeFetchTimer.current=null; }
    const o=origin, d=destination;
    routeFetchTimer.current=setTimeout(async()=>{
      try{
        const pts=await computeRoute(o,d);
        setRouteCoords(pts);
        const initial:Region={ latitude:o.latitude, longitude:o.longitude, latitudeDelta:0.02, longitudeDelta:0.02 };
        if(pts.length && mapRef.current){
          mapRef.current.fitToCoordinates(pts,{ edgePadding:{top:60,bottom:60,left:40,right:40}, animated:true });
        } else if (mapRef.current){
          mapRef.current.animateToRegion(initial, 500);
        }
        setRegion(r=>r ?? initial);
      }catch{}
    },600);
    return ()=>{ if(routeFetchTimer.current){ clearTimeout(routeFetchTimer.current); routeFetchTimer.current=null; } };
  },[origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude]);

  useEffect(()=>{
    const fetchFrames=async()=>{
      try{
        const res=await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if(!res.ok) return;
        const json:any = await res.json().catch(()=>null);
        const past = Array.isArray(json?.radar?.past)?json.radar.past:[];
        const nowcast = Array.isArray(json?.radar?.nowcast)?json.radar.nowcast:[];
        const merged=[...past,...nowcast].map((f:any)=>Number(f?.time))
          .filter((n)=>Number.isFinite(n)).sort((a,b)=>a-b);
        if(!merged.length) return;
        setFrames(merged);
        if(activeTs===undefined){
          const nowSec=Math.floor(Date.now()/1000);
          const idx=closestFrameIndex(merged, nowSec);
          const ts=idx>=0?merged[idx]:undefined;
          setActiveTs(ts); setDesiredTs(ts); setFrameIdx(Math.max(0, idx));
        }
      }catch{}
    };
    fetchFrames();
    radarRefreshTimer.current=setInterval(fetchFrames, 3*60*1000);
    return ()=>{ if(radarRefreshTimer.current){ clearInterval(radarRefreshTimer.current); radarRefreshTimer.current=null; } };
  },[]);

  const windowFrames = useMemo(()=>{
    const nowSec=Math.floor(Date.now()/1000);
    const twoHoursAgo=nowSec-120*60;
    const w=frames.filter(ts=>ts>=twoHoursAgo && ts<=nowSec);
    return w.slice(-MAX_FRAMES_TO_CACHE);
  },[frames]);

  useEffect(()=>{
    if(!windowFrames.length) return;
    const nowSec=Math.floor(Date.now()/1000);
    const idx=closestFrameIndex(windowFrames, nowSec);
    setFrameIdx(Math.max(0, Math.min(idx, windowFrames.length-1)));
  },[windowFrames]);

  useEffect(()=>{
    if(!windowFrames.length) return;
    const idx=Math.max(0, Math.min(frameIdx, windowFrames.length-1));
    setDesiredTs(windowFrames[idx]);
  },[frameIdx, windowFrames]);

  const schedulePrefetchAll=(r:Region|null, framesToPrefetch:number[])=>{
    if(!r || !framesToPrefetch.length) return;
    if(prefetchDebounce.current){ clearTimeout(prefetchDebounce.current); prefetchDebounce.current=null; }
    prefetchDebounce.current=setTimeout(async()=>{
      const zApprox=Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(r))));
      const base=lngLatToTile(r.longitude, r.latitude, zApprox);
      const tasks:Array<()=>Promise<unknown>>=[];
      for(const ts of framesToPrefetch){
        for(const dz of PREFETCH_Z_SPREAD){
          const z=Math.max(0, Math.min(MAX_NATIVE_Z, base.z+dz));
          for(let dx=-NEIGHBOR_RADIUS; dx<=NEIGHBOR_RADIUS; dx++){
            for(let dy=-NEIGHBOR_RADIUS; dy<=NEIGHBOR_RADIUS; dy++){
              const x=base.x+dx, y=base.y+dy;
              tasks.push(()=>prefetchUrlOnce(tileUrl(ts, z, x, y, TILE_SIZE)));
            }
          }
        }
      }
      await runWithConcurrency(tasks, CONCURRENCY);
    }, PREFETCH_DEBOUNCE_MS);
  };
  useEffect(()=>{ schedulePrefetchAll(region, windowFrames); },[region, windowFrames]);

  useEffect(()=>{
    if(!desiredTs) return;
    if(!region){ setActiveTs(desiredTs); return; }
    setIsLoadingFrame(true);
    const zClamp=Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(region))));
    const base=lngLatToTile(region.longitude, region.latitude, zClamp);
    const urls:string[]=[];
    for(const dz of PREFETCH_Z_SPREAD){
      const z=Math.max(0, Math.min(MAX_NATIVE_Z, base.z+dz));
      for(let dx=-NEIGHBOR_RADIUS; dx<=NEIGHBOR_RADIUS; dx++){
        for(let dy=-NEIGHBOR_RADIUS; dy<=NEIGHBOR_RADIUS; dy++){
          urls.push(tileUrl(desiredTs, z, base.x+dx, base.y+dy, TILE_SIZE));
        }
      }
    }
    const tasks=urls.map(u=>()=>prefetchUrlOnce(u));
    runWithConcurrency(tasks, CONCURRENCY).finally(()=>{
      setActiveTs(desiredTs); setIsLoadingFrame(false);
    });
    return ()=>setIsLoadingFrame(false);
  },[desiredTs, region]);

  function warmSignature(r:Region|null, framesList:number[], tileSize:number){
    if(!r || !framesList.length) return null;
    const zClamp=Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(r))));
    return `${tileSize}|${zClamp}|${framesList[0]}-${framesList[framesList.length-1]}|${Math.round(r.latitude*1000)},${Math.round(r.longitude*1000)}`;
  }
  async function warmPlaybackCache(r:Region, framesList:number[]){
    const zClamp=Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(regionToZoom(r))));
    const base=lngLatToTile(r.longitude, r.latitude, zClamp);
    const urls:string[]=[];
    for(const ts of framesList){
      for(const dz of PREFETCH_Z_SPREAD){
        const z=Math.max(0, Math.min(MAX_NATIVE_Z, base.z+dz));
        for(let dx=-NEIGHBOR_RADIUS; dx<=NEIGHBOR_RADIUS; dx++){
          for(let dy=-NEIGHBOR_RADIUS; dy<=NEIGHBOR_RADIUS; dy++){
            urls.push(tileUrl(ts, z, base.x+dx, base.y+dy, TILE_SIZE));
          }
        }
      }
    }
    setWarming(true); setWarmProgress(0);
    await runWithConcurrency(urls.map(u=>()=>prefetchUrlOnce(u)), CONCURRENCY, (d,t)=>setWarmProgress(d/t));
    setWarming(false); setWarmProgress(1);
  }
  useEffect(()=>{
    if(!isPlaying || windowFrames.length<2){ if(animTimer.current){ clearInterval(animTimer.current); animTimer.current=null; } return; }
    if(animTimer.current) clearInterval(animTimer.current);
    animTimer.current=setInterval(()=>{
      setFrameIdx(prev=> prev>=windowFrames.length-1 ? 0 : prev+1);
    }, ANIM_MS);
    return ()=>{ if(animTimer.current){ clearInterval(animTimer.current); animTimer.current=null; } };
  },[isPlaying, windowFrames.length]);

  useEffect(()=>{
    if(!destination || !racks.length){ setNearbyRacks([]); return; }
    const near=racks.filter(r=>haversineMeters(destination,{latitude:r.latitude,longitude:r.longitude})<=NEARBY_RACK_RADIUS_M);
    setNearbyRacks(near);
  },[destination?.latitude, destination?.longitude, racks]);

  const liveClock = useMemo(()=> {
    const d=new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  },[now]);

  const shownIdx = pendingIdx ?? frameIdx;
  const shownTs = windowFrames[shownIdx] ?? activeTs;
  const selectedDate = shownTs ? new Date(shownTs*1000) : null;
  const frameLabel = selectedDate ? selectedDate.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "—";
  const deltaMin = selectedDate ? Math.round((selectedDate.getTime()-now.getTime())/60000) : 0;

  const visibleRacks = useMemo(()=>{
    return filterNotBusy
      ? racks.filter(r => (r.props.busy?.level ?? "LOW")==="LOW")
      : racks;
  },[filterNotBusy, racks]);

  const debugTileUrl = useMemo(()=>{
    if(!region || !activeTs) return null;
    const zApprox=Math.min(MAX_NATIVE_Z, Math.max(0, Math.round(Math.log2(360/region.longitudeDelta))));
    const n=Math.pow(2, zApprox);
    const x=Math.floor(((region.longitude+180)/360)*n);
    const latRad=(region.latitude*Math.PI)/180;
    const y=Math.floor((1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2*n);
    return `https://tilecache.rainviewer.com/v2/radar/${activeTs}/${TILE_SIZE}/${zApprox}/${x}/${y}/2/1_1.png`;
  },[region, activeTs]);

  if(loading || !destination){
    return <View style={[styles.center, styles.container]}><Text>{loading?"Locating…":"Missing destination"}</Text></View>;
  }

  const initialRegion:Region={
    latitude: origin?.latitude ?? destination.latitude,
    longitude: origin?.longitude ?? destination.longitude,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  const urlTileCommonProps:any={
    maximumNativeZ: MAX_NATIVE_Z,
    maximumZ: MAX_NATIVE_Z,
    tileSize: TILE_SIZE,
    zIndex: 0,
    shouldReplaceMapContent: false,
  };

  const onPressPlay=async()=>{
    if(!region || windowFrames.length<2) return;
    const sig=warmSignature(region, windowFrames, urlTileCommonProps.tileSize);
    if(sig && sig===lastWarmSig.current){ setIsPlaying(p=>!p); return; }
    setIsPlaying(false); await warmPlaybackCache(region, windowFrames);
    lastWarmSig.current=sig; if(warmProgress>=WARM_START_THRESHOLD) setIsPlaying(true);
  };

  function pinColorForBusy(level?:"LOW"|"MEDIUM"|"HIGH"){
    switch(level){ case "HIGH": return "#D32F2F"; case "MEDIUM": return "#FB8C00"; default: return "#2E7D32"; }
  }
  function formatBusy(r:BikeRack){
    const b=r.props.busy; if(!b) return "Busyness: unknown";
    const occ=typeof b.occupancy==="number"?` (${Math.round(b.occupancy*100)}%)`:"";
    const upd=b.updatedAt?`\nUpdated: ${new Date(b.updatedAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`:"";
    return `Busyness: ${b.level}${occ}${upd}`;
  }
  const stepOpacity=(delta:number)=>{
    setRadarOpacity(prev=> Math.min(1, Math.max(0.2, +(prev+delta).toFixed(2))));
  };

  const onDockLayout = (e: LayoutChangeEvent) => setDockHeight(e.nativeEvent.layout.height);

  // Compute FAB bottom: above timeline if open, else hover above dock
  const fabBottom = showTimeline
    ? dockHeight + (timelineHeight || 0) + 24
    : dockHeight + 20;

  // Switch navigation to a chosen rack (and close its callout)
  const navigateToRack = (r: BikeRack) => {
    // Close the callout for this rack
    markerRefs.current[r.id]?.hideCallout?.();
    // Navigate
    setDestination({ latitude: r.latitude, longitude: r.longitude });
    setDestLabel(r.props.RackID ? `Rack ${r.props.RackID}` : "Bike Rack");
  };

  // Speeds and formatting
  const BIKE_MPS = 4.5;     // ~16.2 km/h
  const SCOOTER_MPS = 6.7;  // ~24.1 km/h
  const formatMins = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;
  // Distance in miles
  const formatDistanceMi = (m:number) => `${(m / 1609.344).toFixed(2)} mi`;

  return (
    <View style={styles.container}>
      <MapView
        provider={Platform.OS==="android"?PROVIDER_GOOGLE:undefined}
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        onRegionChangeComplete={(r)=>setRegion(r)}
        showsUserLocation
        followsUserLocation={false}
        showsMyLocationButton={Platform.OS==="android"}
        maxZoomLevel={MAP_MAX_Z}
      >
        {radarEnabled && activeTs && (
          <UrlTile
            key={`${activeTs}-${urlTileCommonProps.tileSize}-${radarOpacity}`}
            urlTemplate={`https://tilecache.rainviewer.com/v2/radar/${activeTs}/${urlTileCommonProps.tileSize}/{z}/{x}/{y}/2/1_1.png`}
            {...urlTileCommonProps}
            opacity={Platform.OS==="ios"?radarOpacity:1}
            // @ts-ignore Android transparency (0 opaque .. 1 transparent)
            tileOverlayTransparency={Platform.OS==="android"? 1-radarOpacity : 0}
            zIndex={0}
          />
        )}

        {visibleRacks.map(r=>{
          // compute ETA if we have origin
          let etaLine: string | null = null;
          if (origin) {
            const dist = haversineMeters(origin, { latitude: r.latitude, longitude: r.longitude });
            const tBike = dist / BIKE_MPS;
            const tScoot = dist / SCOOTER_MPS;
            etaLine = `ETA: ${formatMins(tBike)} (bike) · ${formatMins(tScoot)} (scooter)`;
          }
          let fromMainLine: string | null = null;
          if (mainDestination) {
            const dMain = haversineMeters(mainDestination, { latitude: r.latitude, longitude: r.longitude });
            fromMainLine = `~ ${formatDistanceMi(dMain)} from ${mainDestLabel}`;
          }

          return (
            <Marker
              key={`rack-${r.id}`}
              ref={(ref)=> {
                if (ref) markerRefs.current[r.id] = ref;
                else delete markerRefs.current[r.id];
              }}
              coordinate={{ latitude:r.latitude, longitude:r.longitude }}
              title={r.props.RackID || "Bike Rack"}
              description={[
                r.props.RackType ? `Type: ${String(r.props.RackType)}` : "",
                Number.isFinite(r.props.BikeCapacity ?? null) ? `Capacity: ${r.props.BikeCapacity}` : "",
              ].filter(Boolean).join("\n")}
              pinColor={pinColorForBusy(r.props.busy?.level)}
              opacity={1}
              tracksViewChanges={false}
            >
              <Callout tooltip>
                <View style={styles.calloutBubble}>
                  <Text style={styles.calloutTitle}>{r.props.RackID || "Bike Rack"}</Text>
                  {!!r.props.RackType && <Text style={styles.calloutLine}>Type: {r.props.RackType}</Text>}
                  {Number.isFinite(r.props.BikeCapacity ?? null) && (
                    <Text style={styles.calloutLine}>Capacity: {r.props.BikeCapacity}</Text>
                  )}
                  {!!r.props.RackNotes && <Text style={styles.calloutLine}>Notes: {r.props.RackNotes}</Text>}
                  <Text style={styles.calloutLine}>{formatBusy(r)}</Text>
                  {etaLine && <Text style={styles.calloutEta}>{etaLine}</Text>}
                  {fromMainLine && <Text style={styles.calloutFromMain}>{fromMainLine}</Text>}

                  {/* Button pinned to bottom of the bubble */}
                  <CalloutSubview onPress={() => navigateToRack(r)}>
                    <View style={styles.calloutBtn}>
                      <Text style={styles.calloutBtnText}>Navigate here</Text>
                    </View>
                  </CalloutSubview>
                </View>
              </Callout>
            </Marker>
          );
        })}

        {/* Current destination pin */}
        {destination && (
          <Marker
            coordinate={destination}
            title={destLabel}
            pinColor="red"
            tracksViewChanges={false}
          />
        )}

        {/* Always show MAIN destination pin */}
        {mainDestination && (
          <Marker
            coordinate={mainDestination}
            title={`${mainDestLabel} (Main)`}
            pinColor="#FF0000"
            tracksViewChanges={false}
          />
        )}

        {routeCoords.length>0 && (
          <Polyline
            key={`route-${routeCoords[0]?.latitude ?? 0}-${routeCoords[0]?.longitude ?? 0}-${routeCoords[routeCoords.length-1]?.latitude ?? 0}-${routeCoords[routeCoords.length-1]?.longitude ?? 0}`}
            coordinates={routeCoords}
            strokeWidth={6}
            strokeColor="#007AFF"
            zIndex={9999}
          />
        )}
      </MapView>

      {/* Legend */}
      <View style={styles.legendFloating}>
        <View style={styles.legend}>
          <View style={[styles.dot,{backgroundColor:"#2E7D32"}]} />
          <Text style={styles.legendText}>Low</Text>
          <View style={[styles.dot,{backgroundColor:"#FB8C00"}]} />
          <Text style={styles.legendText}>Med</Text>
          <View style={[styles.dot,{backgroundColor:"#D32F2F"}]} />
          <Text style={styles.legendText}>High</Text>
        </View>
      </View>

      {/* Timeline */}
      {showTimeline && (
        <View
          style={[styles.timelineWrap, { bottom: dockHeight + 16 }]}
          onLayout={(e)=> setTimelineHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.sliderWrap}>
            <Text style={styles.sliderLabel}>
              {windowFrames.length?`Frames (last 2h): ${windowFrames.length}`:"Loading radar timeline…"}
            </Text>
            <Slider
              style={styles.slider}
              value={Math.min(pendingIdx ?? frameIdx, Math.max(0, windowFrames.length-1))}
              onValueChange={(n:number)=>setPendingIdx(Math.round(n))}
              onSlidingComplete={(n:number)=>{ const idx=Math.round(n); setPendingIdx(null); setIsPlaying(false); setFrameIdx(idx); }}
              minimumValue={0}
              maximumValue={Math.max(0, windowFrames.length-1)}
              step={1}
              disabled={!windowFrames.length}
              minimumTrackTintColor="#007AFF"
              maximumTrackTintColor="#c7c7cc"
              thumbTintColor="#007AFF"
            />
            <View style={styles.timebar}>
              <Text style={styles.liveText}>● Live {liveClock}</Text>
              <Text style={styles.subText}>Frame: {frameLabel} ({deltaMin===0?"now":`${deltaMin} min`})</Text>
            </View>
            {(isLoadingFrame || warming) && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small"/>
                <Text style={styles.loadingText}>
                  {warming?`Warming playback cache… ${Math.round(warmProgress*100)}%`:"Fetching weather radar frame…"}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Dock */}
      <View style={styles.dockWrap} onLayout={onDockLayout}>
        <View style={styles.controlsWrap}>
          <Pressable style={[styles.btn, radarEnabled ? styles.btnOn : styles.btnOff]} onPress={()=>setRadarEnabled(v=>!v)}>
            <Text style={styles.btnText}>{radarEnabled ? "Radar: ON" : "Radar: OFF"}</Text>
          </Pressable>

          <View style={styles.opacityGroup}>
            <Text style={styles.opacityLabel}>Opacity</Text>
            <Pressable style={styles.stepBtn} onPress={()=>stepOpacity(-0.1)}><Text style={styles.stepText}>–</Text></Pressable>
            <Text style={styles.opacityValue}>{Math.round(radarOpacity*100)}%</Text>
            <Pressable style={styles.stepBtn} onPress={()=>stepOpacity(+0.1)}><Text style={styles.stepText}>+</Text></Pressable>
          </View>

          <Pressable style={[styles.btn, (isPlaying||warming) ? styles.btnOn : styles.btnOff]} onPress={onPressPlay} disabled={!windowFrames.length || warming}>
            <Text style={styles.btnText}>{warming?`Warm ${Math.round(warmProgress*100)}%`:(isPlaying?"Pause":"Play")}</Text>
          </Pressable>

          <Pressable style={[styles.btn, showTimeline ? styles.btnOn : styles.btnOff]} onPress={()=>setShowTimeline(v=>!v)}>
            <Text style={styles.btnText}>{showTimeline ? "Timeline: ON" : "Timeline: OFF"}</Text>
          </Pressable>
        </View>
      </View>

      {/* Arrived FAB */}
      <View style={[styles.arriveFabContainer, { bottom: fabBottom }]}>
        <Pressable
          style={styles.arriveFab}
          onLayout={(e)=> setFabHeight(e.nativeEvent.layout.height)}
          onPress={() =>
            router.push({
              pathname: "/arrival",
              params: {
                latitude: destination!.latitude.toFixed(6),
                longitude: destination!.longitude.toFixed(6),
              },
            })
          }
        >
          <Text style={styles.arriveFabText}>Arrived</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** ===== styles ===== */
const styles = StyleSheet.create({
  container:{ flex:1 },
  map:{ flex:1 },
  center:{ justifyContent:"center", alignItems:"center" },

  // Bottom dock
  dockWrap:{ position:"absolute", left:10, right:10, bottom:16, zIndex:50 },
  controlsWrap:{
    flexDirection:"row",
    flexWrap:"wrap",
    alignItems:"center",
    gap:8,
    backgroundColor:"rgba(255,255,255,0.98)",
    paddingHorizontal:10, paddingVertical:8, borderRadius:12,
    shadowColor:"#000", shadowOpacity:0.12, shadowRadius:6, shadowOffset:{ width:0, height:2 },
  },

  btn:{ paddingHorizontal:10, paddingVertical:6, borderRadius:8, alignItems:"center", justifyContent:"center" },
  btnOn:{ backgroundColor:"#00796b" },
  btnOff:{ backgroundColor:"#9e9e9e" },
  btnText:{ color:"#fff", fontWeight:"700", fontSize:12 },

  // Callout action
  calloutBubble: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    maxWidth: 260,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  calloutTitle: { fontWeight: "700", fontSize: 14, marginBottom: 6, color: "#111" },
  calloutLine: { fontSize: 13, color: "#222", marginTop: 2 },
  calloutBtn:{
    marginTop:8,
    backgroundColor:"#304FFE",
    paddingHorizontal:12,
    paddingVertical:8,
    alignSelf:"flex-start",
    borderRadius:8,
  },
  calloutBtnText:{ color:"#fff", fontWeight:"700", fontSize:12 },

  // Arrive FAB
  arriveFabContainer:{ position:"absolute", left:0, right:0, alignItems:"center", zIndex:1000 },
  arriveFab:{
    paddingHorizontal:22,
    paddingVertical:12,
    backgroundColor:"#304FFE",
    borderRadius:24,
    shadowColor:"#000",
    shadowOpacity:0.2,
    shadowRadius:6,
    shadowOffset:{ width:0, height:3 },
    elevation:3,
  },
  arriveFabText:{ color:"#fff", fontWeight:"800" },

  // Opacity mini-control
  opacityGroup:{ flexDirection:"row", alignItems:"center", backgroundColor:"#f1f3f4", paddingHorizontal:8, paddingVertical:4, borderRadius:8 },
  opacityLabel:{ fontSize:12, fontWeight:"700", marginRight:6, color:"#111" },
  opacityValue:{ fontSize:12, fontWeight:"700", marginHorizontal:6, color:"#111", minWidth:36, textAlign:"center" },
  stepBtn:{ backgroundColor:"#e0e0e0", paddingHorizontal:8, paddingVertical:2, borderRadius:6, minWidth:28, alignItems:"center" },
  stepText:{ fontSize:14, fontWeight:"900", color:"#111" },

  legend:{ flexDirection:"row", alignItems:"center", gap:6, paddingHorizontal:8, paddingVertical:4, backgroundColor:"#f5f5f5", borderRadius:8 },
  dot:{ width:10, height:10, borderRadius:5 },
  legendText:{ fontSize:12, color:"#111" },
  legendFloating:{ position:"absolute", top:12, left:12, zIndex:200 },

  // Timeline
  timelineWrap:{ position:"absolute", left:12, right:12, zIndex:900 },
  sliderWrap:{
    alignSelf:"stretch",
    backgroundColor:"rgba(255,255,255,0.98)",
    paddingHorizontal:12, paddingVertical:10, borderRadius:12,
    shadowColor:"#000", shadowOpacity:0.12, shadowRadius:8, shadowOffset:{ width:0, height:2 },
  },
  sliderLabel:{ textAlign:"center", marginBottom:6, color:"#111", fontWeight:"600", fontSize:13 },
  slider:{ width:"100%", height:30 },
  timebar:{ marginTop:6, flexDirection:"row", justifyContent:"space-between", alignItems:"baseline" },
  liveText:{ fontSize:12, fontWeight:"700", color:"#1b5e20" },
  subText:{ fontSize:11, color:"#333" },
  loadingRow:{ marginTop:8, flexDirection:"row", alignItems:"center", justifyContent:"center" },
  loadingText:{ marginLeft:6, fontSize:12, color:"#111", fontWeight:"600" },

  calloutEta:{ fontSize:12, color:"#111", marginTop:6, fontStyle:"italic" },
  calloutFromMain:{ fontSize:12, color:"#111", marginTop:4 },
});
