import { Package, Truck, ArrowRight } from "lucide-react";

const recentOrders = [
  { id: "#9592999985", business: "mmm",    status: "headingToCustomer", date: "Apr 25" },
  { id: "#7653547781", business: "mmm",    status: "completed",         date: "Apr 25" },
  { id: "#2196681104", business: "dfg",    status: "new",               date: "Apr 24" },
  { id: "#5286962746", business: "Qimora", status: "new",               date: "Apr 24" },
  { id: "#5067488609", business: "Qimora", status: "pickedUp",          date: "Apr 24" },
  { id: "#4572380116", business: "Qimora", status: "returnToWarehouse", date: "Apr 24" },
];

const recentPickups = [
  { id: "#883182", date: "Apr 25", status: "completed" },
  { id: "#115355", date: "Apr 25", status: "new" },
  { id: "#455193", date: "Apr 24", status: "pickedUp" },
  { id: "#282448", date: "Apr 24", status: "pickedUp" },
  { id: "#412489", date: "Apr 25", status: "completed" },
  { id: "#251398", date: "Apr 24", status: "completed" },
];

const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
  completed:           { label: "Completed",          bg: "bg-emerald-50",  text: "text-emerald-700" },
  new:                 { label: "New",                 bg: "bg-slate-100",   text: "text-slate-600" },
  pickedUp:            { label: "Picked Up",           bg: "bg-blue-50",     text: "text-blue-700" },
  headingToCustomer:   { label: "Heading to Customer", bg: "bg-amber-50",    text: "text-amber-700" },
  returnToWarehouse:   { label: "Return to WH",        bg: "bg-orange-50",   text: "text-orange-700" },
  returnCompleted:     { label: "Return Completed",    bg: "bg-violet-50",   text: "text-violet-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || { label: status, bg: "bg-slate-100", text: "text-slate-600" };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.text}`} style={{ fontSize: '11px', fontWeight: 600 }}>
      {cfg.label}
    </span>
  );
}

export function RecentOrders() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Recent Orders */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <Package size={13} className="text-amber-500" />
            </div>
            <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Recent Orders</h3>
          </div>
          <button className="flex items-center gap-1 text-amber-500 hover:text-amber-600 transition-colors" style={{ fontSize: '12px', fontWeight: 500 }}>
            View all <ArrowRight size={12} />
          </button>
        </div>

        <div className="space-y-0">
          <div className="grid grid-cols-3 pb-2 border-b border-slate-100">
            <span className="text-slate-400" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order</span>
            <span className="text-slate-400" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Business</span>
            <span className="text-slate-400" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
          </div>
          {recentOrders.map((order) => (
            <div key={order.id} className="grid grid-cols-3 py-2.5 border-b border-slate-50 hover:bg-slate-50/60 rounded-lg px-1 -mx-1 transition-colors items-center">
              <span className="text-slate-700" style={{ fontSize: '12px', fontWeight: 500 }}>{order.id}</span>
              <span className="text-slate-500" style={{ fontSize: '12px' }}>{order.business}</span>
              <StatusBadge status={order.status} />
            </div>
          ))}
        </div>
      </div>

      {/* Recent Pickups */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <Truck size={13} className="text-blue-500" />
            </div>
            <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Recent Pickups</h3>
          </div>
          <button className="flex items-center gap-1 text-amber-500 hover:text-amber-600 transition-colors" style={{ fontSize: '12px', fontWeight: 500 }}>
            View all <ArrowRight size={12} />
          </button>
        </div>

        <div className="space-y-0">
          <div className="grid grid-cols-3 pb-2 border-b border-slate-100">
            <span className="text-slate-400" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pickup</span>
            <span className="text-slate-400" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
            <span className="text-slate-400" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
          </div>
          {recentPickups.map((p) => (
            <div key={p.id} className="grid grid-cols-3 py-2.5 border-b border-slate-50 hover:bg-slate-50/60 rounded-lg px-1 -mx-1 transition-colors items-center">
              <span className="text-slate-700" style={{ fontSize: '12px', fontWeight: 500 }}>{p.id}</span>
              <span className="text-slate-500" style={{ fontSize: '12px' }}>{p.date}</span>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
