import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SearchPage() {
  // Get the 'query' parameter we passed from the index page
  const { query } = useLocalSearchParams();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.header}>Search Results</Text>
        <Text style={styles.queryText}>
          You searched for: <Text style={styles.query}>{query}</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f0f0",
  },
  content: {
    padding: 20,
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
    color: "#007AFF", // A blue color to highlight the query
  },
});