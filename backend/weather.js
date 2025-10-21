import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function Weather({ lat, lng, label }) {
  const [dailyForecast, setDailyForecast] = useState([]);
  const [hourlyForecast, setHourlyForecast] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!lat || !lng) return;

    async function fetchWeather() {
      setLoading(true);
      setError(null);

      try {
        const headers = {
          "User-Agent": "ScootAGator/1.0 (kalischuchhardt@ufl.edu)",
        };

        const pointRes = await fetch(
          `https://api.weather.gov/points/${lat},${lng}`,
          { headers }
        );
        const pointData = await pointRes.json();

        const dailyUrl = pointData.properties.forecast;
        const hourlyUrl = pointData.properties.forecastHourly;

        const dailyRes = await fetch(dailyUrl, { headers });
        const dailyData = await dailyRes.json();
        setDailyForecast(dailyData.properties.periods.slice(0, 14));

        const hourlyRes = await fetch(hourlyUrl, { headers });
        const hourlyData = await hourlyRes.json();
        setHourlyForecast(hourlyData.properties.periods.slice(0, 96));
      } catch (err) {
        console.error(err);
        setError("Failed to fetch weather data");
      } finally {
        setLoading(false);
      }
    }

    fetchWeather();
  }, [lat, lng]);

  if (!lat || !lng) return <Text>Please select a location.</Text>;
  if (loading) return <Text>Loading weather data...</Text>;
  if (error) return <Text>{error}</Text>;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      <Text style={styles.subHeader}>Daily Forecast (Next 7 Days)</Text>
      <ScrollView style={styles.dailyContainer}>
        {dailyForecast.map((period) => (
          <View key={period.number} style={styles.dailyItem}>
            <Text style={styles.dayName}>{period.name}</Text>
            <Text>{period.temperature}°{period.temperatureUnit}</Text>
            <Text>{period.shortForecast}</Text>
          </View>
        ))}
      </ScrollView>

      <Text style={styles.subHeader}>Hourly Forecast (Next 48-96 Hours)</Text>
      <ScrollView horizontal style={styles.hourlyContainer}>
        {hourlyForecast.map((hour) => (
          <View key={hour.number} style={styles.hourlyItem}>
            <Text>{new Date(hour.startTime).getHours()}:00</Text>
            <Text>{hour.temperature}°{hour.temperatureUnit}</Text>
            <Text>{hour.shortForecast}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 20 },
  label: { fontSize: 16, fontWeight: "bold", marginBottom: 5 },
  subHeader: { fontSize: 14, fontWeight: "600", marginTop: 10 },
  dailyContainer: { marginBottom: 10 },
  dailyItem: { marginBottom: 5 },
  dayName: { fontWeight: "bold" },
  hourlyContainer: { flexDirection: "row" },
  hourlyItem: { marginRight: 10, minWidth: 60 },
});