// IMPORTS
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

// WEATHER COMPONENT FUNCTION
export default function Weather({ lat, lng }) {
  const [locationLabel, setLocationLabel] = useState("Loading...");
  const [hourlyForecast, setHourlyForecast] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // FETCH WEATHER DATA
  useEffect(() => {
    if (!lat || !lng) return;

    let interval;

    async function fetchWeather() {
      setLoading(true);
      setError(null);

      try {
        const headers = {
          "User-Agent": "ScootAGator/1.0 (kalischuchhardt@ufl.edu)",
        };

        // Get location info
        const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lng}`, { headers });
        const pointData = await pointRes.json();

        const city = pointData.properties.relativeLocation?.properties.city;
        const state = pointData.properties.relativeLocation?.properties.state;
        setLocationLabel(city && state ? `${city}, ${state}` : "Unknown Location");

        const hourlyUrl = pointData.properties.forecastHourly;
        const hourlyRes = await fetch(hourlyUrl, { headers });
        const hourlyData = await hourlyRes.json();

        // Keep only the next 24 hours
        const now = new Date();
        const next24 = hourlyData.properties.periods.filter(
          (hour) => new Date(hour.endTime) > now
        ).slice(0, 24);

        setHourlyForecast(next24);

        // UPDATE EVERY MINUTE
        interval = setInterval(() => {
          setHourlyForecast((prev) => {
            const now = new Date();
            const filtered = prev
              .filter((hour) => new Date(hour.endTime) > now);

            // Ensure we always have 24 hours (fetch more if needed)
            return filtered;
          });
        }, 60000);

      } catch (err) {
        console.error(err);
        setError("Failed to fetch weather data");
      } finally {
        setLoading(false);
      }
    }

    fetchWeather();

    return () => clearInterval(interval);
  }, [lat, lng]);

  // CONDITIONAL RENDERING
  if (!lat || !lng) return <Text>Please select a location.</Text>;
  if (loading) return <Text>Loading weather data...</Text>;
  if (error) return <Text>{error}</Text>;

  // FORMAT HOUR
  const formatHour = (timeString) => {
    const date = new Date(timeString);
    let hours = date.getHours();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours} ${ampm}`;
  };

  // WEATHER EMOJIS
  const getWeatherEmoji = (forecast) => {
    forecast = forecast.toLowerCase();
    if (forecast.includes("sunny") || forecast.includes("clear")) return "🌞";
    if (forecast.includes("cloud")) return "☁️";
    if (forecast.includes("rain") || forecast.includes("showers")) return "🌧";
    if (forecast.includes("snow")) return "❄️";
    if (forecast.includes("thunder")) return "⛈";
    if (forecast.includes("fog") || forecast.includes("haze") || forecast.includes("mist")) return "🌫️";
    if (forecast.includes("sleet")) return "🌨️";
    if (forecast.includes("wind")) return "💨";
    if (forecast.includes("drizzle")) return "🌦️";
    return "🌡️";
  };

  // RENDER
  const now = new Date();
  return (
    <View style={styles.container}>
      <Text style={styles.location}>{locationLabel}</Text>

      <Text style={styles.sectionTitle}>Hourly Forecast</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.hourlyScroll}
      >
        {hourlyForecast.map((hour) => {
          const start = new Date(hour.startTime);
          const end = new Date(hour.endTime);
          const isCurrent = now >= start && now < end;

          return (
            <View
              key={hour.number}
              style={[
                styles.hourlyCard,
                isCurrent && styles.currentHourCard
              ]}
            >
              <Text style={styles.hour}>{formatHour(hour.startTime)}</Text>
              <Text style={styles.emoji}>{getWeatherEmoji(hour.shortForecast)}</Text>
              <Text style={styles.temp}>
                {hour.temperature}°{hour.temperatureUnit}
              </Text>
              <Text style={styles.forecast}>{hour.shortForecast}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// STYLES
const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 18,
    padding: 16,
    marginVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  location: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
    color: "#1a1a1a",
  },
  sectionTitle: {
    textAlign: "left",
    fontSize: 14,
    fontWeight: "600",
    marginVertical: 6,
    color: "#333",
  },
  hourlyScroll: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
  },
  hourlyCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
    width: 70,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
  },
  currentHourCard: {
    borderWidth: 2,
    borderColor: "#5B94FF",
    backgroundColor: "#E0F0FF",
  },
  hour: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 2,
  },
  emoji: {
    fontSize: 20,
    marginBottom: 2,
  },
  temp: {
    fontSize: 16,
    fontWeight: "600",
    color: 'rgba(91, 148, 255, 1)',
  },
  forecast: {
    fontSize: 12,
    color: "#555",
    textAlign: "center",
  },
});
