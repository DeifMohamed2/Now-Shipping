import {
  LayoutDashboard,
  Package,
  Truck,
  Users,
  BarChart3,
  Settings,
  Bell,
  ChevronRight,
  ArrowUpDown,
  MapPin,
  RefreshCw,
  Zap,
  ShieldCheck,
  Store,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Package, label: "Shipments", badge: 12 },
  { icon: Truck, label: "Couriers" },
  { icon: ArrowUpDown, label: "Pickups" },
  { icon: RefreshCw, label: "Returns" },
  { icon: Store, label: "Businesses" },
  { icon: Users, label: "Customers" },
  { icon: MapPin, label: "Zones" },
  { icon: BarChart3, label: "Analytics" },
  { icon: ShieldCheck, label: "Compliance" },
  { icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-[#0f172a] flex flex-col z-50">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <div className="text-white font-semibold tracking-tight" style={{ fontSize: '15px' }}>ShipAdmin</div>
            <div className="text-slate-400" style={{ fontSize: '11px' }}>Operations Center</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.label}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group ${
                item.active
                  ? "bg-amber-500/15 text-amber-400"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <item.icon
                size={17}
                className={item.active ? "text-amber-400" : "text-slate-500 group-hover:text-slate-300"}
              />
              <span className="flex-1 text-left" style={{ fontSize: '13.5px', fontWeight: 500 }}>{item.label}</span>
              {item.badge && (
                <span className="bg-amber-500 text-white rounded-full px-1.5 py-0.5" style={{ fontSize: '10px', fontWeight: 600 }}>
                  {item.badge}
                </span>
              )}
              {item.active && <ChevronRight size={14} className="text-amber-400/60" />}
            </button>
          ))}
        </div>
      </nav>

      {/* Bottom section */}
      <div className="px-3 py-4 border-t border-white/[0.06]">
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-all group">
          <Bell size={17} className="text-slate-500 group-hover:text-slate-300" />
          <span style={{ fontSize: '13.5px', fontWeight: 500 }}>Notifications</span>
          <span className="ml-auto bg-red-500 text-white rounded-full px-1.5 py-0.5" style={{ fontSize: '10px', fontWeight: 600 }}>3</span>
        </button>
        <div className="mt-3 flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white" style={{ fontSize: '12px', fontWeight: 700 }}>A</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-slate-200 truncate" style={{ fontSize: '13px', fontWeight: 500 }}>Admin User</div>
            <div className="text-slate-500 truncate" style={{ fontSize: '11px' }}>admin@shipadmin.com</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
