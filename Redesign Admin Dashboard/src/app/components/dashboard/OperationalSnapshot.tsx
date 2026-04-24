import { Zap, Wifi, Package, AlertCircle, XCircle, Clock } from "lucide-react";

const metrics = [
  { label: "Couriers Online", value: "0", icon: Wifi, color: "text-emerald-500", bg: "bg-emerald-50" },
  { label: "Avg. Delivery (days)", value: "0.2", icon: Clock, color: "text-blue-500", bg: "bg-blue-50" },
  { label: "Open Tickets", value: "0", icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-50" },
  { label: "Cancellations Today", value: "0", icon: XCircle, color: "text-red-500", bg: "bg-red-50" },
];

export function OperationalSnapshot() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
          <Zap size={14} className="text-amber-500" />
        </div>
        <h3 className="text-slate-900" style={{ fontSize: '15px', fontWeight: 600 }}>Operational Snapshot</h3>
      </div>

      <div className="space-y-3">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg ${m.bg} flex items-center justify-center`}>
                  <Icon size={13} className={m.color} />
                </div>
                <span className="text-slate-600" style={{ fontSize: '13px' }}>{m.label}</span>
              </div>
              <span className="text-slate-900" style={{ fontSize: '15px', fontWeight: 600 }}>{m.value}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-500" style={{ fontSize: '11px' }}>All systems operational</span>
        </div>
      </div>
    </div>
  );
}
