import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  FlatList,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import Weather from "../backend/weather";


// Hard-coded test data
const savedRoutes = [
  { id: '1', name: 'Reitz Union' },
  { id: '2', name: 'Marston Science Library' },
  { id: '3', name: 'Newell Hall' },
  { id: '4', name: 'Century Tower' },
  { id: '5', name: "O'Connell Center" },
  { id: '6', name: 'The Hub' },
];

type routeItem = {
  id: string;
  name: string;
};

export default function Index() {
  const [searchQuery, setSearchQuery] = useState("");
  const [coords, setCoords] = useState(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      let loc = await Location.getCurrentPositionAsync({});
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    })();
  }, []);

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    router.push({
      pathname: "/search",
      params: { query: searchQuery }
    });
  };

  const renderRouteItem = ({ item }: { item: routeItem }) => (
    <View style={styles.gridItem}>
      <Text style={styles.gridItemText}>{item.name}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.card}>
          <Text style={styles.title}>Where are you going today?</Text>

          <TextInput
            style={styles.searchBar}
            placeholder="search"
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
          />

          <Text style={styles.sectionTitle}>saved routes:</Text>
          <FlatList
            data={savedRoutes}
            renderItem={renderRouteItem}
            keyExtractor={(item) => item.id}
            numColumns={5}
            showsHorizontalScrollIndicator={false}
          />

          <Text style={styles.sectionTitle}>previous routes:</Text>
          <View style={styles.largeBox} />
        </View>

        <View style={[styles.card, styles.weatherContainer]}>
          <Text style={styles.sectionTitle}>Upcoming Weather</Text>
          {coords ? (
            <Weather
              lat={coords.lat}
              lng={coords.lng}
              label="Current Location"
            />
          ) : (
            <Text>Fetching location...</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#333', 
    paddingTop: StatusBar.currentHeight, 
  },
  scrollContainer: {
    padding: 15,
  },
  header: {
    fontSize: 18,
    color: '#fff',
    marginBottom: 10,
    marginLeft: 5,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#111',
  },
  searchBar: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 15,
    fontSize: 16,
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#222',
  },
  horizontalList: {
    flexDirection: 'row',
    justifyContent: 'space-between', 
  },
  smallBox: {
    width: '30%', 
    aspectRatio: 1, 
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
  },
  largeBox: {
    height: 150,
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
  },
    weatherContainer: {
    backgroundColor: 'rgba(124, 170, 255, 0.8)',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    backdropFilter: 'blur(10px)', 
    borderWidth: 1,
    borderColor: 'rgba(100, 149, 237, 0.2)',
  },
  gridItem: {
    flex: 1,
    margin: 4,
    aspectRatio: 1,
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
  },
});
