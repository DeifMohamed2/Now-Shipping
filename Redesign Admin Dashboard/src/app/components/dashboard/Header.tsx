import { Search, Calendar, Download, RefreshCw, ChevronDown } from "lucide-react";

export function Header() {
  return (
    <header className="bg-white border-b border-slate-100 px-8 py-4 flex items-center gap-4">
      {/* Page title */}
      <div className="flex-1">
        <h1 className="text-slate-900" style={{ fontSize: '20px', fontWeight: 600, lineHeight: 1.3 }}>
          Shipping Dashboard
        </h1>
        <p className="text-slate-400 mt-0.5" style={{ fontSize: '13px' }}>
          Last updated: Apr 24, 2026 · 5:14 PM
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search orders, couriers..."
          className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 placeholder-slate-400 outline-none focus:border-amber-400 focus:bg-white transition-all"
          style={{ fontSize: '13px', width: '220px' }}
        />
      </div>

      {/* Date range */}
      <button className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-100 transition-all">
        <Calendar size={14} className="text-slate-500" />
        <span style={{ fontSize: '13px' }}>Apr 1 – Apr 24, 2026</span>
        <ChevronDown size={13} className="text-slate-400" />
      </button>

      {/* Refresh */}
      <button className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-100 transition-all">
        <RefreshCw size={14} className="text-slate-500" />
      </button>

      {/* Export */}
      <button className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-all shadow-sm shadow-amber-200">
        <Download size={14} />
        <span style={{ fontSize: '13px', fontWeight: 500 }}>Export</span>
      </button>
    </header>
  );
}
