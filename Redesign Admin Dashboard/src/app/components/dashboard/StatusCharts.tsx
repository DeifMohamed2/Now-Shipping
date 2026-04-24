import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PieChart as PieIcon } from "lucide-react";

const pickupsByStatus = [
  { name: "Completed", value: 4, color: "#6366f1" },
  { name: "Picked Up", value: 2, color: "#14b8a6" },
  { name: "New",       value: 1, color: "#f59e0b" },
];

const ordersByStatus = [
  { name: "Completed",        value: 3, color: "#10b981" },
  { name: "Return Completed", value: 2, color: "#6366f1" },
  { name: "New",              value: 2, color: "#f59e0b" },
  { name: "Return to WH",     value: 1, color: "#94a3b8" },
  { name: "Heading to Cust.", value: 1, color: "#3b82f6" },
  { name: "Picked Up",        value: 1, color: "#14b8a6" },
];

const ordersByCategory = [
  { name: "Successful",  value: 5, color: "#14b8a6" },
  { name: "Processing",  value: 3, color: "#3b82f6" },
  { name: "New",         value: 2, color: "#f59e0b" },
];

const expressVsStandard = [
  { name: "Standard", value: 8, color: "#f59e0b" },
  { name: "Express",  value: 2, color: "#94a3b8" },
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-slate-100 rounded-xl shadow-xl p-2.5">
        <p className="text-slate-900" style={{ fontSize: '12px', fontWeight: 600 }}>{payload[0].name}</p>
        <p className="text-slate-500" style={{ fontSize: '11px' }}>{payload[0].value} orders</p>
      </div>
    );
  }
  return null;
};

function DonutCard({
  title,
  data,
  icon,
}: {
  title: string;
  data: { name: string; value: number; color: string }[];
  icon?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
          <PieIcon size={13} className="text-violet-500" />
        </div>
        <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>{title}</h3>
      </div>

      <div className="flex items-center gap-4">
        <div style={{ width: 110, height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={32}
                outerRadius={50}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 space-y-2">
          {data.map((d) => (
            <div key={d.name} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-slate-500 truncate" style={{ fontSize: '11px' }}>{d.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-700" style={{ fontSize: '11px', fontWeight: 600 }}>{d.value}</span>
                <span className="text-slate-400" style={{ fontSize: '10px' }}>
                  ({Math.round((d.value / total) * 100)}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatusCharts() {
  return (
    <div className="grid grid-cols-4 gap-4">
      <DonutCard title="Pickups by Status" data={pickupsByStatus} />
      <DonutCard title="Orders by Status" data={ordersByStatus} />
      <DonutCard title="Orders by Category" data={ordersByCategory} />
      <DonutCard title="Express vs Standard" data={expressVsStandard} />
    </div>
  );
}
