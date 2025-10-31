// app/index.tsx
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  ActivityIndicator,
  View,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import SearchInput from "./components/SearchInput";
import Weather from "../backend/weather";

const GOOGLE_MAPS_APIKEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

type RouteItem = { id: string; name: string; lat?: number; lng?: number };

const GRID_COLUMNS = 3;
const ITEM_MARGIN = 8;

export default function Index() {
  const router = useRouter();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [customRoutes, setCustomRoutes] = useState<RouteItem[]>([]);
  const [previousRoutes, setPreviousRoutes] = useState<RouteItem[]>([]);
  const [showAddRouteMenu, setShowAddRouteMenu] = useState(false);
  const [cardWidth, setCardWidth] = useState(0);

  // ✅ Get current location
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
      } catch {
        alert("Error fetching location");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handlePlaceSelected = async (place: { place_id: string; description: string }) => {
    if (!coords) return;
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&key=${GOOGLE_MAPS_APIKEY}`
      );
      const json = await res.json();
      const loc = json?.result?.geometry?.location;
      if (!loc) return alert("Unable to fetch location details");

      setPreviousRoutes((prev) => {
        const updated = [
          { id: Date.now().toString(), name: place.description, lat: loc.lat, lng: loc.lng },
          ...prev.filter((r) => r.name !== place.description),
        ];
        return updated.slice(0, 10);
      });

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
    } catch {
      alert("Failed to fetch place details");
    }
  };

  const handleRoutePress = (item: RouteItem) => {
    if (item.id === "add") return setShowAddRouteMenu(true);
    if (!coords || item.lat === undefined || item.lng === undefined)
      return alert("Route coordinates not set");

    setPreviousRoutes((prev) => {
      const updated = [
        { id: Date.now().toString(), name: item.name, lat: item.lat, lng: item.lng },
        ...prev.filter((r) => r.name !== item.name),
      ];
      return updated.slice(0, 10);
    });

    router.push({
      pathname: "/MapScreen",
      params: {
        userLat: String(coords.lat),
        userLng: String(coords.lng),
        destLat: String(item.lat),
        destLng: String(item.lng),
        destName: encodeURIComponent(item.name),
        startRoute: "true",
      },
    });
  };

  const renderRouteItem = ({ item }: { item: RouteItem }) => {
    const maxItemWidth = 100;
    const calculatedWidth = cardWidth
      ? (cardWidth - ITEM_MARGIN * (GRID_COLUMNS - 1)) / GRID_COLUMNS
      : 0;
    const itemWidth = Math.min(calculatedWidth, maxItemWidth);

    return (
      <View style={{ margin: ITEM_MARGIN / 2 }}>
        <TouchableOpacity
          style={[styles.gridItem, { width: itemWidth, aspectRatio: 1 }]}
          onPress={() => handleRoutePress(item)}
        >
          <Text style={styles.gridItemText}>{item.name}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const savedRoutes = [...customRoutes, { id: "add", name: "Add a Route" }];

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={[{ key: "content" }]}
        renderItem={() => (
          <View
            style={styles.card}
            onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}
          >
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

            {showAddRouteMenu && (
              <View style={[styles.card, styles.addRouteCard]}>
                <Text style={styles.sectionTitle}>Add a New Route</Text>
                <SearchInput
                  apiKey={GOOGLE_MAPS_APIKEY}
                  onPlaceSelected={async (place) => {
                    try {
                      const res = await fetch(
                        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&key=${GOOGLE_MAPS_APIKEY}`
                      );
                      const json = await res.json();
                      const loc = json?.result?.geometry?.location;
                      if (!loc) return alert("Unable to fetch location details");

                      const newRoute: RouteItem = {
                        id: String(Date.now()),
                        name: place.description,
                        lat: loc.lat,
                        lng: loc.lng,
                      };

                      setCustomRoutes([...customRoutes, newRoute]);
                      setShowAddRouteMenu(false);
                    } catch {
                      alert("Failed to fetch location details");
                    }
                  }}
                  placeholder="Search a location to add..."
                />
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setShowAddRouteMenu(false)}
                >
                  <Text style={{ color: "#007AFF", fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Saved routes:</Text>
              {customRoutes.length > 0 && (
                <TouchableOpacity
                  style={styles.removeRouteButton}
                  onPress={() => {
                    Alert.alert(
                      "Remove a Route",
                      "Which route do you want to remove?",
                      customRoutes
                        .map((route) => ({
                          text: route.name,
                          onPress: () =>
                            setCustomRoutes(customRoutes.filter((r) => r.id !== route.id)),
                        }))
                        .concat({ text: "Cancel", style: "cancel" }),
                      { cancelable: true }
                    );
                  }}
                >
                  <Text style={styles.removeRouteText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={savedRoutes}
              renderItem={renderRouteItem}
              keyExtractor={(item) => item.id}
              numColumns={GRID_COLUMNS}
              scrollEnabled={false}
            />

            <Text style={styles.sectionTitle}>Previous routes:</Text>
            <FlatList
              data={previousRoutes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.previousRouteItem}
                  onPress={() => handleRoutePress(item)}
                >
                  <Text style={styles.previousRouteText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              scrollEnabled
              showsVerticalScrollIndicator
              style={styles.previousRoutesList}
            />
          </View>
        )}
        keyExtractor={(item) => item.key}
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
        contentContainerStyle={styles.scrollContainer}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#333" },
  scrollContainer: { padding: 15, paddingBottom: 50 },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
    overflow: "hidden",
  },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 20, color: "#111" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: "600", color: "#222" },
  gridItem: {
    margin: ITEM_MARGIN / 5,
    backgroundColor: "#e0e0e0",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    maxWidth: 100,
    flex: 1,
  },
  gridItemText: { fontSize: 12, fontWeight: "600", color: "#555", textAlign: "center" },
  weatherContainer: {
    backgroundColor: "rgba(124, 170, 255, 0.8)",
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(100, 149, 237, 0.2)",
  },
  addRouteCard: { backgroundColor: "#f5f5f5", marginBottom: 15 },
  cancelButton: { marginTop: 10, alignSelf: "flex-end" },
  removeRouteButton: {
    backgroundColor: "red",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  removeRouteText: { color: "white", fontWeight: "600", fontSize: 13 },
  previousRoutesList: { maxHeight: 200 },
  previousRouteItem: {
    backgroundColor: "#d0d0d0",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  previousRouteText: { fontSize: 14, fontWeight: "600", color: "#333" },
});
