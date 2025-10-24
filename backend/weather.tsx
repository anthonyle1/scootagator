// backend/weather.tsx
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

type WeatherProps = {
  lat: number;
  lng: number;
  label?: string;
};

export default function Weather({ lat, lng, label }: WeatherProps) {
  const [locationLabel, setLocationLabel] = useState("Loading...");
  const [hourlyForecast, setHourlyForecast] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lat || !lng) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    async function fetchWeather() {
      setLoading(true);
      setError(null);

      try {
        const headers = {
          "User-Agent": "ScootAGator/1.0 (kalischuchhardt@ufl.edu)",
        };

        // Fetch metadata for the location
        const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lng}`, { headers });
        const pointData = await pointRes.json();

        const city = pointData.properties.relativeLocation?.properties.city;
        const state = pointData.properties.relativeLocation?.properties.state;
        setLocationLabel(city && state ? `${city}, ${state}` : "Unknown Location");

        // Fetch hourly forecast data
        const hourlyUrl = pointData.properties.forecastHourly;
        const hourlyRes = await fetch(hourlyUrl, { headers });
        const hourlyData = await hourlyRes.json();

        const now = new Date();
        const next24 = hourlyData.properties.periods
          .filter((hour: any) => new Date(hour.endTime) > now)
          .slice(0, 24);

        setHourlyForecast(next24);

        // Update every minute to remove expired hours
        interval = setInterval(() => {
          setHourlyForecast((prev) => {
            const currentTime = new Date();
            return prev.filter((hour) => new Date(hour.endTime) > currentTime);
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

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [lat, lng]);

  if (!lat || !lng) return <Text>Please select a location.</Text>;
  if (loading) return <Text>Loading weather data...</Text>;
  if (error) return <Text>{error}</Text>;

  const formatHour = (timeString: string) => {
    const date = new Date(timeString);
    let hours = date.getHours();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours} ${ampm}`;
  };

  const getWeatherEmoji = (forecast: string) => {
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

  const now = new Date();

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}

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
              style={[styles.hourlyCard, isCurrent && styles.currentHourCard]}
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
  label: {
    fontSize: 16,
    fontWeight: "700",
    color: "#5B94FF",
    textAlign: "center",
    marginBottom: 4,
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
    color: "rgba(91, 148, 255, 1)",
  },
  forecast: {
    fontSize: 12,
    color: "#555",
    textAlign: "center",
  },
});
