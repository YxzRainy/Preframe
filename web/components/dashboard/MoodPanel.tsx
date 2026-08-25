"use client";

import { useCallback, useEffect, useState } from "react";
import type { WeatherInfo } from "./types";

const CITY_FALLBACK = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "西安", "重庆"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function clockText(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function WeatherIcon({ icon }: { icon: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.8, fill: "none" };
  switch (icon) {
    case "sun":
      return (
        <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      );
    case "cloud-sun":
      return (
        <svg {...common}><circle cx="8" cy="8" r="3" /><path d="M17 18a4 4 0 0 0 0-8 5 5 0 0 0-9.5 1.5" /></svg>
      );
    case "cloud":
      return (<svg {...common}><path d="M17.5 18a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A4 4 0 0 0 6 19h11.5z" /></svg>);
    case "rain":
      return (
        <svg {...common}><path d="M17 14a4 4 0 0 0 0-8 5 5 0 0 0-9 1.5" /><path d="M8 16v4M12 16v4M16 16v4" /></svg>
      );
    case "snow":
      return (
        <svg {...common}><path d="M17 14a4 4 0 0 0 0-8 5 5 0 0 0-9 1.5" /><path d="M8 18v2M12 18v2M16 18v2" /></svg>
      );
    case "thunder":
      return (
        <svg {...common}><path d="M17 14a4 4 0 0 0 0-8 5 5 0 0 0-9 1.5" /><path d="M11 14l-2 4h4l-2 4" /></svg>
      );
    default:
      return (<svg {...common}><path d="M17.5 18a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A4 4 0 0 0 6 19h11.5z" /></svg>);
  }
}

export function MoodPanel() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date(0));
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [cityMode, setCityMode] = useState<"geo" | "manual">("geo");
  const [manualCity, setManualCity] = useState("");
  const [loadingWeather, setLoadingWeather] = useState(false);

  useEffect(() => {
    setMounted(true);
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadWeather = useCallback(async (lat?: number, lon?: number, city?: string) => {
    setLoadingWeather(true);
    try {
      const params = new URLSearchParams();
      if (lat !== undefined && lon !== undefined) {
        params.set("lat", String(lat));
        params.set("lon", String(lon));
      } else if (city) {
        params.set("city", city);
      }
      const response = await fetch(`/api/weather?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (data.weather) {
        setWeather(data.weather);
        setDegraded(false);
      } else {
        setWeather(null);
        setDegraded(true);
      }
    } catch {
      setWeather(null);
      setDegraded(true);
    } finally {
      setLoadingWeather(false);
    }
  }, []);

  useEffect(() => {
    if (cityMode !== "geo") return;
    if (!("geolocation" in navigator)) {
      setDegraded(true);
      return;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!cancelled) loadWeather(pos.coords.latitude, pos.coords.longitude); },
      () => { if (!cancelled) setDegraded(true); },
      { timeout: 5000, maximumAge: 600000 },
    );
    return () => { cancelled = true; };
  }, [cityMode, loadWeather]);

  function pickManualCity(city: string) {
    setCityMode("manual");
    setManualCity(city);
    loadWeather(undefined, undefined, city);
  }

  const safeNow = mounted ? now : new Date(0);
  const focusLabel = safeNow.getHours() < 22 && safeNow.getHours() >= 6 ? "专注时段" : "休整时段";
  const clockDisplay = mounted ? clockText(safeNow) : "--:--:--";

  return (
    <section className="mood-panel" aria-label="情绪价值区">
      <div className="mood-clock" suppressHydrationWarning>{clockDisplay}</div>
      <div className="mood-meta">
        <span>{mounted ? focusLabel : "本地时间"}</span>
        <span className="mood-dot" />
        <span>本地时间</span>
      </div>
      <div className="mood-weather">
        {weather ? (
          <>
            <span className="mood-weather-icon"><WeatherIcon icon={weather.icon} /></span>
            <span className="mood-weather-temp">{weather.temperature !== undefined ? `${Math.round(weather.temperature)}°` : "—"}</span>
            <span className="mood-weather-label">{weather.label}</span>
            {weather.location && <span className="mood-weather-loc">{weather.location}</span>}
          </>
        ) : loadingWeather ? (
          <span className="mood-weather-muted">天气读取中</span>
        ) : degraded ? (
          <div className="mood-weather-fallback">
            <span className="mood-weather-muted">天气暂不可用</span>
            <select
              className="mood-city-select"
              value={manualCity}
              onChange={(e) => pickManualCity(e.target.value)}
              aria-label="手动选择城市"
            >
              <option value="">选择城市</option>
              {CITY_FALLBACK.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        ) : (
          <span className="mood-weather-muted">天气读取中</span>
        )}
      </div>
      <p className="mood-quote">{mounted ? getQuote(safeNow) : "今天的创作，按自己的节奏来就好。"}</p>
    </section>
  );
}

function getQuote(now: Date): string {
  const h = now.getHours();
  if (h < 6) return "夜里安静，先照顾好自己。";
  if (h < 11) return "把今天最重要的那件事，先做掉。";
  if (h < 14) return "中午喘口气，别硬撑。";
  if (h < 18) return "下午慢一点，把节奏稳住。";
  if (h < 22) return "晚上适合复盘和记录灵感。";
  return "今天差不多到这里就好。";
}
