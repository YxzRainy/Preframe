"use client";

import { useEffect, useState } from "react";
function greeting(hour: number): string {
  if (hour < 5) return "夜深了，注意休息";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  if (hour < 22) return "晚上好";
  return "夜深了，注意休息";
}

interface DashboardHeaderProps {
  initialNowIso: string;
}

export function DashboardHeader({ initialNowIso }: DashboardHeaderProps) {
  const [now, setNow] = useState<Date>(() => new Date(initialNowIso));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const greetingDisplay = greeting(now.getHours());

  return (
    <header className="dashboard-header">
      <div className="dashboard-header-left">
        <h1 className="dashboard-greeting">
          {greetingDisplay}。
        </h1>
        <p className="dashboard-status">把一个想法推进成可拍、可发的内容。</p>
      </div>
    </header>
  );
}
