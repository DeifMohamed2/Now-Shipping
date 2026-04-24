import { Trophy, AlertTriangle } from "lucide-react";

const topBusinesses = [
  { rank: 1, business: "mmm",    orders: 2, completed: 1, success: 50,   revenue: 100, bad: 0, score: 58 },
  { rank: 2, business: "Qimora", orders: 7, completed: 2, success: 28.6, revenue: 300, bad: 0, score: 50.7 },
  { rank: 3, business: "dfg",    orders: 1, completed: 0, success: 0,    revenue: 0,   bad: 0, score: 0 },
];

const needsAttention = [
  { rank: 1, business: "Qimora", orders: 7, completed: 2, success: 28.6, revenue: 300, bad: 0, score: 50.7 },
];

const rankColors = ["text-amber-500", "text-slate-400", "text-orange-700"];
const rankBg = ["bg-amber-50", "bg-slate-50", "bg-orange-50/60"];

export function TopBusinesses() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Top Businesses */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <Trophy size={13} className="text-amber-500" />
            </div>
            <div>
              <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Top Businesses</h3>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>Score = completion×55 + revenue×35 − bad×40</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-7 pb-2 border-b border-slate-100">
            {["#", "Business", "Orders", "Done", "Success%", "Rev (EGP)", "Score"].map((h) => (
              <span key={h} className="text-slate-400 text-center" style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {h}
              </span>
            ))}
          </div>
          {topBusinesses.map((b) => (
            <div key={b.rank} className={`grid grid-cols-7 py-2.5 rounded-xl px-1 items-center ${rankBg[b.rank - 1]}`}>
              <span className={`text-center ${rankColors[b.rank - 1]}`} style={{ fontSize: '12px', fontWeight: 700 }}>
                {b.rank}
              </span>
              <span className="text-slate-700 text-center" style={{ fontSize: '12px', fontWeight: 500 }}>{b.business}</span>
              <span className="text-slate-500 text-center" style={{ fontSize: '12px' }}>{b.orders}</span>
              <span className="text-slate-500 text-center" style={{ fontSize: '12px' }}>{b.completed}</span>
              <span className="text-slate-500 text-center" style={{ fontSize: '12px' }}>{b.success}%</span>
              <span className="text-slate-500 text-center" style={{ fontSize: '12px' }}>{b.revenue}</span>
              <span
                className={`text-center ${b.score >= 50 ? "text-emerald-600" : "text-red-500"}`}
                style={{ fontSize: '12px', fontWeight: 700 }}
              >
                {b.score}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Returns & Exceptions + Needs Attention */}
      <div className="space-y-4">
        {/* Returns & Exceptions */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
              <AlertTriangle size={13} className="text-orange-500" />
            </div>
            <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Returns & Exceptions</h3>
          </div>
          <div className="space-y-0">
            <div className="grid grid-cols-3 pb-2 border-b border-slate-100">
              {["Type", "Count", "Note"].map((h) => (
                <span key={h} className="text-slate-400" style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {h}
                </span>
              ))}
            </div>
            {[
              { type: "Returns in process", count: 0, note: "In return flow" },
              { type: "Returns completed",  count: 2, note: "—" },
              { type: "Failed deliveries",  count: 0, note: "—" },
            ].map((row) => (
              <div key={row.type} className="grid grid-cols-3 py-2.5 border-b border-slate-50 items-center">
                <span className="text-slate-600" style={{ fontSize: '12px' }}>{row.type}</span>
                <span
                  className={row.count > 0 ? "text-amber-600" : "text-slate-400"}
                  style={{ fontSize: '13px', fontWeight: 600 }}
                >
                  {row.count}
                </span>
                <span className="text-slate-400" style={{ fontSize: '11px' }}>{row.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Needs Attention */}
        <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle size={13} className="text-red-500" />
              </div>
              <h3 className="text-slate-900" style={{ fontSize: '14px', fontWeight: 600 }}>Needs Attention</h3>
            </div>
            <span className="text-slate-400" style={{ fontSize: '11px' }}>Min. 5 orders required</span>
          </div>
          {needsAttention.map((b) => (
            <div key={b.business} className="flex items-center justify-between py-2 px-3 bg-red-50/50 rounded-xl border border-red-100">
              <div>
                <p className="text-slate-700" style={{ fontSize: '13px', fontWeight: 600 }}>{b.business}</p>
                <p className="text-slate-400" style={{ fontSize: '11px' }}>{b.orders} orders · {b.success}% success</p>
              </div>
              <div className="text-right">
                <p className="text-red-500" style={{ fontSize: '18px', fontWeight: 700 }}>{b.score}</p>
                <p className="text-slate-400" style={{ fontSize: '10px' }}>score</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
