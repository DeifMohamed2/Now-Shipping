import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { BarChart2, MapPin, CreditCard, TrendingDown } from "lucide-react";

const courierLoadData = [{ name: "9dd7aa96", load: 6 }];

const governoratesData = [
  { name: "Cairo", orders: 10 },
  { name: "Giza", orders: 3 },
  { name: "Alex", orders: 2 },
];

const paymentData = [
  { name: "N/A", count: 6, color: "#6366f1" },
  { name: "COD", count: 3, color: "#6366f1" },
  { name: "CD",  count: 1, color: "#6366f1" },
];

const returnVolumeData = [
  { month: "Oct", returns: 0 },
  { month: "Nov", returns: 0 },
  { month: "Dec", returns: 0 },
  { month: "Jan", returns: 0 },
  { month: "Feb", returns: 0 },
  { month: "Mar", returns: 1 },
  { month: "Apr", returns: 2 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-slate-100 rounded-xl shadow-xl p-2.5">
        <p className="text-slate-500 mb-1" style={{ fontSize: '11px' }}>{label}</p>
        <p className="text-slate-900" style={{ fontSize: '12px', fontWeight: 600 }}>{payload[0].value}</p>
      </div>
    );
  }
  return null;
};

export function BarCharts() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Payment Breakdown */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
            <CreditCard size={13} className="text-indigo-500" />
          </div>
          <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Payment Breakdown</h3>
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={paymentData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {paymentData.map((_, i) => (
                  <Cell key={i} fill="#6366f1" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Governorates */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
            <MapPin size={13} className="text-amber-500" />
          </div>
          <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Top Governorates</h3>
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={governoratesData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />
              <Bar dataKey="orders" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {governoratesData.map((_, i) => (
                  <Cell key={i} fill="#f59e0b" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Courier Load */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
            <BarChart2 size={13} className="text-blue-500" />
          </div>
          <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Courier Load (30d)</h3>
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={courierLoadData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />
              <Bar dataKey="load" radius={[6, 6, 0, 0]} maxBarSize={60}>
                <Cell fill="#60a5fa" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Return Volume by Month */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center">
            <TrendingDown size={13} className="text-red-500" />
          </div>
          <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Return Volume by Month</h3>
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={returnVolumeData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="returns"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: "#ef4444" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
