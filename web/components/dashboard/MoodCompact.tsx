"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, MapPin } from "@phosphor-icons/react";
import type { WeatherInfo } from "./types";

const CITY_FALLBACK = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "西安", "重庆"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function clockShort(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clockFull(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function WeatherIcon({ icon }: { icon: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.8, fill: "none" };
  switch (icon) {
    case "sun":
      return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case "cloud-sun":
      return <svg {...common}><circle cx="8" cy="8" r="3" /><path d="M17 18a4 4 0 0 0 0-8 5 5 0 0 0-9.5 1.5" /></svg>;
    case "cloud":
      return <svg {...common}><path d="M17.5 18a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A4 4 0 0 0 6 19h11.5z" /></svg>;
    case "rain":
      return <svg {...common}><path d="M17 14a4 4 0 0 0 0-8 5 5 0 0 0-9 1.5" /><path d="M8 16v4M12 16v4M16 16v4" /></svg>;
    case "snow":
      return <svg {...common}><path d="M17 14a4 4 0 0 0 0-8 5 5 0 0 0-9 1.5" /><path d="M8 18v2M12 18v2M16 18v2" /></svg>;
    case "thunder":
      return <svg {...common}><path d="M17 14a4 4 0 0 0 0-8 5 5 0 0 0-9 1.5" /><path d="M11 14l-2 4h4l-2 4" /></svg>;
    default:
      return <svg {...common}><path d="M17.5 18a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A4 4 0 0 0 6 19h11.5z" /></svg>;
  }
}

export function MoodCompact() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date(0));
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [cityMode, setCityMode] = useState<"idle" | "geo" | "manual">("idle");
  const [manualCity, setManualCity] = useState("");
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  const requestLocalWeather = useCallback(() => {
    setCityMode("geo");
    if (!("geolocation" in navigator)) {
      setDegraded(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => loadWeather(pos.coords.latitude, pos.coords.longitude),
      () => setDegraded(true),
      { timeout: 5000, maximumAge: 600000 },
    );
  }, [loadWeather]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [popoverOpen]);

  function pickManualCity(city: string) {
    setCityMode("manual");
    setManualCity(city);
    loadWeather(undefined, undefined, city);
  }

  const clockDisplay = mounted ? clockShort(now) : "--:--";

  return (
    <div className="mood-compact" ref={popoverRef}>
      <button
        type="button"
        className="mood-compact-trigger"
        onClick={() => setPopoverOpen((v) => !v)}
        aria-label="时间与天气"
      >
        <span className="mood-compact-time" suppressHydrationWarning>{clockDisplay}</span>
        {weather && (
          <>
            <span className="mood-compact-divider" />
            <span className="mood-compact-icon"><WeatherIcon icon={weather.icon} /></span>
            <span className="mood-compact-temp">{weather.temperature !== undefined ? `${Math.round(weather.temperature)}°` : "—"}</span>
            {weather.location && <span className="mood-compact-loc">{weather.location}</span>}
          </>
        )}
      </button>
      {popoverOpen && (
        <div className="mood-compact-popover" role="dialog" aria-label="时间与天气详情">
          <div className="mood-compact-clock-full" suppressHydrationWarning>
            {mounted ? clockFull(now) : "--:--:--"}
          </div>
          <div className="mood-compact-weather-detail">
            {weather ? (
              <>
                <span className="mood-compact-detail-icon"><WeatherIcon icon={weather.icon} /></span>
                <span className="mood-compact-detail-temp">{weather.temperature !== undefined ? `${Math.round(weather.temperature)}°` : "—"}</span>
                <span className="mood-compact-detail-label">{weather.label}</span>
                {weather.location && <span className="mood-compact-detail-loc">{weather.location}</span>}
              </>
            ) : loadingWeather ? (
              <span className="mood-compact-muted">天气读取中</span>
            ) : degraded || cityMode === "manual" ? (
              <div className="mood-compact-fallback">
                <span className="mood-compact-muted">天气暂不可用</span>
                <select
                  className="mood-compact-city-select"
                  value={manualCity}
                  onChange={(e) => pickManualCity(e.target.value)}
                  aria-label="手动选择城市"
                >
                  <option value="">选择城市</option>
                  {CITY_FALLBACK.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
            ) : (
              <div className="mood-compact-weather-optin">
                <p><MapPin size={15} /> 天气是可选的，不会自动申请位置权限。</p>
                <button type="button" onClick={requestLocalWeather}><Crosshair size={15} /> 使用当前位置</button>
                <select
                  className="mood-compact-city-select"
                  value={manualCity}
                  onChange={(e) => pickManualCity(e.target.value)}
                  aria-label="手动选择城市"
                >
                  <option value="">手动选择城市</option>
                  {CITY_FALLBACK.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
