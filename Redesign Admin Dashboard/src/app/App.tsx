import { Sidebar } from "./components/dashboard/Sidebar";
import { Header } from "./components/dashboard/Header";
import { StatsCards } from "./components/dashboard/StatsCards";
import { RevenueChart } from "./components/dashboard/RevenueChart";
import { OperationalSnapshot } from "./components/dashboard/OperationalSnapshot";
import { HeatMap } from "./components/dashboard/HeatMap";
import { TopBusinesses } from "./components/dashboard/TopBusinesses";
import { RecentOrders } from "./components/dashboard/RecentOrders";
import { StatusCharts } from "./components/dashboard/StatusCharts";
import { BarCharts } from "./components/dashboard/BarCharts";

export default function App() {
  return (
    <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col ml-64 overflow-hidden">
        {/* Header */}
        <Header />

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {/* KPI Stats */}
          <StatsCards />

          {/* Revenue Chart + Operational Snapshot */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <RevenueChart />
            </div>
            <div>
              <OperationalSnapshot />
            </div>
          </div>

          {/* Order Volume Heatmap */}
          <HeatMap />

          {/* Top Businesses + Returns */}
          <TopBusinesses />

          {/* Recent Orders & Pickups */}
          <RecentOrders />

          {/* Status Donut Charts */}
          <StatusCharts />

          {/* Bar Charts */}
          <BarCharts />

          {/* Bottom padding */}
          <div className="h-4" />
        </main>
      </div>
    </div>
  );
}
