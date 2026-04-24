import { TrendingUp, TrendingDown, Package, Truck, CheckCircle2, AlertTriangle, RefreshCw, Clock } from "lucide-react";

const stats = [
  {
    label: "Total Orders",
    value: "10",
    change: "+12.5%",
    up: true,
    icon: Package,
    color: "amber",
    sparkline: [3, 5, 4, 7, 6, 8, 10],
  },
  {
    label: "Active Shipments",
    value: "4",
    change: "+8.3%",
    up: true,
    icon: Truck,
    color: "blue",
    sparkline: [1, 2, 2, 3, 3, 4, 4],
  },
  {
    label: "Delivered",
    value: "3",
    change: "+5.0%",
    up: true,
    icon: CheckCircle2,
    color: "emerald",
    sparkline: [0, 1, 1, 2, 2, 3, 3],
  },
  {
    label: "In Transit",
    value: "2",
    change: "-2.1%",
    up: false,
    icon: Clock,
    color: "violet",
    sparkline: [4, 3, 3, 2, 3, 2, 2],
  },
  {
    label: "Returns",
    value: "2",
    change: "+1.0%",
    up: false,
    icon: RefreshCw,
    color: "orange",
    sparkline: [1, 2, 1, 2, 1, 2, 2],
  },
  {
    label: "Exceptions",
    value: "0",
    change: "-100%",
    up: true,
    icon: AlertTriangle,
    color: "red",
    sparkline: [2, 1, 2, 1, 0, 1, 0],
  },
];

const colorMap: Record<string, { bg: string; icon: string; border: string; spark: string; badge: string }> = {
  amber:   { bg: "bg-amber-50",   icon: "text-amber-500",   border: "border-amber-100",  spark: "#f59e0b", badge: "bg-amber-100 text-amber-700" },
  blue:    { bg: "bg-blue-50",    icon: "text-blue-500",    border: "border-blue-100",   spark: "#3b82f6", badge: "bg-blue-100 text-blue-700" },
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-500", border: "border-emerald-100",spark: "#10b981", badge: "bg-emerald-100 text-emerald-700" },
  violet:  { bg: "bg-violet-50",  icon: "text-violet-500",  border: "border-violet-100", spark: "#8b5cf6", badge: "bg-violet-100 text-violet-700" },
  orange:  { bg: "bg-orange-50",  icon: "text-orange-500",  border: "border-orange-100", spark: "#f97316", badge: "bg-orange-100 text-orange-700" },
  red:     { bg: "bg-red-50",     icon: "text-red-500",     border: "border-red-100",    spark: "#ef4444", badge: "bg-red-100 text-red-700" },
};

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 56, h = 28;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="2.5" fill={color} />
    </svg>
  );
}

export function StatsCards() {
  return (
    <div className="grid grid-cols-6 gap-4">
      {stats.map((stat) => {
        const c = colorMap[stat.color];
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className={`bg-white rounded-2xl p-4 border ${c.border} shadow-sm hover:shadow-md transition-shadow`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center`}>
                <Icon size={16} className={c.icon} />
              </div>
              <Sparkline data={stat.sparkline} color={c.spark} />
            </div>
            <div className="text-slate-900 mb-1" style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1 }}>
              {stat.value}
            </div>
            <div className="text-slate-500 mb-2" style={{ fontSize: '12px' }}>{stat.label}</div>
            <div className="flex items-center gap-1">
              {stat.up ? (
                <TrendingUp size={11} className="text-emerald-500" />
              ) : (
                <TrendingDown size={11} className="text-red-400" />
              )}
              <span
                className={stat.up ? "text-emerald-600" : "text-red-500"}
                style={{ fontSize: '11px', fontWeight: 600 }}
              >
                {stat.change}
              </span>
              <span className="text-slate-400" style={{ fontSize: '11px' }}>vs last period</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
