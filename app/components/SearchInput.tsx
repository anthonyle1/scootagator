import React, { useState } from "react";
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  Keyboard,
  Platform,
} from "react-native";

type Props = {
  apiKey: string;
  onPlaceSelected: (place: { place_id: string | null; description: string }) => void;
  placeholder?: string;
};

export default function SearchInput({ apiKey, onPlaceSelected, placeholder }: Props) {
  const [text, setText] = useState("");
  const [predictions, setPredictions] = useState<{ place_id: string | null; description: string }[]>([]);
  const minLen = 3;

  const handleChange = async (newText: string) => {
    setText(newText);

    if (newText.length < minLen) {
      setPredictions([]);
      return;
    }

    let url = "https://places.googleapis.com/v1/places:autocomplete";
    if (Platform.OS === "web") {
      url = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify({ input: newText }),
      });

      const json = await response.json();

      if (json.suggestions && Array.isArray(json.suggestions)) {
        const formatted = json.suggestions.map((suggestion: any) => {
          // placePrediction has detailed place info
          if (suggestion.placePrediction) {
            return {
              place_id: suggestion.placePrediction.placeId,
              description: suggestion.placePrediction.text?.text || "Unknown place",
            };
          }
          // queryPrediction is free text suggestion without placeId
          else if (suggestion.queryPrediction) {
            return {
              place_id: null,
              description: suggestion.queryPrediction.text?.text || "Unknown query",
            };
          }
          return null;
        }).filter(Boolean);

        setPredictions(formatted);
      } else {
        setPredictions([]);
      }
    } catch (error) {
      console.warn("Autocomplete error:", error);
      setPredictions([]);
    }
  };

  const handleSelect = (place: { place_id: string | null; description: string }) => {
    Keyboard.dismiss();
    setText(place.description);
    setPredictions([]);
    onPlaceSelected(place);
  };

  const handleSubmit = () => {
    if (predictions.length > 0) {
      handleSelect(predictions[0]);
    } else {
      alert("Please pick a place from the suggestions");
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        placeholder={placeholder || "Search places..."}
        placeholderTextColor="#999"
        value={text}
        onChangeText={handleChange}
        onSubmitEditing={handleSubmit}
        style={styles.input}
      />
      <FlatList
        data={predictions}
        keyExtractor={(item) => item.place_id || item.description}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => handleSelect(item)}>
            <Text style={styles.itemText}>{item.description}</Text>
          </TouchableOpacity>
        )}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 10 },
  input: {
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  item: {
    backgroundColor: "white",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  itemText: { color: "#333", fontSize: 14 },
});
