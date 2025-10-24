// app/components/SearchInput.tsx
import React, { useState } from "react";
import { View, TextInput, FlatList, TouchableOpacity, Text, StyleSheet, Keyboard } from "react-native";

type Props = {
  apiKey: string;
  onPlaceSelected: (place: { place_id: string; description: string }) => void;
  placeholder?: string;
};

export default function SearchInput({ apiKey, onPlaceSelected, placeholder = "Search location" }: Props) {
  const [text, setText] = useState("");
  const [predictions, setPredictions] = useState<any[]>([]);
  const minLen = 3;

  const handleChange = async (newText: string) => {
    setText(newText);
    if (newText.length < minLen) {
      setPredictions([]);
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
        newText
      )}&key=${apiKey}&types=geocode&language=en`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.status === "OK") setPredictions(json.predictions || []);
      else setPredictions([]);
    } catch (e) {
      console.warn("Places autocomplete failed", e);
      setPredictions([]);
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        placeholder={placeholder}
        value={text}
        onChangeText={handleChange}
        style={styles.input}
        clearButtonMode="while-editing"
      />
      {predictions.length > 0 && (
        <FlatList
          data={predictions}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.place_id}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.item}
              onPress={() => {
                onPlaceSelected({ place_id: item.place_id, description: item.description });
                setText(item.description);
                setPredictions([]);
                Keyboard.dismiss();
              }}
            >
              <Text>{item.description}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", zIndex: 100 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    elevation: 3,
    marginHorizontal: 12,
  },
  list: {
    maxHeight: 220,
    marginHorizontal: 12,
    marginTop: 6,
    backgroundColor: "#fff",
    borderRadius: 8,
  },
  item: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
});
