import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SearchPage() {
  const { query } = useLocalSearchParams();
  
  const router = useRouter();

  const handleArrivedPress = () => {
    router.push('/arrival'); 
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.header}>Search Results</Text>
        <Text style={styles.queryText}>
          You searched for: <Text style={styles.query}>{query}</Text>
        </Text>

        <TouchableOpacity 
          style={styles.arrivedButton} 
          onPress={handleArrivedPress}
        >
          <Text style={styles.buttonText}>Arrived!</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 0.1,
    backgroundColor: "#f0f0f0",
  },
  content: {
    padding: 20,
    flex: 1, 
    justifyContent: 'space-between', 
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  queryText: {
    fontSize: 18,
  },
  query: {
    fontWeight: "bold",
    color: "#007AFF",
  },
  arrivedButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center', 
    marginTop: 20, 
    alignSelf: 'stretch', 
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});