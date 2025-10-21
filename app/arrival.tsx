import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ArrivalPage() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.header}>You Arrived!</Text>
        <Text style={styles.message}>How full was the parking?</Text>
        
        <Link href="/" style={styles.homeLink}>
           <Text>Exit</Text>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#e0f2f1", 
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  header: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 20,
    color: '#004d40',
  },
  message: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 40,
  },
  homeLink: {
    fontSize: 16,
    color: '#00796b',
    textDecorationLine: 'underline',
  }
});