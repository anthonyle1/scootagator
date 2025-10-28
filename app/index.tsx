import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  StatusBar,
  ActivityIndicator,
  View,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import SearchInput from "./components/SearchInput";
import Weather from "../backend/weather";
const GOOGLE_MAPS_APIKEY = process.env.GOOGLE_MAPS_APIKEY as string;

const savedRoutes = [
  { id: "1", name: "Reitz Union" },
  { id: "2", name: "Marston Science Library" },
  { id: "3", name: "Newell Hall" },
  { id: "4", name: "Century Tower" },
  { id: "5", name: "O'Connell Center" },
  { id: "6", name: "The Hub" },
];

type RouteItem = { id: string; name: string };

export default function Index() {
  const router = useRouter();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // Get current location
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          alert("Please enable location access to use this feature.");
          setLoading(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({});
        setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch (e) {
        alert("Error fetching location");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // When a place is selected
  const handlePlaceSelected = async (place: { place_id: string; description: string }) => {
    if (!coords) return;

    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&key=${GOOGLE_MAPS_APIKEY}`
      );
      const json = await res.json();
      const loc = json?.result?.geometry?.location;
      if (!loc) return alert("Unable to fetch location details");

      // Navigate safely (encode the name)
      router.push({
        pathname: "/MapScreen",
        params: {
          userLat: String(coords.lat),
          userLng: String(coords.lng),
          destLat: String(loc.lat),
          destLng: String(loc.lng),
          destName: encodeURIComponent(place.description),
          startRoute: "true",
        },
      });
    } catch (e) {
      console.warn("Error fetching place details:", e);
      alert("Failed to fetch place details");
    }
  };

  const renderRouteItem = ({ item }: { item: RouteItem }) => (
    <View style={styles.gridItem}>
      <Text style={styles.gridItemText}>{item.name}</Text>
    </View>
  );

  return (
  <SafeAreaView style={styles.safeArea}>
    <FlatList
      data={[]}
      keyExtractor={() => "layout"}
      contentContainerStyle={styles.scrollContainer}
      ListHeaderComponent={
        <View style={styles.card}>
          <Text style={styles.title}>Where are you going today?</Text>

          {loading ? (
            <ActivityIndicator size="large" color="#007AFF" />
          ) : (
            <SearchInput
              apiKey={GOOGLE_MAPS_APIKEY}
              onPlaceSelected={handlePlaceSelected}
              placeholder="Search nearby places..."
            />
          )}

          <Text style={styles.sectionTitle}>Saved routes:</Text>
          <FlatList
            data={savedRoutes}
            renderItem={renderRouteItem}
            keyExtractor={(item) => item.id}
            numColumns={3}
            showsHorizontalScrollIndicator={false}
          />

          <Text style={styles.sectionTitle}>Previous routes:</Text>
          <View style={styles.largeBox} />
        </View>
      }
      ListFooterComponent={
        <View style={[styles.card, styles.weatherContainer]}>
          <Text style={styles.sectionTitle}>Your Local Weather</Text>
          {coords ? (
            <Weather lat={coords.lat} lng={coords.lng} label="Current Location" />
          ) : (
            <Text>Fetching location...</Text>
          )}
        </View>
      }
    />
  </SafeAreaView>
);

}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#333"},
  scrollContainer: { padding: 15 },
  card: { backgroundColor: "white", borderRadius: 12, padding: 20, marginBottom: 15 },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 20, color: "#111" },
  sectionTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12, color: "#222" },
  gridItem: {
    flex: 1,
    margin: 4,
    aspectRatio: 1,
    backgroundColor: "#e0e0e0",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  gridItemText: { fontSize: 12, fontWeight: "600", color: "#555", textAlign: "center" },
  largeBox: { height: 150, backgroundColor: "#e0e0e0", borderRadius: 8 },
  weatherContainer: {
    backgroundColor: "rgba(124, 170, 255, 0.8)",
    borderRadius: 18,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(100, 149, 237, 0.2)",
  },
});
