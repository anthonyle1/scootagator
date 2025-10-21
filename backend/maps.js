// Maps.js
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import MapView, { Marker } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";

const GOOGLE_MAPS_APIKEY = "AIzaSyD9lU1bVMGBm77wCVZf6jKiFGe8FB6MlX8"; // OUR API KEY

export default function Maps({ setFrom, setTo }) {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null); // { distanceKm, durationMin }
  const [distanceUnit, setDistanceUnit] = useState("metric"); // 'metric' or 'imperial'
  const [durationFormat, setDurationFormat] = useState("hm"); // 'hm' (hours+mins) or 'min' (minutes)
  const mapRef = useRef();

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          console.warn("Location permission denied");
          return;
        }
        const loc = await Location.getCurrentPositionAsync({});
        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setCurrentLocation(coords);
        if (setFrom) setFrom(coords);
        // CENTER MAP
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.animateToRegion(
              { ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 },
              500
            );
          }
        }, 200);
      } catch (err) {
        console.error("Location error:", err);
      }
    })();
  }, [setFrom]);

  // MAP ON-TAP SET DESTINATION HANDLER
  const handleMapPress = (e) => {
    const coords = e.nativeEvent.coordinate;
    setDestination(coords);
    if (setTo) setTo(coords);
    setRouteInfo(null);
  };

  // MAPVIEWDIRECTIONS ONREADY HANDLER
  const handleDirectionsReady = (result) => {
    // result.distance = kilometers (float)
    // result.duration = minutes (float)
    setRouteInfo({
      distanceKm: result.distance,
      durationMin: result.duration,
    });
  };

  // CONVERSIONS AND FORMATTING
  const kmToMiles = (km) => km * 0.621371;
  const minsToHoursString = (minutes) => {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formattedDistance = () => {
    if (!routeInfo) return "--";
    return distanceUnit === "metric"
      ? `${routeInfo.distanceKm.toFixed(2)} km`
      : `${kmToMiles(routeInfo.distanceKm).toFixed(2)} mi`;
  };

  const formattedDuration = () => {
    if (!routeInfo) return "--";
    if (durationFormat === "hm") {
      return `${minsToHoursString(routeInfo.durationMin)} (${Math.round(
        routeInfo.durationMin
      )} min)`;
    }
    // RAW MINS
    return `${Math.round(routeInfo.durationMin)} min`;
  };

  return (
    <View style={styles.container}>
      {/* AUTOCOMPLETE SEARCH BAR */}
      <View style={styles.searchContainer} pointerEvents="box-none">
        <GooglePlacesAutocomplete
          placeholder="Search places"
          fetchDetails={true}
          onPress={(data, details = null) => {
            if (!details || !details.geometry) return;
            const lat = details.geometry.location.lat;
            const lng = details.geometry.location.lng;
            const coords = { latitude: lat, longitude: lng };
            setDestination(coords);
            if (setTo) setTo(coords);
            setRouteInfo(null);
            if (mapRef.current) {
              mapRef.current.animateToRegion(
                { ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 },
                400
              );
            }
          }}
          query={{
            key: GOOGLE_MAPS_APIKEY,
            language: "en",
          }}
          styles={{
            container: { flex: 0 },
            textInputContainer: {
              backgroundColor: "rgba(255,255,255,0.95)",
              borderRadius: 8,
              marginHorizontal: 12,
              marginTop: Platform.OS === "ios" ? 50 : 12,
              shadowColor: "#000",
              shadowOpacity: 0.1,
              shadowRadius: 6,
              elevation: 2,
            },
            textInput: { height: 44, color: "#333", fontSize: 16 },
            listView: { backgroundColor: "#fff" },
          }}
        />
      </View>

      {/* MAP */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: currentLocation?.latitude || 40.7128,
          longitude: currentLocation?.longitude || -74.006,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onPress={handleMapPress}
        showsUserLocation={true}
      >
        {currentLocation && (
          <Marker coordinate={currentLocation} title="You" pinColor="blue" />
        )}
        {destination && (
          <Marker coordinate={destination} title="Destination" pinColor="red" />
        )}

        {currentLocation && destination && (
          <MapViewDirections
            origin={currentLocation}
            destination={destination}
            apikey={GOOGLE_MAPS_APIKEY}
            strokeWidth={5}
            strokeColor="#4285F4"
            optimizeWaypoints={true}
            onReady={handleDirectionsReady}
            onError={(err) => console.warn("Directions error:", err)}
          />
        )}
      </MapView>

      {/* CONTROLS */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.unitBtn}
          onPress={() =>
            setDistanceUnit((u) => (u === "metric" ? "imperial" : "metric"))
          }
        >
          <Text style={styles.unitBtnText}>
            {distanceUnit === "metric" ? "Show mi" : "Show km"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.unitBtn, { marginTop: 8 }]}
          onPress={() =>
            setDurationFormat((f) => (f === "hm" ? "min" : "hm"))
          }
        >
          <Text style={styles.unitBtnText}>
            {durationFormat === "hm" ? "Show minutes" : "Show h/m"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.recenterBtn}
          onPress={() => {
            if (currentLocation && mapRef.current) {
              mapRef.current.animateToRegion(
                {
                  ...currentLocation,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                },
                500
              );
            }
          }}
        >
          <Text style={{ color: "white", fontWeight: "600" }}>⟳</Text>
        </TouchableOpacity>
      </View>

      {/* ROUTE INFO */}
      {routeInfo && (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Route</Text>
          <Text style={styles.infoText}>Distance: {formattedDistance()}</Text>
          <Text style={styles.infoText}>Duration: {formattedDuration()}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchContainer: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  controls: {
    position: "absolute",
    top: Platform.OS === "ios" ? 140 : 100,
    right: 12,
    zIndex: 21,
    alignItems: "center",
  },
  unitBtn: {
    backgroundColor: "#333",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    elevation: 3,
  },
  unitBtnText: { color: "white", fontWeight: "600" },
  recenterBtn: {
    marginTop: 12,
    backgroundColor: "#333",
    padding: 10,
    borderRadius: 24,
    elevation: 4,
  },
  infoCard: {
    position: "absolute",
    bottom: 20,
    left: 12,
    right: 12,
    backgroundColor: "white",
    borderRadius: 8,
    padding: 12,
    elevation: 6,
    zIndex: 20,
  },
  infoTitle: { fontWeight: "700", marginBottom: 6 },
  infoText: { fontSize: 15, marginVertical: 2 },
});