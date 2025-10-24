// ArrivalPage.js
import { Link, useLocalSearchParams } from "expo-router";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Animated,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useRef } from "react";

import { db } from "../backend/firebase";
import { ref, push } from "firebase/database";

export default function ArrivalPage() {
  // Get latitude & longitude from router params
  const params = useLocalSearchParams();
  const latitude = Number(params.latitude);
  const longitude = Number(params.longitude);

  const [selected, setSelected] = useState(-1);
  const [submitted, setSubmitted] = useState(false);

  const colors = ["#4CAF50", "#8BC34A", "#FFEB3B", "#FFC107", "#F44336"];
  const animations = useRef(colors.map(() => new Animated.Value(1))).current;

  // Animate circle selection
  const handleSelect = (index) => {
    if (submitted) return;
    setSelected(index);

    Animated.sequence([
      Animated.spring(animations[index], {
        toValue: 1.25,
        speed: 10,
        bounciness: 12,
        useNativeDriver: true,
      }),
      Animated.spring(animations[index], {
        toValue: 1,
        speed: 10,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Button press animations
  const createPressAnim = () => new Animated.Value(1);
  const handlePressIn = (anim) =>
    Animated.spring(anim, { toValue: 0.95, useNativeDriver: true }).start();
  const handlePressOut = (anim) =>
    Animated.spring(anim, { toValue: 1, friction: 3, useNativeDriver: true }).start();

  const submitAnim = useRef(createPressAnim()).current;
  const exitAnim = useRef(createPressAnim()).current;

  // Submit rating to Firebase
  const handleSubmit = async () => {
    if (selected < 0) {
      Alert.alert("Please select a rating before submitting.");
      return;
    }
    setSubmitted(true);

    try {
      const ratingsRef = ref(db, "parking-feedback");
      await push(ratingsRef, {
        latitude,
        longitude,
        rating: selected + 1, // 1–5 scale
        timestamp: Date.now(),
      });
      console.log("Rating successfully sent to Firebase!");
      Alert.alert("✅ Submitted", "Your rating has been sent.");
    } catch (error) {
      console.error("Firebase push failed:", error);
      Alert.alert("Error", "Failed to send rating. Check console.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.header}>Rate Parking</Text>
        <Text style={styles.message}>How full is the parking?</Text>

        <View style={styles.ratingContainer}>
          {colors.map((color, index) => (
            <Pressable
              key={index}
              onPress={() => handleSelect(index)}
              disabled={submitted}
            >
              <Animated.View
                style={[
                  styles.circle,
                  {
                    backgroundColor: index <= selected ? color : "#ddd",
                    transform: [{ scale: animations[index] }],
                  },
                ]}
              />
            </Pressable>
          ))}
        </View>

        {/* Submit Button */}
        <Pressable
          onPressIn={() => handlePressIn(submitAnim)}
          onPressOut={() => handlePressOut(submitAnim)}
          onPress={handleSubmit}
          disabled={submitted}
        >
          <Animated.View
            style={[
              styles.button,
              submitted && styles.disabledButton,
              { transform: [{ scale: submitAnim }] },
            ]}
          >
            <Text style={styles.buttonText}>
              {submitted ? "Submitted" : "Submit"}
            </Text>
          </Animated.View>
        </Pressable>

        {/* Exit Button */}
        <Link href="/" asChild>
          <Pressable
            onPressIn={() => handlePressIn(exitAnim)}
            onPressOut={() => handlePressOut(exitAnim)}
          >
            <Animated.View
              style={[styles.button, styles.exitButton, { transform: [{ scale: exitAnim }] }]}
            >
              <Text style={styles.buttonText}>End This Trip</Text>
            </Animated.View>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" },
  content: { alignItems: "center", width: "80%" },
  header: { fontSize: 28, fontWeight: "bold", marginBottom: 20, color: "#004d40" },
  message: { fontSize: 18, fontWeight: "600", marginBottom: 30, color: "#333" },
  ratingContainer: { flexDirection: "row", justifyContent: "space-between", width: "90%", marginBottom: 30 },
  circle: { width: 55, height: 55, borderRadius: 27.5, marginHorizontal: 6 },
  button: {
    backgroundColor: "#00796b",
    paddingVertical: 14,
    width: 220,
    borderRadius: 40,
    marginBottom: 20,
    alignItems: "center",
  },
  exitButton: { backgroundColor: "#009688" },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 16, textAlign: "center" },
  disabledButton: { backgroundColor: "#9e9e9e" },
});
