import React, { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  Keyboard,
  Platform,
  ActivityIndicator,
} from "react-native";

type Prediction = { place_id: string | null; description: string };

type Props = {
  apiKey: string;
  onPlaceSelected: (place: Prediction) => void;
  placeholder?: string;
  minLen?: number;
};

// simple session token generator (no packages)
const makeToken = () =>
  (globalThis.crypto?.randomUUID?.()) ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function SearchInput({
  apiKey,
  onPlaceSelected,
  placeholder,
  minLen = 3,
}: Props) {
  // ✅ hooks are INSIDE the component
  const [text, setText] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const sessionTokenRef = useRef<string>(makeToken());        // ✅ OK here
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const lastIssuedQuery = useRef<string>("");

  const resetSession = () => { sessionTokenRef.current = makeToken(); };

  const fetchPredictions = async (query: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++seqRef.current;
    setLoading(true);

    try {
      if (!apiKey) {
        console.warn("SearchInput: missing apiKey");
        setPredictions([]);
        return;
      }

      const base = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
      const params = new URLSearchParams({
        input: query,
        key: apiKey,
        sessiontoken: sessionTokenRef.current,
      });
      const requestUrl = `${base}?${params.toString()}`;
      const url =
        Platform.OS === "web"
          ? `https://corsproxy.io/?${encodeURIComponent(requestUrl)}`
          : requestUrl;

      lastIssuedQuery.current = query;
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`Autocomplete HTTP ${res.status}`, body.slice(0, 200) || "<no body>");
        setPredictions([]);
        return;
      }

      const json = await res.json();

      if (seq !== seqRef.current) return; // ignore stale

      if (json.status !== "OK") {
        console.warn("Places Autocomplete error:", json.status, json.error_message);
        if (json.status === "ZERO_RESULTS") setPredictions([]);
        return;
      }

      const list: Prediction[] = (json.predictions || []).map((p: any) => ({
        place_id: p.place_id,
        description: p.description,
      }));
      setPredictions(list);
    } catch (err: any) {
      if (err?.name !== "AbortError") console.warn("Autocomplete fetch error:", err);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  const handleChange = (newText: string) => {
    setText(newText);
    setTouched(true);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!newText || newText.length < minLen) {
      setPredictions([]);
      setLoading(false);
      return;
    }
    debounceTimer.current = setTimeout(() => fetchPredictions(newText), 250);
  };

  const handleSelect = (place: Prediction) => {
    Keyboard.dismiss();
    setText(place.description);
    setPredictions([]);
    onPlaceSelected(place);
    resetSession(); // start a new session after selection
  };

  const handleSubmit = () => {
    if (predictions.length > 0) {
      handleSelect(predictions[0]);
    } else if (text.length >= minLen && lastIssuedQuery.current !== text) {
      fetchPredictions(text);
    } else {
      alert("Please pick a place from the suggestions");
    }
  };

  useEffect(() => {
    return () => {
      debounceTimer.current && clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  return (
    <View style={styles.container}>
      <TextInput
        placeholder={placeholder || "Search places..."}
        placeholderTextColor="#999"
        value={text}
        onChangeText={handleChange}
        onSubmitEditing={handleSubmit}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
        onFocus={() => setTouched(true)}
      />
      {touched && (
        <View style={styles.statusRow}>
          {loading ? <ActivityIndicator size="small" /> : null}
          {!loading && text.length >= minLen && predictions.length === 0 ? (
            <Text style={styles.statusText}>No results</Text>
          ) : null}
        </View>
      )}
      <FlatList
        data={predictions}
        keyExtractor={(item) => item.place_id || item.description}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => handleSelect(item)}>
            <Text style={styles.itemText}>{item.description}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 10, zIndex: 10, elevation: 10 },
  input: {
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    paddingVertical: 6,
    minHeight: 24,
  },
  statusText: { color: "#666", fontSize: 12 },
  list: {
    maxHeight: 240,
    backgroundColor: "white",
    borderRadius: 8,
    overflow: "hidden",
  },
  item: {
    backgroundColor: "white",
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  itemText: { color: "#333", fontSize: 14 },
});
