import { LayoutGrid } from "lucide-react";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hours = ["0:00", "3:00", "6:00", "9:00", "12:00", "15:00", "18:00", "21:00"];

// Simulated order volume data [day][hour_slot]
const heatData: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0],    // Mon
  [0, 0, 0, 0, 0, 0, 0, 0],    // Tue
  [0, 0, 0, 0, 0, 0, 0, 0],    // Wed
  [0, 0, 0, 0, 0, 0, 0, 1],    // Thu
  [0, 2, 0, 1, 0, 0, 1, 0],    // Fri
  [0, 0, 0, 0, 0, 0, 0, 0],    // Sat
  [0, 0, 0, 0, 0, 0, 0, 0],    // Sun
];

const maxVal = Math.max(...heatData.flat());

function getColor(val: number): string {
  if (val === 0) return "#f8fafc";
  const ratio = val / (maxVal || 1);
  if (ratio < 0.3) return "#fef3c7";
  if (ratio < 0.6) return "#fcd34d";
  if (ratio < 0.85) return "#f59e0b";
  return "#d97706";
}

function getTextColor(val: number): string {
  if (val === 0) return "transparent";
  const ratio = val / (maxVal || 1);
  return ratio > 0.5 ? "#92400e" : "#78350f";
}

export function HeatMap() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <LayoutGrid size={14} className="text-amber-500" />
            </div>
            <h3 className="text-slate-900" style={{ fontSize: '15px', fontWeight: 600 }}>Order Volume Heatmap</h3>
          </div>
          <p className="text-slate-400" style={{ fontSize: '12px' }}>Orders by day of week and hour (local time)</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400" style={{ fontSize: '11px' }}>Low</span>
          {["#fef3c7", "#fde68a", "#fcd34d", "#f59e0b", "#d97706"].map((c) => (
            <div key={c} className="w-5 h-4 rounded" style={{ backgroundColor: c }} />
          ))}
          <span className="text-slate-400" style={{ fontSize: '11px' }}>High</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 500 }}>
          {/* Hour labels */}
          <div className="flex mb-2 ml-12">
            {hours.map((h) => (
              <div key={h} className="flex-1 text-center text-slate-400" style={{ fontSize: '11px' }}>
                {h}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          {days.map((day, di) => (
            <div key={day} className="flex items-center gap-0 mb-1.5">
              <div
                className="w-12 text-right pr-3 text-slate-500 flex-shrink-0"
                style={{ fontSize: '12px', fontWeight: 500 }}
              >
                {day}
              </div>
              {heatData[di].map((val, hi) => (
                <div
                  key={hi}
                  className="flex-1 h-10 rounded-lg mx-0.5 flex items-center justify-center transition-transform hover:scale-105 cursor-default"
                  style={{ backgroundColor: getColor(val) }}
                  title={`${day} ${hours[hi]}: ${val} orders`}
                >
                  {val > 0 && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: getTextColor(val) }}>
                      {val}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
