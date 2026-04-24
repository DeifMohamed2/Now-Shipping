import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";

const data = [
  { month: "Oct", revenue: 0, orders: 0 },
  { month: "Nov", revenue: 0, orders: 0 },
  { month: "Dec", revenue: 0, orders: 0 },
  { month: "Jan", revenue: 0, orders: 0 },
  { month: "Feb", revenue: 0, orders: 0 },
  { month: "Mar", revenue: 100, orders: 2 },
  { month: "Apr", revenue: 400, orders: 8 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-slate-100 rounded-xl shadow-xl p-3">
        <p className="text-slate-500 mb-2" style={{ fontSize: '12px' }}>{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-slate-600" style={{ fontSize: '12px' }}>{p.name}:</span>
            <span className="text-slate-900" style={{ fontSize: '12px', fontWeight: 600 }}>
              {p.name === "Revenue (EGP)" ? `EGP ${p.value}` : p.value}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export function RevenueChart() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <TrendingUp size={14} className="text-amber-500" />
            </div>
            <h3 className="text-slate-900" style={{ fontSize: '15px', fontWeight: 600 }}>Revenue & Orders</h3>
          </div>
          <p className="text-slate-400" style={{ fontSize: '12px' }}>Monthly trend overview</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <span className="text-slate-500" style={{ fontSize: '12px' }}>Revenue (EGP)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-slate-700" />
            <span className="text-slate-500" style={{ fontSize: '12px' }}>Orders</span>
          </div>
        </div>
      </div>

      <div className="flex-1" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#334155" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#334155" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="rev"
              orientation="left"
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="ord"
              orientation="right"
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              yAxisId="rev"
              type="monotone"
              dataKey="revenue"
              name="Revenue (EGP)"
              stroke="#f59e0b"
              strokeWidth={2.5}
              fill="url(#revGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#f59e0b" }}
            />
            <Area
              yAxisId="ord"
              type="monotone"
              dataKey="orders"
              name="Orders"
              stroke="#334155"
              strokeWidth={2}
              fill="url(#ordGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#334155" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
