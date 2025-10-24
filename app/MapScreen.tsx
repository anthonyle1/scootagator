// app/MapScreen.tsx
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Alert, StyleSheet } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const { userLat, userLng, destLat, destLng, destName, startRoute } =
    useLocalSearchParams();

  const [showRoute, setShowRoute] = useState(startRoute === "true");
  const [routeCoords, setRouteCoords] = useState<any[]>([]);

  const userLocation = {
    latitude: parseFloat(userLat as string) || 0,
    longitude: parseFloat(userLng as string) || 0,
  };

  const destination = {
    latitude: parseFloat(destLat as string) || 0,
    longitude: parseFloat(destLng as string) || 0,
  };

  // Ask user if they want to start navigation
  useEffect(() => {
    if (showRoute) {
      Alert.alert(
        "Start Route?",
        `Do you want to start navigation to ${destName}?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => router.back() },
          {
            text: "Start",
            onPress: () => {
              fetchRoute();
            },
          },
        ]
      );
    }
  }, [showRoute]);

  // Fetch the polyline path between origin and destination
  const fetchRoute = async () => {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${userLocation.latitude},${userLocation.longitude}&destination=${destination.latitude},${destination.longitude}&key=${GOOGLE_MAPS_APIKEY}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.routes.length) {
        const points = decodePolyline(json.routes[0].overview_polyline.points);
        setRouteCoords(points);

        // Zoom to fit route
        mapRef.current?.fitToCoordinates(points, {
          edgePadding: { top: 80, bottom: 80, left: 50, right: 50 },
          animated: true,
        });
      } else {
        Alert.alert("No route found", "Could not generate directions.");
      }
    } catch (error) {
      console.warn("Error fetching directions:", error);
      Alert.alert("Error", "Failed to fetch route.");
    }
  };

  // Decode Google polyline into coordinate array
  const decodePolyline = (t: string) => {
    let points = [];
    let index = 0,
      lat = 0,
      lng = 0;

    while (index < t.length) {
      let b,
        shift = 0,
        result = 0;
      do {
        b = t.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = t.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push({
        latitude: lat / 1e5,
        longitude: lng / 1e5,
      });
    }

    return points;
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: userLocation.latitude || 37.78825,
          longitude: userLocation.longitude || -122.4324,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        <Marker
          coordinate={userLocation}
          title="Your Location"
          pinColor="blue"
        />
        <Marker
          coordinate={destination}
          title={destName as string}
          pinColor="red"
        />
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeWidth={5}
            strokeColor="#007AFF"
          />
        )}
      </MapView>
      <View style={styles.overlay}>
        <Text style={styles.destText}>Destination: {destName}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  destText: { fontSize: 16, fontWeight: "600", color: "#111" },
});
