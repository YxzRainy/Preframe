import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 天气 provider 封装：
 * - 优先使用 Open-Meteo（免 Key、无需登录、支持经纬度查询）
 * - 失败时返回降级状态，不抛错给前端，保证首页可用
 */

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    relative_humidity_2m?: number;
  };
}

interface GeoResponse {
  results?: Array<{ latitude: number; longitude: number; name: string; country?: string }>;
}

const WEATHER_CODE_MAP: Record<number, { label: string; icon: string }> = {
  0: { label: "晴朗", icon: "sun" },
  1: { label: "大致晴朗", icon: "sun" },
  2: { label: "局部多云", icon: "cloud-sun" },
  3: { label: "阴", icon: "cloud" },
  45: { label: "雾", icon: "fog" },
  48: { label: "雾凇", icon: "fog" },
  51: { label: "小毛毛雨", icon: "drizzle" },
  53: { label: "毛毛雨", icon: "drizzle" },
  55: { label: "强毛毛雨", icon: "drizzle" },
  61: { label: "小雨", icon: "rain" },
  63: { label: "中雨", icon: "rain" },
  65: { label: "大雨", icon: "rain" },
  71: { label: "小雪", icon: "snow" },
  73: { label: "中雪", icon: "snow" },
  75: { label: "大雪", icon: "snow" },
  80: { label: "阵雨", icon: "rain" },
  81: { label: "强阵雨", icon: "rain" },
  82: { label: "猛烈阵雨", icon: "rain" },
  95: { label: "雷暴", icon: "thunder" },
  96: { label: "雷暴伴冰雹", icon: "thunder" },
  99: { label: "强雷暴伴冰雹", icon: "thunder" },
};

async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`;
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  const data = (await response.json()) as GeoResponse;
  const hit = data.results?.[0];
  if (!hit) return null;
  return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
}

async function fetchWeather(lat: number, lon: number): Promise<OpenMeteoResponse | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  return (await response.json()) as OpenMeteoResponse;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const city = url.searchParams.get("city");
    let coords: { lat: number; lon: number; name?: string } | null = null;

    if (lat && lon) {
      coords = { lat: Number(lat), lon: Number(lon) };
    } else if (city) {
      coords = await geocodeCity(city);
    }

    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) {
      return NextResponse.json({
        ok: true,
        success: true,
        weather: null,
        degraded: true,
        reason: "no_location",
      });
    }

    const data = await fetchWeather(coords.lat, coords.lon);
    if (!data?.current) {
      return NextResponse.json({
        ok: true,
        success: true,
        weather: null,
        degraded: true,
        reason: "fetch_failed",
      });
    }

    const code = data.current.weather_code ?? 0;
    const mapped = WEATHER_CODE_MAP[code] ?? { label: "未知", icon: "cloud" };
    return NextResponse.json({
      ok: true,
      success: true,
      weather: {
        temperature: data.current.temperature_2m,
        code,
        label: mapped.label,
        icon: mapped.icon,
        windSpeed: data.current.wind_speed_10m,
        humidity: data.current.relative_humidity_2m,
        location: coords.name,
      },
      degraded: false,
    });
  } catch (error) {
    // 网络失败时安静降级
    return NextResponse.json({
      ok: true,
      success: true,
      weather: null,
      degraded: true,
      reason: "network_error",
    });
  }
}
